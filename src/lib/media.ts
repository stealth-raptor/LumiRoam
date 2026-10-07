import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { GridFSBucket, ObjectId } from "mongodb";
import { db } from "./db";

// Generated media (crayon sketches, spoken clips) lives in MongoDB GridFS, keyed by what produced it.
// The same key is never generated twice: a sketch of the same photo in the same light, or the same
// sentence in the same voice, comes straight back from Atlas instead of costing another API call.

const BUCKET = "media";

async function bucket() {
  return new GridFSBucket(await db(), { bucketName: BUCKET });
}

export const mediaKey = (...parts: unknown[]) =>
  createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);

export const mediaUrl = (id: string) => `/api/media/${id}`;

export async function findMedia(key: string): Promise<string | null> {
  const f = await (await db()).collection(`${BUCKET}.files`).findOne({ "metadata.key": key }, { projection: { _id: 1 } });
  return f ? (f._id as ObjectId).toHexString() : null;
}

export async function putMedia(
  key: string,
  data: Buffer,
  contentType: string,
  meta: Record<string, unknown> = {},
): Promise<string> {
  const existing = await findMedia(key);
  if (existing) return existing;
  const b = await bucket();
  const id = new ObjectId();
  await new Promise<void>((resolve, reject) => {
    Readable.from(data)
      .pipe(b.openUploadStreamWithId(id, `${meta.kind ?? "media"}-${key}`, { metadata: { key, contentType, ...meta } }))
      .on("finish", () => resolve())
      .on("error", reject);
  });
  return id.toHexString();
}

/** Look up by key, or produce + store it. `make` only runs on a cache miss. */
export async function cachedMedia(
  key: string,
  contentType: string,
  meta: Record<string, unknown>,
  make: () => Promise<Buffer>,
): Promise<{ id: string; hit: boolean }> {
  const hit = await findMedia(key);
  if (hit) return { id: hit, hit: true };
  return { id: await putMedia(key, await make(), contentType, meta), hit: false };
}

export async function openMedia(id: string) {
  if (!ObjectId.isValid(id)) return null;
  const _id = new ObjectId(id);
  const file = await (await db()).collection(`${BUCKET}.files`).findOne({ _id });
  if (!file) return null;
  return {
    contentType: (file.metadata?.contentType as string) ?? "application/octet-stream",
    length: file.length as number,
    stream: (await bucket()).openDownloadStream(_id),
  };
}
