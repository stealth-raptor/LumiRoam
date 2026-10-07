import { MongoClient, ObjectId, type Db } from "mongodb";
import { toGeoJSON } from "./geo";
import type { LatLon, Spot } from "./types";

// One long-running Node server on App Platform, one user, Atlas M0 (500-connection cap):
// a single cached client with a small pool is plenty. The global survives `next dev` hot reloads.
const g = globalThis as unknown as { _mongo?: Promise<MongoClient>; _indexes?: Promise<void> };

export const dbConfigured = () => !!process.env.MONGODB_URI;

export async function db(): Promise<Db> {
  if (!process.env.MONGODB_URI) throw new Error("MONGODB_URI is not set");
  g._mongo ??= new MongoClient(process.env.MONGODB_URI, {
    maxPoolSize: 10, // a walk tick + a plan request at once is the realistic peak
    minPoolSize: 0, // the app sits idle most of the day; don't hold M0 connections open
    maxIdleTimeMS: 60_000,
    serverSelectionTimeoutMS: 8_000, // fail fast on a bad URI / IP allowlist instead of hanging the UI
    appName: "lumiroam",
  }).connect();
  const client = await g._mongo;
  const database = client.db(process.env.MONGODB_DB ?? "lumiroam");
  g._indexes ??= ensureIndexes(database);
  await g._indexes;
  return database;
}

async function ensureIndexes(d: Db) {
  // walk breadcrumbs: a time-series collection (compact, bucketed by walk, auto-expires after 90 days)
  const existing = new Set((await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
  if (!existing.has("walk_points")) {
    await d
      .createCollection("walk_points", {
        timeseries: { timeField: "ts", metaField: "walk", granularity: "seconds" },
        expireAfterSeconds: 90 * 86400,
      })
      .catch((e) => {
        if (e?.codeName !== "NamespaceExists") throw e;
      });
  }
  await Promise.all([
    // GridFS media are looked up by what produced them (cache key), never generated twice
    d.collection("media.files").createIndex({ "metadata.key": 1 }, { unique: true }),
    d.collection("walk_points").createIndex({ walk: 1, ts: 1 }),
    // "is my planned shot near me": $geoNear on where to stand, scoped to one shoot
    d.collection("spots").createIndex({ stand: "2dsphere", shootId: 1 }),
    // "what's here that I haven't heard about": $geoNear over cached Wikipedia places
    d.collection("places").createIndex({ at: "2dsphere" }),
    d.collection("cache").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
    d.collection("shoots").createIndex({ createdAt: -1 }),
  ]);
}

export type ShootDoc = {
  _id: ObjectId;
  place: string;
  label: string;
  center: ReturnType<typeof toGeoJSON>;
  localTime: string;
  timezone: string;
  gear: { sensor: string; lenses: string };
  createdAt: Date;
};

export type SpotDoc = Omit<Spot, "subject" | "shot"> & {
  shootId: ObjectId;
  order: number;
  subject: ReturnType<typeof toGeoJSON>;
  stand: ReturnType<typeof toGeoJSON>;
  shot: Omit<Spot["shot"], "stand">;
};

export async function saveShoot(
  shoot: Omit<ShootDoc, "_id" | "createdAt" | "center"> & { center: LatLon },
  spots: Spot[],
): Promise<string> {
  const d = await db();
  const { insertedId } = await d.collection("shoots").insertOne({
    ...shoot,
    center: toGeoJSON(shoot.center),
    createdAt: new Date(),
  });
  if (spots.length) {
    await d.collection<Omit<SpotDoc, "_id">>("spots").insertMany(
      spots.map((s, order) => {
        const { stand, ...shot } = s.shot;
        return { ...s, shootId: insertedId, order, subject: toGeoJSON(s.subject), stand: toGeoJSON(stand), shot };
      }),
    );
  }
  return insertedId.toHexString();
}

export function fromSpotDoc(doc: SpotDoc & { _id?: unknown; dist?: number }): Spot {
  // drop Mongo-only fields: ObjectIds can't be passed to client components
  const { _id, shootId, order, dist, subject, stand, shot, ...rest } = doc;
  void [_id, shootId, order, dist];
  const ll = (p: { coordinates: [number, number] }) => ({ lat: p.coordinates[1], lon: p.coordinates[0] });
  return { ...(rest as unknown as Spot), subject: ll(subject), shot: { ...shot, stand: ll(stand) } };
}

export async function loadShoot(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const d = await db();
  const _id = new ObjectId(id);
  const shoot = await d.collection<ShootDoc>("shoots").findOne({ _id });
  if (!shoot) return null;
  const spots = await d.collection<SpotDoc>("spots").find({ shootId: _id }).sort({ order: 1 }).toArray();
  return { shoot, spots: spots.map(fromSpotDoc) };
}

export async function listShoots(limit = 20) {
  const d = await db();
  return d
    .collection<ShootDoc>("shoots")
    .find({}, { projection: { place: 1, label: 1, localTime: 1, createdAt: 1 } })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
}

/** Small JSON cache with TTL, so we don't hammer Overpass/Nominatim/Wikimedia while testing. */
export async function cached<T>(key: string, ttlSeconds: number, fn: () => Promise<T>): Promise<T> {
  if (!dbConfigured()) return fn();
  const col = (await db()).collection<{ _id: string; value: T; expiresAt: Date }>("cache");
  const hit = await col.findOne({ _id: key });
  if (hit && hit.expiresAt > new Date()) return hit.value;
  const value = await fn();
  await col.updateOne(
    { _id: key },
    { $set: { value, expiresAt: new Date(Date.now() + ttlSeconds * 1000) } },
    { upsert: true },
  );
  return value;
}
