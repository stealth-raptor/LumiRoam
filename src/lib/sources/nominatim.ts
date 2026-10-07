import { distanceM } from "../geo";
import { getJSON } from "../http";
import type { LatLon } from "../types";
import { areaNamed } from "./overpass";

type NominatimHit = {
  lat: string;
  lon: string;
  display_name: string;
  category: string;
  type: string;
  boundingbox: [string, string, string, string];
};

export type BBox = { south: number; north: number; west: number; east: number };
export type Place = LatLon & { label: string; bbox: BBox | null };

const AREA_CATEGORIES = new Set(["leisure", "boundary", "place", "landuse", "tourism", "natural", "amenity", "historic"]);
const toBBox = (b: NominatimHit["boundingbox"]): BBox => ({ south: +b[0], north: +b[1], west: +b[2], east: +b[3] });
const diagonal = (b: BBox) => distanceM({ lat: b.south, lon: b.west }, { lat: b.north, lon: b.east });

/**
 * Place name → centre and extent. Nominatim's policy is max 1 request/second; callers cache.
 * "Lodhi Garden, New Delhi" matches a tomb *in* the garden (the garden is part of its address,
 * and the park itself is mapped as "Lodhi Gardens"). So prefer a result that is an area, and if
 * none is, look the area up by name around the first match.
 */
export async function geocode(query: string): Promise<Place | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "10");
  const hits = await getJSON<NominatimHit[]>(url.toString());
  if (!hits.length) return null;

  const area = hits.find((h) => AREA_CATEGORIES.has(h.category) && diagonal(toBBox(h.boundingbox)) > 150);
  if (area) return { lat: +area.lat, lon: +area.lon, label: area.display_name, bbox: toBBox(area.boundingbox) };

  const top = hits[0];
  const name = query.split(",")[0].trim();
  const found = await areaNamed(name, { lat: +top.lat, lon: +top.lon }).catch(() => null);
  if (found) return { ...found.center, label: `${found.name}, ${top.display_name.split(",").slice(2).join(",").trim()}`, bbox: found.bbox };
  return { lat: +top.lat, lon: +top.lon, label: top.display_name, bbox: toBBox(top.boundingbox) };
}
