import { useEffect, useMemo, useState } from "react";

// In production (Vercel) the serverless functions live at /api/...
// In local dev the Vite proxy forwards /api to http://127.0.0.1:5000/api
const API_URL = import.meta.env.VITE_API_URL || "/api";
const COLORS = {
  "Immediate priority": "#9b2226",
  "High priority": "#ca6702",
  "Moderate priority": "#ee9b00",
  "Lower priority": "#2a9d8f",
};

function scoreColor(score) {
  if (score >= 70) return COLORS["Immediate priority"];
  if (score >= 50) return COLORS["High priority"];
  if (score >= 30) return COLORS["Moderate priority"];
  return COLORS["Lower priority"];
}

function formatNumber(value, digits = 0) {
  return Number(value || 0).toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function MapPanel({ geojson, visibleWards, selectedWard, onSelect }) {
  const [minX, maxX, minY, maxY] = useMemo(() => {
    const points = [];
    (geojson?.features || []).forEach((feature) => {
      const add = (value) => {
        if (!value) return;
        if (typeof value[0] === "number") points.push(value);
        else value.forEach(add);
      };
      add(feature.geometry?.coordinates);
    });
    if (!points.length) return [72.75, 73.05, 18.85, 19.35];
    return [
      Math.min(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[0])),
      Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[1])),
    ];
  }, [geojson]);

  const project = ([longitude, latitude]) => {
    const x = 24 + ((longitude - minX) / Math.max(maxX - minX, 0.001)) * 612;
    const y = 350 - ((latitude - minY) / Math.max(maxY - minY, 0.001)) * 300;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  };

  const polygonPoints = (coordinates) => {
    if (!coordinates?.length) return "";
    const ring = coordinates[0];
    return ring.map(project).join(" ");
  };

  return (
    <div className="map-wrap">
      <div className="map-heading">
        <div>
          <h2>Ward priority map</h2>
          <p>Real Mumbai ward boundaries coloured by the composite score</p>
        </div>
        <span className="map-badge">{visibleWards.length} wards shown</span>
      </div>
      <svg className="ward-map" viewBox="0 0 660 390" role="img" aria-label="Mumbai ward priority map">
        <rect x="0" y="0" width="660" height="390" rx="16" fill="#eef5f6" />
        <path d="M30 340 C180 310, 235 352, 360 326 C460 306, 515 338, 632 310" fill="none" stroke="#bed7dc" strokeWidth="3" strokeDasharray="7 8" />
        {(geojson?.features || []).map((feature) => {
          const ward = feature.properties;
          const visible = visibleWards.some((item) => item.zone_id === ward.zone_id);
          const selected = selectedWard?.zone_id === ward.zone_id;
          const geometry = feature.geometry;
          const polygons = geometry?.type === "Polygon" ? [geometry.coordinates] : geometry?.coordinates || [];
          return polygons.map((coordinates, index) => (
            <polygon
              key={`${ward.zone_id}-${index}`}
              points={polygonPoints(coordinates)}
              fill={visible ? scoreColor(ward.heat_inequality_score) : "#d8e1e8"}
              fillOpacity={visible ? (selected ? 0.95 : 0.72) : 0.25}
              stroke={selected ? "#12263f" : "#ffffff"}
              strokeWidth={selected ? 3 : 0.8}
              onClick={() => visible && onSelect(ward)}
              className={visible ? "ward-shape" : "ward-shape disabled"}
            />
          ));
        })}
        {visibleWards.map((ward) => (
          <circle key={`point-${ward.zone_id}`} cx={project([ward.longitude, ward.latitude]).split(",")[0]} cy={project([ward.longitude, ward.latitude]).split(",")[1]} r="3.2" fill="#12263f" opacity="0.7" />
        ))}
      </svg>
      <div className="legend">
        {Object.entries(COLORS).map(([label, color]) => <span key={label}><i style={{ background: color }} />{label.replace(" priority", "")}</span>)}
      </div>
    </div>
  );
}

function ComponentBars({ ward }) {
  const components = [
    ["Heat exposure", ward.heat_component, "#9b2226"],
    ["Low literacy proxy", ward.low_literacy_component, "#ca6702"],
    ["Population density", ward.density_component, "#ee9b00"],
    ["Children aged 0–6", ward.child_component, "#2a9d8f"],
  ];
  return <div className="component-bars">{components.map(([label, value, color]) => <div className="component-row" key={label}>
    <div className="component-label"><span>{label}</span><b>{formatNumber(value * 100, 1)}%</b></div>
    <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(value * 100, 1)}%`, background: color }} /></div>
  </div>)}</div>;
}

function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [bands, setBands] = useState(Object.keys(COLORS));
  const [selectedWard, setSelectedWard] = useState(null);

  useEffect(() => {
    fetch(`${API_URL}/dashboard`).then((response) => {
      if (!response.ok) throw new Error("The real Mumbai data service could not be reached.");
      return response.json();
    }).then((payload) => {
      setData(payload);
      setSelectedWard(payload.wards?.[0] || null);
    }).catch((reason) => setError(reason.message));
  }, []);

  const visibleWards = useMemo(() => {
    if (!data) return [];
    const query = search.trim().toLowerCase();
    return data.wards.filter((ward) => bands.includes(ward.priority_band) && ward.heat_inequality_score >= minScore && (!query || `${ward.zone_id} ${ward.ward_name}`.toLowerCase().includes(query)));
  }, [data, search, minScore, bands]);

  const activeWard = visibleWards.find((ward) => ward.zone_id === selectedWard?.zone_id) || visibleWards[0] || null;
  const toggleBand = (band) => setBands((current) => current.includes(band) ? current.filter((item) => item !== band) : [...current, band]);
  const downloadCsv = () => {
    const headers = Object.keys(data.wards[0]);
    const rows = visibleWards.map((ward) => headers.map((header) => JSON.stringify(ward[header] ?? "")).join(","));
    const blob = new Blob([[headers.join(","), ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "mumbai_ward_heat_inequality_scores.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <main className="loading-page"><div className="error-card"><span className="eyebrow">R + Apache Spark pipeline</span><h1>Processed data is not ready</h1><p>{error}</p><p>Run <code>source("run_project.R")</code> in RStudio, then start the Node.js API and refresh this page.</p></div></main>;
  if (!data) return <main className="loading-page"><div className="loader"><span className="spinner" />Loading real Mumbai ward, Census, and weather data…</div></main>;

  const topRows = visibleWards.slice(0, 8);
  return <main className="app-shell">
    <header className="hero">
      <div><span className="eyebrow">REAL MUMBAI DATA · DECISION SUPPORT</span><h1>Urban Heat Inequality<br /><em>Intelligence System</em></h1><p>See where historical heat exposure overlaps with population vulnerability across Mumbai wards.</p></div>
      <div className="hero-mark"><span>REAL</span><strong>{data.summary.ward_count}</strong><small>wards analysed</small></div>
    </header>

    <section className="control-panel">
      <div className="control-copy"><span className="eyebrow">Explore the evidence</span><h2>Filter the priority view</h2><p>This dashboard uses Census 2011 ward indicators, BMC ward geometry, and April–May 2024 historical weather. No synthetic or demo data is used.</p></div>
      <label className="search-field">Search ward<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ward name or code" /></label>
      <label className="score-field">Minimum score <strong>{minScore}</strong><input type="range" min="0" max="100" value={minScore} onChange={(event) => setMinScore(Number(event.target.value))} /></label>
      <div className="band-filter"><span>Priority bands</span>{Object.keys(COLORS).map((band) => <button className={bands.includes(band) ? "band active" : "band"} key={band} onClick={() => toggleBand(band)}><i style={{ background: COLORS[band] }} />{band.replace(" priority", "")}</button>)}</div>
    </section>

    <section className="metrics-grid">
      <article><span>Wards shown</span><strong>{formatNumber(visibleWards.length)}</strong><small>Filtered view</small></article>
      <article><span>Highest priority ward</span><strong className="text-value">{visibleWards[0]?.ward_name || "—"}</strong><small>{visibleWards[0] ? `Score ${formatNumber(visibleWards[0].heat_inequality_score, 1)}` : "No match"}</small></article>
      <article><span>High or immediate</span><strong>{formatNumber(visibleWards.filter((ward) => ["High priority", "Immediate priority"].includes(ward.priority_band)).length)}</strong><small>In filtered view</small></article>
      <article><span>Average heat exposure</span><strong>{formatNumber(visibleWards.reduce((sum, ward) => sum + ward.mean_heat_index_c, 0) / Math.max(visibleWards.length, 1), 1)}°C</strong><small>Mean apparent temperature</small></article>
    </section>

    <div className="notice"><b>Interpretation:</b> A higher score means heat exposure overlaps with lower adaptive-capacity proxies. This is a transparent planning prototype, not an official medical or government risk index.</div>

    <section className="main-grid"><MapPanel geojson={data.geojson} visibleWards={visibleWards} selectedWard={activeWard} onSelect={setSelectedWard} /><aside className="ranking-card"><div className="card-heading"><div><span className="eyebrow">RANKED VIEW</span><h2>Top priority wards</h2></div><span className="count-pill">{topRows.length} results</span></div>{topRows.map((ward) => <button key={ward.zone_id} className={`rank-row ${activeWard?.zone_id === ward.zone_id ? "selected" : ""}`} onClick={() => setSelectedWard(ward)}><span className="rank-index">{String(topRows.indexOf(ward) + 1).padStart(2, "0")}</span><span className="rank-name"><b>{ward.ward_name}</b><small>{ward.zone_id} · {ward.priority_band.replace(" priority", "")}</small></span><span className="rank-score" style={{ color: scoreColor(ward.heat_inequality_score) }}>{formatNumber(ward.heat_inequality_score, 1)}</span></button>)}</aside></section>

    <section className="detail-grid"><article className="detail-card"><div className="card-heading"><div><span className="eyebrow">WARD DRILL-DOWN</span><h2>{activeWard?.ward_name || "No ward selected"}</h2></div>{activeWard && <span className="priority-pill" style={{ background: COLORS[activeWard.priority_band] }}>{activeWard.priority_band}</span>}</div>{activeWard && <><div className="detail-metrics"><span><small>Score</small><b>{formatNumber(activeWard.heat_inequality_score, 1)}</b></span><span><small>Mean heat</small><b>{formatNumber(activeWard.mean_heat_index_c, 1)}°C</b></span><span><small>Peak heat</small><b>{formatNumber(activeWard.peak_heat_index_c, 1)}°C</b></span></div><ComponentBars ward={activeWard} /><div className="detail-table"><span>Population <b>{formatNumber(activeWard.population)}</b></span><span>Density <b>{formatNumber(activeWard.population_density)}</b></span><span>Literacy <b>{formatNumber(activeWard.literacy_rate, 1)}%</b></span><span>Children 0–6 <b>{formatNumber(activeWard.child_pct, 1)}%</b></span></div></>}</article><article className="method-card"><span className="eyebrow">TRANSPARENT MODEL</span><h2>How the score works</h2><p>Each real-data indicator is normalized to 0–1, then weighted into a score from 0 to 100.</p><div className="formula">Score = 100 × (0.50H + 0.25L + 0.15D + 0.10C)</div><div className="weight-list"><span><i style={{ background: "#9b2226" }} />Heat exposure <b>50%</b></span><span><i style={{ background: "#ca6702" }} />Low literacy proxy <b>25%</b></span><span><i style={{ background: "#ee9b00" }} />Population density <b>15%</b></span><span><i style={{ background: "#2a9d8f" }} />Children aged 0–6 <b>10%</b></span></div><button className="download" onClick={downloadCsv}>Download filtered CSV ↓</button></article></section>

    <footer><span>Urban Heat Inequality Intelligence System</span><span>Real Mumbai data only · Census 2011 + Open-Meteo Apr–May 2024</span></footer>
  </main>;
}

export default App;
