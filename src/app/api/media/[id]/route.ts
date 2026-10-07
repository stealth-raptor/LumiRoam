import { Readable } from "node:stream";
import { dbConfigured } from "@/lib/db";
import { openMedia } from "@/lib/media";

export async function GET(_req: Request, ctx: RouteContext<"/api/media/[id]">) {
  if (!dbConfigured()) return new Response("no database", { status: 503 });
  const { id } = await ctx.params;
  const media = await openMedia(id);
  if (!media) return new Response("not found", { status: 404 });
  return new Response(Readable.toWeb(media.stream) as ReadableStream, {
    headers: {
      "Content-Type": media.contentType,
      "Content-Length": String(media.length),
      // content never changes for an id, so phones can keep it
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
