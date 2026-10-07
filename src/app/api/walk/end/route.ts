import { z } from "zod";
import { endWalk, recordTrail } from "@/lib/walk";

const End = z.object({
  walkId: z.string(),
  trail: z.array(z.object({ lat: z.number(), lon: z.number(), t: z.number(), acc: z.number().optional() })).max(500).default([]),
});

export async function POST(req: Request) {
  const parsed = End.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  await recordTrail(parsed.data.walkId, parsed.data.trail);
  await endWalk(parsed.data.walkId);
  return Response.json({ ok: true });
}
