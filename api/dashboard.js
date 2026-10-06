import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const processedDir = path.join(projectRoot, "data", "processed");
const rawDir = path.join(projectRoot, "data", "raw");

const sourceUrls = {
  census: "https://raw.githubusercontent.com/mickeykedia/Mumbai-Population-Map/refs/heads/master/ward_level_collated.csv",
  geometry: "https://raw.githubusercontent.com/sanjanakrishnan/mumbai_spatial_data/refs/heads/main/BMC_admin_wards.geojson",
  weather: "https://archive-api.open-meteo.com/v1/archive",
};

// Cache the parsed result across warm invocations
let cached = null;

function parseCsvLine(line) {
  const values = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { values.push(value.trim()); value = ""; }
    else value += char;
  }
  values.push(value.trim());
  return values;
}

function parseCsv(csv) {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines.shift());
  return lines.map((line) =>
    Object.fromEntries(parseCsvLine(line).map((v, i) => [headers[i], v]))
  );
}

function numericFields(row) {
  const fields = [
    "latitude", "longitude", "population", "population_density",
    "literacy_rate", "child_pct", "mean_heat_index_c", "peak_heat_index_c",
    "heat_event_observations", "observation_count",
    "heat_component", "low_literacy_component", "density_component",
    "child_component", "heat_inequality_score",
  ];
  fields.forEach((field) => {
    if (row[field] !== undefined && row[field] !== "") row[field] = Number(row[field]);
  });
  return row;
}

function wardCode(properties) {
  for (const key of ["NAME", "WARDNAME", "WARD_NAME", "Ward", "ward", "name"]) {
    if (properties?.[key] != null && String(properties[key]).trim())
      return String(properties[key]).trim().toUpperCase();
  }
  return "";
}

async function loadDashboard() {
  if (cached) return cached;

  const [scoresCsv, geojsonText] = await Promise.all([
    readFile(path.join(processedDir, "neighborhood_heat_inequality_scores.csv"), "utf8"),
    readFile(path.join(rawDir, "mumbai_wards.geojson"), "utf8"),
  ]);

  const wards = parseCsv(scoresCsv).map(numericFields);
  const geojson = JSON.parse(geojsonText);
  const scoreByCode = new Map(wards.map((w) => [String(w.ward_code).toUpperCase(), w]));

  const features = (geojson.features || [])
    .map((feature) => {
      const score = scoreByCode.get(wardCode(feature.properties));
      return score
        ? { type: "Feature", geometry: feature.geometry, properties: score }
        : null;
    })
    .filter(Boolean);

  if (!wards.length || !features.length) {
    throw new Error(
      "Processed R/Spark outputs are missing or empty. Run source('run_project.R') and commit the data files."
    );
  }

  const observationCount = wards.reduce((sum, w) => sum + (w.observation_count || 0), 0);

  cached = {
    data_mode: "real_mumbai_only",
    processing_engine: "R + Apache Spark",
    observation_count: observationCount,
    sources: Object.values(sourceUrls),
    weights: { heat: 0.50, low_literacy: 0.25, density: 0.15, children_0_6: 0.10 },
    summary: {
      ward_count: wards.length,
      high_or_immediate_count: wards.filter((w) =>
        ["High priority", "Immediate priority"].includes(w.priority_band)
      ).length,
      mean_heat_c: wards.reduce((sum, w) => sum + w.mean_heat_index_c, 0) / wards.length,
      top_ward: wards[0]?.ward_name || null,
    },
    wards,
    geojson: { type: "FeatureCollection", features },
  };

  return cached;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  try {
    const payload = await loadDashboard();
    res.status(200).json(payload);
  } catch (error) {
    cached = null;
    res.status(503).json({ error: error.message });
  }
}
