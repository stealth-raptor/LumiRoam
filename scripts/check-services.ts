import { db } from "../src/lib/db";
import { mastra } from "../src/mastra";

const t0 = Date.now();
try {
  const d = await db();
  const r = await d.command({ ping: 1 });
  const cols = (await d.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name);
  console.log("atlas ok", r.ok, `${Date.now() - t0}ms`, "collections:", cols.join(", "));
} catch (e) { console.log("ATLAS FAILED:", (e as Error).message.slice(0, 300)); }

const t1 = Date.now();
try {
  const res = await mastra.getAgent("guideAgent").generate(
    "LISTENER POSITION: Tower Bridge is about 80 metres straight ahead.\n\nSOURCE TEXT (Wikipedia):\nTower Bridge is a Grade I listed combined bascule, suspension, and, until 1960, cantilever bridge in London, built between 1886 and 1894, designed by Horace Jones and engineered by John Wolfe Barry. It crosses the River Thames close to the Tower of London.",
    { abortSignal: AbortSignal.timeout(60_000) },
  );
  console.log("gemma ok", `${Date.now() - t1}ms`, "model:", (res as any).response?.modelId ?? "?", "\n", res.text);
} catch (e) { console.log("GEMMA FAILED:", (e as Error).message.slice(0, 500)); }
process.exit(0);
