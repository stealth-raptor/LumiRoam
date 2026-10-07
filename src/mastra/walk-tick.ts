import { compass, relativeWords } from "@/lib/geo";
import { getWalk, nearestPlannedShot, nextUnheardPlace, updateWalk } from "@/lib/walk";
import type { LatLon } from "@/lib/types";
import { gemmaConfigured } from "./model";
import { mastra } from ".";

export type TickPart = { kind: "shot-here" | "shot-near" | "story"; text: string; title: string };

const AT_SPOT_M = 35; // phone GPS is good to ~10-20 m in a city; this still feels like "here"
const ANNOUNCE_WITHIN_M = 800;

const bucketOf = (m: number) => (m < 100 ? 100 : m < 250 ? 250 : m < 500 ? 500 : 800);

/** "f/8, 1/125s, ISO 200" reads badly aloud; turn it into how a photographer would say it. */
export function forSpeech(text: string): string {
  const ord = (n: number) => (n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th");
  return text
    .replace(/\bf\/(\d+(?:\.\d)?)/g, "f $1")
    .replace(/\b1\/2s\b/g, "half a second")
    .replace(/\b1\/(\d+)s\b/g, (_, d) => `a ${d}${ord(+d)} of a second`)
    .replace(/\b(\d+)s\b/g, "$1 seconds")
    .replace(/(\d+)\s?mm\b/g, "$1 millimetre")
    .replace(/[*_#`]/g, "");
}

function firstSentences(text: string, n: number): string {
  const parts = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  return parts.slice(0, n).join(" ").trim();
}

/**
 * One walk check-in: (1) is a planned shot near, or am I standing at it?
 * (2) the nearest documented place I haven't heard about yet, told only from its Wikipedia text.
 */
export async function walkTick(input: {
  walkId: string;
  shootId: string | null;
  here: LatLon;
  heading: number | null;
}): Promise<TickPart[]> {
  const walk = await getWalk(input.walkId);
  if (!walk) throw new Error("Unknown walk");
  const parts: TickPart[] = [];

  if (input.shootId) {
    const hit = await nearestPlannedShot(input.shootId, input.here, walk.doneShots ?? []);
    if (hit) {
      const s = hit.spot;
      if (hit.distanceM <= AT_SPOT_M) {
        const turn = relativeWords(input.heading, s.shot.facing);
        const turnWords = input.heading == null ? `Face ${s.shot.facingCompass}.` : `Face ${s.shot.facingCompass}, that's ${turn}.`;
        parts.push({
          kind: "shot-here",
          title: s.name,
          // a little history first, then how to shoot it
          text: forSpeech(
            `You're at your planned spot for ${s.name}. ${s.plan?.history ?? ""} ${turnWords} ${s.plan?.lens ?? ""} Settings: ${s.plan?.settings ?? ""} ${s.plan?.tip ?? ""}`,
          ),
        });
        await updateWalk(input.walkId, { doneShot: s.key });
      } else if (hit.distanceM <= ANNOUNCE_WITHIN_M) {
        const bucket = bucketOf(hit.distanceM);
        const last = walk.lastShotNote;
        // speak again only for a different shot, or when the walker has got meaningfully closer
        if (!last || last.key !== s.key || bucket < last.bucket) {
          const dir = input.heading == null ? `to the ${compass(hit.bearing)}` : `${relativeWords(input.heading, hit.bearing)}, to the ${compass(hit.bearing)}`;
          parts.push({
            kind: "shot-near",
            title: s.name,
            text: `Your planned shot of ${s.name} is about ${Math.round(hit.distanceM / 10) * 10} metres ${dir}.`,
          });
          await updateWalk(input.walkId, { lastShotNote: { key: s.key, bucket } });
        }
      }
    }
  }

  // don't pile a history story on top of "you're at your spot, here are your settings"
  if (!parts.some((p) => p.kind === "shot-here")) {
    const place = await nextUnheardPlace(input.walkId, input.here, { markHeard: true });
    if (place) {
      const where =
        place.distanceM < 40 ? "right here" : `about ${Math.round(place.distanceM / 10) * 10} metres ${relativeWords(input.heading, place.bearing)}`;
      let story = `${place.title}, ${where}. ${firstSentences(place.extract, 2)}`;
      if (gemmaConfigured()) {
        try {
          const res = await mastra.getAgent("guideAgent").generate(
            `LISTENER POSITION: ${place.title} is ${where}.\n\nSOURCE TEXT (Wikipedia):\n${place.extract}`,
            // the facts are already in the prompt; with tools on, Gemma sometimes answered with a
            // tool call and no text, and the walker silently got the raw Wikipedia intro instead
            { abortSignal: AbortSignal.timeout(25_000), toolChoice: "none" },
          );
          if (res.text.trim()) story = res.text.trim();
          else console.warn("[walk] Gemma returned no text; reading the Wikipedia intro instead");
        } catch (err) {
          console.warn("[walk] Gemma story failed, reading the Wikipedia intro instead:", (err as Error).message);
        }
      }
      parts.push({ kind: "story", title: place.title, text: forSpeech(story) });
    }
  }
  return parts;
}
