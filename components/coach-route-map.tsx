"use client";
import { useEffect, useRef } from "react";
import type { CoachVisual } from "@/lib/coach-visuals";

const activityWord = {
  run: "run",
  walk: "walk",
  bike: "ride",
} as const;

export function routeDurationLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `about ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest
    ? `about ${hours} h ${rest} min`
    : `about ${hours} h`;
}

export function CoachRouteSummary({
  visual,
}: {
  visual: Extract<CoachVisual, { kind: "route_map" }>;
}) {
  return (
    <div className="coach-route-summary">
      <p>
        <strong>
          {visual.distanceKm} km {activityWord[visual.activity]}
        </strong>
        <span> · {routeDurationLabel(visual.durationSeconds)}</span>
      </p>
      <ol>
        {visual.stops.map((stop, i) => (
          <li key={`${stop.lat}:${stop.lng}:${i}`}>
            {i === 0
              ? "Start"
              : i === visual.stops.length - 1
                ? "End"
                : `Via ${i}`}
            : {stop.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CoachRouteMap({
  visual,
}: {
  visual: Extract<CoachVisual, { kind: "route_map" }>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let map: import("leaflet").Map | undefined;
    let cancelled = false;
    void (async () => {
      const leaflet = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (cancelled || !holder.current) return;
      const L = leaflet.default;
      const path = visual.path.map(([lat, lng]) => L.latLng(lat, lng));
      map = L.map(holder.current, {
        scrollWheelZoom: true,
        attributionControl: true,
      });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      L.polyline(path, {
        color: "#ac2d4f",
        weight: 5,
        opacity: 0.92,
        lineJoin: "round",
      }).addTo(map);
      visual.stops.forEach((stop, i) => {
        const start = i === 0;
        const end = i === visual.stops.length - 1;
        L.circleMarker([stop.lat, stop.lng], {
          radius: start || end ? 8 : 6,
          color: "#fff",
          weight: 2,
          fillColor: start ? "#1f7a4d" : end ? "#ac2d4f" : "#3d5a80",
          fillOpacity: 1,
        })
          .bindPopup(
            `${start ? "Start" : end ? "End" : "Via"}: ${stop.label}`,
          )
          .addTo(map!);
      });
      map.fitBounds(L.latLngBounds(path), { padding: [24, 24], maxZoom: 16 });
    })();
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [visual]);
  return (
    <div
      ref={holder}
      className="coach-route-map"
      role="application"
      aria-label={`${visual.title} map`}
    />
  );
}
