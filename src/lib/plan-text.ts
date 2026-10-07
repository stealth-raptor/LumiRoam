import { cropFactor, describeCamera } from "./camera";
import type { Gear, Plan, Spot } from "./types";

type Lens = { min: number; max: number; label: string };

/** "18-55mm, 50mm f/1.8, EF 70-300" → focal ranges. */
export function parseLenses(text: string): Lens[] {
  const out: Lens[] = [];
  for (const m of text.matchAll(/(\d{2,3})\s*(?:-|–|to)\s*(\d{2,3})|(\d{2,3})\s*mm/gi)) {
    if (m[1] && m[2]) out.push({ min: +m[1], max: +m[2], label: `${m[1]}-${m[2]}mm` });
    else if (m[3]) out.push({ min: +m[3], max: +m[3], label: `${m[3]}mm` });
  }
  return out;
}

/**
 * Turn the full-frame-equivalent focal length into advice for the user's own body and lenses,
 * including how far to step back or forward when no lens fits.
 */
export function lensAdvice(spot: Spot, gear: Gear): string {
  const ff = spot.shot.focalFF;
  if (ff == null) return "Widest lens you have; a viewpoint is about the whole scene.";
  const crop = cropFactor(gear);
  const actual = Math.round(ff / crop);
  const eq = crop > 1 ? ` (${ff}mm full-frame equivalent)` : "";
  const lenses = parseLenses(gear.lenses);
  if (!lenses.length) return `About ${actual}mm${eq}.`;

  const fits = lenses.find((l) => actual >= l.min && actual <= l.max);
  if (fits) return `About ${actual}mm${eq}; your ${fits.label} covers it.`;

  const widest = Math.min(...lenses.map((l) => l.min));
  const longest = Math.max(...lenses.map((l) => l.max));
  const d = spot.shot.standDistanceM;
  if (actual < widest) {
    const back = Math.round(d * (widest / actual) - d);
    return `Needs about ${actual}mm${eq}, wider than your ${widest}mm. Zoom out fully and step back about ${back} m, or shoot a vertical panorama.`;
  }
  const closer = Math.round(d - d * (longest / actual));
  return `Needs about ${actual}mm${eq}. At ${longest}mm, walk about ${closer} m closer, or crop later.`;
}

export function settingsLine(spot: Spot): string {
  const s = spot.shot.settings;
  return `${s.aperture}, ${s.shutter}, ISO ${s.iso}${s.tripod ? " on a tripod or wall (too slow to hand-hold)" : ""}.`;
}

export function standLine(spot: Spot): string {
  const g = spot.shot;
  const from =
    g.standSource === "viewpoint"
      ? "At the viewpoint itself"
      : g.standSource === "commons-camera"
        ? `Where the Commons photographer stood, about ${g.standDistanceM} m from it`
        : `About ${g.standDistanceM} m from it`;
  return `${from}, facing ${g.facingCompass}.`;
}

const LIGHT_WORDS: Record<Spot["shot"]["lightAngle"], string> = {
  "front-lit": "the sun will be behind you, lighting the front evenly",
  "side-lit": "the sun comes from the side, which brings out texture",
  "back-lit": "you're looking towards the sun: expect a silhouette, so expose for the sky",
  "no direct sun": "there's no direct sun, so the light will be soft and even",
};

/** Deterministic plan, used when Gemma is offline and as a sanity baseline. */
export function templatePlan(spot: Spot, gear: Gear): Plan {
  return {
    headline: `${spot.name}: ${spot.light.phase}, ${LIGHT_WORDS[spot.shot.lightAngle].split(",")[0]}`,
    whereToStand: standLine(spot),
    lens: lensAdvice(spot, gear),
    settings: settingsLine(spot),
    tip: `${cap(LIGHT_WORDS[spot.shot.lightAngle])}. Check the histogram after the first frame and adjust.`,
    history: spot.wikiExtract ? firstSentences(spot.wikiExtract, 2) : "",
    writtenBy: "template",
  };
}

/** Everything Gemma is allowed to know about a spot. It must not add facts beyond this. */
export function factSheet(spot: Spot, gear: Gear): string {
  return [
    `SPOT: ${spot.name} (${spot.kind})`,
    `TIME OF SHOOT LIGHT: ${spot.light.phase}; sun ${spot.light.sunAltitude}° above horizon in the ${spot.light.sunCompass}. Sunset ${spot.light.sunset ?? "n/a"}, golden hour from ${spot.light.goldenStart ?? "n/a"}, blue hour ends ${spot.light.blueEnd ?? "n/a"}.`,
    `WEATHER: ${spot.weather.summary}`,
    `WHERE TO STAND (computed): ${standLine(spot)} Light on subject: ${spot.shot.lightAngle}.`,
    `LENS (computed for the user's camera): ${lensAdvice(spot, gear)}`,
    `STARTING SETTINGS (computed): ${settingsLine(spot)}`,
    `CAMERA: ${describeCamera(gear)}; lenses: ${gear.lenses || "unknown"}`,
    spot.photo ? `REFERENCE PHOTO: "${spot.photo.title.replace(/^File:/, "")}"` : "REFERENCE PHOTO: none",
    `ABOUT THE PLACE (Wikipedia): ${spot.wikiExtract ?? "no article"}`,
    DRAWING_HINT[spot.kind] ? `DRAWING HINT: ${DRAWING_HINT[spot.kind]}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// Per-stop nudges for the drawing. A general rule in the instructions wasn't always enough: for the
// garden itself Gemma sometimes drew yet another wide view instead of its trees and wildlife.
const DRAWING_HINT: Partial<Record<Spot["kind"], string>> = {
  nature:
    "this stop is a park or garden. Draw what lives in it up close: big old trees with light coming through the leaves, or a small animal that lives there (like a squirrel on a tree trunk or a bird on a branch). Not a wide view.",
  monument: "try an unusual angle, for example from the bottom of its steps looking up.",
  tower: "try looking straight up from its base.",
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Every drawing prompt starts with this (FLUX weighs the start most), so all share one look. */
export const DRAWING_STYLE =
  "A young child's wax crayon drawing on white paper, simple wobbly outlines, bright flat colours, no text";

const SKY_WORDS: Record<Spot["light"]["phase"], string> = {
  "golden hour": "warm orange and pink evening sky",
  "blue hour": "deep blue twilight sky with glowing yellow lights",
  night: "dark night sky with yellow lights",
  "low sun": "warm afternoon light and long shadows",
  "high sun": "bright blue sky with white clouds",
};

/** Put the shared style in front of a model-written scene description. */
export function styled(scene: string): string {
  const s = scene
    .trim()
    .replace(/\s+/g, " ")
    .replace(/^(a |an )?(young )?child'?s (wax )?crayon (drawing|picture)( on white paper)?( of)?[:,]?\s*/i, "")
    .replace(/,?\s*drawn as a young child's wax crayon picture on white paper\.?$/i, "")
    .replace(/[.,;\s]+$/, "");
  return `${DRAWING_STYLE}: ${s}`;
}

/** One drawing per stop from the facts alone, used when Gemma is offline. */
export function templateFrame(spot: Spot): { label: string; prompt: string } {
  const sky = SKY_WORDS[spot.light.phase];
  const n = spot.name;
  const byKind: Record<Spot["kind"], { label: string; scene: string }> = {
    tower: { label: "Looking up", scene: `${n} seen from its base looking straight up, ${sky}` },
    church: { label: "From the steps", scene: `${n} seen from the bottom of its steps looking up, ${sky}` },
    building: { label: "From below", scene: `${n} seen from low down looking up at its walls and roof, ${sky}` },
    monument: { label: "Up close", scene: `${n} close up, filling the picture, ${sky}` },
    bridge: { label: "Across the water", scene: `${n} stretching across the water with its reflection below, ${sky}` },
    nature: { label: "Under the trees", scene: `tall old trees with thick trunks in ${n}, a squirrel on one trunk, ${sky}` },
    viewpoint: { label: "The view", scene: `the wide view from ${n}, hills and rooftops to the horizon, ${sky}` },
    other: { label: "The scene", scene: `${n} with a small person in front for scale, ${sky}` },
  };
  const t = byKind[spot.kind];
  return { label: t.label, prompt: styled(t.scene) };
}

export function firstSentences(text: string, n: number): string {
  const parts = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return parts.slice(0, n).join(" ").replace(/\s+/g, " ").trim();
}
