// Nominatim, Overpass and the Wikimedia APIs all ask for an identifying
// User-Agent with a way to contact the operator, and throttle generic ones.
export const USER_AGENT =
  process.env.LUMIROAM_USER_AGENT ?? "LumiRoam/0.1 (+https://github.com/stealth-raptor/LumiRoam; open-source photographer's tour guide)";

// Minimum gap between requests to the same host. Nominatim's policy is 1 req/s;
// Wikimedia asks for serial requests rather than parallel bursts.
const MIN_GAP_MS: Record<string, number> = {
  "nominatim.openstreetmap.org": 1100,
  "en.wikipedia.org": 100,
  "commons.wikimedia.org": 100,
};
const queues = new Map<string, Promise<unknown>>();

function serial<T>(host: string, fn: () => Promise<T>): Promise<T> {
  const gap = MIN_GAP_MS[host];
  if (gap == null) return fn();
  const prev = queues.get(host) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(async () => {
    try {
      return await fn();
    } finally {
      await new Promise((r) => setTimeout(r, gap));
    }
  });
  queues.set(host, next);
  return next;
}

export async function getJSON<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const { timeoutMs = 15000, ...rest } = init;
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt++) {
    const res = await serial(host, () =>
      fetch(url, {
        ...rest,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...rest.headers },
        signal: AbortSignal.timeout(timeoutMs),
      }),
    );
    if ((res.status === 429 || res.status === 503) && attempt < 3) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 1000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, Math.min(wait, 8000)));
      continue;
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`${res.status} from ${host}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }
}
