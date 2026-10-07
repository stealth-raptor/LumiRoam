import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { geocode } from "@/lib/sources/nominatim";
import { forecastAt } from "@/lib/sources/openmeteo";
import { findCandidates } from "@/lib/spots";
import { lightAt } from "@/lib/light";
import { nearestPlannedShot, nextUnheardPlace } from "@/lib/walk";
import { Candidate, LatLon, Light, Weather } from "@/lib/types";

export const geocodeTool = createTool({
  id: "geocode",
  description: "Turn a place name into coordinates (OpenStreetMap Nominatim).",
  inputSchema: z.object({ place: z.string() }),
  outputSchema: z.object({ lat: z.number(), lon: z.number(), label: z.string() }).nullable(),
  execute: async ({ place }) => geocode(place),
});

export const placesTool = createTool({
  id: "find-photogenic-places",
  description:
    "Find photogenic places (viewpoints, towers, bridges, churches, monuments...) near a point, from OpenStreetMap and Wikipedia, best first.",
  inputSchema: LatLon.extend({ radiusM: z.number().default(1500) }),
  outputSchema: z.object({ places: z.array(Candidate) }),
  execute: async ({ lat, lon, radiusM }) => ({ places: (await findCandidates({ lat, lon }, radiusM)).candidates.slice(0, 30) }),
});

export const sunLightTool = createTool({
  id: "sun-and-light",
  description: "Sun altitude/direction, light phase (golden hour, blue hour...) and the day's light times at a place.",
  inputSchema: LatLon.extend({ utc: z.string().describe("ISO time in UTC"), utcOffsetSeconds: z.number() }),
  outputSchema: Light,
  execute: async ({ lat, lon, utc, utcOffsetSeconds }) => lightAt({ lat, lon }, new Date(utc), utcOffsetSeconds),
});

export const weatherTool = createTool({
  id: "weather",
  description: "Cloud, rain chance and visibility at a place for a local wall-clock time (Open-Meteo).",
  inputSchema: LatLon.extend({ localTime: z.string().describe("YYYY-MM-DDTHH:MM local time") }),
  outputSchema: Weather.extend({ timezone: z.string(), utc: z.string(), utcOffsetSeconds: z.number() }),
  execute: async ({ lat, lon, localTime }) => {
    const f = await forecastAt({ lat, lon }, localTime);
    return { ...f.weather, timezone: f.timezone, utc: f.utc.toISOString(), utcOffsetSeconds: f.utcOffsetSeconds };
  },
});

export const plannedShotTool = createTool({
  id: "nearest-planned-shot",
  description: "MongoDB $geoNear: the closest planned shot in a saved shoot to where the walker is now.",
  inputSchema: LatLon.extend({ shootId: z.string() }),
  outputSchema: z.object({ name: z.string(), distanceM: z.number(), bearing: z.number() }).nullable(),
  execute: async ({ lat, lon, shootId }) => {
    const hit = await nearestPlannedShot(shootId, { lat, lon });
    return hit ? { name: hit.spot.name, distanceM: hit.distanceM, bearing: hit.bearing } : null;
  },
});

export const nearbyStoryTool = createTool({
  id: "nearby-unheard-place",
  description: "The nearest Wikipedia-documented place the walker hasn't heard about yet on this walk, with its source text.",
  inputSchema: LatLon.extend({ walkId: z.string() }),
  outputSchema: z.object({ title: z.string(), extract: z.string(), distanceM: z.number() }).nullable(),
  execute: async ({ lat, lon, walkId }) => {
    const p = await nextUnheardPlace(walkId, { lat, lon }, { markHeard: false });
    return p ? { title: p.title, extract: p.extract, distanceM: p.distanceM } : null;
  },
});

export const tools = { geocodeTool, placesTool, sunLightTool, weatherTool, plannedShotTool, nearbyStoryTool };
