"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect, useRef } from "react";
import type { WalkDiary } from "@/lib/walk";

function Fit({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !points.length) return;
    map.fitBounds(points, { padding: [24, 24], maxZoom: 17 });
    done.current = true;
  }, [map, points]);
  return null;
}

/** The route actually walked (from the time-series collection), what was said where, and the planned spots. */
export default function DiaryMap({ diary }: { diary: WalkDiary }) {
  const route = diary.route.map((p) => [p.lat, p.lon] as [number, number]);
  const points = [...route, ...diary.spots.map((s) => [s.subject.lat, s.subject.lon] as [number, number])];
  return (
    <MapContainer center={points[0] ?? [51.5, 0]} zoom={15} scrollWheelZoom={false} className="h-80 w-full rounded-2xl border border-line">
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <Fit points={points} />
      {route.length > 1 && <Polyline positions={route} pathOptions={{ color: "#2563eb", weight: 5, opacity: 0.8 }} />}
      {diary.spots.map((s) => {
        const reached = diary.reached.includes(s.key);
        return (
          <CircleMarker
            key={s.key}
            center={[s.shot.stand.lat, s.shot.stand.lon]}
            radius={9}
            pathOptions={{ color: "#2a2420", fillColor: reached ? "#16a34a" : "#d9661f", fillOpacity: 1, weight: 2 }}
          >
            <Tooltip>
              {reached ? "✓ " : ""}
              {s.name}
            </Tooltip>
          </CircleMarker>
        );
      })}
      {diary.events.map((e, i) => (
        <CircleMarker key={i} center={[e.lat, e.lon]} radius={5} pathOptions={{ color: "#fff", fillColor: e.kind === "story" ? "#7c3aed" : "#d9661f", fillOpacity: 1, weight: 2 }}>
          <Tooltip>{e.title}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
