import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { geocode } from "@/lib/sources/nominatim";
import { forecastAt } from "@/lib/sources/openmeteo";
import { findCandidates, pickDiverse } from "@/lib/spots";
import { findPhoto, leadPhotos } from "@/lib/sources/commons";
import { lightAt, shotGeometry } from "@/lib/light";
import { distanceM } from "@/lib/geo";
import { factSheet, lensAdvice, styled, templateFrame, templatePlan } from "@/lib/plan-text";
import { cached, dbConfigured, saveShoot } from "@/lib/db";
import { geometrySketch } from "@/lib/sketch";
import { USER_AGENT } from "@/lib/http";
import { type Frame, LatLon, Plan, PlanRequest, Spot, Weather } from "@/lib/types";
import { gemmaConfigured } from "../model";

const Located = z.object({
  request: PlanRequest,
  center: LatLon,
  bbox: z.object({ south: z.number(), north: z.number(), west: z.number(), east: z.number() }).nullable(),
  label: z.string(),
  timezone: z.string(),
  utc: z.string(),
  utcOffsetSeconds: z.number(),
  weather: Weather,
});
const WithSpots = Located.extend({ spots: z.array(Spot), notes: z.array(z.string()) });
const Saved = WithSpots.extend({ shootId: z.string().nullable() });

const locate = createStep({
  id: "locate",
  description: "Geocode the place and get the local time zone + forecast for the shoot time.",
  inputSchema: PlanRequest,
  outputSchema: Located,
  execute: async ({ inputData }) => {
    const hit = await cached(`geocode5:${inputData.place.toLowerCase()}`, 30 * 86400, () => geocode(inputData.place));
    if (!hit) throw new Error(`Couldn't find "${inputData.place}" on OpenStreetMap`);
    const center = { lat: hit.lat, lon: hit.lon };
    const f = await forecastAt(center, inputData.localTime);
    return {
      request: inputData,
      center,
      bbox: hit.bbox ?? null,
      label: hit.label,
      timezone: f.timezone,
      utc: f.utc.toISOString(),
      utcOffsetSeconds: f.utcOffsetSeconds,
      weather: f.weather,
    };
  },
});

const MAX_SPOTS = 4; // a short photowalk: 4 stops, one drawing each
const MIN_SPOTS = 4;

const findSpots = createStep({
  id: "find-spots",
  description: "Find photogenic places, attach a real Commons photo, and compute light + where to stand.",
  inputSchema: Located,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx }) => {
    const { center, request } = ctx;
    const cell = `${center.lat.toFixed(3)},${center.lon.toFixed(3)},${request.radiusM}`;
    const { candidates } = await cached(
      `candidates2:${cell}`,
      7 * 86400,
      () => findCandidates(center, request.radiusM),
      (r) => r.complete,
    );
    // If the place is an area that fits inside the walk (a park, a square, a campus), keep the stops
    // inside it: "Lodhi Garden" should be a walk through the garden, not to the market next door.
    const inArea = (c: (typeof candidates)[number]) => {
      const b = ctx.bbox;
      if (!b) return true;
      const pad = 0.0005; // ~50 m, for things on the edge
      return c.subject.lat >= b.south - pad && c.subject.lat <= b.north + pad && c.subject.lon >= b.west - pad && c.subject.lon <= b.east + pad;
    };
    const areaFits = ctx.bbox && distanceM({ lat: ctx.bbox.south, lon: ctx.bbox.west }, { lat: ctx.bbox.north, lon: ctx.bbox.east }) <= request.radiusM * 2.5;
    const inside = areaFits ? candidates.filter(inArea) : candidates;
    const ordered = pickDiverse(inside.length >= MIN_SPOTS ? inside : candidates, 16);
    const utc = new Date(ctx.utc);
    const notes: string[] = [];
    const pageImage = (c: (typeof ordered)[number]) => c.osmTags["lumiroam:pageImage"] || "";
    const leads = await leadPhotos(ordered.map(pageImage)).catch(() => new Map());

    // A place nobody has photographed and uploaded is rarely photogenic, so prefer spots with a
    // Commons photo. Fall back to photo-less spots only if there aren't enough.
    const withPhoto: Spot[] = [];
    const without: Spot[] = [];
    for (const c of ordered) {
      if (withPhoto.length >= MAX_SPOTS) break;
      const photo = await cached(`photo:${c.key}`, 7 * 86400, () =>
        findPhoto(c.subject, c.name, leads.get(pageImage(c)) ?? null),
      ).catch(() => null);
      const light = lightAt(c.subject, utc, ctx.utcOffsetSeconds);
      const spot: Spot = { ...c, photo, light, weather: ctx.weather, shot: shotGeometry(c, photo, light, ctx.weather), plan: null, sketch: null, frames: [] };
      (photo ? withPhoto : without).push(spot);
    }
    const spots = [...withPhoto, ...without.slice(0, Math.max(0, MIN_SPOTS - withPhoto.length))];
    if (spots.length < MIN_SPOTS) notes.push(`Only found ${spots.length} photogenic spots within ${request.radiusM} m.`);
    return { ...ctx, spots, notes };
  },
});

// ONE Gemma call for the whole walk: it sees every stop's photo at once, so it can make the four
// drawings different from each other (and free tiers count requests)
const StopPlan = Plan.omit({ writtenBy: true }).extend({ history: z.string(), drawingLabel: z.string(), drawingPrompt: z.string() });
const WalkPlan = z.object({ stops: z.array(StopPlan) });

/** The Commons photo, small, as a data URL: the model host doesn't have to fetch from Wikimedia. */
async function photoForGemma(url: string): Promise<{ image: string; mimeType: string } | null> {
  try {
    const small = url.replace(/\/\d+px-/, "/512px-"); // Commons thumbnails: fewer image tokens
    const res = await fetch(small, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return { image: `data:${mimeType};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`, mimeType };
  } catch {
    return null;
  }
}

const frameOf = (label: string, prompt: string, by: "gemma" | "template"): Frame => ({
  label,
  prompt: styled(prompt),
  promptBy: by,
  url: null,
  model: null,
});

const writePlans = createStep({
  id: "write-plans",
  description:
    "Gemma looks at the real Commons photos of all 4 stops plus the computed fact sheets, and writes a plan and one drawing prompt per stop, varied across the walk; template text if Gemma is offline.",
  inputSchema: WithSpots,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx, mastra }) => {
    const gear = ctx.request.gear;
    const fallback = (s: Spot): Spot => {
      const t = templateFrame(s);
      return { ...s, plan: templatePlan(s, gear), frames: [{ ...t, promptBy: "template", url: null, model: null }] };
    };
    if (!gemmaConfigured()) {
      return {
        ...ctx,
        spots: ctx.spots.map(fallback),
        notes: [...ctx.notes, "Gemma is offline (no LLM_API_KEY / HF_TOKEN), so plans and drawing prompts are template text."],
      };
    }
    try {
      const photos = await Promise.all(ctx.spots.map((s) => (s.photo ? photoForGemma(s.photo.thumbUrl) : Promise.resolve(null))));
      const content = ctx.spots.flatMap((s, i) => [
        { type: "text" as const, text: `
=== STOP ${i + 1} of ${ctx.spots.length} ===` },
        ...(photos[i] ? [{ type: "image" as const, image: photos[i]!.image, mimeType: photos[i]!.mimeType }] : []),
        { type: "text" as const, text: factSheet(s, gear) },
      ]);
      const res = await mastra.getAgent("plannerAgent").generate([{ role: "user", content }], {
        // schema goes in the prompt: free Gemma hosts don't all support response_format
        structuredOutput: { schema: WalkPlan, jsonPromptInjection: "inline" },
        abortSignal: AbortSignal.timeout(120_000),
      });
      const stops = res.object.stops;
      let missing = 0;
      const spots = ctx.spots.map((s, i) => {
        const stop = stops[i];
        if (!stop) {
          missing++;
          return fallback(s);
        }
        const { drawingLabel, drawingPrompt, ...plan } = stop;
        // The lens line is pure maths for the user's own body and lenses. Gemma kept "improving" it:
        // full-frame numbers for an APS-C body, 15 mm on an 18-55. So it isn't Gemma's to rewrite.
        const lens = lensAdvice(s, gear);
        return { ...s, plan: { ...plan, lens, writtenBy: "gemma" as const }, frames: [frameOf(drawingLabel, drawingPrompt, "gemma")] };
      });
      const notes = missing ? [...ctx.notes, `Gemma skipped ${missing} stop(s); those use template text.`] : ctx.notes;
      return { ...ctx, spots, notes };
    } catch (err) {
      console.warn("[write-plans] Gemma failed:", (err as Error).message.slice(0, 300));
      return { ...ctx, spots: ctx.spots.map(fallback), notes: [...ctx.notes, "Gemma didn't answer, so plans use template text."] };
    }
  },
});

const sketch = createStep({
  id: "fallback-sketch",
  description:
    "A free SVG drawn from sun position and geometry, shown until the text-to-image drawings arrive (they are drawn on demand by /api/sketch and cached in GridFS).",
  inputSchema: WithSpots,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx }) => {
    const spots = await mapLimit(ctx.spots, 3, async (s) => ({ ...s, sketch: await geometrySketch(s) }));
    return { ...ctx, spots };
  },
});

const save = createStep({
  id: "save",
  description: "Save the shoot and its spots to MongoDB Atlas (spots get a 2dsphere index for walk mode).",
  inputSchema: WithSpots,
  outputSchema: Saved,
  execute: async ({ inputData: ctx }) => {
    if (!dbConfigured()) return { ...ctx, shootId: null, notes: [...ctx.notes, "Not saved: MONGODB_URI is not set."] };
    let shootId: string | null = null;
    try {
      shootId = await saveShoot(
        {
          place: ctx.request.place,
          label: ctx.label,
          center: ctx.center,
          localTime: ctx.request.localTime,
          timezone: ctx.timezone,
          gear: ctx.request.gear,
        },
        ctx.spots,
      );
    } catch (err) {
      // the plan is still useful on screen; walk mode needs it saved, so say why it isn't
      const msg = (err as Error).message;
      console.warn("[save] couldn't save the shoot:", msg.slice(0, 300));
      return { ...ctx, shootId: null, notes: [...ctx.notes, `Not saved (walk mode needs it): ${msg.slice(0, 220)}`] };
    }
    return { ...ctx, shootId };
  },
});

export const planShootWorkflow = createWorkflow({
  id: "plan-shoot",
  description: "Location + time → 4-6 photogenic spots with light, position, lens, settings, a plan and a sketch, saved to MongoDB.",
  inputSchema: PlanRequest,
  outputSchema: Saved,
})
  .then(locate)
  .then(findSpots)
  .then(writePlans)
  .then(sketch)
  .then(save)
  .commit();

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
