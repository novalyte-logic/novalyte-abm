import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import Globe from 'react-globe.gl';
import { Globe as GlobeIcon } from 'lucide-react';
import { cn } from '../utils/cn';

export interface GlobeLocation {
  lat: number;
  lng: number;
  city: string;
  state: string;
  visitors: number;
  leads: number;
  sessions: number;
  topSource: string;
}

export interface GlobeLiveEvent {
  id: string;
  session_id: string;
  event_type: string;
  created_at: string;
  geo_city: string | null;
  geo_state: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  event_data: Record<string, any>;
}

export interface TrafficMapRef {
  flyTo: (lat: number, lng: number, altitude?: number, durationMs?: number) => void;
}

export interface GlobePointSelection {
  cityId: string;
  city: string;
  state: string;
  sessionId?: string;
  sessionData: GlobeLiveEvent[];
}

interface PointDatum {
  id: string;
  lat: number;
  lng: number;
  city: string;
  state: string;
  leads: number;
  visitors: number;
  kind: 'city' | 'session';
  sessionId?: string;
  eventType?: string;
  source?: string;
}

interface RingDatum {
  id: string;
  lat: number;
  lng: number;
  color: string;
}

interface ArcDatum {
  id: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color: string;
}

const SF_HQ = { lat: 37.7749, lng: -122.4194 };
const COUNTRY_GEOJSON_URL = 'https://unpkg.com/three-globe/example/datasets/ne_110m_admin_0_countries.geojson';

const TrafficMap = forwardRef<TrafficMapRef, {
  locations: GlobeLocation[];
  liveEvents: GlobeLiveEvent[];
  onPointSelect?: (payload: GlobePointSelection) => void;
  height?: number;
}>(({ locations, liveEvents, onPointSelect, height = 560 }, ref) => {
  const globeRef = useRef<any>(null);
  const rotateLockRef = useRef(false);
  const [countries, setCountries] = useState<any[]>([]);
  const [mapLoaded, setMapLoaded] = useState(false);

  const getControls = () => globeRef.current?.controls?.();
  const setAutoRotate = (value: boolean) => {
    const controls = getControls();
    if (!controls) return;
    controls.autoRotate = value;
  };

  useImperativeHandle(ref, () => ({
    flyTo: (lat: number, lng: number, altitude = 1.5, durationMs = 1200) => {
      if (!globeRef.current || !Number.isFinite(lat) || !Number.isFinite(lng)) return;
      globeRef.current.pointOfView({ lat, lng, altitude }, durationMs);
    },
  }), []);

  useEffect(() => {
    let mounted = true;
    fetch(COUNTRY_GEOJSON_URL)
      .then(r => r.json())
      .then((geo) => {
        if (!mounted) return;
        setCountries(geo?.features || []);
        setMapLoaded(true);
      })
      .catch(() => {
        if (!mounted) return;
        setMapLoaded(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!globeRef.current) return;

    const globe = globeRef.current;
    const controls = globe.controls?.();
    if (controls) {
      controls.autoRotate = true;
      controls.autoRotateSpeed = 1.425;
      controls.enablePan = false;
      controls.minDistance = 170;
      controls.maxDistance = 420;
      controls.enableDamping = true;
      controls.dampingFactor = 0.06;
      controls.zoomSpeed = 1.2;
    }

    const mat = globe.globeMaterial?.();
    if (mat) {
      mat.color.set('#000000');
      mat.emissive.set('#0b1220');
      mat.emissiveIntensity = 0.45;
      mat.shininess = 0.2;
      mat.transparent = true;
      mat.opacity = 0.94;
    }
  }, [mapLoaded]);

  const cityIndex = useMemo(() => {
    const m = new Map<string, { lat: number; lng: number }>();
    locations.forEach(l => {
      if (!Number.isFinite(l.lat) || !Number.isFinite(l.lng)) return;
      m.set(`${(l.city || '').toLowerCase()}|${(l.state || '').toLowerCase()}`, { lat: l.lat, lng: l.lng });
    });
    return m;
  }, [locations]);

  const resolveCoords = (e: GlobeLiveEvent): { lat: number; lng: number } | null => {
    if (typeof e.geo_lat === 'number' && typeof e.geo_lng === 'number') {
      if (Number.isFinite(e.geo_lat) && Number.isFinite(e.geo_lng)) return { lat: e.geo_lat, lng: e.geo_lng };
    }
    const key = `${(e.geo_city || '').toLowerCase()}|${(e.geo_state || '').toLowerCase()}`;
    return cityIndex.get(key) || null;
  };

  const cityPoints = useMemo<PointDatum[]>(() => {
    return locations
      .filter(l => Number.isFinite(l.lat) && Number.isFinite(l.lng))
      .map((l, i) => ({
        id: `city-${(l.city || 'unknown').toLowerCase()}-${(l.state || 'na').toLowerCase()}-${i}`,
        lat: l.lat,
        lng: l.lng,
        city: l.city,
        state: l.state,
        leads: l.leads,
        visitors: l.visitors,
        kind: 'city' as const,
        source: l.topSource,
      }));
  }, [locations]);

  const sessionPoints = useMemo<PointDatum[]>(() => {
    const bySession = new Map<string, PointDatum>();
    for (const e of liveEvents) {
      const coords = resolveCoords(e);
      if (!coords || !e.session_id) continue;
      bySession.set(e.session_id, {
        id: `session-${e.session_id}`,
        lat: coords.lat,
        lng: coords.lng,
        city: e.geo_city || 'Unknown',
        state: e.geo_state || '',
        leads: e.event_type === 'conversion' || e.event_type === 'lead_capture' ? 1 : 0,
        visitors: 1,
        kind: 'session' as const,
        sessionId: e.session_id,
        eventType: e.event_type,
        source: String(e.event_data?.utm_source || e.event_data?.source || 'live'),
      });
    }
    return Array.from(bySession.values()).slice(0, 120);
  }, [liveEvents, cityIndex]);

  const pointsData = useMemo(() => [...cityPoints, ...sessionPoints], [cityPoints, sessionPoints]);

  const ringsData = useMemo<RingDatum[]>(() => {
    return liveEvents
      .filter(e => e.event_type === 'session_start' || e.event_type === 'heartbeat' || e.event_type === 'interaction')
      .slice(0, 80)
      .map((e) => {
        const coords = resolveCoords(e);
        if (!coords) return null;
        return { id: `ring-${e.id}`, lat: coords.lat, lng: coords.lng, color: '#3b82f6' };
      })
      .filter(Boolean) as RingDatum[];
  }, [liveEvents, cityIndex]);

  const arcsData = useMemo<ArcDatum[]>(() => {
    return liveEvents
      .filter(e => e.event_type === 'conversion' || e.event_type === 'lead_capture')
      .slice(0, 24)
      .map((e) => {
        const coords = resolveCoords(e);
        if (!coords) return null;
        return {
          id: `arc-${e.id}`,
          startLat: coords.lat,
          startLng: coords.lng,
          endLat: SF_HQ.lat,
          endLng: SF_HQ.lng,
          color: '#22c55e',
        };
      })
      .filter(Boolean) as ArcDatum[];
  }, [liveEvents, cityIndex]);

  return (
    <div className="relative rounded-xl border border-white/[0.08] bg-black overflow-hidden" style={{ height }}>
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -inset-10 rounded-full bg-[#3b82f6]/15 blur-3xl" />
      </div>

      {!mapLoaded && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80">
          <div className="text-center">
            <GlobeIcon className="w-7 h-7 text-blue-400 animate-pulse mx-auto mb-2" />
            <p className="text-xs text-slate-400">Initializing Holographic Globe...</p>
          </div>
        </div>
      )}

      <Globe
        ref={globeRef}
        width={undefined}
        height={height}
        backgroundColor="rgba(0,0,0,0)"
        globeImageUrl="//unpkg.com/three-globe/example/img/earth-dark.jpg"
        bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
        showAtmosphere
        atmosphereColor="#3b82f6"
        atmosphereAltitude={0.22}
        hexPolygonsData={countries}
        hexPolygonResolution={3}
        hexPolygonMargin={0.35}
        hexPolygonColor={() => 'rgba(59,130,246,0.65)'}
        pointsData={pointsData}
        pointLat="lat"
        pointLng="lng"
        pointAltitude={(d: any) => d.kind === 'session' ? 0.04 : 0.025}
        pointRadius={(d: any) => d.kind === 'session' ? 0.2 : 0.28}
        pointColor={(d: any) => {
          if (d.kind === 'session') {
            return d.eventType === 'conversion' || d.eventType === 'lead_capture' ? '#22c55e' : '#3b82f6';
          }
          return d.leads > 0 ? '#22c55e' : '#3b82f6';
        }}
        pointsMerge={false}
        onPointHover={(d: any) => {
          if (d) {
            setAutoRotate(false);
          } else if (!rotateLockRef.current) {
            setAutoRotate(true);
          }
        }}
        onPointClick={(d: any) => {
          if (!d || !Number.isFinite(d.lat) || !Number.isFinite(d.lng)) return;

          rotateLockRef.current = true;
          setAutoRotate(false);
          globeRef.current?.pointOfView({ lat: d.lat, lng: d.lng, altitude: 1.1 }, 1200);

          const cityId = `${String(d.city || 'unknown').toLowerCase()}|${String(d.state || '').toLowerCase()}`;
          const sessionData = liveEvents.filter((e) => {
            if (d.sessionId) return e.session_id === d.sessionId;
            const eKey = `${String(e.geo_city || 'unknown').toLowerCase()}|${String(e.geo_state || '').toLowerCase()}`;
            return eKey === cityId;
          });

          onPointSelect?.({
            cityId,
            city: d.city,
            state: d.state,
            sessionId: d.sessionId,
            sessionData,
          });
        }}
        onGlobeClick={() => {
          rotateLockRef.current = true;
          setAutoRotate(false);
        }}
        pointLabel={(d: any) => `
          <div style="
            backdrop-filter: blur(10px);
            background: rgba(10,15,25,0.68);
            border: 1px solid rgba(59,130,246,0.35);
            border-radius: 12px;
            padding: 10px 12px;
            color: #e2e8f0;
            font-family: Inter, system-ui, sans-serif;
            font-size: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.45);
          ">
            <div style="font-weight:700;color:#93c5fd;margin-bottom:4px;">${d.city}, ${d.state}</div>
            <div style="color:#94a3b8;">${d.visitors} visitors • ${d.leads} leads</div>
            <div style="color:#67e8f9;">Source: ${String(d.source || 'Direct')}</div>
            <div style="color:#22c55e;font-weight:600;">Current: ${d.eventType ? String(d.eventType).replace(/_/g, ' ') : 'active session'}</div>
          </div>`}
        ringsData={ringsData}
        ringLat="lat"
        ringLng="lng"
        ringColor={(d: any) => [d.color, 'rgba(59,130,246,0.05)']}
        ringMaxRadius={() => 7}
        ringPropagationSpeed={() => 2.6}
        ringRepeatPeriod={() => 1000}
        arcsData={arcsData}
        arcStartLat="startLat"
        arcStartLng="startLng"
        arcEndLat="endLat"
        arcEndLng="endLng"
        arcColor={(d: any) => [d.color, 'rgba(34,197,94,0.2)']}
        arcStroke={0.65}
        arcAltitude={0.28}
        arcDashLength={0.4}
        arcDashGap={0.85}
        arcDashAnimateTime={1200}
      />

      <div className="absolute bottom-3 left-3 bg-black/55 backdrop-blur-sm rounded-lg px-3 py-2 border border-white/[0.08]">
        <div className="flex items-center gap-3 text-[10px] text-slate-300">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400" /> Active users</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400" /> Conversion arcs → SF HQ</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-slate-300" /> Hover pauses spin</span>
        </div>
      </div>

      <div className={cn(
        'absolute top-3 right-3 px-5 py-2 rounded-full text-[20px] leading-none font-semibold border',
        liveEvents.length > 0 ? 'text-blue-200 border-blue-500/40 bg-blue-500/15' : 'text-slate-400 border-white/10 bg-white/[0.03]'
      )}>
        LIVE {new Set(liveEvents.map(e => e.session_id)).size}
      </div>
    </div>
  );
});

TrafficMap.displayName = 'TrafficMap';

export default TrafficMap;
