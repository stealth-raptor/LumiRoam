import { getJSON } from "../http";
import type { LatLon } from "../types";

type NominatimHit = { lat: string; lon: string; display_name: string };

/** Place name → coordinates. Nominatim's policy is max 1 request/second; callers cache. */
export async function geocode(query: string): Promise<(LatLon & { label: string }) | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  const hits = await getJSON<NominatimHit[]>(url.toString());
  if (!hits.length) return null;
  return { lat: +hits[0].lat, lon: +hits[0].lon, label: hits[0].display_name };
}
