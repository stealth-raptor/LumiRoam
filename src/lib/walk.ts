import { ObjectId } from "mongodb";
import { cached, db, fromSpotDoc, type SpotDoc } from "./db";
import { bearing, toGeoJSON } from "./geo";
import { wikiGeosearch, wikiSummaries } from "./sources/wikipedia";
import type { LatLon, Spot } from "./types";

type PlaceDoc = {
  _id: string; // "wiki/<pageid>"
  title: string;
  at: ReturnType<typeof toGeoJSON>;
  extract: string | null;
};

type WalkDoc = { _id: ObjectId; shootId: ObjectId | null; heard: string[]; startedAt: Date; lastTickAt?: Date };

export async function startWalk(shootId: string | null): Promise<string> {
  const d = await db();
  const { insertedId } = await d.collection<Omit<WalkDoc, "_id">>("walks").insertOne({
    shootId: shootId && ObjectId.isValid(shootId) ? new ObjectId(shootId) : null,
    heard: [],
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
          query: { shootId: new ObjectId(shootId) },
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
