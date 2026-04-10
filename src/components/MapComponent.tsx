import React, { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

export interface RoutePoint {
  city: string;
  lat: number;
  lng: number;
  status?: string;
  audience?: string;
  venue?: string;
  score?: string;
}

interface MapComponentProps {
  route: RoutePoint[];
  isRoute?: boolean;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function statusColor(status?: string): string {
  if (!status) return '#c084fc';
  const s = status.toLowerCase();
  if (s.includes('зелен')) return '#22c55e';
  if (s.includes('жовт')) return '#eab308';
  if (s.includes('сір')) return '#94a3b8';
  return '#c084fc';
}

function buildMarkerIcon(index: number, isRoute: boolean, status?: string): L.DivIcon {
  const bg = isRoute ? '#7c3aed' : statusColor(status);
  return L.divIcon({
    className: 'chaika-marker',
    html: `<div style="
      width:36px;height:36px;border-radius:10px;
      background:${bg};
      border:2.5px solid rgba(255,255,255,0.95);
      color:#fff;display:flex;align-items:center;justify-content:center;
      font-size:13px;font-weight:800;letter-spacing:-0.5px;
      box-shadow:0 6px 20px rgba(0,0,0,0.45),0 0 0 3px ${bg}33;
      font-family:'Inter',system-ui,sans-serif;
    ">${index + 1}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    popupAnchor: [0, -16],
  });
}

function DistanceLabels({ route }: { route: RoutePoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length < 2) return;
    const markers: L.Marker[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const a = route[i];
      const b = route[i + 1];
      const km = Math.round(haversineKm(a.lat, a.lng, b.lat, b.lng));
      const midLat = (a.lat + b.lat) / 2;
      const midLng = (a.lng + b.lng) / 2;
      const icon = L.divIcon({
        className: 'distance-label',
        html: `<div style="
          background:rgba(15,15,15,0.92);backdrop-filter:blur(8px);
          border:1px solid rgba(124,58,237,0.5);border-radius:8px;
          padding:3px 8px;color:#e9d5ff;font-size:11px;font-weight:700;
          white-space:nowrap;font-family:'Inter',system-ui,sans-serif;
          box-shadow:0 4px 12px rgba(0,0,0,0.5);
        ">${km} km</div>`,
        iconSize: [0, 0],
        iconAnchor: [25, 10],
      });
      markers.push(L.marker([midLat, midLng], { icon, interactive: false }).addTo(map));
    }
    return () => {
      markers.forEach((m) => m.remove());
    };
  }, [map, route]);
  return null;
}

function BoundsFitter({ route }: { route: RoutePoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (route.length > 0) {
      const bounds = L.latLngBounds(route.map((p) => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [60, 60] });
    }
  }, [map, route]);
  return null;
}

function isValidPoint(p: RoutePoint): boolean {
  return typeof p.city === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lng);
}

export default function MapComponent({ route, isRoute = true }: MapComponentProps) {
  const safeRoute = (route || []).filter(isValidPoint);
  if (safeRoute.length === 0) return null;

  const positions = safeRoute.map((p) => [p.lat, p.lng] as [number, number]);
  const totalKm =
    isRoute && safeRoute.length > 1
      ? safeRoute.reduce(
          (sum, p, i) =>
            i === 0
              ? 0
              : sum + haversineKm(safeRoute[i - 1].lat, safeRoute[i - 1].lng, p.lat, p.lng),
          0
        )
      : 0;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-white/10 mt-5 shadow-2xl">
      {isRoute && totalKm > 0 && (
        <div className="absolute top-3 left-3 z-[1000] bg-black/80 backdrop-blur-md border border-purple-500/30 rounded-xl px-4 py-2 flex items-center gap-3">
          <span className="text-purple-300 text-xs font-bold uppercase tracking-wider">
            Маршрут
          </span>
          <span className="text-white text-sm font-semibold">{safeRoute.length} міст</span>
          <span className="text-purple-400 text-xs">|</span>
          <span className="text-white text-sm font-semibold">
            ~{Math.round(totalKm).toLocaleString()} km
          </span>
        </div>
      )}
      <div className="h-72 md:h-[420px]">
        <MapContainer
          center={positions[0]}
          zoom={5}
          scrollWheelZoom={true}
          dragging={true}
          doubleClickZoom={true}
          touchZoom={true}
          zoomControl={true}
          className="w-full h-full"
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          />
          {safeRoute.map((point, idx) => (
            <Marker
              key={idx}
              position={[point.lat, point.lng]}
              icon={buildMarkerIcon(idx, isRoute, point.status)}
            >
              <Popup className="chaika-popup">
                <div style={{ fontFamily: "'Inter',system-ui,sans-serif", minWidth: 200 }}>
                  <div style={{ fontWeight: 800, fontSize: 15, marginBottom: 6, color: '#1a1a2e' }}>
                    {isRoute ? `${idx + 1}. ` : ''}
                    {point.city}
                  </div>
                  {point.status && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: statusColor(point.status),
                          display: 'inline-block',
                        }}
                      />
                      <span style={{ fontSize: 12, color: '#555' }}>{point.status}</span>
                    </div>
                  )}
                  {point.venue && (
                    <div style={{ fontSize: 12, color: '#444', marginBottom: 2 }}>
                      <b>Майданчик:</b> {point.venue}
                    </div>
                  )}
                  {point.audience && (
                    <div style={{ fontSize: 12, color: '#444', marginBottom: 2 }}>
                      <b>Аудиторія:</b> {point.audience}
                    </div>
                  )}
                  {point.score && (
                    <div style={{ fontSize: 12, color: '#444' }}>
                      <b>Score:</b> {point.score}
                    </div>
                  )}
                  {isRoute && idx < safeRoute.length - 1 && (
                    <div
                      style={{
                        marginTop: 8,
                        paddingTop: 6,
                        borderTop: '1px solid #e5e7eb',
                        fontSize: 11,
                        color: '#7c3aed',
                        fontWeight: 600,
                      }}
                    >
                      → {safeRoute[idx + 1].city}:{' '}
                      {Math.round(
                        haversineKm(
                          point.lat,
                          point.lng,
                          safeRoute[idx + 1].lat,
                          safeRoute[idx + 1].lng
                        )
                      )}{' '}
                      km
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}
          {isRoute && positions.length > 1 && (
            <Polyline
              positions={positions}
              pathOptions={{
                color: '#7c3aed',
                weight: 3,
                opacity: 0.85,
                dashArray: '8, 6',
              }}
            />
          )}
          {isRoute && <DistanceLabels route={safeRoute} />}
          <BoundsFitter route={safeRoute} />
        </MapContainer>
      </div>
    </div>
  );
}
