import { InferenceClient } from "@huggingface/inference";
import { dbConfigured } from "./db";
import { norm360 } from "./geo";
import { USER_AGENT } from "./http";
import { findMedia, mediaKey, mediaUrl, putMedia } from "./media";
import type { Sketch, Spot } from "./types";

const SKETCH_MODEL = () => process.env.SKETCH_MODEL ?? "Qwen/Qwen-Image-Edit";
const SKETCH_PROVIDER = () => process.env.SKETCH_PROVIDER ?? "fal-ai";

/**
 * Crayon sketch of the shot: a rough idea, not a prediction.
 *  - SKETCH_MODE=hf: an open image-editing model on Hugging Face redraws the real Commons photo
 *    as a child's crayon drawing, so the layout is right. Costs a few cents per image.
 *  - default: an SVG drawn from the sun position and geometry alone. Free.
 * Either way the result is stored once in MongoDB GridFS and reused by every later shoot.
 */
export async function makeSketch(spot: Spot): Promise<{ sketch: Sketch; warning?: string }> {
  if (process.env.SKETCH_MODE === "hf" && spot.photo && process.env.HF_TOKEN) {
    try {
      return { sketch: await imageModelSketch(spot) };
    } catch (err) {
      console.warn(`[sketch] image model failed for ${spot.name}:`, (err as Error).message);
      return {
        sketch: await geometrySketch(spot),
        warning: "The image model didn't answer, so sketches are drawn from sun + geometry data instead.",
      };
    }
  }
  return { sketch: await geometrySketch(spot) };
}

async function imageModelSketch(spot: Spot): Promise<Sketch> {
  const photo = spot.photo!;
  const model = SKETCH_MODEL();
  // the same photo in the same light always gives the same sketch: never pay for it twice
  const key = mediaKey("sketch", model, photo.title, spot.light.phase);
  if (dbConfigured()) {
    const hit = await findMedia(key);
    if (hit) return { url: mediaUrl(hit), source: "image-model", model };
  }
  const src = await fetch(photo.thumbUrl, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(20_000) });
  if (!src.ok) throw new Error(`Commons image ${src.status}`);
  const hf = new InferenceClient(process.env.HF_TOKEN);
  const out = await hf.imageToImage(
    { provider: SKETCH_PROVIDER() as "fal-ai", model, inputs: await src.blob(), parameters: { prompt: sketchPrompt(spot) } },
    { signal: AbortSignal.timeout(90_000) },
  );
  const bytes = Buffer.from(await out.arrayBuffer());
  const type = out.type || "image/png";
  if (!dbConfigured()) return { url: `data:${type};base64,${bytes.toString("base64")}`, source: "image-model", model };
  const id = await putMedia(key, bytes, type, { kind: "sketch", model, photo: photo.title, spot: spot.name, phase: spot.light.phase });
  return { url: mediaUrl(id), source: "image-model", model };
}

export function sketchPrompt(spot: Spot): string {
  const sky: Record<Spot["light"]["phase"], string> = {
    "golden hour": "a warm orange and pink sunset sky",
    "blue hour": "a deep blue twilight sky with glowing yellow windows",
    night: "a dark night sky with yellow lights",
    "low sun": "warm afternoon light and long shadows",
    "high sun": "a bright blue sky with white clouds",
  };
  return `Redraw this photo as a young child's wax crayon drawing on white paper. Keep the same layout and composition: ${spot.name} stays where it is in the frame. Simple wobbly outlines, bright flat colours, ${sky[spot.light.phase]}. No text, no photo realism.`;
}

// ---------- geometry fallback ----------

const SKY: Record<Spot["light"]["phase"], [string, string]> = {
  "high sun": ["#7cc4f2", "#d9f0ff"],
  "low sun": ["#8ec9ee", "#fbe7b5"],
  "golden hour": ["#f59e5b", "#ffe08a"],
  "blue hour": ["#1f3a7a", "#5b74b8"],
  night: ["#0d1530", "#22305a"],
};

function subjectShape(kind: Spot["kind"], x: number, ground: number, lit: string): string {
  const s = `stroke="#3b2f2a" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" fill="${lit}"`;
  switch (kind) {
    case "tower":
      return `<path ${s} d="M${x - 28} ${ground} L${x - 22} ${ground - 190} L${x + 22} ${ground - 190} L${x + 28} ${ground} Z"/>
<path ${s} d="M${x - 26} ${ground - 190} L${x} ${ground - 250} L${x + 26} ${ground - 190} Z"/>
<circle cx="${x}" cy="${ground - 150}" r="13" fill="#fff8e0" stroke="#3b2f2a" stroke-width="4"/>`;
    case "bridge":
      return `<path ${s} d="M${x - 200} ${ground - 60} Q${x} ${ground - 110} ${x + 200} ${ground - 60} L${x + 200} ${ground - 45} Q${x} ${ground - 95} ${x - 200} ${ground - 45} Z"/>
<rect ${s} x="${x - 95}" y="${ground - 170}" width="36" height="170"/><rect ${s} x="${x + 59}" y="${ground - 170}" width="36" height="170"/>
<path ${s} d="M${x - 99} ${ground - 170} L${x - 77} ${ground - 205} L${x - 55} ${ground - 170} Z M${x + 55} ${ground - 170} L${x + 77} ${ground - 205} L${x + 99} ${ground - 170} Z"/>`;
    case "church":
      return `<rect ${s} x="${x - 80}" y="${ground - 90}" width="120" height="90"/>
<path ${s} d="M${x - 88} ${ground - 90} L${x - 20} ${ground - 140} L${x + 48} ${ground - 90} Z"/>
<rect ${s} x="${x + 40}" y="${ground - 150}" width="40" height="150"/><path ${s} d="M${x + 36} ${ground - 150} L${x + 60} ${ground - 225} L${x + 84} ${ground - 150} Z"/>`;
    case "monument":
      return `<rect ${s} x="${x - 40}" y="${ground - 40}" width="80" height="40"/><path ${s} d="M${x - 14} ${ground - 40} L${x - 10} ${ground - 120} Q${x} ${ground - 140} ${x + 10} ${ground - 120} L${x + 14} ${ground - 40} Z"/>
<circle cx="${x}" cy="${ground - 135}" r="14" ${s}/>`;
    case "nature":
      return [-90, -20, 60]
        .map((dx, i) => `<rect x="${x + dx - 6}" y="${ground - 50}" width="12" height="50" fill="#7a4a2b" stroke="#3b2f2a" stroke-width="4"/>
<circle cx="${x + dx}" cy="${ground - 80 - i * 10}" r="${42 - i * 4}" fill="#5aa055" stroke="#2f5a2c" stroke-width="5"/>`)
        .join("");
    case "viewpoint":
      return `<path ${s.replace(lit, "#86b86a")} d="M0 ${ground - 30} Q120 ${ground - 120} 230 ${ground - 60} T512 ${ground - 70} L512 ${ground} L0 ${ground} Z"/>
<path stroke="#3b2f2a" stroke-width="4" fill="#5d8f4c" d="M0 ${ground} Q160 ${ground - 50} 330 ${ground - 20} T512 ${ground - 30} L512 ${ground + 20} L0 ${ground + 20} Z"/>`;
    default:
      return `<rect ${s} x="${x - 90}" y="${ground - 120}" width="180" height="120"/>
<path ${s} d="M${x - 100} ${ground - 120} L${x} ${ground - 165} L${x + 100} ${ground - 120} Z"/>
${[-55, 0, 55].map((dx) => `<rect x="${x + dx - 12}" y="${ground - 95}" width="24" height="30" fill="#fff4c2" stroke="#3b2f2a" stroke-width="3"/>`).join("")}`;
  }
}

async function geometrySketch(spot: Spot): Promise<Sketch> {
  const svg = geometrySvg(spot);
  if (!dbConfigured()) return { url: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`, source: "geometry", model: null };
  const id = await putMedia(mediaKey("sketch-svg", svg), Buffer.from(svg), "image/svg+xml", { kind: "sketch", spot: spot.name, phase: spot.light.phase });
  return { url: mediaUrl(id), source: "geometry", model: null };
}

export function geometrySvg(spot: Spot): string {
  const W = 512;
  const H = 384;
  const ground = 300;
  const { light, shot } = spot;
  const [top, bottom] = SKY[light.phase];
  const sunUp = light.sunAltitude > -1;

  // horizontal FOV from the planned focal length (landscape frame, 36mm wide sensor)
  const ff = shot.focalFF ?? 24;
  const hfov = (2 * Math.atan(36 / (2 * ff)) * 180) / Math.PI;
  const rel = ((norm360(light.sunAzimuth - shot.facing) + 180) % 360) - 180; // -180..180, + = right
  const inFrame = Math.abs(rel) < hfov / 2;
  const sunX = inFrame ? W / 2 + (rel / (hfov / 2)) * (W / 2) : rel < 0 ? 26 : W - 26;
  const sunY = Math.max(40, ground - 20 - Math.max(0, light.sunAltitude) * 6);

  // subject on a third, leaving the sun's side open when it's in frame
  const subjX = inFrame ? (rel < 0 ? (W * 2) / 3 : W / 3) : W / 2;
  const lit =
    light.phase === "golden hour" ? "#f2b36b" : light.phase === "blue hour" || light.phase === "night" ? "#4a4f6e" : "#d9c6a5";

  const sun = !sunUp
    ? light.phase === "night" || light.phase === "blue hour"
      ? `<circle cx="${W - 80}" cy="70" r="20" fill="#f4f1d0" stroke="#d8d2a0" stroke-width="4"/>`
      : ""
    : inFrame
      ? `<g stroke="#f08a24" stroke-width="5" stroke-linecap="round">${Array.from({ length: 8 }, (_, i) => {
          const a = (i * Math.PI) / 4;
          return `<line x1="${sunX + Math.cos(a) * 36}" y1="${sunY + Math.sin(a) * 36}" x2="${sunX + Math.cos(a) * 52}" y2="${sunY + Math.sin(a) * 52}"/>`;
        }).join("")}</g><circle cx="${sunX}" cy="${sunY}" r="28" fill="#ffd23f" stroke="#f08a24" stroke-width="5"/>`
      : `<text x="${sunX}" y="${sunY}" font-size="30" text-anchor="middle" fill="#f08a24">${rel < 0 ? "☀←" : "→☀"}</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
<filter id="crayon"><feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" seed="${spot.key.length}"/><feDisplacementMap in="SourceGraphic" scale="6"/></filter>
<filter id="paper"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0.12 0"/><feComposite in2="SourceGraphic" operator="in"/></filter>
</defs>
<g filter="url(#crayon)">
<rect width="${W}" height="${ground}" fill="url(#sky)"/>
<rect y="${ground}" width="${W}" height="${H - ground}" fill="#8fbf6a"/>
${sun}
${subjectShape(spot.kind, subjX, ground, lit)}
<path d="M${W / 2 - 60} ${H - 12} L${W / 2} ${ground + 18} L${W / 2 + 60} ${H - 12}" stroke="#6b5a45" stroke-width="5" fill="none" stroke-dasharray="10 8"/>
</g>
<rect width="${W}" height="${H}" filter="url(#paper)"/>
</svg>`;
  return svg;
}
