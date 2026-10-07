import { z } from "zod";

export const LatLon = z.object({ lat: z.number(), lon: z.number() });
export type LatLon = z.infer<typeof LatLon>;

export const CommonsPhoto = z.object({
  title: z.string(),
  url: z.string(),
  thumbUrl: z.string(),
  pageUrl: z.string(),
  artist: z.string(),
  license: z.string(),
  // where the camera stood, when Commons knows it
  camera: LatLon.nullable(),
});
export type CommonsPhoto = z.infer<typeof CommonsPhoto>;

export const SpotKind = z.enum([
  "viewpoint",
  "tower",
  "bridge",
  "church",
  "monument",
  "building",
  "nature",
  "other",
]);
export type SpotKind = z.infer<typeof SpotKind>;

export const Candidate = z.object({
  key: z.string(),
  name: z.string(),
  kind: SpotKind,
  subject: LatLon,
  heightM: z.number().nullable(),
  direction: z.number().nullable(), // OSM viewpoint direction tag, degrees
  wikiTitle: z.string().nullable(),
  wikiExtract: z.string().nullable(),
  osmTags: z.record(z.string(), z.string()),
  distanceM: z.number(),
  score: z.number(),
});
export type Candidate = z.infer<typeof Candidate>;

export const Weather = z.object({
  cloudCover: z.number().nullable(),
  cloudLow: z.number().nullable(),
  precipProb: z.number().nullable(),
  visibilityM: z.number().nullable(),
  summary: z.string(),
});
export type Weather = z.infer<typeof Weather>;

export const Light = z.object({
  phase: z.enum(["night", "blue hour", "golden hour", "low sun", "high sun"]),
  sunAltitude: z.number(),
  sunAzimuth: z.number(), // compass bearing, 0 = north
  sunCompass: z.string(),
  sunrise: z.string().nullable(), // local HH:MM
  sunset: z.string().nullable(),
  goldenStart: z.string().nullable(), // evening golden hour start
  blueEnd: z.string().nullable(), // evening blue hour end (civil dusk)
});
export type Light = z.infer<typeof Light>;

export const ShotGeometry = z.object({
  stand: LatLon,
  facing: z.number(),
  facingCompass: z.string(),
  standDistanceM: z.number(),
  standSource: z.enum(["commons-camera", "viewpoint", "computed"]),
  lightAngle: z.enum(["front-lit", "side-lit", "back-lit", "no direct sun"]),
  focalFF: z.number().nullable(), // full-frame equivalent mm
  settings: z.object({
    aperture: z.string(),
    shutter: z.string(),
    iso: z.number(),
    tripod: z.boolean(),
  }),
});
export type ShotGeometry = z.infer<typeof ShotGeometry>;

export const Plan = z.object({
  headline: z.string(),
  whereToStand: z.string(),
  lens: z.string(),
  settings: z.string(),
  tip: z.string(),
  // a little history of the structure, retold from its Wikipedia text only
  history: z.string().default(""),
  writtenBy: z.enum(["gemma", "template"]),
});
export type Plan = z.infer<typeof Plan>;

/** The free fallback picture: an SVG drawn from sun position and geometry alone. */
export const Sketch = z.object({
  url: z.string(), // /api/media/<GridFS id>, or a data: URL when there's no database
  source: z.literal("geometry"),
});
export type Sketch = z.infer<typeof Sketch>;

/**
 * The drawing for a stop. Gemma looks at the real Commons photo plus the computed facts and writes
 * the prompt; an open text-to-image model draws it. `url` is null until drawn.
 */
export const Frame = z.object({
  label: z.string(), // e.g. "Tomb from below"
  prompt: z.string(),
  promptBy: z.enum(["gemma", "template"]),
  url: z.string().nullable(),
  model: z.string().nullable(),
});
export type Frame = z.infer<typeof Frame>;

export const Spot = Candidate.extend({
  photo: CommonsPhoto.nullable(),
  light: Light,
  weather: Weather,
  shot: ShotGeometry,
  plan: Plan.nullable(),
  sketch: Sketch.nullable(),
  frames: z.array(Frame).default([]),
});
export type Spot = z.infer<typeof Spot>;

export const Gear = z.object({
  camera: z.string().max(80).default(""), // free text, e.g. "Canon EOS 250D"
  sensor: z.enum(["apsc", "full"]),
  lenses: z.string(),
});
export type Gear = z.infer<typeof Gear>;

export const PlanRequest = z.object({
  place: z.string().min(2),
  localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/), // wall-clock time at the place
  gear: Gear,
  radiusM: z.number().min(300).max(5000).default(800), // a photowalk, not a city tour
});
export type PlanRequest = z.infer<typeof PlanRequest>;
