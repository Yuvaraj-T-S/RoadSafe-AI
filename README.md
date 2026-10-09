# RoadSafe AI — DevDynasty

A hackathon MVP starter built with React, TypeScript, Vite, Leaflet, Recharts, PapaParse and optional Supabase.

## Requirements
- Node.js 20.19+ or 22.12+
- npm
- Internet access for OpenStreetMap tiles and Google Fonts

## Run locally
```bash
npm install
npm run dev
```
Open the local URL printed by Vite (usually http://localhost:5173).

## Build check
```bash
npm run build
```

## Demo features
- 1,200 synthetic accident records around Bengaluru (clearly marked synthetic)
- Search by accident ID, road, area or factor
- Severity and contributing-factor filters update the KPIs, map, charts and hotspot rankings
- Leaflet accident map with clickable marker detail cards
- Risk score derived from accident frequency, severity and selected record conditions
- Ranked road segments, temporal chart, factor donut, prediction simulation and intervention cards
- CSV import and CSV export
- Optional Supabase upsert integration

## Supabase setup
1. Create a Supabase project.
2. In SQL Editor, run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` and add your project URL and publishable/anon key.
4. Restart `npm run dev`.

Important: the included browser upsert is only a starter integration. Before public deployment, enable Row Level Security, define restrictive policies, use authentication and do not expose a service-role key in frontend code. Do not upload personal or sensitive information into the demo.

## CSV headers
Accepted aliases include:
- `accident_id` or `id`
- `date`, `time`
- `latitude` / `lat`, `longitude` / `lng` / `lon`
- `road_name` / `road`, `location` / `area`
- `severity`, `fatalities`, `injuries`
- `weather`, `road_condition`, `lighting`
- `vehicle_type` / `vehicle`, `contributing_factor` / `factor`

Rows with missing coordinates currently receive demo fallback coordinates. This is convenient for a quick demo but is not appropriate for production data validation; implement a strict validation/review step before operational use.

## Important limitations
- All generated accident records and hotspot statistics are synthetic, not official road-safety statistics.
- The risk score is a transparent heuristic for demonstration, not a validated safety model.
- Prediction is a scenario simulation; no model confidence or real-world accuracy is claimed.
- Map tiles require internet connectivity.

## Advanced live GIS map (DevDynasty update)

The map now includes real-world basemap tiles (network required), four map styles (Dark Streets, Light Streets, OpenStreetMap, Satellite), accident point rendering, density glow, risk zones, road-segment overlays, blackspot candidates, zoom-aware cluster aggregation, geocoded place search, browser geolocation, fullscreen, reset view, and selectable accident details. The accident records remain synthetic until you load verified historical data; basemap imagery is live, but accident incidents are not a live police/ambulance feed.

### Map controls
- **Layer selector** above the map: Accident points, Heatmap, Risk zones, Road segments, Blackspots, Cluster view.
- **Map style** in the map overlay: Dark Streets, Light Streets, OpenStreetMap, Satellite.
- **Search**: first searches loaded roads/records; otherwise queries OpenStreetMap Nominatim for a Bengaluru place. Respect the service's usage policy and use a production geocoder for high-traffic deployments.
- **Location** requests browser permission and centers the map on the device.
- **Fullscreen / reset** are available beside the map style.

### Important limitations
- Map tiles require internet access. Tile provider availability, rate limits, and attribution terms apply.
- The density glow is a lightweight client-side density visualization, not a formal KDE result. Road lines connect demo points as a visual proxy and are not surveyed road geometry. Blackspots are heuristic candidates, not officially designated locations.
- For production, use validated accident records, authoritative road geometry, server-side PostGIS bounding-box queries, a dedicated geocoder, and a trained/validated model before making operational decisions.
