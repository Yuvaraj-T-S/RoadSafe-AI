import { useMemo, useState, useEffect, useRef } from "react";
import L from "leaflet";
import Papa from "papaparse";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Bell, ChevronDown,
  CircleHelp, CloudUpload, Database, Download, FileBarChart, Filter, Gauge,
  Layers, Map as MapIcon, Menu, Navigation, Search, ShieldCheck, SlidersHorizontal,
  Target, TrendingUp, X, Zap
} from "lucide-react";
import {
  Area, AreaChart, CartesianGrid, Bar, BarChart, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis
} from "recharts";
import { Accident, generateDemoAccidents, riskColor, riskLabel, riskScore } from "./data";
import { supabase, saveAccidents } from "./supabase";

const initialData = generateDemoAccidents(1200);
const navItems = ["Overview", "Live map", "Hotspots", "Analytics", "Prediction", "Interventions", "Data management"];
const sevColors: Record<string, string> = { "Fatal": "#ef4444", "Serious Injury": "#f97316", "Minor Injury": "#eab308", "Property Damage": "#22c55e" };

function downloadCsv(rows: Accident[], filename = "roadsafe-accidents.csv") {
  const csv = Papa.unparse(rows);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function MapPanel({ records, selected, onSelect, layer }: {
  records: Accident[]; selected: Accident | null; onSelect: (a: Accident | null) => void; layer: string;
}) {
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const [baseStyle, setBaseStyle] = useState("Satellite");
  const [mapSearch, setMapSearch] = useState("");
  const [mapMessage, setMapMessage] = useState("");
  const [busySearch, setBusySearch] = useState(false);
  const [zoom, setZoom] = useState(11);
  const baseStyles: Record<string, { url: string; attribution: string; maxZoom: number }> = {
    "Dark streets": { url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 },
    "Light streets": { url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", attribution: '&copy; OpenStreetMap &copy; CARTO', maxZoom: 20 },
    "OpenStreetMap": { url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 },
    "Satellite": { url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", attribution: 'Tiles &copy; Esri', maxZoom: 19 }
  };

  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;
    const map = L.map(mapEl.current, { zoomControl: false, preferCanvas: true, zoomSnap: 0.5 }).setView([12.93, 77.61], 11);
    const base = baseStyles[baseStyle];
    tileRef.current = L.tileLayer(base.url, { attribution: base.attribution, maxZoom: base.maxZoom }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    overlayRef.current = L.layerGroup().addTo(map);
    map.on("zoomend", () => setZoom(map.getZoom()));
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !tileRef.current) return;
    const style = baseStyles[baseStyle];
    tileRef.current.setUrl(style.url);
    tileRef.current.options.attribution = style.attribution;
  }, [baseStyle]);

  useEffect(() => {
    const map = mapRef.current;
    const group = overlayRef.current;
    if (!map || !group) return;
    group.clearLayers();
    const roadGroups = new Map<string, Accident[]>();
    records.forEach(a => roadGroups.set(a.road, [...(roadGroups.get(a.road) || []), a]));
    const scoreFor = (road: string) => riskScore(roadGroups.get(road) || []);

    if (layer === "Road segments") {
      roadGroups.forEach((rows, road) => {
        const sorted = [...rows].sort((a,b) => a.lat - b.lat);
        if (sorted.length < 2) return;
        const score = scoreFor(road);
        L.polyline(sorted.map(a => [a.lat, a.lng] as L.LatLngExpression), { color: riskColor(score), weight: 5, opacity: 0.82, lineCap: "round" })
          .bindTooltip(`${road} · risk ${score}/100 · ${rows.length} records`)
          .on("click", () => onSelect(rows[0])).addTo(group);
      });
      return;
    }

    if (layer === "Risk zones" || layer === "Blackspots") {
      roadGroups.forEach((rows, road) => {
        const score = scoreFor(road);
        if (layer === "Blackspots" && score < 50) return;
        const lat = rows.reduce((n,a)=>n+a.lat,0)/rows.length;
        const lng = rows.reduce((n,a)=>n+a.lng,0)/rows.length;
        L.circle([lat,lng], { radius: layer === "Blackspots" ? 420 : 280 + Math.min(650, rows.length * 2), color: riskColor(score), weight: 2, fillColor: riskColor(score), fillOpacity: layer === "Blackspots" ? 0.22 : 0.13 })
          .bindTooltip(`${road} · ${layer === "Blackspots" ? "Blackspot candidate" : "Risk zone"} · ${score}/100`)
          .on("click", () => onSelect(rows[0])).addTo(group);
        if (layer === "Blackspots") {
          L.marker([lat,lng], { icon: L.divIcon({ className: "risk-pin", html: `<div class="risk-pin-core">${score}</div>`, iconSize: [38,38], iconAnchor: [19,19] }) })
            .bindTooltip(`${road} · score ${score}`).on("click", () => onSelect(rows[0])).addTo(group);
        }
      });
      return;
    }

    if (layer === "Heatmap") {
      // Canvas-friendly density glow using overlapping translucent circles; intensity is local record density.
      const stride = records.length > 3000 ? 3 : records.length > 1800 ? 2 : 1;
      const density = new Map<string, number>();
      records.forEach(a => { const key = `${Math.floor(a.lat / 0.006)}:${Math.floor(a.lng / 0.006)}`; density.set(key, (density.get(key) || 0) + 1); });
      records.filter((_,i)=>i%stride===0).forEach(a => {
        const key = `${Math.floor(a.lat / 0.006)}:${Math.floor(a.lng / 0.006)}`;
        const nearby = density.get(key) || 1;
        const intensity = Math.min(0.5, 0.08 + nearby * 0.018);
        L.circleMarker([a.lat,a.lng], { radius: 18, stroke: false, fillColor: nearby > 15 ? "#ef4444" : nearby > 8 ? "#f97316" : "#fbbf24", fillOpacity: intensity })
          .bindTooltip(`${a.road} · local density ${nearby}`).addTo(group);
      });
      return;
    }

    if (layer === "Cluster view" && zoom < 14) {
      const bins = new Map<string, Accident[]>();
      const cell = zoom < 11 ? 0.025 : zoom < 12.5 ? 0.012 : 0.005;
      records.forEach(a => {
        const key = `${Math.floor(a.lat/cell)}:${Math.floor(a.lng/cell)}`;
        bins.set(key, [...(bins.get(key)||[]), a]);
      });
      bins.forEach(rows => {
        const lat = rows.reduce((n,a)=>n+a.lat,0)/rows.length;
        const lng = rows.reduce((n,a)=>n+a.lng,0)/rows.length;
        const score = riskScore(rows);
        const radius = Math.min(28, 10 + Math.log2(rows.length + 1) * 3);
        L.circleMarker([lat,lng], { radius, color: "#f8fafc", weight: 1.5, fillColor: riskColor(score), fillOpacity: 0.88 })
          .bindTooltip(`${rows.length} records · cluster risk ${score}/100`)
          .bindPopup(`<strong>${rows.length} accident records</strong><br/>Cluster risk score: ${score}/100<br/><small>Zoom in to inspect individual records.</small>`)
          .on("click", () => { if (rows[0]) onSelect(rows[0]); if (map.getZoom() < 15) map.flyTo([lat,lng], Math.min(16, map.getZoom()+2)); }).addTo(group);
      });
      return;
    }

    // Individual accident markers, optimized with Canvas renderer and adaptive sampling.
    const stride = records.length > 2200 ? 3 : records.length > 1200 ? 2 : 1;
    records.filter((_, i) => i % stride === 0).forEach(a => {
      const color = layer === "Risk zones" ? riskColor(scoreFor(a.road)) : sevColors[a.severity];
      L.circleMarker([a.lat, a.lng], { radius: selected?.id === a.id ? 8 : 4.5, color: "#fff", weight: 1, fillColor: color, fillOpacity: 0.9 })
        .bindTooltip(`${a.road} · ${a.severity} · ${a.id}`)
        .on("click", () => onSelect(a)).addTo(group);
    });
  }, [records, selected, onSelect, layer, zoom]);

  async function findOnMap() {
    const q = mapSearch.trim(); if (!q || !mapRef.current) return;
    const map = mapRef.current;
    const local = records.find(a => `${a.road} ${a.location} ${a.id}`.toLowerCase().includes(q.toLowerCase()));
    if (local) { map.flyTo([local.lat,local.lng], 15, { duration: 0.8 }); onSelect(local); setMapMessage(`Focused ${local.road}`); return; }
    setBusySearch(true); setMapMessage("");
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q + ", Bengaluru, India")}`);
      if (!response.ok) throw new Error("Search service unavailable");
      const found = await response.json();
      if (!found.length) { setMapMessage("No matching place found. Try a road or Bengaluru landmark."); return; }
      map.flyTo([Number(found[0].lat), Number(found[0].lon)], 15, { duration: 0.9 });
      setMapMessage(`Focused ${found[0].display_name.split(",").slice(0,2).join(",")}`);
    } catch { setMapMessage("Place search unavailable. Search a road from the loaded dataset."); }
    finally { setBusySearch(false); }
  }
  function locateMe() {
    if (!navigator.geolocation || !mapRef.current) { setMapMessage("Location is not supported by this browser."); return; }
    navigator.geolocation.getCurrentPosition(pos => {
      const point: L.LatLngExpression = [pos.coords.latitude, pos.coords.longitude];
      mapRef.current?.flyTo(point, 16, { duration: 0.8 });
      L.circleMarker(point, { radius: 8, color: "#fff", weight: 2, fillColor: "#38bdf8", fillOpacity: 1 }).bindTooltip("Your current location").addTo(overlayRef.current!);
      setMapMessage("Showing your current location");
    }, () => setMapMessage("Location permission denied or unavailable."), { enableHighAccuracy: true, timeout: 8000 });
  }
  function toggleFullscreen() {
    const el = mapEl.current?.parentElement;
    if (!el) return;
    if (!document.fullscreenElement) void el.requestFullscreen?.(); else void document.exitFullscreen?.();
    window.setTimeout(() => mapRef.current?.invalidateSize(), 250);
  }

  return <div className="map-wrap">
    <div ref={mapEl} className="map-canvas" />
    <div className="map-tools">
      <form className="map-search" onSubmit={e => { e.preventDefault(); void findOnMap(); }}><Search size={14}/><input value={mapSearch} onChange={e=>setMapSearch(e.target.value)} placeholder="Search road, area or landmark" aria-label="Search map"/><button type="submit" disabled={busySearch}>{busySearch ? "…" : "Go"}</button></form>
      <div className="map-tool-row"><label><Layers size={13}/><select aria-label="Map style" value={baseStyle} onChange={e=>setBaseStyle(e.target.value)}>{Object.keys(baseStyles).map(x=><option key={x}>{x}</option>)}</select></label><button onClick={locateMe} title="Use my location"><Navigation size={14}/></button><button onClick={toggleFullscreen} title="Toggle fullscreen"><MaximizeMapIcon/></button><button onClick={()=>{mapRef.current?.flyTo([12.93,77.61],11);setMapMessage("View reset to Bengaluru");}} title="Reset view"><Target size={14}/></button></div>
      {mapMessage && <div className="map-message">{mapMessage}</div>}
    </div>
    <div className="map-label"><span className="live-dot" /> BENGALURU METRO REGION <span className="map-label-sub">HISTORICAL DEMO</span></div>
    <div className="map-legend"><b>{layer.toUpperCase()} · LEGEND</b>{layer === "Accident points" ? Object.entries(sevColors).map(([name,color])=><span key={name}><i style={{background:color}}/>{name}</span>) : <><span><i style={{background:"#22c55e"}}/>Low risk</span><span><i style={{background:"#eab308"}}/>Moderate risk</span><span><i style={{background:"#f97316"}}/>High risk</span><span><i style={{background:"#ef4444"}}/>Critical risk</span></>}</div>
    {selected && <div className="map-detail"><button className="icon-button close-detail" onClick={() => onSelect(null)} aria-label="Close details"><X size={15}/></button><div className="eyebrow">SELECTED ACCIDENT</div><h3>{selected.road}</h3><p>{selected.id} · {selected.date} · {selected.time}</p><div className="detail-grid"><div><small>Severity</small><b style={{color:sevColors[selected.severity]}}>{selected.severity}</b></div><div><small>Factor</small><b>{selected.factor}</b></div><div><small>Location</small><b>{selected.location}</b></div><div><small>Risk score</small><b>{riskScore(records.filter(r=>r.road===selected.road))}/100</b></div><div><small>Coordinates</small><b>{selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}</b></div><div><small>Conditions</small><b>{selected.weather} · {selected.lighting}</b></div></div><div className="map-detail-foot">Historical record · not a live incident feed</div></div>}
  </div>;
}
function MaximizeMapIcon() { return <span className="maximize-icon" aria-hidden="true">↗</span>; }

export default function App() {
  const [records, setRecords] = useState<Accident[]>(initialData);
  const [nav, setNav] = useState("Overview");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("All severities");
  const [factor, setFactor] = useState("All factors");
  const [layer, setLayer] = useState("Accident points");
  const [selected, setSelected] = useState<Accident | null>(null);
  const [notice, setNotice] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [predictionRoad, setPredictionRoad] = useState("Hosur Road");
  const [predictionWeather, setPredictionWeather] = useState("Clear");
  const [predictionLight, setPredictionLight] = useState("Adequate");
  const [predictionRoadCondition, setPredictionRoadCondition] = useState("Dry");
  const [predictionFactor, setPredictionFactor] = useState("Overspeeding");
  const [predictedRisk, setPredictedRisk] = useState<number | null>(null);
  const [loadingPrediction, setLoadingPrediction] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => records.filter(a => {
    const text = `${a.id} ${a.road} ${a.location} ${a.factor}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase())) &&
      (severity === "All severities" || a.severity === severity) &&
      (factor === "All factors" || a.factor === factor);
  }), [records, query, severity, factor]);

  const roadStats = useMemo(() => {
    const map = new Map<string, Accident[]>();
    filtered.forEach(a => map.set(a.road, [...(map.get(a.road) || []), a]));
    return [...map.entries()].map(([road, rows]) => ({
      road, rows, count: rows.length, fatalities: rows.reduce((s, a) => s + a.fatalities, 0),
      injuries: rows.reduce((s, a) => s + a.injuries, 0), score: riskScore(rows)
    })).sort((a, b) => b.score - a.score);
  }, [filtered]);

  const fatalCount = filtered.filter(a => a.severity === "Fatal").length;
  const injuryCount = filtered.reduce((s, a) => s + a.injuries, 0);
  const criticalCount = roadStats.filter(r => r.score > 75).length;
  const timeData = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const label = ["00–04", "04–08", "08–12", "12–16", "16–20", "20–24"][i];
    const count = filtered.filter(a => { const h = Number(a.time.slice(0, 2)); return h >= i * 4 && h < i * 4 + 4; }).length;
    return { period: label, accidents: count };
  }), [filtered]);
  const factorData = useMemo(() => {
    const m = new Map<string, number>(); filtered.forEach(a => m.set(a.factor, (m.get(a.factor) || 0) + 1));
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [filtered]);

  async function handlePredict() {
    setLoadingPrediction(true);
    try {
      const response = await fetch("http://localhost:8000/predict", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          road: predictionRoad,
          weather: predictionWeather,
          lighting: predictionLight,
          roadCondition: predictionRoadCondition,
          factor: predictionFactor
        })
      });
      const data = await response.json();
      setPredictedRisk(data.predicted_risk_score);
      showNotice("Scenario recalculated using the ML model.");
    } catch (err) {
      showNotice("Prediction API connection error. Ensure uvicorn server is running.");
    } finally {
      setLoadingPrediction(false);
    }
  }

  function showNotice(msg: string) { setNotice(msg); window.setTimeout(() => setNotice(""), 3500); }
  async function handleUpload(file?: File) {
    if (!file) return;
    setUploading(true);
    Papa.parse<Record<string, string>>(file, {
      header: true, skipEmptyLines: true,
      complete: async ({ data, errors }) => {
        const normalized: Accident[] = data.map((r, i) => {
          const get = (...keys: string[]) => {
            const k = Object.keys(r).find(key => keys.includes(key.trim().toLowerCase().replace(/[_\s-]/g, "")));
            return k ? String(r[k] ?? "").trim() : "";
          };
          const lat = Number(get("latitude", "lat")) || 12.93;
          const lng = Number(get("longitude", "lng", "lon")) || 77.61;
          const rawSeverity = get("severity").toLowerCase();
          const sev: Accident["severity"] = rawSeverity.includes("fatal") ? "Fatal" : rawSeverity.includes("serious") ? "Serious Injury" : rawSeverity.includes("minor") ? "Minor Injury" : "Property Damage";
          return {
            id: get("accidentid", "id") || `UPLOAD-${Date.now()}-${i}`,
            date: get("date") || "2025-01-01", time: get("time") || "12:00",
            lat, lng, road: get("roadname", "road") || "Unspecified road",
            location: get("location", "area") || "Uploaded dataset", severity: sev,
            fatalities: Number(get("fatalities")) || (sev === "Fatal" ? 1 : 0),
            injuries: Number(get("injuries")) || 0, weather: get("weather") || "Unknown",
            roadCondition: get("roadcondition") || "Unknown", lighting: get("lighting") || "Unknown",
            vehicle: get("vehicletype", "vehicle") || "Unknown",
            factor: get("contributingfactor", "factor") || "Unspecified"
          };
        }).filter(a => a.lat >= -90 && a.lat <= 90 && a.lng >= -180 && a.lng <= 180);
        if (!normalized.length) { showNotice("No usable rows found. Check your CSV headers."); setUploading(false); return; }
        setRecords(normalized); setSelected(null); setUploading(false);
        showNotice(`Imported ${normalized.length.toLocaleString()} rows${errors.length ? ` (${errors.length} parse warnings)` : ""}.`);
      },
      error: () => { setUploading(false); showNotice("Could not read that CSV file."); }
    });
  }

  const clearFilters = () => { setQuery(""); setSeverity("All severities"); setFactor("All factors"); };
  const isDashboard = ["Overview", "Live map", "Hotspots", "Analytics"].includes(nav);

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><ShieldCheck size={23}/></div><div><strong>RoadSafe <span>AI</span></strong><small>DEVDYNASTY · SAFETY INTELLIGENCE</small></div><button className="icon-button mobile-close" onClick={() => setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace"><span className="workspace-dot"/> BENGALURU REGION <ChevronDown size={14}/></div>
      <div className="side-label">WORKSPACE</div>
      <nav>{navItems.map((item, i) => {
        const Icon = [Activity, MapIcon, Target, FileBarChart, Gauge, ShieldCheck, Database][i];
        return <button key={item} className={`nav-link ${nav === item ? "active" : ""}`} onClick={() => { setNav(item); setMobileNav(false); }}>
          <Icon size={17}/><span>{item}</span>{item === "Hotspots" && <em>{criticalCount}</em>}
        </button>;
      })}</nav>
      <div className="sidebar-bottom"><div className="status-card"><div className="status-icon"><Zap size={16}/></div><div><b>Analytics engine</b><small><span className="live-dot"/> Demo engine active</small></div></div><div className="sidebar-footer"><span>RoadSafe AI v0.1</span><span>© 2026 DevDynasty</span></div></div>
    </aside>

    <main className="main">
      <header className="topbar">
        <button className="icon-button menu-toggle" onClick={() => setMobileNav(!mobileNav)}><Menu size={20}/></button>
        <div className="breadcrumb">Workspace <span>/</span> <b>{nav}</b></div>
        <div className="top-actions">
          <div className="searchbox"><Search size={16}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search roads, IDs, locations..." /><kbd>⌘ K</kbd></div>
          <button className="icon-button notification" onClick={() => showNotice("No new alerts. All demo systems operational.")} aria-label="Notifications"><Bell size={18}/><i/></button>
          <div className="avatar">DD</div>
        </div>
      </header>

      <div className="content">
        <div className="page-heading">
          <div><div className="eyebrow"><span className="live-dot"/> ROAD SAFETY INTELLIGENCE <span className="demo-pill">SYNTHETIC DEMO DATA</span></div><h1>{nav === "Overview" ? "Road Safety Intelligence" : nav}</h1><p>Find where accidents happen. Understand why. Prioritize safer roads.</p></div>
          <div className="heading-actions"><button className="btn secondary" onClick={() => downloadCsv(filtered)}><Download size={16}/> Export CSV</button><button className="btn primary" onClick={() => fileRef.current?.click()}><CloudUpload size={16}/> Upload dataset</button><input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={e => handleUpload(e.target.files?.[0])}/></div>
        </div>

        {isDashboard && <>
          <div className="filter-bar"><div className="filter-title"><SlidersHorizontal size={15}/> FILTERS</div><select value={severity} onChange={e => setSeverity(e.target.value)}><option>All severities</option><option>Fatal</option><option>Serious Injury</option><option>Minor Injury</option><option>Property Damage</option></select><select value={factor} onChange={e => setFactor(e.target.value)}><option>All factors</option>{["Overspeeding","Distracted Driving","Poor Lighting","Unsafe Road Geometry","Signal Violations","Poor Road Surface","Weather","Traffic Congestion","Pedestrian Activity"].map(f => <option key={f}>{f}</option>)}</select><button className="text-button" onClick={clearFilters}>Clear all</button><div className="filter-spacer"/><span className="record-count">{filtered.length.toLocaleString()} records matched</span></div>
          <div className="kpi-grid">
            <Kpi title="Total accidents" value={filtered.length.toLocaleString()} change="Dataset scope" icon={<Activity size={18}/>} tone="blue" foot="records in current view"/>
            <Kpi title="Fatal accidents" value={fatalCount.toLocaleString()} change={`${filtered.length ? (fatalCount / filtered.length * 100).toFixed(1) : "0.0"}% of records`} icon={<AlertTriangle size={18}/>} tone="red" foot="severity flagged fatal"/>
            <Kpi title="High-risk roads" value={roadStats.filter(r => r.score > 50).length.toString()} change={`${criticalCount} critical`} icon={<Target size={18}/>} tone="orange" foot="based on demo risk score"/>
            <Kpi title="Reported injuries" value={injuryCount.toLocaleString()} change="Across records" icon={<ShieldCheck size={18}/>} tone="green" foot="injuries in current view"/>
          </div>
          <div className="section-heading"><div><h2>Geospatial risk overview</h2><p>Accident distribution across the Bengaluru demo region</p></div><div className="map-layer-select"><Layers size={15}/><select value={layer} onChange={e => setLayer(e.target.value)}><option>Accident points</option><option>Heatmap</option><option>Risk zones</option><option>Road segments</option><option>Blackspots</option><option>Cluster view</option></select></div></div>
          <div className="map-layout"><section className="panel map-panel"><div className="panel-top"><div><h3>Accident location map</h3><p>Click a marker to inspect an accident record</p></div><span className="live-tag"><span className="live-dot"/> MAP ACTIVE</span></div><MapPanel records={filtered} selected={selected} onSelect={a => setSelected(a)} layer={layer}/><div className="map-foot"><span><i className="legend-dot red"/> Fatal</span><span><i className="legend-dot orange"/> Serious injury</span><span><i className="legend-dot yellow"/> Minor injury</span><span className="map-foot-note">Illustrative synthetic locations · OpenStreetMap</span></div></section>
            <section className="panel hotspot-panel"><div className="panel-top"><div><h3>Priority road segments</h3><p>Ranked by analytical risk score</p></div><button className="arrow-button" onClick={() => setNav("Hotspots")}>View all <ArrowUpRight size={14}/></button></div>
              <div className="hotspot-list">{roadStats.slice(0, 6).map((r, i) => <button className="hotspot-row" key={r.road} onClick={() => { setQuery(r.road); setNav("Live map"); const first = filtered.find(a => a.road === r.road); if (first) setSelected(first); }}><div className="rank">{String(i + 1).padStart(2, "0")}</div><div className="hotspot-info"><b>{r.road}</b><small>{r.count} records · {r.fatalities} fatalities</small><div className="risk-track"><i style={{ width: `${r.score}%`, background: riskColor(r.score) }}/></div></div><div className="score-wrap"><b>{r.score}</b><small style={{ color: riskColor(r.score) }}>{riskLabel(r.score)}</small></div></button>)}</div>
              <div className="panel-bottom-note"><ShieldCheck size={15}/> Risk scores are analytical indicators, not validated forecasts.</div>
            </section></div>
          <div className="chart-grid"><section className="panel chart-panel"><div className="panel-top"><div><h3>Accidents by time of day</h3><p>Identify periods with higher recorded frequency</p></div><span className="chart-unit">RECORDS</span></div><div className="chart-body"><ResponsiveContainer width="100%" height="100%"><AreaChart data={timeData} margin={{ top: 10, right: 8, left: -20, bottom: 0 }}><defs><linearGradient id="riskFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity={0.24}/><stop offset="95%" stopColor="#f97316" stopOpacity={0}/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="#243244"/><XAxis dataKey="period" tick={{ fill: "#8b9bb0", fontSize: 11 }} axisLine={false} tickLine={false}/><YAxis tick={{ fill: "#8b9bb0", fontSize: 11 }} axisLine={false} tickLine={false}/><Tooltip contentStyle={{ background: "#111e2e", border: "1px solid #2b3a4d", borderRadius: 10, color: "#e5edf6" }}/><Area type="monotone" dataKey="accidents" stroke="#f97316" strokeWidth={2.5} fill="url(#riskFill)"/></AreaChart></ResponsiveContainer></div></section>
            <section className="panel chart-panel"><div className="panel-top"><div><h3>Contributing factors</h3><p>Most frequently recorded in current view</p></div><span className="chart-unit">TOP 6</span></div><div className="factor-chart"><div className="donut"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={factorData} dataKey="value" nameKey="name" innerRadius={47} outerRadius={67} paddingAngle={3}>{factorData.map((d, i) => <Cell key={d.name} fill={["#f97316","#ef4444","#eab308","#3b82f6","#a78bfa","#22c55e"][i % 6]}/>)}</Pie><Tooltip contentStyle={{ background: "#111e2e", border: "1px solid #2b3a4d", borderRadius: 10 }}/></PieChart></ResponsiveContainer><div className="donut-center"><b>{filtered.length}</b><small>records</small></div></div><div className="factor-legend">{factorData.map((d, i) => <button key={d.name} onClick={() => setFactor(d.name)}><i style={{ background: ["#f97316","#ef4444","#eab308","#3b82f6","#a78bfa","#22c55e"][i % 6] }}/><span>{d.name}</span><b>{d.value}</b></button>)}</div></div></section></div>
        </>}

        {nav === "Prediction" && <section className="panel feature-panel"><div className="panel-top"><div><h3><Gauge size={18} className="inline-icon"/> Future road risk prediction</h3><p>Scenario-based risk prediction powered by a trained Machine Learning model.</p></div><span className="demo-pill">ML MODEL</span></div><div className="prediction-layout"><div className="prediction-form"><Field label="Road segment"><select value={predictionRoad} onChange={e => setPredictionRoad(e.target.value)}>{[...new Set(records.map(a => a.road))].map(r => <option key={r}>{r}</option>)}</select></Field><Field label="Weather"><select value={predictionWeather} onChange={e => setPredictionWeather(e.target.value)}>{["Clear","Rain","Fog","Storm"].map(v => <option key={v}>{v}</option>)}</select></Field><Field label="Lighting"><select value={predictionLight} onChange={e => setPredictionLight(e.target.value)}><option>Adequate</option><option>Poor</option></select></Field><Field label="Road conditions"><select value={predictionRoadCondition} onChange={e => setPredictionRoadCondition(e.target.value)}><option>Dry</option><option>Wet</option><option>Damaged</option><option>Under construction</option></select></Field><Field label="Contributing factor"><select value={predictionFactor} onChange={e => setPredictionFactor(e.target.value)}>{["Overspeeding","Distracted Driving","Poor Lighting","Unsafe Road Geometry","Signal Violations","Poor Road Surface","Weather","Traffic Congestion","Pedestrian Activity"].map(f => <option key={f}>{f}</option>)}</select></Field><button className="btn primary" onClick={handlePredict} disabled={loadingPrediction}><Zap size={16}/> {loadingPrediction ? "Calculating..." : "Predict scenario"}</button></div><div className="prediction-result"><div className="eyebrow">ML PREDICTED RISK</div><div className="prediction-score" style={{ color: predictedRisk !== null ? riskColor(predictedRisk) : "#888" }}>{predictedRisk !== null ? predictedRisk : "--"}<small>/100</small></div>{predictedRisk !== null && <span className="risk-badge" style={{ color: riskColor(predictedRisk), borderColor: riskColor(predictedRisk) }}>{riskLabel(predictedRisk).toUpperCase()} RISK</span>}<p>Risk score predicted using the trained RandomForestRegressor model.</p><small className="muted">This model is trained on historical data and provides real-time inference via FastAPI.</small></div></div></section>}

        {nav === "Interventions" && <section className="panel feature-panel"><div className="panel-top"><div><h3>Recommended safety interventions</h3><p>Decision support based on historical patterns; engineering assessment is required.</p></div></div><div className="intervention-grid">{roadStats.filter(r => r.score > 25).slice(0, 8).map(r => <div className="intervention-card" key={r.road}><div className="intervention-head"><Target size={18}/><span className="risk-badge" style={{ color: riskColor(r.score), borderColor: riskColor(r.score) }}>{riskLabel(r.score)}</span></div><h3>{r.road}</h3><p>{r.count} records · risk score {r.score}/100</p><ul><li>Review street lighting and visibility</li><li>Audit signage, speed and intersection geometry</li><li>Assess pedestrian crossings and road surface</li></ul><button className="text-button" onClick={() => showNotice(`Intervention priority flagged for ${r.road}. Demo only.`)}>Flag for assessment <ArrowUpRight size={14}/></button></div>)}</div></section>}

        {nav === "Data management" && <section className="panel feature-panel"><div className="panel-top"><div><h3>Dataset management</h3><p>Upload accident records, inspect basic quality metrics and export the current view.</p></div></div><div className="upload-zone" onClick={() => fileRef.current?.click()}><CloudUpload size={34}/><h3>{uploading ? "Processing CSV…" : "Upload accident dataset"}</h3><p>Choose a CSV file with headers for date, latitude, longitude, road name and severity.</p><button className="btn primary">{uploading ? "Please wait…" : "Choose CSV file"}</button><span>Excel upload is not enabled in this starter version.</span></div><div className="quality-grid"><Quality label="Records loaded" value={records.length.toLocaleString()}/><Quality label="Valid coordinate range" value={`${records.filter(a => a.lat >= -90 && a.lat <= 90 && a.lng >= -180 && a.lng <= 180).length.toLocaleString()} / ${records.length.toLocaleString()}`}/><Quality label="Missing road names" value={records.filter(a => !a.road).length.toString()}/><Quality label="Data source" value={records === initialData ? "Synthetic demo" : "Imported CSV"}/></div><div className="inline-note"><CircleHelp size={16}/> Uploaded data is held in browser memory for this demo. Configure Supabase and Row Level Security before storing real or sensitive data.</div><div className="section-heading compact"><div><h2>Database connection</h2><p>{supabase ? "Supabase credentials detected." : "Local-only mode. Configure .env to connect."}</p></div><span className={`status-chip ${supabase ? "ok" : ""}`}><i/>{supabase ? "Configured" : "Not connected"}</span></div><button className="btn secondary" onClick={async () => { try { await saveAccidents(records.map(a => ({ accident_id: a.id, accident_date: a.date, accident_time: a.time, latitude: a.lat, longitude: a.lng, location: a.location, road_name: a.road, severity: a.severity, fatalities: a.fatalities, injuries: a.injuries, vehicle_type: a.vehicle, weather: a.weather, road_condition: a.roadCondition, lighting: a.lighting, contributing_factor: a.factor }))); showNotice("Records saved to Supabase."); } catch (e) { showNotice(e instanceof Error ? e.message : "Could not save records."); } }}><Database size={16}/> Save records to Supabase</button></section>}

        {nav === "Hotspots" && <section className="panel feature-panel"><div className="panel-top"><div><h3>Ranked road risk hotspots</h3><p>Scores recalculate from the currently filtered accident records.</p></div><span className="demo-pill">DEMO ANALYTICS</span></div><div className="table-wrap"><table><thead><tr><th>Rank</th><th>Road segment</th><th>Accidents</th><th>Fatalities</th><th>Injuries</th><th>Risk score</th><th>Risk level</th><th>Action</th></tr></thead><tbody>{roadStats.map((r, i) => <tr key={r.road}><td><b className="table-rank">{String(i + 1).padStart(2, "0")}</b></td><td><b>{r.road}</b><small className="table-sub">{r.rows[0]?.location}</small></td><td>{r.count}</td><td>{r.fatalities}</td><td>{r.injuries}</td><td><b>{r.score}</b><div className="risk-track"><i style={{ width: `${r.score}%`, background: riskColor(r.score) }}/></div></td><td><span className="risk-badge" style={{ color: riskColor(r.score), borderColor: riskColor(r.score) }}>{riskLabel(r.score)}</span></td><td><button className="text-button" onClick={() => { setNav("Live map"); setQuery(r.road); const first = r.rows[0]; if (first) setSelected(first); }}>Inspect</button></td></tr>)}</tbody></table></div></section>}

        {nav === "Analytics" && <section className="panel feature-panel"><div className="panel-top"><div><h3>Accident analytics</h3><p>Explore recorded patterns across the filtered dataset.</p></div><button className="btn secondary" onClick={() => downloadCsv(filtered, "roadsafe-filtered-analytics.csv")}><Download size={15}/> Export current records</button></div><div className="analytics-grid"><div className="analytic-card"><h3>By time of day</h3><div className="chart-body tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={timeData}><CartesianGrid strokeDasharray="3 3" stroke="#243244"/><XAxis dataKey="period" tick={{ fill: "#9aa9bb", fontSize: 11 }}/><YAxis tick={{ fill: "#9aa9bb", fontSize: 11 }}/><Tooltip/><Bar dataKey="accidents" fill="#f97316" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></div><div className="analytic-card"><h3>By severity</h3>{Object.keys(sevColors).map(s => <div className="severity-row" key={s}><span><i style={{ background: sevColors[s] }}/>{s}</span><b>{filtered.filter(a => a.severity === s).length}</b><div className="risk-track"><i style={{ width: `${filtered.length ? filtered.filter(a => a.severity === s).length / filtered.length * 100 : 0}%`, background: sevColors[s] }}/></div></div>)}</div><div className="analytic-card wide"><h3>Monthly record distribution</h3><div className="chart-body tall"><ResponsiveContainer width="100%" height="100%"><BarChart data={Array.from({ length: 12 }, (_, i) => ({ month: new Date(2000, i, 1).toLocaleString("en", { month: "short" }), count: filtered.filter(a => Number(a.date.slice(5, 7)) === i + 1).length }))}><CartesianGrid strokeDasharray="3 3" stroke="#243244"/><XAxis dataKey="month" tick={{ fill: "#9aa9bb", fontSize: 11 }}/><YAxis tick={{ fill: "#9aa9bb", fontSize: 11 }}/><Tooltip/><Bar dataKey="count" fill="#3b82f6" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></div></div></section>}

        <footer className="footer"><span><ShieldCheck size={14}/> RoadSafe AI <b>by DevDynasty</b></span><span>Demo environment · Synthetic data · Not for emergency response</span></footer>
      </div>
    </main>
    {mobileNav && <button className="mobile-scrim" aria-label="Close menu" onClick={() => setMobileNav(false)}/>}
    {notice && <div className="toast"><ShieldCheck size={17}/>{notice}<button onClick={() => setNotice("")}><X size={14}/></button></div>}
  </div>;
}

function Kpi({ title, value, change, icon, tone, foot }: { title: string; value: string; change: string; icon: React.ReactNode; tone: string; foot: string }) {
  return <div className="kpi-card"><div className="kpi-top"><span>{title}</span><i className={`kpi-icon ${tone}`}>{icon}</i></div><div className="kpi-value">{value}</div><div className="kpi-change"><span className="neutral-change"><TrendingUp size={13}/>{change}</span></div><div className="kpi-foot">{foot}</div><div className={`sparkline ${tone}`}><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="field"><span>{label}</span>{children}</label>; }
function Quality({ label, value }: { label: string; value: string }) { return <div className="quality-card"><span>{label}</span><b>{value}</b></div>; }
