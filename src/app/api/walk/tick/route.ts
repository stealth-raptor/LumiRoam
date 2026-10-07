import { z } from "zod";
import { speak, voiceConfigured } from "@/lib/voice";
import { walkTick } from "@/mastra/walk-tick";

const Tick = z.object({
  walkId: z.string(),
  shootId: z.string().nullable(),
  lat: z.number(),
  lon: z.number(),
  heading: z.number().nullable(),
});

export const maxDuration = 60;

export async function POST(req: Request) {
  const parsed = Tick.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad tick" }, { status: 400 });
  const { walkId, shootId, lat, lon, heading } = parsed.data;

  const parts = await walkTick({ walkId, shootId, here: { lat, lon }, heading });
  if (!parts.length) return Response.json({ parts, audio: null });

  const text = parts.map((p) => p.text).join(" ... ");
  let audio: string | null = null;
  if (voiceConfigured()) {
    try {
      audio = (await speak(text)).toString("base64");
    } catch (err) {
      // the phone falls back to the browser's own speech synthesis
      console.warn("[walk] ElevenLabs failed:", (err as Error).message);
    }
  }
  return Response.json({ parts, text, audio });
}
