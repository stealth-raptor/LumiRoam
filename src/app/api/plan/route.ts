import { mastra } from "@/mastra";
import { PlanRequest } from "@/lib/types";

export const maxDuration = 180;

export async function POST(req: Request) {
  const parsed = PlanRequest.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the place and time." }, { status: 400 });

  const run = await mastra.getWorkflow("planShootWorkflow").createRun();
  const res = await run.start({ inputData: parsed.data });
  if (res.status !== "success") {
    const msg = res.status === "failed" ? String(res.error?.message ?? res.error) : res.status;
    console.error("[plan] workflow", res.status, msg);
    return Response.json({ error: msg }, { status: 502 });
  }
  return Response.json(res.result);
}
