"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ShootView, { type ShootViewProps } from "./ShootView";
import { guessSensor } from "@/lib/camera";
import type { Spot } from "@/lib/types";

const STEPS = [
  "Finding the place on OpenStreetMap…",
  "Looking for viewpoints, towers and bridges…",
  "Checking Wikipedia and Wikimedia Commons…",
  "Working out where the sun will be…",
  "Gemma is writing your plans…",
  "Sketching the compositions…",
  "Saving the shoot…",
];

function defaultTime() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const GEAR_KEY = "lumiroam.gear";

export default function PlanForm() {
  const router = useRouter();
  const [place, setPlace] = useState("");
  const [localTime, setLocalTime] = useState("");
  const [camera, setCamera] = useState("");
  const [sensor, setSensor] = useState<"apsc" | "full">("apsc");
  const [lenses, setLenses] = useState("18-55mm kit");
  const [radiusM, setRadiusM] = useState(800);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ShootViewProps | null>(null);

  // Browser-only setup: the default time depends on "now" and the saved gear lives in localStorage,
  // so neither can be computed during prerender without a hydration mismatch.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setLocalTime((t) => t || defaultTime());
    try {
      const g = JSON.parse(localStorage.getItem(GEAR_KEY) ?? "null");
      if (g?.camera) setCamera(g.camera);
      if (g?.sensor) setSensor(g.sensor);
      if (g?.lenses) setLenses(g.lenses);
    } catch {}
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 6000);
    return () => clearInterval(t);
  }, [busy]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStep(0);
    setError(null);
    setResult(null);
    try {
      localStorage.setItem(GEAR_KEY, JSON.stringify({ camera, sensor, lenses }));
    } catch {}
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ place, localTime, gear: { camera, sensor, lenses }, radiusM }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      if (data.shootId) {
        router.push(`/shoot/${data.shootId}`);
        return;
      }
      setResult({
        shootId: null,
        label: data.label,
        localTime: data.request.localTime,
        timezone: data.timezone,
        spots: data.spots as Spot[],
        notes: data.notes,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-xl border border-line bg-card px-4 py-3 text-base outline-none focus:border-accent";

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Where are you going?</span>
          <input className={field} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Tower Bridge, London" required minLength={2} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">When? (local time there)</span>
          <input className={field} type="datetime-local" value={localTime} onChange={(e) => setLocalTime(e.target.value)} required />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Your camera</span>
          <input
            className={field}
            value={camera}
            onChange={(e) => {
              setCamera(e.target.value);
              // guess the sensor from the name; the user can still change it below
              const guess = guessSensor(e.target.value);
              if (guess) setSensor(guess);
            }}
            placeholder="e.g. Canon EOS 250D, Nikon Z6, Sony a6400"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Sensor</span>
            <select className={field} value={sensor} onChange={(e) => setSensor(e.target.value as "apsc" | "full")}>
              <option value="apsc">APS-C sensor</option>
              <option value="full">Full-frame sensor</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm text-muted">Walk radius</span>
            <select className={field} value={radiusM} onChange={(e) => setRadiusM(+e.target.value)}>
              <option value={500}>500 m</option>
              <option value={800}>800 m</option>
              <option value={1200}>1.2 km</option>
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-sm text-muted">Your lenses</span>
          <input className={field} value={lenses} onChange={(e) => setLenses(e.target.value)} placeholder="18-55mm kit, 50mm f/1.8" />
        </label>
        <button disabled={busy} className="rounded-full bg-accent px-5 py-4 text-lg font-semibold text-accent-ink disabled:opacity-60">
          {busy ? "Planning…" : "Plan my shoot"}
        </button>
        {busy && <p className="text-center text-sm text-muted">{STEPS[step]}</p>}
        {error && <p className="rounded-xl border border-red-400 p-3 text-sm text-red-500">{error}</p>}
      </form>
      {result && <ShootView {...result} />}
    </div>
  );
}
