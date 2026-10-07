export {};
// Simulated walk against the running dev server: approach a planned shot, arrive, then end.
const BASE = "http://localhost:3000";
const shootId = process.argv[2];
const post = async (path: string, body: unknown) => {
  const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
};
const sh = await (await fetch(`${BASE}/api/shoots/${shootId}`)).json();
const target = sh.spots[1];
const stand = target.shot.stand;
const { walkId } = await post("/api/walk/start", { shootId });
console.log("walk", walkId, "target", target.name);
const path = [
  { lat: stand.lat + 0.004, lon: stand.lon + 0.001 }, // ~450 m north
  { lat: stand.lat + 0.0018, lon: stand.lon + 0.0004 }, // ~200 m
  { lat: stand.lat + 0.0001, lon: stand.lon }, // ~10 m: at the spot
];
for (const p of path) {
  const t = Date.now();
  const trail = [{ ...p, t: Date.now() }];
  const res = await post("/api/walk/tick", { walkId, shootId, lat: p.lat, lon: p.lon, heading: 180, trail });
  console.log(`\ntick ${Date.now() - t}ms`);
  for (const part of res.parts ?? []) console.log(`  [${part.kind}] ${part.title} audio=${!!part.audioUrl}\n    ${part.text}`);
  if (res.error) console.log("  ERROR", res.error);
}
await post("/api/walk/end", { walkId, trail: [] });
console.log(`\ndiary: ${BASE}/walk/${walkId}`);
