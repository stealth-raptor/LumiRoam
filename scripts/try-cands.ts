import { findCandidates, pickDiverse } from "../src/lib/spots";
import { findPhoto } from "../src/lib/sources/commons";
const c = { lat: 51.5055, lon: -0.0754 };
const t0 = Date.now();
const all = await findCandidates(c, 1500);
console.log("all", all.length, Date.now() - t0, "ms; osm:", all.filter(x => !x.key.startsWith("wiki/")).length);
for (const x of all.slice(0, 25)) console.log(x.score.toFixed(1), x.kind.padEnd(9), x.key.padEnd(22), x.name, x.wikiExtract ? "" : "(no wiki)");
const picks = pickDiverse(all, 16);
console.log("\npicks:", picks.map(p => p.name).join(" | "));
for (const p of picks.slice(0, 8)) {
  const t = Date.now();
  const ph = await findPhoto(p.subject, p.name, null).catch(e => "ERR " + e.message);
  console.log(p.name, "->", typeof ph === "string" ? ph : ph?.title ?? null, Date.now() - t, "ms");
}
