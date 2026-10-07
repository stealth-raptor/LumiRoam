import { dbConfigured } from "@/lib/db";
import { startWalk } from "@/lib/walk";

export async function POST(req: Request) {
  if (!dbConfigured()) return Response.json({ error: "Walk mode needs MongoDB (MONGODB_URI)." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { shootId?: string };
  const walkId = await startWalk(body.shootId ?? null);
  return Response.json({ walkId });
}
