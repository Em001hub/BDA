# Urban Heat Inequality Intelligence System

React JavaScript dashboard for visualizing real Mumbai ward heat exposure and vulnerability indicators processed by R and Apache Spark.

## What changed

- The frontend is now React + Vite JavaScript. There are no TypeScript or TSX files.
- The Streamlit application was removed.
- The React dashboard has no synthetic/demo mode and only displays real Mumbai data.
- R and Apache Spark now own the real-data download, aggregation, normalization, and scoring pipeline.
- The Node.js API only serves R/Spark-generated outputs to the React dashboard.
- There are no Python files or Python runtime dependencies in the project.
- The original R/Spark course pipeline is retained separately under `R/` and can still be run with `run_project.R`.

## Data sources

The R/Spark pipeline combines:

1. Census ward indicators: population, literacy, children aged 0–6, and population density.
2. Mumbai ward boundary GeoJSON used for the interactive ward map.
3. Open-Meteo historical hourly weather for April–May 2024, including apparent temperature.

Because the Census source is from 2011 while the weather window is from 2024, the score is a transparent planning prototype rather than an official risk index.

## Project structure

```text
urban_heat_inequality/
|-- server.js                  Node.js visualization API
|-- package.json               Node.js server scripts
|-- run_project.R              Original R/Spark course pipeline
|-- R/                         R/Spark processing scripts
|-- frontend/
|   |-- package.json            React/Vite dependencies and scripts
|   |-- vite.config.js
|   |-- index.html
|   `-- src/
|       |-- App.jsx             React dashboard
|       |-- main.jsx
|       `-- styles.css
`-- presentation_output/       Project presentation artifact
```

## Run the project

### 1. Process the real Mumbai data with R and Spark

From the project root in RStudio:

```r
source("run_project.R")
```

This downloads the Mumbai inputs, processes the weather observations in Apache Spark, calculates the real-data priority scores, and writes files under `data/processed/`.

### 2. Start the Node.js visualization API

From the project root:

```powershell
npm start
```

The API reads the R/Spark outputs and runs at `http://127.0.0.1:5000`. It exposes the dashboard payload at `/api/dashboard`.

### 3. Start the React frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://localhost:5173`.

## Score model

Each indicator is normalized to 0–1 and combined into a score from 0 to 100:

```text
Score = 100 × (0.50H + 0.25L + 0.15D + 0.10C)
```

- `H`: mean apparent temperature, scaled from 28°C to 40°C.
- `L`: low-literacy proxy.
- `D`: population density normalized to the 90th percentile.
- `C`: children aged 0–6 share proxy.

Priority bands are Lower (<30), Moderate (30–49), High (50–69), and Immediate (70+).

The system is designed to identify where heat and vulnerability overlap so resources can be investigated more intelligently. It does not claim to predict illness.
