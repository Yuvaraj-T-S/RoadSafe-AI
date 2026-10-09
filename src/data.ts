export type Accident = {
  id: string; date: string; time: string; lat: number; lng: number; road: string;
  severity: "Fatal" | "Serious Injury" | "Minor Injury" | "Property Damage";
  fatalities: number; injuries: number; weather: string; roadCondition: string;
  lighting: string; vehicle: string; factor: string; location: string;
};

const roads = [
  { name: "Hosur Road", lat: 12.8500, lng: 77.6600, location: "Electronic City" },
  { name: "Outer Ring Road", lat: 12.9352, lng: 77.6950, location: "Marathahalli" },
  { name: "Bannerghatta Road", lat: 12.8950, lng: 77.6000, location: "Arekere" },
  { name: "Tumakuru Road", lat: 13.0450, lng: 77.5100, location: "Peenya" },
  { name: "Mysuru Road", lat: 12.9500, lng: 77.5200, location: "Nayandahalli" },
  { name: "Bellary Road", lat: 13.0650, lng: 77.5950, location: "Hebbal" },
  { name: "Old Airport Road", lat: 12.9600, lng: 77.6500, location: "Domlur" },
  { name: "Kanakapura Road", lat: 12.8750, lng: 77.5700, location: "Konanakunte" }
];
const severities: Accident["severity"][] = ["Fatal", "Serious Injury", "Minor Injury", "Property Damage"];
const factors = ["Overspeeding", "Distracted Driving", "Poor Lighting", "Unsafe Road Geometry", "Signal Violations", "Poor Road Surface", "Weather", "Traffic Congestion", "Pedestrian Activity"];
const weather = ["Clear", "Rain", "Fog", "Storm"];
const conditions = ["Dry", "Wet", "Damaged", "Under construction"];
const vehicles = ["Two-wheeler", "Car", "Truck", "Bus", "Auto-rickshaw", "Pedestrian"];
const pick = <T,>(arr: T[], n: number) => arr[n % arr.length];

export function generateDemoAccidents(count = 1200): Accident[] {
  // Synthetic points are intentionally concentrated around road corridors for demo visualization.
  return Array.from({ length: count }, (_, i) => {
    const road = roads[(i * 7 + Math.floor(i / 11)) % roads.length];
    const cluster = (i % 6) * 0.0011;
    const lat = road.lat + Math.sin(i * 1.73) * 0.018 + cluster;
    const lng = road.lng + Math.cos(i * 1.19) * 0.020 - cluster / 2;
    const date = new Date(Date.UTC(2024 + (i % 3), (i * 5) % 12, 1 + (i * 13) % 27));
    const hour = (i * 7 + Math.floor(i / 3)) % 24;
    const severity = pick(severities, (i * 13 + (i % 9 === 0 ? 0 : 2)) % severities.length);
    return {
      id: `RSA-${String(i + 1).padStart(5, "0")}`,
      date: date.toISOString().slice(0, 10),
      time: `${String(hour).padStart(2, "0")}:${String((i * 17) % 60).padStart(2, "0")}`,
      lat, lng, road: road.name, location: road.location, severity,
      fatalities: severity === "Fatal" ? 1 + (i % 3 === 0 ? 1 : 0) : 0,
      injuries: severity === "Serious Injury" ? 1 + i % 4 : severity === "Minor Injury" ? 1 + i % 2 : 0,
      weather: pick(weather, i * 3), roadCondition: pick(conditions, i * 5),
      lighting: hour < 6 || hour > 18 ? "Poor" : "Adequate",
      vehicle: pick(vehicles, i * 11), factor: pick(factors, i * 7 + Math.floor(i / 4))
    };
  });
}

export function riskScore(records: Accident[]): number {
  if (!records.length) return 0;
  const fatal = records.filter(a => a.severity === "Fatal").length;
  const serious = records.filter(a => a.severity === "Serious Injury").length;
  const poorLight = records.filter(a => a.lighting === "Poor").length;
  const wet = records.filter(a => a.roadCondition === "Wet" || a.weather === "Rain").length;
  // Normalize severity and conditions by record count so one large road does not
  // automatically score 100. This is a transparent demo heuristic, not a validated model.
  const frequency = Math.min(35, records.length * 0.24);
  const severity = (fatal / records.length) * 35 + (serious / records.length) * 18;
  const conditionsScore = (poorLight / records.length) * 10 + (wet / records.length) * 5;
  return Math.round(Math.min(100, frequency + severity + conditionsScore));
}

export const riskLabel = (score: number) => score <= 25 ? "Low" : score <= 50 ? "Moderate" : score <= 75 ? "High" : "Critical";
export const riskColor = (score: number) => score <= 25 ? "#22c55e" : score <= 50 ? "#eab308" : score <= 75 ? "#f97316" : "#ef4444";
