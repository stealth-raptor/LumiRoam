import { z } from "zod";
import { toGeoJSON } from "@/lib/geo";
import { mediaUrl } from "@/lib/media";
import { speakCached, voiceConfigured } from "@/lib/voice";
import { logEvents, recordTrail, type WalkEvent } from "@/lib/walk";
import { walkTick } from "@/mastra/walk-tick";

const Tick = z.object({
  walkId: z.string(),
  shootId: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  heading: z.number().nullable(),
  // positions seen since the last tick, for the walk diary's route
  trail: z.array(z.object({ lat: z.number(), lon: z.number(), t: z.number(), acc: z.number().optional() })).max(500).default([]),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  const parsed = Tick.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad tick" }, { status: 400 });
  const { walkId, shootId, lat, lon, heading, trail } = parsed.data;

  const [parts] = await Promise.all([
    walkTick({ walkId, shootId, here: { lat, lon }, heading }),
    recordTrail(walkId, trail).catch((e) => console.warn("[walk] trail not saved:", e.message)),
  ]);

  // one clip per part: each sentence is cached in GridFS on its own, so repeats are free
  const clips = await Promise.all(
    parts.map(async (p) => {
      if (!voiceConfigured()) return null;
      try {
        return await speakCached(p.text, { walkId, title: p.title });
      } catch (err) {
        console.warn("[walk] ElevenLabs failed:", (err as Error).message); // phone falls back to its own voice
        return null;
      }
    }),
  );

  const at = new Date();
  const events: WalkEvent[] = parts.map((p, i) => ({ ...p, at, audioId: clips[i], loc: toGeoJSON({ lat, lon }) }));
  await logEvents(walkId, events).catch((e) => console.warn("[walk] events not saved:", e.message));

  return Response.json({
    parts: parts.map((p, i) => ({ ...p, audioUrl: clips[i] ? mediaUrl(clips[i]!) : null })),
  });
}
