/**
 * generate-data.js
 *
 * Replicates the R/Spark pipeline in Node.js.
 * Downloads real Mumbai Census, ward GeoJSON, and Open-Meteo weather data,
 * then calculates the heat-inequality score and writes:
 *   data/processed/neighborhood_heat_inequality_scores.csv
 *
 * Run once before deploying:
 *   node generate-data.js
 *
 * Requires Node.js 18+ (uses built-in fetch).
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const rawDir = path.join(projectRoot, "data", "raw");
const processedDir = path.join(projectRoot, "data", "processed");

const CENSUS_URL =
  "https://raw.githubusercontent.com/mickeykedia/Mumbai-Population-Map/refs/heads/master/ward_level_collated.csv";
const GEOJSON_URL =
  "https://raw.githubusercontent.com/sanjanakrishnan/mumbai_spatial_data/refs/heads/main/BMC_admin_wards.geojson";
const WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive";

// ─── CSV helpers ────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += ch;
  }
  values.push(value.trim());
  return values;
}

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) =>
    Object.fromEntries(parseCsvLine(line).map((v, i) => [headers[i], v]))
  );
}

function toCsvRow(headers, row) {
  return headers
    .map((h) => {
      const v = row[h] ?? "";
      const s = String(v);
      return s.includes(",") || s.includes('"') || s.includes("\n")
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    })
    .join(",");
}

function writeCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  return [headers.join(","), ...rows.map((r) => toCsvRow(headers, r))].join("\n");
}

// ─── GeoJSON helpers ─────────────────────────────────────────────────────────

/** Recursively extract all [lon, lat] leaf coordinate pairs */
function flattenCoords(coords) {
  if (!coords || coords.length === 0) return [];
  if (typeof coords[0] === "number") return [coords]; // leaf point
  return coords.flatMap(flattenCoords);
}

function centroid(coordinates) {
  const points = flattenCoords(coordinates);
  if (!points.length) return null;
  const lon = points.reduce((s, p) => s + p[0], 0) / points.length;
  const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
  return { lon, lat };
}

function wardCodeFromProperties(props) {
  for (const key of ["NAME", "WARDNAME", "WARD_NAME", "Ward", "ward", "name"]) {
    if (props?.[key] != null && String(props[key]).trim()) {
      return String(props[key]).trim().toUpperCase();
    }
  }
  return null;
}

// ─── Statistics helpers ───────────────────────────────────────────────────────

function quantile(sorted, p) {
  // sorted ascending array, p in [0,1]
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), hi);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(rawDir, { recursive: true });
  await mkdir(processedDir, { recursive: true });

  // 1. Download Census CSV
  console.log("Downloading Census ward demographics...");
  const censusText = await fetch(CENSUS_URL).then((r) => {
    if (!r.ok) throw new Error(`Census download failed: ${r.status}`);
    return r.text();
  });
  const census = parseCsv(censusText);
  console.log(`  ${census.length} census rows`);

  // Build a lookup: ward_code → census row
  const censusByCode = new Map();
  for (const row of census) {
    const code = String(row.Ward_Alphabet || "").trim().toUpperCase();
    if (code && code !== "NAN") censusByCode.set(code, row);
  }

  // 2. Download ward GeoJSON
  console.log("Downloading Mumbai ward GeoJSON...");
  const geojsonText = await fetch(GEOJSON_URL).then((r) => {
    if (!r.ok) throw new Error(`GeoJSON download failed: ${r.status}`);
    return r.text();
  });
  const geojson = JSON.parse(geojsonText);
  await writeFile(path.join(rawDir, "mumbai_wards.geojson"), geojsonText, "utf8");
  console.log(`  ${geojson.features.length} ward features`);

  // 3. Match GeoJSON features to Census rows via ward code, compute centroids
  const wards = [];
  for (const feature of geojson.features) {
    const code = wardCodeFromProperties(feature.properties);
    if (!code) continue;
    const censusRow = censusByCode.get(code);
    if (!censusRow) continue;

    const coords =
      feature.geometry?.type === "Polygon"
        ? feature.geometry.coordinates
        : feature.geometry?.type === "MultiPolygon"
        ? feature.geometry.coordinates.flat()
        : null;
    if (!coords) continue;

    const c = centroid(coords);
    if (!c) continue;

    const population = Number(censusRow.TOT_P) || 0;
    const populationDensity = Number(censusRow.TOT_P_DEN) || 0;
    const childPct = population > 0 ? (100 * Number(censusRow.P_06)) / population : 0;
    const literacyRate = population > 0 ? (100 * Number(censusRow.P_LIT)) / population : 0;
    const wardName = censusRow.Ward_Names || code;

    wards.push({
      ward_code: code,
      ward_name: wardName,
      latitude: c.lat,
      longitude: c.lon,
      population,
      population_density: populationDensity,
      child_pct: childPct,
      literacy_rate: literacyRate,
    });
  }

  // Remove duplicates by ward_code (keep first match)
  const seen = new Set();
  const uniqueWards = wards.filter((w) => {
    if (seen.has(w.ward_code)) return false;
    seen.add(w.ward_code);
    return true;
  });

  if (uniqueWards.length < 10) {
    throw new Error(
      `Only matched ${uniqueWards.length} wards. Check Census/GeoJSON ward code alignment.`
    );
  }
  console.log(`  Matched ${uniqueWards.length} wards to GeoJSON boundaries`);

  // 4. Fetch weather from Open-Meteo (supports multi-location in one request)
  // API supports up to ~50 locations per request; Mumbai has ~24 wards so this is fine.
  console.log("Fetching historical weather from Open-Meteo (Apr–May 2024)...");
  const lats = uniqueWards.map((w) => w.latitude.toFixed(6)).join(",");
  const lons = uniqueWards.map((w) => w.longitude.toFixed(6)).join(",");

  const weatherParams = new URLSearchParams({
    latitude: lats,
    longitude: lons,
    start_date: "2024-04-01",
    end_date: "2024-05-31",
    hourly: "temperature_2m,relative_humidity_2m,apparent_temperature",
    timezone: "Asia/Kolkata",
  });

  const weatherData = await fetch(`${WEATHER_URL}?${weatherParams}`).then((r) => {
    if (!r.ok) throw new Error(`Weather API failed: ${r.status}`);
    return r.json();
  });

  // Open-Meteo returns an array when multiple locations are requested, or a single object
  const locationResults = Array.isArray(weatherData) ? weatherData : [weatherData];

  if (locationResults.length !== uniqueWards.length) {
    throw new Error(
      `Weather API returned ${locationResults.length} locations but expected ${uniqueWards.length}`
    );
  }

  // Merge weather into ward records
  const wardWeather = uniqueWards.map((ward, i) => {
    const hourly = locationResults[i]?.hourly;
    const apparent = (hourly?.apparent_temperature || []).map(Number).filter((v) => !isNaN(v));
    if (!apparent.length) throw new Error(`No apparent temperature data for ward ${ward.ward_code}`);

    const meanHeat = apparent.reduce((s, v) => s + v, 0) / apparent.length;
    const peakHeat = Math.max(...apparent);
    const heatEvents = apparent.filter((v) => v >= 35).length;

    return {
      ...ward,
      mean_heat_index_c: meanHeat,
      peak_heat_index_c: peakHeat,
      heat_event_observations: heatEvents,
      observation_count: apparent.length,
    };
  });

  console.log(
    `  Weather fetched: ${wardWeather.reduce((s, w) => s + w.observation_count, 0).toLocaleString()} observations`
  );

  // 5. Calculate scores (same formula as 02_spark_heat_pipeline.R)
  const densities = wardWeather.map((w) => w.population_density).sort((a, b) => a - b);
  const p90density = quantile(densities, 0.9);

  const scored = wardWeather
    .map((ward) => {
      const heatComponent = clamp((ward.mean_heat_index_c - 28) / 12, 0, 1);
      const lowLiteracyComponent = clamp(1 - ward.literacy_rate / 100, 0, 1);
      const densityComponent = clamp(ward.population_density / p90density, 0, 1);
      const childComponent = clamp(ward.child_pct / 20, 0, 1);
      const score =
        100 * (0.5 * heatComponent + 0.25 * lowLiteracyComponent + 0.15 * densityComponent + 0.1 * childComponent);

      const priorityBand =
        score >= 70
          ? "Immediate priority"
          : score >= 50
          ? "High priority"
          : score >= 30
          ? "Moderate priority"
          : "Lower priority";

      return {
        zone_id: `WARD-${ward.ward_code}`,
        ward_code: ward.ward_code,
        ward_name: ward.ward_name,
        latitude: ward.latitude,
        longitude: ward.longitude,
        population: ward.population,
        population_density: ward.population_density,
        literacy_rate: ward.literacy_rate,
        child_pct: ward.child_pct,
        mean_heat_index_c: meanHeat(ward),
        peak_heat_index_c: ward.peak_heat_index_c,
        heat_event_observations: ward.heat_event_observations,
        observation_count: ward.observation_count,
        heat_component: heatComponent,
        low_literacy_component: lowLiteracyComponent,
        density_component: densityComponent,
        child_component: childComponent,
        heat_inequality_score: score,
        priority_band: priorityBand,
      };
    })
    .sort((a, b) => b.heat_inequality_score - a.heat_inequality_score);

  // 6. Write outputs
  const csvContent = writeCsv(scored);
  const outFile = path.join(processedDir, "neighborhood_heat_inequality_scores.csv");
  await writeFile(outFile, csvContent, "utf8");

  console.log(`\nDone. Wrote ${scored.length} ward records to:`);
  console.log(`  ${outFile}`);
  console.log("\nTop 5 priority wards:");
  scored.slice(0, 5).forEach((w, i) =>
    console.log(
      `  ${i + 1}. ${w.ward_name} (${w.ward_code}) — score ${w.heat_inequality_score.toFixed(1)} [${w.priority_band}]`
    )
  );
}

// Helper: just returns the precomputed value (closure over ward object)
function meanHeat(ward) {
  return ward.mean_heat_index_c;
}

main().catch((err) => {
  console.error("\nFailed:", err.message);
  process.exit(1);
});
