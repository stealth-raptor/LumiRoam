import { ObjectId } from "mongodb";
import { cached, db, fromSpotDoc, type SpotDoc } from "./db";
import { bearing, distanceM, toGeoJSON } from "./geo";
import { wikiGeosearch, wikiSummaries } from "./sources/wikipedia";
import type { LatLon, Spot } from "./types";

type PlaceDoc = {
  _id: string; // "wiki/<pageid>"
  title: string;
  at: ReturnType<typeof toGeoJSON>;
  extract: string | null;
};

type WalkDoc = {
  _id: ObjectId;
  shootId: ObjectId | null;
  heard: string[]; // place ids already talked about
  doneShots: string[]; // spot keys the walker has already been talked through at the spot
  lastShotNote?: { key: string; bucket: number }; // last "your shot is N m away" so we don't repeat it
  events: WalkEvent[]; // everything the guide said, for the walk diary
  startedAt: Date;
  lastTickAt?: Date;
  endedAt?: Date;
};

export type WalkEvent = {
  at: Date;
  kind: "shot-here" | "shot-near" | "story";
  title: string;
  text: string;
  audioId: string | null;
  loc: ReturnType<typeof toGeoJSON>;
};

export async function startWalk(shootId: string | null): Promise<string> {
  const d = await db();
  const { insertedId } = await d.collection<Omit<WalkDoc, "_id">>("walks").insertOne({
    shootId: shootId && ObjectId.isValid(shootId) ? new ObjectId(shootId) : null,
    heard: [],
    doneShots: [],
    events: [],
    startedAt: new Date(),
  });
  return insertedId.toHexString();
}

export async function getWalk(walkId: string) {
  if (!ObjectId.isValid(walkId)) return null;
  return (await db()).collection<WalkDoc>("walks").findOne({ _id: new ObjectId(walkId) });
}

/** Closest planned shot (by where to stand) in a shoot, via $geoNear on the 2dsphere index. */
export async function nearestPlannedShot(
  shootId: string,
  here: LatLon,
  skipKeys: string[] = [],
): Promise<{ spot: Spot; distanceM: number; bearing: number } | null> {
  if (!ObjectId.isValid(shootId)) return null;
  const d = await db();
  const [hit] = await d
    .collection<SpotDoc>("spots")
    .aggregate<SpotDoc & { dist: number }>([
      {
        $geoNear: {
          near: toGeoJSON(here),
          key: "stand",
          distanceField: "dist",
          spherical: true,
          query: { shootId: new ObjectId(shootId), key: { $nin: skipKeys } },
        },
      },
      { $limit: 1 },
    ])
    .toArray();
  if (!hit) return null;
  const spot = fromSpotDoc(hit);
  return { spot, distanceM: Math.round(hit.dist), bearing: Math.round(bearing(here, spot.shot.stand)) };
}

/**
 * Make sure Wikipedia places around `here` are in the `places` collection.
 * Cached per ~500 m grid cell for a day, so a walk doesn't re-query Wikipedia every tick.
 */
async function ensurePlacesAround(here: LatLon) {
  const cell = `${(Math.round(here.lat * 200) / 200).toFixed(3)},${(Math.round(here.lon * 200) / 200).toFixed(3)}`;
  await cached(`places-cell:${cell}`, 86400, async () => {
    const d = await db();
    const found = await wikiGeosearch(here, 800, 40);
    const ids = found.map((f) => `wiki/${f.pageid}`);
    const known = new Set(
      (await d.collection<PlaceDoc>("places").find({ _id: { $in: ids } }, { projection: { _id: 1 } }).toArray()).map((p) => p._id),
    );
    const fresh = found.filter((f) => !known.has(`wiki/${f.pageid}`));
    if (fresh.length) {
      const sums = await wikiSummaries(fresh.map((f) => f.title));
      await d.collection<PlaceDoc>("places").bulkWrite(
        fresh.map((f) => ({
          updateOne: {
            filter: { _id: `wiki/${f.pageid}` },
            update: { $set: { title: f.title, at: toGeoJSON(f.at), extract: sums.get(f.title)?.extract ?? null } },
            upsert: true,
          },
        })),
      );
    }
    return found.length;
  });
}

/** Nearest documented place within 350 m that this walk hasn't talked about yet. */
export async function nextUnheardPlace(
  walkId: string,
  here: LatLon,
  { markHeard }: { markHeard: boolean },
): Promise<{ id: string; title: string; extract: string; distanceM: number; bearing: number } | null> {
  const walk = await getWalk(walkId);
  if (!walk) return null;
  await ensurePlacesAround(here);
  const d = await db();
  const [hit] = await d
    .collection<PlaceDoc>("places")
    .aggregate<PlaceDoc & { dist: number }>([
      {
        $geoNear: {
          near: toGeoJSON(here),
          key: "at",
          distanceField: "dist",
          maxDistance: 350,
          spherical: true,
          query: { _id: { $nin: walk.heard }, extract: { $ne: null } },
        },
      },
      { $limit: 1 },
    ])
    .toArray();
  if (!hit || !hit.extract) return null;
  if (markHeard) {
    await d.collection<WalkDoc>("walks").updateOne({ _id: walk._id }, { $addToSet: { heard: hit._id }, $set: { lastTickAt: new Date() } });
  }
  const at = { lat: hit.at.coordinates[1], lon: hit.at.coordinates[0] };
  return { id: hit._id, title: hit.title, extract: hit.extract, distanceM: Math.round(hit.dist), bearing: Math.round(bearing(here, at)) };
}

export async function updateWalk(walkId: string, update: { doneShot?: string; lastShotNote?: { key: string; bucket: number } }) {
  const d = await db();
  await d.collection<WalkDoc>("walks").updateOne(
    { _id: new ObjectId(walkId) },
    {
      ...(update.doneShot ? { $addToSet: { doneShots: update.doneShot } } : {}),
      $set: { lastTickAt: new Date(), ...(update.lastShotNote ? { lastShotNote: update.lastShotNote } : {}) },
    },
  );
}

/** GPS breadcrumbs go into a MongoDB time-series collection (see ensureIndexes in db.ts). */
export async function recordTrail(walkId: string, points: { lat: number; lon: number; t: number; acc?: number }[]) {
  if (!points.length || !ObjectId.isValid(walkId)) return;
  const walk = new ObjectId(walkId);
  await (await db()).collection("walk_points").insertMany(
    points.map((p) => ({ ts: new Date(p.t), walk, loc: toGeoJSON(p), acc: p.acc ?? null })),
    { ordered: false },
  );
}

export async function logEvents(walkId: string, events: WalkEvent[]) {
  if (!events.length) return;
  await (await db())
    .collection<WalkDoc>("walks")
    .updateOne({ _id: new ObjectId(walkId) }, { $push: { events: { $each: events, $slice: -300 } } });
}

export async function endWalk(walkId: string) {
  if (!ObjectId.isValid(walkId)) return;
  await (await db()).collection<WalkDoc>("walks").updateOne({ _id: new ObjectId(walkId) }, { $set: { endedAt: new Date() } });
}

/** Everything the walk diary needs: route (time series), what was said, and planned vs reached shots. */
export async function walkDiary(walkId: string) {
  const walk = await getWalk(walkId);
  if (!walk) return null;
  const d = await db();
  const pts = await d
    .collection<{ ts: Date; loc: { coordinates: [number, number] } }>("walk_points")
    .find({ walk: walk._id }, { projection: { _id: 0, ts: 1, loc: 1 } })
    .sort({ ts: 1 })
    .toArray();
  const route = pts.map((p) => ({ lat: p.loc.coordinates[1], lon: p.loc.coordinates[0], t: p.ts.getTime() }));
  let distance = 0;
  for (let i = 1; i < route.length; i++) distance += distanceM(route[i - 1], route[i]);
  const spots = walk.shootId
    ? (await d.collection<SpotDoc>("spots").find({ shootId: walk.shootId }).sort({ order: 1 }).toArray()).map(fromSpotDoc)
    : [];
  return {
    walkId,
    shootId: walk.shootId?.toHexString() ?? null,
    startedAt: walk.startedAt.toISOString(),
    endedAt: (walk.endedAt ?? walk.lastTickAt ?? walk.startedAt).toISOString(),
    distanceM: Math.round(distance),
    route,
    spots,
    reached: walk.doneShots ?? [],
    events: (walk.events ?? []).map((e) => ({
      at: e.at.toISOString(),
      kind: e.kind,
      title: e.title,
      text: e.text,
      audioId: e.audioId,
      lat: e.loc.coordinates[1],
      lon: e.loc.coordinates[0],
    })),
  };
}
export type WalkDiary = NonNullable<Awaited<ReturnType<typeof walkDiary>>>;
