"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Frame, Spot } from "@/lib/types";

const SpotMap = dynamic(() => import("./SpotMap"), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-2xl bg-line" />,
});

export type ShootViewProps = {
  shootId: string | null;
  label: string;
  localTime: string;
  timezone: string;
  spots: Spot[];
  notes?: string[];
};

const PHASE_EMOJI: Record<Spot["light"]["phase"], string> = {
  "golden hour": "🌇",
  "blue hour": "🌆",
  night: "🌃",
  "low sun": "🌤️",
  "high sun": "☀️",
};

export default function ShootView({ shootId, label, localTime, timezone, spots, notes }: ShootViewProps) {
  // localTime is the wall clock at the destination: format it as-is (UTC, fixed locale) so the
  // server and the phone render the same text; a locale mismatch here broke hydration
  const when = new Date(`${localTime}:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
  const first = spots[0];
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {when} at {localTime.slice(11)} ({timezone})
        </p>
        <h1 className="text-2xl font-semibold leading-tight">{label.split(",").slice(0, 2).join(",")}</h1>
        {first && (
          <p className="text-sm">
            {PHASE_EMOJI[first.light.phase]} {first.light.phase} · {first.weather.summary} · sunset {first.light.sunset ?? "–"}, golden hour from{" "}
            {first.light.goldenStart ?? "–"}, blue hour until {first.light.blueEnd ?? "–"}
          </p>
        )}
      </header>

      {shootId && (
        <Link
          href={`/walk?shoot=${shootId}`}
          className="sticky top-3 z-[1000] rounded-full bg-accent px-5 py-4 text-center text-lg font-semibold text-accent-ink shadow-lg"
        >
          Start walk · put the phone away
        </Link>
      )}

      {!!notes?.length && (
        <ul className="rounded-xl border border-line bg-card p-3 text-sm text-muted">
          {notes.map((n) => (
            <li key={n}>• {n}</li>
          ))}
        </ul>
      )}

      <SpotMap spots={spots} />

      <ol className="flex flex-col gap-5">
        {spots.map((s, i) => (
          <SpotCard key={s.key} spot={s} n={i + 1} shootId={shootId} />
        ))}
      </ol>
    </div>
  );
}

// one drawing request at a time across all cards: the model draws on a single GPU anyway
let drawQueue: Promise<unknown> = Promise.resolve();
// once the free daily allowance is used up, stop asking for the rest of this visit
let outOfAllowance = false;
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const job = drawQueue.then(fn);
  drawQueue = job.catch(() => {});
  return job;
}

/**
 * The four drawings for a spot. Gemma wrote the prompts at plan time; each picture is drawn by the
 * open text-to-image model on first view (POST /api/sketch) and is cached in MongoDB after that.
 */
function useFrames(spot: Spot, shootId: string | null) {
  const [frames, setFrames] = useState<Frame[]>(spot.frames ?? []);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!shootId) return;
    let cancelled = false;
    (spot.frames ?? []).forEach((f, index) => {
      if (f.url) return;
      void queued(async () => {
        if (cancelled || outOfAllowance) return;
        setBusy(index);
        try {
          const res = await fetch("/api/sketch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shootId, spotKey: spot.key, index }),
          });
          const data = await res.json();
          if (res.status === 429) outOfAllowance = true;
          if (!res.ok) throw new Error(data.error ?? "drawing failed");
          if (!cancelled) setFrames((fs) => fs.map((x, i) => (i === index ? { ...x, url: data.url, model: data.model } : x)));
        } catch (err) {
          if (!cancelled) setError((err as Error).message);
        } finally {
          if (!cancelled) setBusy(null);
        }
      });
    });
    return () => {
      cancelled = true;
    };
  }, [spot, shootId]);
  return { frames, busy, error };
}

function SpotCard({ spot: s, n, shootId }: { spot: Spot; n: number; shootId: string | null }) {
  const { frames, busy, error } = useFrames(s, shootId);
  const [open, setOpen] = useState<number | null>(null);
  const osm = `https://www.openstreetmap.org/?mlat=${s.shot.stand.lat}&mlon=${s.shot.stand.lon}#map=18/${s.shot.stand.lat}/${s.shot.stand.lon}`;
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-card">
      {frames.length > 0 ? (
        <div className="grid grid-cols-2 gap-0.5 bg-line">
          {frames.map((f, i) => (
            <button key={i} type="button" onClick={() => setOpen(open === i ? null : i)} className="relative bg-card text-left">
              {/* eslint-disable-next-line @next/next/no-img-element -- GridFS URLs, not static assets */}
              <img
                src={f.url ?? s.sketch?.url}
                alt={`${f.label}: ${f.prompt}`}
                className={`aspect-[4/3] w-full object-cover ${f.url ? "" : "opacity-50 blur-[1px]"}`}
              />
              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">
                {busy === i ? "✏️ drawing…" : f.label}
              </span>
            </button>
          ))}
        </div>
      ) : (
        s.sketch && (
          // eslint-disable-next-line @next/next/no-img-element -- GridFS / data URLs
          <img src={s.sketch.url} alt={`Sketch of the planned shot of ${s.name}`} className="aspect-[4/3] w-full object-cover" />
        )
      )}
      {open != null && frames[open] && (
        <p className="border-b border-line bg-background px-4 py-2 text-xs text-muted">
          <span className="font-semibold">{frames[open].label}</span> · prompt by {frames[open].promptBy === "gemma" ? "Gemma, from the photo" : "template"}
          {frames[open].model ? ` · drawn by ${frames[open].model}` : ""}: “{frames[open].prompt}”
        </p>
      )}
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-accent-ink">{n}</span>
          <h2 className="text-lg font-semibold leading-tight">{s.name}</h2>
        </div>
        {s.plan && <p className="font-medium">{s.plan.headline}</p>}
        {s.plan && (
          <dl className="grid grid-cols-[5.5rem_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-muted">Stand</dt>
            <dd>
              {s.plan.whereToStand}{" "}
              <a href={osm} target="_blank" rel="noreferrer" className="text-accent underline">
                map
              </a>
            </dd>
            <dt className="text-muted">Lens</dt>
            <dd>{s.plan.lens}</dd>
            <dt className="text-muted">Settings</dt>
            <dd>{s.plan.settings}</dd>
            <dt className="text-muted">Tip</dt>
            <dd>{s.plan.tip}</dd>
          </dl>
        )}
        <p className="text-xs text-muted">
          {PHASE_EMOJI[s.light.phase]} {s.light.phase}, sun {s.light.sunAltitude}° {s.light.sunCompass} · {s.shot.lightAngle} · plan by{" "}
          {s.plan?.writtenBy === "gemma" ? "Gemma" : "template"} · drawings{" "}
          {frames.some((f) => f.url) ? `by ${frames.find((f) => f.model)?.model ?? "text-to-image"}` : "pending"}
          {error ? ` (${error}; showing the geometry sketch)` : ""}
        </p>
        {s.photo && (
          <a href={s.photo.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line p-2 text-xs text-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote Commons thumbnail */}
            <img src={s.photo.thumbUrl} alt="" className="h-14 w-20 rounded-lg object-cover" loading="lazy" />
            <span>
              Reference photo for Gemma: {s.photo.artist}, {s.photo.license}, via Wikimedia Commons. The drawings are a rough idea of
              the shot, not a prediction.
            </span>
          </a>
        )}
      </div>
    </li>
  );
}
