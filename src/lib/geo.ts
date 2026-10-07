import type { LatLon } from "./types";

const R = 6371008.8;
const rad = (d: number) => (d * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;

export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Initial compass bearing from a to b, 0 = north, clockwise. */
export function bearing(a: LatLon, b: LatLon): number {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return norm360(deg(Math.atan2(y, x)));
}

/** Point reached by going `dist` metres from `p` on compass bearing `brg`. */
export function offset(p: LatLon, brg: number, dist: number): LatLon {
  const d = dist / R;
  const b = rad(brg);
  const lat1 = rad(p.lat);
  const lon1 = rad(p.lon);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return { lat: deg(lat2), lon: ((deg(lon2) + 540) % 360) - 180 };
}

export const norm360 = (d: number) => ((d % 360) + 360) % 360;

/** Smallest absolute difference between two bearings, 0..180. */
export const angleDiff = (a: number, b: number) => {
  const d = Math.abs(norm360(a) - norm360(b));
  return d > 180 ? 360 - d : d;
};

const POINTS = [
  "north", "north-north-east", "north-east", "east-north-east",
  "east", "east-south-east", "south-east", "south-south-east",
  "south", "south-south-west", "south-west", "west-south-west",
  "west", "west-north-west", "north-west", "north-north-west",
];
export const compass = (d: number) => POINTS[Math.round(norm360(d) / 22.5) % 16];

/** Turn a relative bearing into words for someone walking: "ahead", "on your left"... */
export function relativeWords(heading: number | null, target: number): string {
  if (heading == null) return `to the ${compass(target)}`;
  const rel = norm360(target - heading);
  if (rel < 30 || rel > 330) return "straight ahead";
  if (rel < 150) return "on your right";
  if (rel <= 210) return "behind you";
  return "on your left";
}

export const toGeoJSON = (p: LatLon) => ({
  type: "Point" as const,
  coordinates: [p.lon, p.lat] as [number, number],
});
