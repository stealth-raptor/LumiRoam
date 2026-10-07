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
const SMALL_HISTORIC = /^(boundary_stone|milestone|wayside_shrine|marker|tomb|grave|stone|cannon|anchor|district|yes)$/;
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
