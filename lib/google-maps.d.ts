export {};

type GoogleLatLng = { lat: number; lng: number };

type GoogleMapsApi = {
  Map: new (
    el: HTMLElement,
    opts?: Record<string, unknown>,
  ) => {
    fitBounds: (bounds: unknown, padding?: number) => void;
  };
  Polyline: new (opts: Record<string, unknown>) => unknown;
  Marker: new (opts: Record<string, unknown>) => unknown;
  LatLngBounds: new () => { extend: (point: GoogleLatLng) => void };
  SymbolPath: { FORWARD_CLOSED_ARROW: number };
};

declare global {
  interface Window {
    google?: { maps: GoogleMapsApi };
  }
  var google: { maps: GoogleMapsApi } | undefined;
}
