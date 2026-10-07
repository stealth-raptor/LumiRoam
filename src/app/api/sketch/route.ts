import { ObjectId } from "mongodb";
import { z } from "zod";
import { db, dbConfigured } from "@/lib/db";
import { drawPrompt, T2I_MODEL, t2iConfigured } from "@/lib/t2i";
import type { Frame } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({ shootId: z.string(), spotKey: z.string(), index: z.number().int().min(0).max(3) });

// The Space queues work on one GPU anyway; drawing one at a time per server keeps the
// daily allowance predictable and avoids piling requests into its queue.
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const job = queue.then(fn);
  queue = job.catch(() => {});
  return job;
}

/** Draw frame `index` of a saved spot with the text-to-image model (or return it if already drawn). */
export async function POST(req: Request) {
  if (!dbConfigured()) return Response.json({ error: "no database" }, { status: 503 });
  if (!t2iConfigured()) return Response.json({ error: "text-to-image not configured (Cloudflare account/token or HF_TOKEN)" }, { status: 503 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !ObjectId.isValid(parsed.data.shootId)) return Response.json({ error: "bad request" }, { status: 400 });
  const { shootId, spotKey, index } = parsed.data;

  const spots = (await db()).collection<{ shootId: ObjectId; key: string; name: string; frames?: Frame[] }>("spots");
  const filter = { shootId: new ObjectId(shootId), key: spotKey };
  const spot = await spots.findOne(filter, { projection: { frames: 1, name: 1 } });
  const frame = spot?.frames?.[index];
  if (!spot || !frame) return Response.json({ error: "unknown frame" }, { status: 404 });
  if (frame.url) return Response.json({ url: frame.url, model: frame.model });

  try {
    const url = await serial(() => drawPrompt(frame.prompt, { spot: spot.name, label: frame.label }));
    await spots.updateOne(filter, { $set: { [`frames.${index}.url`]: url, [`frames.${index}.model`]: T2I_MODEL() } });
    return Response.json({ url, model: T2I_MODEL() });
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    console.warn(`[sketch] drawing failed for ${spot.name} #${index}:`, msg.slice(0, 300));
    // free tiers say so when the daily allowance is used up; the client keeps the geometry sketch
    const quota = /quota|exceeded|rate.?limit|allowance|402|429/i.test(msg);
    return Response.json({ error: quota ? "Daily free drawing allowance used up" : "drawing failed" }, { status: quota ? 429 : 502 });
  }
}
