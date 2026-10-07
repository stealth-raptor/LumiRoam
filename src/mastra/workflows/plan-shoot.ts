import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { geocode } from "@/lib/sources/nominatim";
import { forecastAt } from "@/lib/sources/openmeteo";
import { findCandidates, pickDiverse } from "@/lib/spots";
import { findPhoto, leadPhotos } from "@/lib/sources/commons";
import { lightAt, shotGeometry } from "@/lib/light";
import { factSheet, templatePlan } from "@/lib/plan-text";
import { cached, dbConfigured, saveShoot } from "@/lib/db";
import { makeSketch } from "@/lib/sketch";
import { LatLon, Plan, PlanRequest, Spot, Weather } from "@/lib/types";
import { gemmaConfigured } from "../model";

const Located = z.object({
  request: PlanRequest,
  center: LatLon,
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
    const hit = await cached(`geocode:${inputData.place.toLowerCase()}`, 30 * 86400, () => geocode(inputData.place));
    if (!hit) throw new Error(`Couldn't find "${inputData.place}" on OpenStreetMap`);
    const center = { lat: hit.lat, lon: hit.lon };
    const f = await forecastAt(center, inputData.localTime);
    return {
      request: inputData,
      center,
      label: hit.label,
      timezone: f.timezone,
      utc: f.utc.toISOString(),
      utcOffsetSeconds: f.utcOffsetSeconds,
      weather: f.weather,
    };
  },
});

const MAX_SPOTS = 6;
const MIN_SPOTS = 4;

const findSpots = createStep({
  id: "find-spots",
  description: "Find photogenic places, attach a real Commons photo, and compute light + where to stand.",
  inputSchema: Located,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx }) => {
    const { center, request } = ctx;
    const cell = `${center.lat.toFixed(3)},${center.lon.toFixed(3)},${request.radiusM}`;
    const candidates = await cached(`candidates:${cell}`, 7 * 86400, () => findCandidates(center, request.radiusM));
    const ordered = pickDiverse(candidates, 16);
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
      const spot: Spot = { ...c, photo, light, weather: ctx.weather, shot: shotGeometry(c, photo, light, ctx.weather), plan: null, sketch: null };
      (photo ? withPhoto : without).push(spot);
    }
    const spots = [...withPhoto, ...without.slice(0, Math.max(0, MIN_SPOTS - withPhoto.length))];
    if (spots.length < MIN_SPOTS) notes.push(`Only found ${spots.length} photogenic spots within ${request.radiusM} m.`);
    return { ...ctx, spots, notes };
  },
});

const PlanBody = Plan.omit({ writtenBy: true });

const writePlans = createStep({
  id: "write-plans",
  description: "Gemma writes a short plan per spot from the computed fact sheet; template text if Gemma is offline.",
  inputSchema: WithSpots,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx, mastra }) => {
    const gear = ctx.request.gear;
    if (!gemmaConfigured()) {
      return {
        ...ctx,
        spots: ctx.spots.map((s) => ({ ...s, plan: templatePlan(s, gear) })),
        notes: [...ctx.notes, "Gemma is offline (no HF_TOKEN), so plans are template text."],
      };
    }
    const agent = mastra.getAgent("plannerAgent");
    let failures = 0;
    // one GPU: two at a time keeps it busy without queueing everything behind one request
    const spots = await mapLimit(ctx.spots, 2, async (s) => {
      try {
        const res = await agent.generate(factSheet(s, gear), {
          structuredOutput: { schema: PlanBody },
          abortSignal: AbortSignal.timeout(60_000),
        });
        return { ...s, plan: { ...res.object, writtenBy: "gemma" as const } };
      } catch (err) {
        failures++;
        console.warn(`[write-plans] Gemma failed for ${s.name}:`, (err as Error).message);
        return { ...s, plan: templatePlan(s, gear) };
      }
    });
    const notes = failures ? [...ctx.notes, `Gemma failed on ${failures} spot(s); those use template text.`] : ctx.notes;
    return { ...ctx, spots, notes };
  },
});

const sketch = createStep({
  id: "sketch",
  description: "Crayon sketch of the composition: SDXL-Turbo img2img from the Commons photo, or a geometry drawing.",
  inputSchema: WithSpots,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx }) => {
    const notes = [...ctx.notes];
    const spots = await mapLimit(ctx.spots, 2, async (s) => {
      const out = await makeSketch(s);
      if (out.warning && !notes.includes(out.warning)) notes.push(out.warning);
      return { ...s, sketch: out.sketch };
    });
    return { ...ctx, spots, notes };
  },
});

const save = createStep({
  id: "save",
  description: "Save the shoot and its spots to MongoDB Atlas (spots get a 2dsphere index for walk mode).",
  inputSchema: WithSpots,
  outputSchema: Saved,
  execute: async ({ inputData: ctx }) => {
    if (!dbConfigured()) return { ...ctx, shootId: null, notes: [...ctx.notes, "Not saved: MONGODB_URI is not set."] };
    const shootId = await saveShoot(
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
