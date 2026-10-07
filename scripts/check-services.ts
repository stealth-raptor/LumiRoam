import { writeFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { mastra } from "../src/mastra";
import { speak } from "../src/lib/voice";

const step = async (name: string, fn: () => Promise<string>) => {
  const t = Date.now();
  try { console.log(`${name} ok ${Date.now() - t}ms:`, (await fn()).slice(0, 400)); }
  catch (e) { console.log(`${name} FAILED:`, (e as Error).message.slice(0, 400)); }
};

await step("atlas", async () => String((await (await db()).command({ ping: 1 })).ok));
await step("gemma", async () => {
  const res = await mastra.getAgent("guideAgent").generate(
    "LISTENER POSITION: Tower Bridge is about 80 metres straight ahead.\n\nSOURCE TEXT (Wikipedia):\nTower Bridge is a Grade I listed combined bascule, suspension, and, until 1960, cantilever bridge in London, built between 1886 and 1894. It crosses the River Thames close to the Tower of London.",
    { abortSignal: AbortSignal.timeout(60_000) },
  );
  return res.text;
});
await step("flux", async () => {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/black-forest-labs/flux-1-schnell`, {
    method: "POST", headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Looking up at a domed Mughal tomb from the bottom of its steps, blue sky, drawn as a young child's wax crayon picture on white paper", steps: 4 }),
  });
  const j = await r.json() as any;
  if (!j?.result?.image) throw new Error(`${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  writeFileSync("scripts/check-flux.jpg", Buffer.from(j.result.image, "base64"));
  return `${r.status}, ${j.result.image.length} b64 chars`;
});
await step("elevenlabs", async () => `${(await speak("Hello from LumiRoam. Your planned shot is about eighty metres ahead.")).length} bytes mp3`);
process.exit(0);
