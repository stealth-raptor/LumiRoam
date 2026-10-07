"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { Spot } from "@/lib/types";

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
  const when = new Date(`${localTime}:00`);
  const first = spots[0];
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted">
          {when.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} at {localTime.slice(11)} ({timezone})
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
          <SpotCard key={s.key} spot={s} n={i + 1} />
        ))}
      </ol>
    </div>
  );
}

function SpotCard({ spot: s, n }: { spot: Spot; n: number }) {
  const osm = `https://www.openstreetmap.org/?mlat=${s.shot.stand.lat}&mlon=${s.shot.stand.lon}#map=18/${s.shot.stand.lat}/${s.shot.stand.lon}`;
  return (
    <li className="overflow-hidden rounded-2xl border border-line bg-card">
      {s.sketch && (
        // eslint-disable-next-line @next/next/no-img-element -- data: URLs from the sketch step
        <img src={s.sketch.url} alt={`Crayon sketch of the planned shot of ${s.name}`} className="aspect-[4/3] w-full object-cover" />
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
          {s.plan?.writtenBy === "gemma" ? "Gemma" : "template"} · sketch from {s.sketch?.source === "sdxl-turbo" ? "SDXL-Turbo" : "sun + geometry"}
        </p>
        {s.photo && (
          <a href={s.photo.pageUrl} target="_blank" rel="noreferrer" className="flex items-center gap-3 rounded-xl border border-line p-2 text-xs text-muted">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote Commons thumbnail */}
            <img src={s.photo.thumbUrl} alt="" className="h-14 w-20 rounded-lg object-cover" loading="lazy" />
            <span>
              Reference photo: {s.photo.artist}, {s.photo.license}, via Wikimedia Commons. The sketch is a rough idea, not a prediction.
            </span>
          </a>
        )}
      </div>
    </li>
  );
}
