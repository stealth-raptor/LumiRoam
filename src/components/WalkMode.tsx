"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { bearing, distanceM } from "@/lib/geo";
import type { LatLon, Spot } from "@/lib/types";
import type { TickPart } from "@/mastra/walk-tick";

const SpotMap = dynamic(() => import("./SpotMap"), {
  ssr: false,
  loading: () => <div className="h-72 w-full animate-pulse rounded-2xl bg-line" />,
});

const MOVE_M = 75; // talk again after walking this far...
const EVERY_MS = 3 * 60 * 1000; // ...or after this long standing around
// Playing a short silent clip inside the Start tap unlocks audio on iOS/Android for clips that
// arrive later with the phone in a pocket. Built as a WAV here so it's guaranteed to be valid.
function silentWav(): string {
  const rate = 8000;
  const samples = rate / 10; // 0.1 s
  const buf = new DataView(new ArrayBuffer(44 + samples * 2));
  const str = (o: number, s: string) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  str(0, "RIFF");
  buf.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVEfmt ");
  buf.setUint32(16, 16, true); // PCM chunk size
  buf.setUint16(20, 1, true); // PCM
  buf.setUint16(22, 1, true); // mono
  buf.setUint32(24, rate, true);
  buf.setUint32(28, rate * 2, true); // byte rate
  buf.setUint16(32, 2, true); // block align
  buf.setUint16(34, 16, true); // bits per sample
  str(36, "data");
  buf.setUint32(40, samples * 2, true); // samples are already zero = silence
  let bin = "";
  new Uint8Array(buf.buffer).forEach((b) => (bin += String.fromCharCode(b)));
  return `data:audio/wav;base64,${btoa(bin)}`;
}

type LogEntry = { at: string; parts: TickPart[] };

export default function WalkMode({ shootId }: { shootId: string | null }) {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [walkId, setWalkId] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "starting" | "walking" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<LatLon | null>(null);
  const [pocket, setPocket] = useState(false);
  const [simulate, setSimulate] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  const audio = useRef<HTMLAudioElement | null>(null);
  const last = useRef<{ pos: LatLon; at: number } | null>(null);
  const prevPos = useRef<LatLon | null>(null);
  const heading = useRef<number | null>(null);
  const busy = useRef(false);
  const watchId = useRef<number | null>(null);
  const wakeLock = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (!shootId) return;
    fetch(`/api/shoots/${shootId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSpots(d.spots))
      .catch(() => {});
  }, [shootId]);

  const play = useCallback(async (audioB64: string | null, text: string) => {
    if (audioB64 && audio.current) {
      audio.current.src = `data:audio/mpeg;base64,${audioB64}`;
      await audio.current.play().catch(() => {});
      await new Promise<void>((r) => {
        audio.current!.onended = () => r();
        audio.current!.onerror = () => r();
      });
    } else if ("speechSynthesis" in window) {
      // no ElevenLabs key or it failed: the browser's built-in voice is the free fallback
      await new Promise<void>((r) => {
        const u = new SpeechSynthesisUtterance(text);
        u.onend = () => r();
        u.onerror = () => r();
        speechSynthesis.speak(u);
      });
    }
  }, []);

  const tick = useCallback(
    async (pos: LatLon, id: string) => {
      busy.current = true;
      last.current = { pos, at: Date.now() };
      try {
        const res = await fetch("/api/walk/tick", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ walkId: id, shootId, lat: pos.lat, lon: pos.lon, heading: heading.current }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "tick failed");
        if (data.parts?.length) {
          setLog((l) => [{ at: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), parts: data.parts }, ...l].slice(0, 20));
          await play(data.audio, data.text);
        }
      } catch (err) {
        console.warn("[walk] tick failed", err);
      } finally {
        busy.current = false;
      }
    },
    [shootId, play],
  );

  const onPosition = useCallback(
    (pos: LatLon, gpsHeading: number | null) => {
      setMe(pos);
      // compass heading from the GPS when walking, otherwise from the last few metres of movement
      if (gpsHeading != null && !isNaN(gpsHeading)) heading.current = gpsHeading;
      else if (prevPos.current && distanceM(prevPos.current, pos) > 8) heading.current = bearing(prevPos.current, pos);
      if (!prevPos.current || distanceM(prevPos.current, pos) > 8) prevPos.current = pos;

      if (!walkId || busy.current) return;
      const l = last.current;
      if (!l || distanceM(l.pos, pos) >= MOVE_M || Date.now() - l.at >= EVERY_MS) void tick(pos, walkId);
    },
    [walkId, tick],
  );

  // time-based check-in even if the GPS doesn't fire (standing still)
  useEffect(() => {
    if (status !== "walking") return;
    const t = setInterval(() => {
      const l = last.current;
      if (walkId && l && !busy.current && Date.now() - l.at >= EVERY_MS) void tick(me ?? l.pos, walkId);
    }, 20_000);
    return () => clearInterval(t);
  }, [status, walkId, me, tick]);

  // GPS watch (real walking) — paused in simulate mode
  useEffect(() => {
    if (status !== "walking" || simulate) return;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => onPosition({ lat: p.coords.latitude, lon: p.coords.longitude }, p.coords.speed && p.coords.speed > 0.5 ? p.coords.heading : null),
      (e) => setError(`GPS: ${e.message}`),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    );
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current);
    };
  }, [status, simulate, onPosition]);

  // keep the screen (and so GPS) awake; browsers drop the lock when the tab is hidden, so re-take it
  const lockScreen = useCallback(async () => {
    try {
      wakeLock.current = await navigator.wakeLock?.request("screen");
    } catch {}
  }, []);
  useEffect(() => {
    if (status !== "walking") return;
    const again = () => document.visibilityState === "visible" && void lockScreen();
    document.addEventListener("visibilitychange", again);
    return () => {
      document.removeEventListener("visibilitychange", again);
      void wakeLock.current?.release().catch(() => {});
    };
  }, [status, lockScreen]);

  async function start() {
    setStatus("starting");
    setError(null);
    // must happen inside the tap: unlock audio for clips that arrive later with the phone in a pocket
    audio.current ??= new Audio();
    audio.current.src = silentWav();
    void audio.current.play().catch(() => {});
    if ("speechSynthesis" in window) speechSynthesis.speak(new SpeechSynthesisUtterance(""));
    void lockScreen();
    try {
      const res = await fetch("/api/walk/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shootId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't start the walk");
      setWalkId(data.walkId);
      setStatus("walking");
    } catch (err) {
      setError((err as Error).message);
      setStatus("error");
    }
  }

  function stop() {
    setStatus("idle");
    setPocket(false);
    setWalkId(null);
    last.current = null;
    void wakeLock.current?.release().catch(() => {});
  }

  return (
    <div className="flex flex-col gap-4">
      {pocket && (
        <button
          onDoubleClick={() => setPocket(false)}
          className="fixed inset-0 z-[3000] flex items-end justify-center bg-black pb-10 text-xs text-neutral-800"
          aria-label="Pocket mode: double-tap to show the screen"
        >
          double-tap to wake · LumiRoam is listening for your location
        </button>
      )}

      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Walk</h1>
        <p className="text-sm text-muted">
          Every {MOVE_M} m or {EVERY_MS / 60000} minutes you&apos;ll hear what&apos;s nearby and how close your planned shots are.
          {shootId ? "" : " No shoot selected, so you'll only hear stories."}
        </p>
      </header>

      {status !== "walking" ? (
        <button
          onClick={start}
          disabled={status === "starting"}
          className="rounded-full bg-accent px-5 py-5 text-xl font-semibold text-accent-ink disabled:opacity-60"
        >
          {status === "starting" ? "Starting…" : "Start walk"}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <button onClick={() => setPocket(true)} className="rounded-full bg-accent px-4 py-4 font-semibold text-accent-ink">
            Pocket mode
          </button>
          <button onClick={stop} className="rounded-full border border-line px-4 py-4 font-semibold">
            Stop
          </button>
        </div>
      )}
      {error && <p className="rounded-xl border border-red-400 p-3 text-sm text-red-500">{error}</p>}

      <SpotMap spots={spots} me={me} onPick={simulate && walkId ? (p) => onPosition(p, null) : undefined} />

      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} />
        Simulate: tap the map to move (for testing indoors)
      </label>

      <ol className="flex flex-col gap-3">
        {log.map((entry, i) => (
          <li key={i} className="rounded-xl border border-line bg-card p-3 text-sm">
            <p className="mb-1 text-xs text-muted">{entry.at}</p>
            {entry.parts.map((p, j) => (
              <p key={j}>
                <span className="font-semibold">{p.kind === "story" ? "📖 " : "📷 "}</span>
                {p.text}
              </p>
            ))}
          </li>
        ))}
      </ol>

      {shootId && (
        <Link href={`/shoot/${shootId}`} className="text-sm text-muted">
          ← Back to the plan
        </Link>
      )}
    </div>
  );
}
