import type { Gear } from "./types";

// Full-frame bodies by name, for the common brands. Anything else defaults to APS-C, which is what
// most beginner and mid-range interchangeable-lens cameras use; the user can override it.
const FULL_FRAME = [
  /\beos\s*(r|r3|r5|r6|r8|rp|1d|5d|6d)\b/i, // Canon (R6 Mark II etc. still start this way)
  /\beos\s*(r[3568p]|[156]d)/i,
  /\bnikon\s*(z\s*[5-9]|z\s*f\b|d(6|7)[0-9]{2}\b|d8[0-9]{2}\b|df\b)/i,
  /\b(z\s*[5-9](\s*ii)?|zf)\b/i,
  /\b(a7|a9|a1)\b|\balpha\s*(7|9|1)\b|ilce-[79]/i, // Sony
  /\blumix\s*s|\bs5|\bs1\b/i, // Panasonic full frame
  /\bleica\s*(sl|q|m)\b/i,
];

export function guessSensor(camera: string): Gear["sensor"] | null {
  const c = camera.trim();
  if (c.length < 3) return null;
  return FULL_FRAME.some((re) => re.test(c)) ? "full" : "apsc";
}

/** Canon's APS-C is slightly smaller (1.6x) than Nikon/Sony/Fuji (1.5x). */
export function cropFactor(gear: Gear): number {
  if (gear.sensor === "full") return 1;
  return /canon|eos/i.test(gear.camera ?? "") ? 1.6 : 1.5;
}

export function describeCamera(gear: Gear): string {
  const sensor = gear.sensor === "full" ? "full-frame sensor" : `APS-C sensor, ${cropFactor(gear)}x crop`;
  return gear.camera?.trim() ? `${gear.camera.trim()} (${sensor})` : sensor;
}
