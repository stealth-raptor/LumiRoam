import { getJSON } from "../http";
import type { LatLon, Weather } from "../types";

type Forecast = {
  utc_offset_seconds: number;
  timezone: string;
  hourly?: {
    time: string[];
    cloud_cover: (number | null)[];
    cloud_cover_low: (number | null)[];
    precipitation_probability: (number | null)[];
    visibility: (number | null)[];
  };
};

/**
 * The user types a wall-clock time at the destination. Open-Meteo with timezone=auto
 * tells us the UTC offset there, and the hourly forecast in the same local time.
 */
export async function forecastAt(p: LatLon, localTime: string): Promise<{
  utc: Date;
  timezone: string;
  utcOffsetSeconds: number;
  weather: Weather;
}> {
  const day = localTime.slice(0, 10);
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: p.lat.toFixed(4),
    longitude: p.lon.toFixed(4),
    hourly: "cloud_cover,cloud_cover_low,precipitation_probability,visibility",
    timezone: "auto",
    start_date: day,
    end_date: day,
  }).toString();

  let f: Forecast;
  try {
    f = await getJSON<Forecast>(url.toString());
  } catch {
    // dates outside the 16-day forecast window get a 400; still need the offset
    const tz = new URL("https://api.open-meteo.com/v1/forecast");
    tz.search = new URLSearchParams({
      latitude: p.lat.toFixed(4),
      longitude: p.lon.toFixed(4),
      timezone: "auto",
      forecast_days: "1",
    }).toString();
    f = await getJSON<Forecast>(tz.toString());
    delete f.hourly;
  }

  const utc = new Date(Date.parse(`${localTime}:00Z`) - f.utc_offset_seconds * 1000);
  const hourKey = `${localTime.slice(0, 13)}:00`;
  const i = f.hourly?.time.indexOf(hourKey) ?? -1;
  const pick = (arr?: (number | null)[]) => (i >= 0 && arr ? arr[i] ?? null : null);
  const cloudCover = pick(f.hourly?.cloud_cover);
  const cloudLow = pick(f.hourly?.cloud_cover_low);
  const precipProb = pick(f.hourly?.precipitation_probability);
  const visibilityM = pick(f.hourly?.visibility);

  return {
    utc,
    timezone: f.timezone,
    utcOffsetSeconds: f.utc_offset_seconds,
    weather: { cloudCover, cloudLow, precipProb, visibilityM, summary: describe(cloudCover, precipProb, visibilityM) },
  };
}

function describe(cloud: number | null, rain: number | null, vis: number | null): string {
  if (cloud == null) return "no forecast for that date yet";
  const sky =
    cloud < 15 ? "clear sky" : cloud < 45 ? "a few clouds" : cloud < 80 ? "broken cloud" : "overcast";
  const parts = [`${sky} (${Math.round(cloud)}% cloud)`];
  if (rain != null && rain >= 30) parts.push(`${Math.round(rain)}% chance of rain`);
  if (vis != null && vis < 5000) parts.push(`haze or mist, visibility ${(vis / 1000).toFixed(1)} km`);
  return parts.join(", ");
}
