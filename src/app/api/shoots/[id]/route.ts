import { dbConfigured, loadShoot } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/shoots/[id]">) {
  if (!dbConfigured()) return Response.json({ error: "Database not configured" }, { status: 503 });
  const { id } = await ctx.params;
  const found = await loadShoot(id);
  if (!found) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(found);
}
