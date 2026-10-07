import { getJSON } from "../http";
import type { LatLon } from "../types";

const API = "https://en.wikipedia.org/w/api.php";

export type WikiPlace = { pageid: number; title: string; at: LatLon; distM: number };

/** Wikipedia articles with coordinates near a point (API max radius is 10 km). */
export async function wikiGeosearch(p: LatLon, radius: number, limit = 50): Promise<WikiPlace[]> {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action: "query",
    list: "geosearch",
    gscoord: `${p.lat}|${p.lon}`,
    gsradius: String(Math.min(10000, Math.round(radius))),
    gslimit: String(limit),
    format: "json",
    formatversion: "2",
  }).toString();
  const data = await getJSON<{
    query?: { geosearch: { pageid: number; title: string; lat: number; lon: number; dist: number }[] };
  }>(url.toString());
  return (data.query?.geosearch ?? []).map((g) => ({
    pageid: g.pageid,
    title: g.title,
    at: { lat: g.lat, lon: g.lon },
    distM: g.dist,
  }));
}

export type WikiSummary = {
  title: string;
  extract: string;
  pageImage: string | null; // file name, e.g. "Big_Ben.jpg"
  url: string;
  views30d: number; // popularity: famous places are usually the photogenic ones
};

/** Plain-text intro + lead image for up to 20 titles in one request. */
export async function wikiSummaries(titles: string[]): Promise<Map<string, WikiSummary>> {
  const out = new Map<string, WikiSummary>();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20);
    const url = new URL(API);
    url.search = new URLSearchParams({
      action: "query",
      prop: "extracts|pageimages|info|pageviews",
      pvipdays: "30",
      exintro: "1",
      explaintext: "1",
      exsentences: "6",
      piprop: "name",
      inprop: "url",
      redirects: "1",
      titles: batch.join("|"),
      format: "json",
      formatversion: "2",
    }).toString();
    const data = await getJSON<{
      query?: {
        redirects?: { from: string; to: string }[];
        normalized?: { from: string; to: string }[];
        pages: {
          title: string;
          missing?: boolean;
          extract?: string;
          pageimage?: string;
          fullurl?: string;
          pageviews?: Record<string, number | null>;
        }[];
      };
    }>(url.toString());
    const q = data.query;
    if (!q) continue;
    for (const page of q.pages) {
      if (page.missing || !page.extract) continue;
      out.set(page.title, {
        title: page.title,
        extract: page.extract.trim(),
        pageImage: page.pageimage ?? null,
        url: page.fullurl ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title)}`,
        views30d: Object.values(page.pageviews ?? {}).reduce<number>((a, v) => a + (v ?? 0), 0),
      });
    }
    // let callers look up by the title they asked for, not just the canonical one
    for (const m of [...(q.normalized ?? []), ...(q.redirects ?? [])]) {
      const hit = out.get(m.to);
      if (hit) out.set(m.from, hit);
    }
    for (const t of batch) {
      const n = q.normalized?.find((m) => m.from === t)?.to;
      const r = q.redirects?.find((m) => m.from === (n ?? t))?.to;
      const hit = out.get(r ?? n ?? t);
      if (hit) out.set(t, hit);
    }
  }
  return out;
}
