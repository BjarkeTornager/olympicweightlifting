"use client";
import { memo, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Expand, X } from "@/components/ui/icons";
import { privateFetch } from "@/lib/private-fetch";
import type { CoachVisual } from "@/lib/coach-visuals";
import { Button } from "./ui/button";

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
  return rest ? `about ${hours} h ${rest} min` : `about ${hours} h`;
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
        {visual.targetKm != null && (
          <span>
            {" "}
            · requested {visual.targetKm} km
          </span>
        )}
      </p>
      <p className="fine-print">Arrows on the map show the running direction.</p>
      <ol>
        {visual.stops.map((stop, i) => (
          <li key={`${stop.lat}:${stop.lng}:${i}`}>
            {i === 0
              ? "Start"
              : i === visual.stops.length - 1
                ? visual.loop
                  ? "Finish"
                  : "End"
                : `Via ${i}`}
            : {stop.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

let mapsLoader: Promise<NonNullable<Window["google"]>["maps"]> | undefined;

async function googleMapsApi() {
  if (window.google?.maps?.Map) return window.google.maps;
  mapsLoader ??= (async () => {
    const response = await privateFetch("/api/maps/config");
    const body = (await response.json()) as { key?: string; error?: string };
    if (!response.ok || !body.key)
      throw Error(body.error ?? "Google Maps is not connected yet.");
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(
        "script[data-coach-google-maps]",
      );
      if (existing) {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener(
          "error",
          () => reject(Error("Could not load Google Maps.")),
          { once: true },
        );
        return;
      }
      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(body.key!)}&v=weekly`;
      script.async = true;
      script.dataset.coachGoogleMaps = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(Error("Could not load Google Maps."));
      document.head.appendChild(script);
    });
    if (!window.google?.maps?.Map) throw Error("Could not load Google Maps.");
    return window.google.maps;
  })();
  try {
    return await mapsLoader;
  } catch (error) {
    mapsLoader = undefined;
    throw error;
  }
}

function routeSignature(
  visual: Extract<CoachVisual, { kind: "route_map" }>,
  fullscreen: boolean,
) {
  return [
    fullscreen ? "full" : "inline",
    visual.title,
    visual.path.map((point) => point.join(",")).join(";"),
    visual.stops
      .map((stop) => `${stop.lat},${stop.lng},${stop.label}`)
      .join(";"),
  ].join("|");
}

type MapHandle = { fitBounds: (bounds: unknown, padding?: number) => void };
type OverlayHandle = { setMap?: (map: unknown) => void };

function GoogleRouteCanvas({
  visual,
  fullscreen,
}: {
  visual: Extract<CoachVisual, { kind: "route_map" }>;
  fullscreen: boolean;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const session = useRef<
    | {
        el: HTMLDivElement;
        map: MapHandle;
        overlays: OverlayHandle[];
        signature: string;
        size: string;
        path: { lat: number; lng: number }[];
      }
    | undefined
  >(undefined);
  const [error, setError] = useState("");
  const signature = routeSignature(visual, fullscreen);
  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    void (async () => {
      try {
        const maps = await googleMapsApi();
        if (cancelled || !holder.current) return;
        const path = visual.path.map(([lat, lng]) => ({ lat, lng }));
        let handle = session.current;
        if (!handle || handle.el !== holder.current) {
          const map = new maps.Map(holder.current, {
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            zoomControl: true,
            gestureHandling: "greedy",
            clickableIcons: false,
          });
          holder.current.classList.add("coach-route-google");
          handle = {
            el: holder.current,
            map,
            overlays: [],
            signature: "",
            size: "",
            path,
          };
          session.current = handle;
        }
        const size = `${Math.round(handle.el.clientWidth / 8)}x${Math.round(handle.el.clientHeight / 8)}`;
        const redraw = handle.signature !== signature;
        if (redraw) {
          handle.overlays.forEach((overlay) => overlay.setMap?.(null));
          const bounds = new maps.LatLngBounds();
          path.forEach((point) => bounds.extend(point));
          const overlays: OverlayHandle[] = [
            new maps.Polyline({
              path,
              map: handle.map,
              strokeColor: "#ac2d4f",
              strokeOpacity: 0.95,
              strokeWeight: fullscreen ? 7 : 5,
              icons: [
                {
                  icon: {
                    path: maps.SymbolPath.FORWARD_CLOSED_ARROW,
                    scale: fullscreen ? 4 : 3,
                    fillColor: "#ac2d4f",
                    fillOpacity: 1,
                    strokeColor: "#ffffff",
                    strokeWeight: 1,
                  },
                  offset: "6%",
                  repeat: fullscreen ? "64px" : "78px",
                },
              ],
            }) as OverlayHandle,
          ];
          visual.stops.forEach((stop, i) => {
            const start = i === 0;
            const end = i === visual.stops.length - 1;
            overlays.push(
              new maps.Marker({
                map: handle.map,
                position: { lat: stop.lat, lng: stop.lng },
                label: {
                  text: start ? "A" : end ? "B" : String(i),
                  color: "#ffffff",
                  fontSize: "11px",
                  fontWeight: "700",
                },
                title: `${start ? "Start" : end ? "Finish" : "Via"}: ${stop.label}`,
              }) as OverlayHandle,
            );
          });
          handle.overlays = overlays;
          handle.signature = signature;
          handle.size = size;
          handle.path = path;
          requestAnimationFrame(() =>
            handle.map.fitBounds(bounds, fullscreen ? 48 : 32),
          );
        }
        observer = new ResizeObserver(() => {
          const live = session.current;
          if (!live) return;
          const next = `${Math.round(live.el.clientWidth / 8)}x${Math.round(live.el.clientHeight / 8)}`;
          if (next === live.size || next === "0x0") return;
          live.size = next;
          const bounds = new maps.LatLngBounds();
          live.path.forEach((point) => bounds.extend(point));
          live.map.fitBounds(bounds, fullscreen ? 48 : 32);
        });
        observer.observe(holder.current);
      } catch (caught) {
        if (!cancelled)
          setError(
            caught instanceof Error
              ? caught.message
              : "Could not open Google Maps.",
          );
      }
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [signature, fullscreen, visual]);
  return (
    <>
      <div
        ref={holder}
        className="coach-route-map"
        role="application"
        aria-label={`${visual.title} map`}
      />
      {error && (
        <p className="coach-route-map-error" role="status">
          {error} The route details are still listed below.
        </p>
      )}
    </>
  );
}

function sameRoute(
  a: Extract<CoachVisual, { kind: "route_map" }>,
  b: Extract<CoachVisual, { kind: "route_map" }>,
) {
  return routeSignature(a, false) === routeSignature(b, false);
}

export const CoachRouteMap = memo(
  function CoachRouteMap({
    visual,
  }: {
    visual: Extract<CoachVisual, { kind: "route_map" }>;
  }) {
    const [fullscreen, setFullscreen] = useState(false);
    const titleId = useId();
    useEffect(() => {
      if (!fullscreen) return;
      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") setFullscreen(false);
      };
      const previous = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      window.addEventListener("keydown", onKey);
      return () => {
        document.body.style.overflow = previous;
        window.removeEventListener("keydown", onKey);
      };
    }, [fullscreen]);
    const tools = (
      <Button
        variant={fullscreen ? "secondary" : "ghost"}
        aria-label={fullscreen ? "Exit full screen" : "Open full screen"}
        onClick={() => setFullscreen((open) => !open)}
      >
        {fullscreen ? <X size={18} /> : <Expand size={18} />}
        {fullscreen ? "Close" : "Full screen"}
      </Button>
    );
    return (
      <>
        <div className="coach-route-map-wrap">
          <GoogleRouteCanvas visual={visual} fullscreen={false} />
          {!fullscreen && <div className="coach-route-map-tools">{tools}</div>}
        </div>
        {fullscreen &&
          createPortal(
            <div
              className="coach-route-fullscreen"
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
            >
              <header>
                <h2 id={titleId}>{visual.title}</h2>
                {tools}
              </header>
              <GoogleRouteCanvas visual={visual} fullscreen />
            </div>,
            document.body,
          )}
      </>
    );
  },
  (prev, next) => sameRoute(prev.visual, next.visual),
);
