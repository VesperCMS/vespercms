import 'maplibre-gl/dist/maplibre-gl.css';
import { Map as MapLibre, Marker, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef, useState } from 'react';
import type { LatLng } from './geo.tsx';

/*
 * The geo field's map (DECISIONS.md: MapLibre with OpenFreeMap tiles). Loaded
 * on demand. The pin is a real button: Tab reaches it, and the arrow keys
 * move it (Shift moves ten times as far), with each move announced.
 */

setWorkerUrl(workerUrl);

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const WORLD: LatLng = { lat: 20, lng: 0 };

export default function GeoMap({
  label,
  point,
  center,
  zoom,
  disabled,
  onChange,
}: {
  label: string;
  point: LatLng | null;
  center: LatLng | undefined;
  zoom: number | undefined;
  disabled: boolean;
  onChange: (point: LatLng) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibre | null>(null);
  const marker = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);
  const [failed, setFailed] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  useEffect(() => {
    if (!container.current) return;
    const start = point ?? center ?? WORLD;
    let instance: MapLibre;
    try {
      instance = new MapLibre({
        container: container.current,
        style: STYLE,
        center: [start.lng, start.lat],
        zoom: zoom ?? (point || center ? 13 : 1),
        attributionControl: { compact: true },
        // The map itself isn't a tab stop; the pin and the number fields are.
        keyboard: false,
      });
    } catch {
      // No WebGL, most likely. Reported after this effect, not during it.
      void Promise.resolve().then(() => {
        setFailed(true);
      });
      return;
    }
    instance.on('error', () => {
      setFailed(true);
    });
    instance.getCanvas().setAttribute('tabindex', '-1');
    instance.getCanvas().setAttribute('aria-hidden', 'true');
    map.current = instance;

    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'vesper-map-pin';
    pin.setAttribute('aria-label', `${label} pin. Use the arrow keys to move it.`);
    const created = new Marker({ element: pin, draggable: !disabled })
      .setLngLat([start.lng, start.lat])
      .addTo(instance);
    marker.current = created;

    const commit = (next: LatLng, announce: boolean) => {
      const rounded = { lat: round(next.lat), lng: round(next.lng) };
      created.setLngLat([rounded.lng, rounded.lat]);
      onChangeRef.current(rounded);
      if (announce)
        setAnnouncement(`Latitude ${String(rounded.lat)}, longitude ${String(rounded.lng)}.`);
    };
    created.on('dragend', () => {
      const { lat, lng } = created.getLngLat();
      commit({ lat, lng }, true);
    });
    instance.on('click', (event) => {
      if (!disabled) commit({ lat: event.lngLat.lat, lng: event.lngLat.lng }, true);
    });
    pin.addEventListener('keydown', (event) => {
      const steps: Record<string, [number, number]> = {
        ArrowUp: [1, 0],
        ArrowDown: [-1, 0],
        ArrowRight: [0, 1],
        ArrowLeft: [0, -1],
      };
      const step = steps[event.key];
      if (!step || disabled) return;
      event.preventDefault();
      // About 20 screen pixels at the current zoom; Shift moves ten times as far.
      const degrees = (360 / 2 ** instance.getZoom() / 512) * 20 * (event.shiftKey ? 10 : 1);
      const { lat, lng } = created.getLngLat();
      const next = {
        lat: Math.max(-85, Math.min(85, lat + step[0] * degrees)),
        lng: ((lng + step[1] * degrees + 540) % 360) - 180,
      };
      commit(next, true);
      instance.panTo([next.lng, next.lat]);
    });

    return () => {
      created.remove();
      instance.remove();
      map.current = null;
      marker.current = null;
    };
    // The map is created once; later point changes are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Values typed into the number fields move the pin.
  useEffect(() => {
    if (!point || !marker.current) return;
    const current = marker.current.getLngLat();
    if (current.lat === point.lat && current.lng === point.lng) return;
    marker.current.setLngLat([point.lng, point.lat]);
    map.current?.panTo([point.lng, point.lat]);
  }, [point]);

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={container}
        className="h-64 w-full overflow-hidden rounded-md border border-border-strong"
      />
      {failed && (
        <p className="text-small text-content-muted">
          The map couldn’t load (it needs an internet connection). The number fields above work
          without it.
        </p>
      )}
      <p className="text-small text-content-muted">
        Drag the pin, click the map, or focus the pin and use the arrow keys.
      </p>
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

/** Six decimal places is about 10 cm: more is noise in a content file. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
