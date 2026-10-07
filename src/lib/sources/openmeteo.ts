import tzLookup from "@photostructure/tz-lookup";
import { cached } from "../db";
import { getJSON } from "../http";
import type { LatLon, Weather } from "../types";

// Time zone and weather for "this place, at this local wall-clock time".
// The time zone is looked up offline from the coordinates, so the sun maths never depends on an API.
// Weather comes from Open-Meteo, then MET Norway as a fallback (Open-Meteo's free limit is per IP,
// and a shared host like Render's free tier can find it used up by its neighbours), cached for an
// hour in MongoDB. If both are down, the plan goes ahead with "no forecast".

/** Offset of `tz` from UTC at instant `utcMs`, in seconds (DST-aware, via Intl). */
function offsetSeconds(tz: string, utcMs: number): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((asUtc - utcMs) / 1000);
}

/** "2026-10-09T17:30" at `tz` → the UTC instant, plus the offset in force then. */
export function localToUtc(localTime: string, tz: string): { utc: Date; utcOffsetSeconds: number } {
  const wall = Date.parse(`${localTime}:00Z`);
  // two passes settle DST edges: guess with the offset at the wall time, then at the result
  let off = offsetSeconds(tz, wall);
  off = offsetSeconds(tz, wall - off * 1000);
  return { utc: new Date(wall - off * 1000), utcOffsetSeconds: off };
}

type Hourly = { cloudCover: number | null; cloudLow: number | null; precipProb: number | null; visibilityM: number | null };

async function openMeteo(p: LatLon, localTime: string, tz: string): Promise<Hourly | null> {
  const day = localTime.slice(0, 10);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: p.lat.toFixed(4),
    longitude: p.lon.toFixed(4),
    hourly: "cloud_cover,cloud_cover_low,precipitation_probability,visibility",
    timezone: tz,
    start_date: day,
    end_date: day,
  }).toString();
  const f = await getJSON<{
    hourly?: { time: string[]; cloud_cover: (number | null)[]; cloud_cover_low: (number | null)[]; precipitation_probability: (number | null)[]; visibility: (number | null)[] };
  }>(url.toString());
  const i = f.hourly?.time.indexOf(`${localTime.slice(0, 13)}:00`) ?? -1;
  if (!f.hourly || i < 0) return null;
  return {
    cloudCover: f.hourly.cloud_cover[i] ?? null,
    cloudLow: f.hourly.cloud_cover_low[i] ?? null,
    precipProb: f.hourly.precipitation_probability[i] ?? null,
    visibilityM: f.hourly.visibility[i] ?? null,
  };
}

/** MET Norway (yr.no) locationforecast: global, free, no key, ~9 days ahead. Wants a real User-Agent. */
async function metNorway(p: LatLon, utc: Date): Promise<Hourly | null> {
  const url = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${p.lat.toFixed(4)}&lon=${p.lon.toFixed(4)}`;
  const f = await getJSON<{
    properties: {
      timeseries: {
        time: string;
        data: {
          instant: { details: { cloud_area_fraction?: number; cloud_area_fraction_low?: number; fog_area_fraction?: number } };
          next_1_hours?: { details: { probability_of_precipitation?: number } };
        };
      }[];
    };
  }>(url);
  const series = f.properties.timeseries;
  if (!series.length) return null;
  const target = utc.getTime();
  const nearest = series.reduce((a, b) => (Math.abs(Date.parse(b.time) - target) < Math.abs(Date.parse(a.time) - target) ? b : a));
  if (Math.abs(Date.parse(nearest.time) - target) > 3 * 3600_000) return null; // outside the forecast range
  const d = nearest.data.instant.details;
  return {
    cloudCover: d.cloud_area_fraction ?? null,
    cloudLow: d.cloud_area_fraction_low ?? null,
    precipProb: nearest.data.next_1_hours?.details.probability_of_precipitation ?? null,
    visibilityM: d.fog_area_fraction != null && d.fog_area_fraction > 50 ? 1000 : null,
  };
}

export async function forecastAt(
  p: LatLon,
  localTime: string,
): Promise<{ utc: Date; timezone: string; utcOffsetSeconds: number; weather: Weather }> {
  const timezone = tzLookup(p.lat, p.lon);
  const { utc, utcOffsetSeconds } = localToUtc(localTime, timezone);

  const cell = `${p.lat.toFixed(2)},${p.lon.toFixed(2)},${localTime.slice(0, 13)}`; // ~1 km, one hour
  const hourly = await cached(
    `weather:${cell}`,
    3600,
    async () => {
      for (const source of [() => openMeteo(p, localTime, timezone), () => metNorway(p, utc)]) {
        try {
          const h = await source();
          if (h) return h;
        } catch (err) {
          console.warn("[weather] source failed, trying the next:", (err as Error).message.slice(0, 160));
        }
      }
      return null;
    },
    (h) => h !== null, // don't remember "no forecast" for an hour
  );

  const h = hourly ?? { cloudCover: null, cloudLow: null, precipProb: null, visibilityM: null };
  return { utc, timezone, utcOffsetSeconds, weather: { ...h, summary: describe(h.cloudCover, h.precipProb, h.visibilityM) } };
}

function describe(cloud: number | null, rain: number | null, vis: number | null): string {
  if (cloud == null) return "no forecast available for that time";
  const sky = cloud < 15 ? "clear sky" : cloud < 45 ? "a few clouds" : cloud < 80 ? "broken cloud" : "overcast";
  const parts = [`${sky} (${Math.round(cloud)}% cloud)`];
  if (rain != null && rain >= 30) parts.push(`${Math.round(rain)}% chance of rain`);
  if (vis != null && vis < 5000) parts.push(`haze or mist, visibility ${(vis / 1000).toFixed(1)} km`);
  return parts.join(", ");
}
