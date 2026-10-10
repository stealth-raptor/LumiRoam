import { getJSON } from "../http";
import type { LatLon } from "../types";

export type OsmPoi = {
  id: string;
  name: string;
  at: LatLon;
  tags: Record<string, string>;
};

type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

// Small stuff that clutters cities: plaques, boundary stones, milestones. Filtered here rather than
// in the query, because negative regex filters made overpass-api.de time out (504) on central London.
// not "tomb": in Delhi historic=tomb is a whole mausoleum
const SMALL_HISTORIC = /^(boundary_stone|milestone|wayside_shrine|marker|grave|stone|cannon|anchor|district|yes)$/;
const SMALL_MEMORIAL = /^(plaque|blue_plaque|stolperstein|bench|stone)$/;

/** Named things worth photographing within `radius` metres. */
export async function photogenicPois(p: LatLon, radius: number): Promise<OsmPoi[]> {
  const a = `(around:${radius},${p.lat},${p.lon})`;
  const q = `[out:json][timeout:25];
(
  nwr["tourism"="viewpoint"]${a};
  nwr["tourism"="attraction"]["name"]["wikidata"]${a};
  nwr["tourism"="artwork"]["name"]["wikidata"]${a};
  nwr["historic"]["name"]${a};
  nwr["man_made"~"^(lighthouse|tower|windmill|bridge)$"]["name"]${a};
  way["bridge"]["name"]["wikipedia"]${a};
  nwr["amenity"="place_of_worship"]["wikipedia"]${a};
  nwr["building"~"^(cathedral|church|chapel|mosque|temple)$"]["name"]${a};
  nwr["natural"~"^(peak|waterfall|cliff)$"]["name"]${a};
  nwr["leisure"~"^(park|garden)$"]["wikipedia"]${a};
);
out center tags 800;`;

  let lastErr: unknown;
  for (const endpoint of ENDPOINTS) {
    try {
      const data = await getJSON<{ elements: OverpassElement[] }>(endpoint, {
        method: "POST",
        body: new URLSearchParams({ data: q }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        timeoutMs: 30000,
      });
      return data.elements
        .map((e) => {
          const lat = e.lat ?? e.center?.lat;
          const lon = e.lon ?? e.center?.lon;
          const tags = e.tags ?? {};
          if (lat == null || lon == null) return null;
          if (SMALL_HISTORIC.test(tags.historic ?? "") || SMALL_MEMORIAL.test(tags.memorial ?? "")) return null;
          const name = tags["name:en"] ?? tags.name ?? (tags.tourism === "viewpoint" ? "Viewpoint" : null);
          if (!name) return null;
          return { id: `${e.type}/${e.id}`, name, at: { lat, lon }, tags };
        })
        .filter((x): x is OsmPoi => x !== null);
    } catch (err) {
      lastErr = err; // public Overpass instances are often busy; try the next one
      console.warn(`[overpass] ${endpoint} failed:`, (err as Error).message.slice(0, 300));
    }
  }
  throw lastErr;
}

/** A park/garden/square named like `name` near `near`, with its bounding box (e.g. "Lodhi Gardens"). */
export async function areaNamed(
  name: string,
  near: LatLon,
): Promise<{ name: string; center: LatLon; bbox: { south: number; north: number; west: number; east: number } } | null> {
  const safe = name.replace(/[^\p{L}\p{N} '-]/gu, "").trim();
  if (safe.length < 3) return null;
  const q = `[out:json][timeout:15];
nwr["name"~"^${safe}",i]["leisure"~"^(park|garden|nature_reserve)$"](around:1500,${near.lat},${near.lon});
out tags bb 1;`;
  for (const endpoint of ENDPOINTS) {
    try {
      const data = await getJSON<{ elements: (OverpassElement & { bounds?: { minlat: number; minlon: number; maxlat: number; maxlon: number } })[] }>(
        endpoint,
        {
          method: "POST",
          body: new URLSearchParams({ data: q }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          timeoutMs: 20000,
        },
      );
      const e = data.elements[0];
      if (!e?.bounds) return null;
      // "out bb" returns bounds but no centre; the middle of the box is close enough for a park
      return {
        name: e.tags?.name ?? name,
        center: { lat: (e.bounds.minlat + e.bounds.maxlat) / 2, lon: (e.bounds.minlon + e.bounds.maxlon) / 2 },
        bbox: { south: e.bounds.minlat, north: e.bounds.maxlat, west: e.bounds.minlon, east: e.bounds.maxlon },
      };
    } catch {
      // try the next public instance
    }
  }
  return null;
}
