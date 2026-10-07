import { distanceM } from "./geo";
import { photogenicPois, type OsmPoi } from "./sources/overpass";
import { wikiGeosearch, wikiSummaries } from "./sources/wikipedia";
import type { Candidate, LatLon, SpotKind } from "./types";

/**
 * The head noun of an English place name is usually its last word ("Big Ben Clock Tower")
 * or the word before "of" ("Tower of London"). Matching anywhere in the name made
 * "Tower Hotel" a tower and "Bridge Theatre" a bridge.
 */
function headNoun(name: string): string {
  const n = name.toLowerCase().replace(/\(.*?\)/g, "").split(",")[0].trim();
  const beforeOf = n.split(/\s+of\s+/)[0];
  const words = beforeOf.split(/\s+/);
  return words[words.length - 1] ?? "";
}

// English plus common South Asian / Middle Eastern words, so "Bara Gumbad", "Jama Masjid",
// "Purana Qila" or "Agrasen ki Baoli" aren't thrown away as "other"
const HEAD_KIND: [RegExp, SpotKind][] = [
  [/^(viewpoint|lookout|overlook|belvedere)$/, "viewpoint"],
  [/^(bridge|viaduct|aqueduct|pul|pula|athpula)$/, "bridge"],
  [/^(tower|lighthouse|windmill|spire|minaret|pagoda|campanile|obelisk|minar|stambh)$/, "tower"],
  [/^(cathedral|church|temple|mosque|chapel|abbey|basilica|gurdwara|mandir|minster|synagogue|shrine|priory|masjid|dargah|stupa|monastery|gompa)$/, "church"],
  [/^(statue|memorial|monument|fountain|cross|column|arch|sculpture|tomb|mausoleum|cenotaph|maqbara|gumbad|gumbaz|gumbat|chhatri|chattri|dome)$/, "monument"],
  [/^(falls|waterfall|lake|park|garden|gardens|bagh|hill|beach|cliffs?|gorge|peak|common|heath|forest|pond|talab|ghat|kund)$/, "nature"],
  [/^(palace|castle|fort|fortress|museum|hall|house|station|gate|market|library|observatory|mill|ruins?|qila|qilla|mahal|haveli|darwaza|baoli|baori|stepwell|sarai|haveli)$/, "building"],
];

function kindOf(tags: Record<string, string>, title = ""): SpotKind {
  // OSM tags are structured, so trust them before guessing from the name
  if (tags.tourism === "viewpoint") return "viewpoint";
  if (tags.man_made === "bridge" || tags.bridge) return "bridge";
  if (/^(tower|lighthouse|windmill)$/.test(tags.man_made ?? "")) return "tower";
  if (tags.amenity === "place_of_worship" || /^(cathedral|church|chapel|mosque|temple)$/.test(tags.building ?? "")) return "church";
  if (/^(castle|fort|palace|manor|city_gate|ruins)$/.test(tags.historic ?? "")) return "building";
  if (/^(monument|memorial|statue|wayside_cross)$/.test(tags.historic ?? "") || tags.tourism === "artwork") return "monument";
  if (tags.natural || /^(park|garden)$/.test(tags.leisure ?? "")) return "nature";
  const head = headNoun(title || tags.name || "");
  for (const [re, kind] of HEAD_KIND) if (re.test(head)) return kind;
  if (tags.historic || tags.building) return "building";
  return "other";
}

function heightOf(tags: Record<string, string>): number | null {
  const h = parseFloat(tags.height ?? "");
  if (!isNaN(h) && h > 0) return h;
  const levels = parseFloat(tags["building:levels"] ?? "");
  return !isNaN(levels) && levels > 0 ? levels * 3.2 : null;
}

const EVENTISH = /^\d{3,4}\b|\b(bombing|attack|fire|riot|siege|battle|murders?|disaster|incident|protest|explosion|collision|crash|rally|festival|list of|history of)\b/i;

const KIND_SCORE: Record<SpotKind, number> = {
  viewpoint: 3,
  tower: 3,
  bridge: 3,
  church: 2.5,
  building: 2,
  monument: 1.5,
  nature: 2,
  other: 0.5,
};

/**
 * Photogenic places near `center`, from OSM (what's there) joined with
 * Wikipedia (what's notable, and the facts the guide is allowed to use).
 */
export async function findCandidates(center: LatLon, radiusM: number): Promise<{ candidates: Candidate[]; complete: boolean }> {
  let complete = true;
  const [pois, wiki] = await Promise.all([
    photogenicPois(center, radiusM).catch(() => {
      complete = false; // Overpass was down: still usable, but don't cache it for a week
      return [] as OsmPoi[];
    }),
    wikiGeosearch(center, radiusM).catch(() => []),
  ]);

  const byKey = new Map<string, Candidate>();

  for (const poi of pois) {
    const wp = poi.tags.wikipedia?.startsWith("en:") ? poi.tags.wikipedia.slice(3) : null;
    byKey.set(poi.id, {
      key: poi.id,
      name: poi.name,
      kind: kindOf(poi.tags),
      subject: poi.at,
      heightM: heightOf(poi.tags),
      direction: parseDirection(poi.tags.direction),
      wikiTitle: wp,
      wikiExtract: null,
      osmTags: poi.tags,
      distanceM: Math.round(distanceM(center, poi.at)),
      score: 0,
    });
  }

  // Wikipedia articles that OSM didn't already cover (matched by title, or by being within 60 m)
  const osmList = [...byKey.values()];
  for (const w of wiki) {
    // a long bridge's OSM centre and its Wikipedia pin can be a few hundred metres apart
    const twin = osmList.find(
      (c) => c.wikiTitle === w.title || (distanceM(c.subject, w.at) < 400 && similar(c.name, w.title)),
    );
    if (twin) {
      twin.wikiTitle ??= w.title;
      continue;
    }
    // geosearch also returns streets, stations, neighbourhoods and events; keep photogenic-sounding places
    if (EVENTISH.test(w.title)) continue;
    const kind = kindOf({}, w.title);
    if (kind === "other") continue;
    byKey.set(`wiki/${w.pageid}`, {
      key: `wiki/${w.pageid}`,
      name: w.title,
      kind,
      subject: w.at,
      heightM: null,
      direction: null,
      wikiTitle: w.title,
      wikiExtract: null,
      osmTags: {},
      distanceM: Math.round(w.distM),
      score: 0,
    });
  }

  const all = [...byKey.values()];
  const summaries = await wikiSummaries([...new Set(all.map((c) => c.wikiTitle).filter((t): t is string => !!t))]).catch(
    () => new Map(),
  );
  for (const c of all) {
    const s = c.wikiTitle ? summaries.get(c.wikiTitle) : undefined;
    c.wikiExtract = s?.extract ?? null;
    if (s) c.osmTags = { ...c.osmTags, "lumiroam:pageImage": s.pageImage ?? "" };
    const views = s?.views30d ?? 0;
    c.score =
      KIND_SCORE[c.kind] +
      Math.max(0, Math.min(3, Math.log10(views + 1) - 2)) + // 100 views/month → 0, 100k → 3
      (c.key.startsWith("wiki/") ? 0 : 1) + // OSM-mapped means it physically exists on the ground
      (/^(way|relation)\//.test(c.key) ? 1 : 0) + // an outline, not a point: a building or area, not a plaque

      (c.wikiExtract ? 2 : 0) +
      (c.osmTags.wikidata ? 0.5 : 0) +
      (c.heightM && c.heightM > 25 ? 0.5 : 0) -
      (c.distanceM / radiusM) * 1.5;
  }
  return { candidates: all.sort((a, b) => b.score - a.score), complete };
}

/**
 * Top `n` candidates, skipping ones within `minGapM` of an already-picked spot. A park or garden
 * is an area, not a point: its centre mustn't crowd out the tombs standing inside it.
 */
export function pickDiverse(cands: Candidate[], n: number, minGapM = 60): Candidate[] {
  const picked: Candidate[] = [];
  for (const c of cands) {
    if (picked.length >= n) break;
    const crowded = picked.some(
      (p) => p.kind !== "nature" && c.kind !== "nature" && distanceM(p.subject, c.subject) < minGapM,
    );
    if (crowded || picked.some((p) => similar(p.name, c.name))) continue;
    picked.push(c);
  }
  return picked;
}

function parseDirection(v?: string): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  if (!isNaN(n)) return n;
  const pts: Record<string, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
  return pts[v.toUpperCase()] ?? null;
}

const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|[^a-z0-9 ]/g, "").trim();
function similar(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return x === y || (x.length > 4 && y.includes(x)) || (y.length > 4 && x.includes(y));
}
