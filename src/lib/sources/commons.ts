import { getJSON } from "../http";
import { distanceM } from "../geo";
import type { CommonsPhoto, LatLon } from "../types";

// Wikimedia rate-limits unauthenticated clients hard, so every lookup here is one request:
// lead images are batched through enwiki (which proxies Commons metadata), and the
// nearby search uses generator=geosearch to get titles, image info and camera position together.

type ImagePage = {
  title: string;
  missing?: boolean;
  imagerepository?: string; // "shared" = on Commons; "local" = enwiki-only, often non-free
  coordinates?: { lat: number; lon: number; primary?: boolean }[];
  imageinfo?: {
    url: string;
    thumburl?: string;
    descriptionurl: string;
    mime: string;
    width: number;
    height: number;
    extmetadata?: Record<string, { value: string }>;
  }[];
};

const IMAGE_PROPS = {
  iiprop: "url|mime|size|extmetadata",
  iiurlwidth: "768",
  iiextmetadatafilter: "Artist|LicenseShortName",
  format: "json",
  formatversion: "2",
};

const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();

function toPhoto(page: ImagePage): CommonsPhoto | null {
  const ii = page.imageinfo?.[0];
  if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) return null;
  if (ii.width < 600 || ii.width < ii.height * 0.6) return null; // skip tiny and very tall images
  const meta = ii.extmetadata ?? {};
  // Commons stores where the camera stood as the photo's primary coordinate
  const cam = page.coordinates?.find((c) => c.primary !== false) ?? null;
  return {
    title: page.title,
    url: ii.url,
    thumbUrl: ii.thumburl ?? ii.url,
    pageUrl: ii.descriptionurl.replace("en.wikipedia.org/wiki/File:", "commons.wikimedia.org/wiki/File:"),
    artist: stripHtml(meta.Artist?.value ?? "Unknown"),
    license: stripHtml(meta.LicenseShortName?.value ?? "see file page"),
    camera: cam ? { lat: cam.lat, lon: cam.lon } : null,
  };
}

/** Wikipedia lead images for many places, 20 per request. Only free files hosted on Commons. */
export async function leadPhotos(fileNames: string[]): Promise<Map<string, CommonsPhoto>> {
  const out = new Map<string, CommonsPhoto>();
  const names = [...new Set(fileNames.filter(Boolean))];
  for (let i = 0; i < names.length; i += 20) {
    const url = new URL("https://en.wikipedia.org/w/api.php");
    url.search = new URLSearchParams({
      action: "query",
      prop: "imageinfo",
      titles: names.slice(i, i + 20).map((n) => `File:${n}`).join("|"),
      ...IMAGE_PROPS,
    }).toString();
    const data = await getJSON<{ query?: { pages: ImagePage[] } }>(url.toString());
    for (const page of data.query?.pages ?? []) {
      if (page.imagerepository !== "shared") continue;
      const photo = toPhoto(page);
      if (photo) out.set(page.title.replace(/^File:/, "").replace(/ /g, "_"), photo);
    }
  }
  return out;
}

/** Geotagged Commons photos within 300 m that name the subject in their title, one request. */
export async function nearbyPhotos(subject: LatLon, name: string): Promise<CommonsPhoto[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    generator: "geosearch",
    ggscoord: `${subject.lat}|${subject.lon}`,
    ggsradius: "300",
    ggsnamespace: "6",
    ggslimit: "40",
    prop: "imageinfo|coordinates",
    coprimary: "primary",
    ...IMAGE_PROPS,
  }).toString();
  const data = await getJSON<{ query?: { pages: ImagePage[] } }>(url.toString());
  return (data.query?.pages ?? [])
    .filter((p) => namesSubject(p.title, name) && !NOT_A_VIEW.test(p.title))
    .map(toPhoto)
    .filter((p): p is CommonsPhoto => p !== null);
}

/**
 * Pick a real photo of the subject, in this order:
 *  1. a geotagged photo naming the subject, taken 30-300 m away: a proven place to stand
 *     AND the layout for the sketch;
 *  2. the Wikipedia lead image (most recognisable view, usually no camera position);
 *  3. any nearby photo naming the subject.
 * Returns null rather than a photo of something else next door.
 */
export async function findPhoto(subject: LatLon, name: string, lead: CommonsPhoto | null): Promise<CommonsPhoto | null> {
  const photos = await nearbyPhotos(subject, name);
  const framed = photos.find((p) => p.camera && within(p.camera, subject, 30, 300));
  return framed ?? lead ?? photos[0] ?? null;
}

// interiors and details make a bad reference for "where to stand and what the frame looks like"
const NOT_A_VIEW =
  /interior|inside|stair|wheelhouse|detail|plaque|\bsign\b|\bmodel\b|\bmap\b|ceiling|window|organ|altar|\bnave\b|crypt|tomb|exhibit|display|\broad\b|street|station|platform|\bbus\b|engine|mess deck|cabin/i;

const STOP = new Set(["the", "of", "and", "saint", "st", "street", "road", "old", "new", "great"]);

/** Does a file title mention the distinctive words of the place name? */
function namesSubject(fileTitle: string, name: string): boolean {
  const words = name
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  if (!words.length) return false;
  const t = fileTitle.toLowerCase();
  const hits = words.filter((w) => t.includes(w)).length;
  return hits >= Math.min(2, words.length);
}

const within = (a: LatLon, b: LatLon, min: number, max: number) => {
  const d = distanceM(a, b);
  return d >= min && d <= max;
};
