import { writeFileSync } from "node:fs";
import { mastra } from "../src/mastra";

const place = process.argv[2] ?? "Tower Bridge, London";
const localTime = process.argv[3] ?? "2026-10-09T18:00";
const t0 = Date.now();
const run = await mastra.getWorkflow("planShootWorkflow").createRun();
const res = await run.start({
  inputData: { place, localTime, gear: { camera: "Canon EOS 250D", sensor: "apsc", lenses: "18-55mm kit, 50mm f/1.8" }, radiusM: 1500 },
});
console.log("status", res.status, `${Date.now() - t0}ms`);
if (res.status !== "success") { console.dir(res, { depth: 4 }); process.exit(1); }
const r = res.result;
console.log(r.label, "|", r.timezone, "|", r.weather.summary, "| notes:", r.notes);
for (const s of r.spots) {
  console.log(`\n## ${s.name} [${s.kind}] ${s.distanceM}m — ${s.light.phase}, ${s.shot.lightAngle}, stand=${s.shot.standSource}`);
  console.log("  photo:", s.photo?.title ?? "none");
  console.log("  plan:", JSON.stringify(s.plan, null, 1));
  console.log("  sketch:", s.sketch?.source, s.sketch?.url.length);
}
writeFileSync("scripts/out-sketch.svg", Buffer.from(r.spots[0].sketch!.url.split(",")[1], "base64"));
