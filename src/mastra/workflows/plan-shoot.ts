import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { geocode } from "@/lib/sources/nominatim";
import { forecastAt } from "@/lib/sources/openmeteo";
import { findCandidates, pickDiverse } from "@/lib/spots";
import { findPhoto, leadPhotos } from "@/lib/sources/commons";
import { lightAt, shotGeometry } from "@/lib/light";
import { factSheet, styled, templateFrames, templatePlan } from "@/lib/plan-text";
import { cached, dbConfigured, saveShoot } from "@/lib/db";
import { geometrySketch } from "@/lib/sketch";
import { USER_AGENT } from "@/lib/http";
import { type Frame, LatLon, Plan, PlanRequest, Spot, Weather } from "@/lib/types";
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
      const spot: Spot = { ...c, photo, light, weather: ctx.weather, shot: shotGeometry(c, photo, light, ctx.weather), plan: null, sketch: null, frames: [] };
      (photo ? withPhoto : without).push(spot);
    }
    const spots = [...withPhoto, ...without.slice(0, Math.max(0, MIN_SPOTS - withPhoto.length))];
    if (spots.length < MIN_SPOTS) notes.push(`Only found ${spots.length} photogenic spots within ${request.radiusM} m.`);
    return { ...ctx, spots, notes };
  },
});

// one Gemma call per spot returns the plan AND the four drawing prompts (free tiers count requests)
const PlanAndFrames = Plan.omit({ writtenBy: true }).extend({
  frames: z.array(z.object({ label: z.string(), prompt: z.string() })).min(1).max(4),
});

/** The Commons photo as a data URL, so the model host doesn't have to fetch from Wikimedia itself. */
async function photoForGemma(url: string): Promise<{ image: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
    return { image: `data:${mimeType};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`, mimeType };
  } catch {
    return null;
  }
}

const unsketched = (frames: { label: string; prompt: string }[], by: "gemma" | "template"): Frame[] =>
  frames.map((f) => ({ label: f.label, prompt: styled(f.prompt), promptBy: by, url: null, model: null }));

const writePlans = createStep({
  id: "write-plans",
  description:
    "Gemma looks at the real Commons photo plus the computed fact sheet and writes a plan and 4 drawing prompts per spot; template text if Gemma is offline.",
  inputSchema: WithSpots,
  outputSchema: WithSpots,
  execute: async ({ inputData: ctx, mastra }) => {
    const gear = ctx.request.gear;
    const fallback = (s: Spot): Spot => ({ ...s, plan: templatePlan(s, gear), frames: unsketched(templateFrames(s), "template") });
    if (!gemmaConfigured()) {
      return {
        ...ctx,
        spots: ctx.spots.map(fallback),
        notes: [...ctx.notes, "Gemma is offline (no LLM_API_KEY / HF_TOKEN), so plans and drawing prompts are template text."],
      };
    }
    const agent = mastra.getAgent("plannerAgent");
    let failures = 0;
    // two at a time: free hosts rate-limit bursts
    const spots = await mapLimit(ctx.spots, 2, async (s) => {
      try {
        const photo = s.photo ? await photoForGemma(s.photo.thumbUrl) : null;
        const res = await agent.generate(
          [
            {
              role: "user",
              content: [
                ...(photo ? [{ type: "image" as const, image: photo.image, mimeType: photo.mimeType }] : []),
                { type: "text" as const, text: factSheet(s, gear) },
              ],
            },
          ],
          {
            // schema goes in the prompt: free Gemma hosts don't all support response_format
            structuredOutput: { schema: PlanAndFrames, jsonPromptInjection: "inline" },
            abortSignal: AbortSignal.timeout(90_000),
          },
        );
        const { frames, ...plan } = res.object;
        // if Gemma returned fewer than 4 frames, top up from the template set
        const template = templateFrames(s);
        const all = [...unsketched(frames, "gemma"), ...unsketched(template.slice(frames.length), "template")];
        return { ...s, plan: { ...plan, writtenBy: "gemma" as const }, frames: all };
      } catch (err) {
        failures++;
        console.warn(`[write-plans] Gemma failed for ${s.name}:`, (err as Error).message.slice(0, 200));
        return fallback(s);
      }
    });
    const notes = failures ? [...ctx.notes, `Gemma failed on ${failures} spot(s); those use template text.`] : ctx.notes;
    return { ...ctx, spots, notes };
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
