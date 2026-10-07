import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import PlanForm from "@/components/PlanForm";
import { dbConfigured, listShoots } from "@/lib/db";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold">LumiRoam</h1>
        <p className="text-muted">
          Most tour guides tell you about a building. This one tells you how and when to photograph it. Plan here, then put
          your phone in your pocket and walk.
        </p>
      </header>
      <PlanForm />
      <Suspense>
        <SavedShoots />
      </Suspense>
      <footer className="text-xs text-muted">
        Open source: Gemma + SDXL-Turbo on our own GPU, Mastra, OpenStreetMap, Wikipedia, Wikimedia Commons, Open-Meteo.
      </footer>
    </main>
  );
}

async function SavedShoots() {
  await connection(); // MongoDB isn't fetch(), so tell Next.js this part is per-request
  if (!dbConfigured()) return null;
  const shoots = await listShoots(8).catch(() => []);
  if (!shoots.length) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted">Saved shoots</h2>
      <ul className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-card">
        {shoots.map((s) => (
          <li key={s._id.toHexString()}>
            <Link href={`/shoot/${s._id.toHexString()}`} className="flex justify-between gap-3 px-4 py-3">
              <span className="truncate">{s.place}</span>
              <span className="shrink-0 text-muted">{s.localTime.replace("T", " ")}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
