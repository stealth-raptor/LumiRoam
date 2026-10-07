"use client";

import "leaflet/dist/leaflet.css";
import { CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap } from "react-leaflet";
import { useEffect } from "react";
import type { LatLon, Spot } from "@/lib/types";

const ll = (p: LatLon): [number, number] => [p.lat, p.lon];

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length) map.fitBounds(points, { padding: [28, 28], maxZoom: 17 });
  }, [map, points]);
  return null;
}

/** Subjects (big dots), where to stand (small dots) and the line of sight between them. */
export default function SpotMap({ spots, me }: { spots: Spot[]; me?: LatLon | null }) {
  const points = spots.flatMap((s) => [ll(s.subject), ll(s.shot.stand)]);
  if (me) points.push(ll(me));
  return (
    <MapContainer
      center={points[0] ?? [51.5, 0]}
      zoom={15}
      scrollWheelZoom={false}
      className="h-72 w-full rounded-2xl border border-line"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <FitBounds points={points} />
      {spots.map((s, i) => (
        <span key={s.key}>
          <Polyline positions={[ll(s.shot.stand), ll(s.subject)]} pathOptions={{ color: "#d9661f", weight: 3, dashArray: "6 6" }} />
          <CircleMarker center={ll(s.shot.stand)} radius={6} pathOptions={{ color: "#2a2420", fillColor: "#fff", fillOpacity: 1, weight: 3 }}>
            <Tooltip>Stand here for {s.name}</Tooltip>
          </CircleMarker>
          <CircleMarker center={ll(s.subject)} radius={11} pathOptions={{ color: "#2a2420", fillColor: "#d9661f", fillOpacity: 1, weight: 2 }}>
            <Tooltip permanent direction="center" className="!bg-transparent !border-0 !shadow-none !text-white !font-bold">
              {i + 1}
            </Tooltip>
          </CircleMarker>
        </span>
      ))}
      {me && (
        <CircleMarker center={ll(me)} radius={8} pathOptions={{ color: "#fff", fillColor: "#2563eb", fillOpacity: 1, weight: 3 }}>
          <Tooltip>You</Tooltip>
        </CircleMarker>
      )}
    </MapContainer>
  );
}
