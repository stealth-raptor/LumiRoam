"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import type { WalkDiary } from "@/lib/walk";

const DiaryMap = dynamic(() => import("./DiaryMap"), {
  ssr: false,
  loading: () => <div className="h-80 w-full animate-pulse rounded-2xl bg-line" />,
});

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export default function WalkDiaryView({ diary }: { diary: WalkDiary }) {
  const minutes = Math.max(1, Math.round((Date.parse(diary.endedAt) - Date.parse(diary.startedAt)) / 60000));
  const stories = diary.events.filter((e) => e.kind === "story").length;
  const stats = [
    { label: "walked", value: diary.distanceM >= 1000 ? `${(diary.distanceM / 1000).toFixed(1)} km` : `${diary.distanceM} m` },
    { label: "minutes", value: String(minutes) },
    { label: "stories", value: String(stories) },
    { label: "shots reached", value: diary.spots.length ? `${diary.reached.length}/${diary.spots.length}` : "–" },
  ];
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        {/* real instants shown in the phone's own time zone: rendered differently on the server, on purpose */}
        <p className="text-sm text-muted" suppressHydrationWarning>
          {new Date(diary.startedAt).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })},{" "}
          {time(diary.startedAt)}–{time(diary.endedAt)}
        </p>
        <h1 className="text-2xl font-semibold">Walk diary</h1>
      </header>

      <dl className="grid grid-cols-4 gap-2">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-line bg-card p-3 text-center">
            <dd className="text-xl font-semibold">{s.value}</dd>
            <dt className="text-xs text-muted">{s.label}</dt>
          </div>
        ))}
      </dl>

      <DiaryMap diary={diary} />

      {diary.spots.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Planned shots</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {diary.spots.map((s) => (
              <li key={s.key}>
                {diary.reached.includes(s.key) ? "✅" : "⬜"} {s.name}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">What you heard</h2>
        {diary.events.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
        <ol className="flex flex-col gap-3">
          {diary.events.map((e, i) => (
            <li key={i} className="flex flex-col gap-2 rounded-xl border border-line bg-card p-3 text-sm">
              <p className="text-xs text-muted" suppressHydrationWarning>
                {time(e.at)} · {e.kind === "story" ? "📖 story" : "📷 your shot"} · {e.title}
              </p>
              <p>{e.text}</p>
              {e.audioId && <audio controls preload="none" src={`/api/media/${e.audioId}`} className="w-full" />}
            </li>
          ))}
        </ol>
      </section>

      <div className="flex gap-4 text-sm text-muted">
        {diary.shootId && <Link href={`/shoot/${diary.shootId}`}>← The plan</Link>}
        <Link href="/">New plan</Link>
      </div>
    </div>
  );
}
