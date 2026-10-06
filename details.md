# Urban Heat Inequality Intelligence System

## 1. Project summary

The Urban Heat Inequality Intelligence System is a data-driven decision-support project for identifying Mumbai wards where heat exposure overlaps with population vulnerability.

The project processes real Mumbai data through R and Apache Spark, then presents the processed results through a React JavaScript dashboard. A native Node.js API serves the R/Spark output files to the browser. Users can explore ward-level scores, filter priority bands, inspect individual wards, view the ward map, and download filtered results.

The score is intended to support investigation and planning. It is not an official government risk index and does not claim to predict illness.

## 2. Problem statement

Urban heat is not experienced equally across a city. Some wards may have higher apparent temperatures while also having population characteristics that can reduce the ability to adapt to heat.

The system is designed to answer four questions:

1. Which Mumbai wards experience the highest historical heat exposure?
2. Which wards combine heat exposure with lower adaptive-capacity indicators?
3. Which wards should be investigated first for heat-response planning?
4. How can the reasoning behind each priority score be explained transparently?

## 3. Project objectives

- Combine environmental and demographic indicators at ward level using R and Spark.
- Convert multiple indicators into one interpretable priority score.
- Display the results in an interactive browser dashboard.
- Allow users to search, filter, compare, and inspect wards.
- Provide a reproducible workflow suitable for a BDA project report and presentation.
- Preserve the original R and Apache Spark course pipeline separately for distributed-processing demonstration.

## 4. Current technology stack

### Active application

- React JavaScript
- Vite
- Native Node.js HTTP server used only as a visualization API
- Browser SVG map rendering
- Public REST/CSV/GeoJSON data sources

There are no Python files or Python runtime dependencies in the active application. There are also no TypeScript or TSX source files.

### Retained course pipeline

- R
- Apache Spark through `sparklyr`
- `dplyr`
- `ggplot2`

The R/Spark pipeline is kept under the `R/` folder and produces the files consumed by the React dashboard.

## 5. Project architecture

```text
                         REAL MUMBAI DATA PATH

 Census ward CSV ───────┐
 Ward boundary GeoJSON ─┼──> R data preparation
 Open-Meteo weather ────┘             │
                                     ▼
                         Spark ward-level aggregation
                                     │
                                     ▼
                         R normalization and scoring
                                     │
                                     ▼
                  Processed CSV + scored GeoJSON
                                     │
                                     ▼
                  Node.js visualization API
                                     │
                                     ▼
                          React JavaScript frontend
                                     │
                    ┌────────────────┼────────────────┐
                    ▼                ▼                ▼
              Map visualization  Filters        Ward drill-down
                    │                │                │
                    └────────────────┴────────────────┘
                                     ▼
                         CSV download and explanation
```

### R/Spark processing path

```text
Real Mumbai data download and preparation
            ▼
Ward demographics + weather CSV files
            ▼
Apache Spark aggregation through sparklyr
            ▼
R score calculation and priority bands
            ▼
CSV summaries and static PNG visualizations
```

The R/Spark path is the primary analytical pipeline. The React dashboard does not perform data loading, normalization, or scoring; it only visualizes the processed outputs.

## 6. Real Mumbai data sources

### Census ward indicators

Source URL:

<https://raw.githubusercontent.com/mickeykedia/Mumbai-Population-Map/refs/heads/master/ward_level_collated.csv>

Used indicators include:

- Total population
- Population density
- Literacy count/rate proxy
- Population aged 0–6
- Ward code and ward name

### Ward boundary geometry

Source URL:

<https://raw.githubusercontent.com/sanjanakrishnan/mumbai_spatial_data/refs/heads/main/BMC_admin_wards.geojson>

The GeoJSON provides the ward polygons displayed in the dashboard. Polygon coordinates are also used to calculate approximate ward centroids for weather lookup.

### Historical weather

Source URL:

<https://archive-api.open-meteo.com/v1/archive>

The current weather window is 1 April 2024 through 31 May 2024. The API retrieves hourly:

- Air temperature
- Relative humidity
- Apparent temperature

The score currently uses apparent temperature as the main heat exposure measure.

## 7. Data preparation process

1. Download the ward-level Census CSV.
2. Normalize ward codes to uppercase strings.
3. Download the Mumbai ward GeoJSON.
4. Extract ward names, polygon coordinates, longitude, and latitude.
5. Match Census wards to ward geometries.
6. Send all matched ward centroids to the historical weather API.
7. Aggregate hourly apparent temperature for each ward in Spark.
8. Join the weather summary to demographic indicators.
9. Normalize the indicators to a 0–1 range in R.
10. Calculate the final score and priority band in R.
11. Write scored CSV output for the Node.js visualization API.

## 8. Real-data scoring model

The current real-data score is:

```text
Score = 100 × (0.50H + 0.25L + 0.15D + 0.10C)
```

Where:

- `H` = heat exposure component.
- `L` = low-literacy vulnerability proxy.
- `D` = population-density component.
- `C` = children aged 0–6 component.

### Component definitions

#### Heat exposure component

```text
H = clamp((mean apparent temperature − 28) / 12, 0, 1)
```

This maps mean apparent temperature from approximately 28°C to 40°C into a 0–1 range.

#### Low-literacy component

```text
L = clamp(1 − literacy rate / 100, 0, 1)
```

Lower literacy produces a higher vulnerability component.

#### Population-density component

```text
D = clamp(population density / 90th-percentile density, 0, 1)
```

This gives higher values to denser wards while reducing the effect of extreme outliers.

#### Children aged 0–6 component

```text
C = clamp(children aged 0–6 percentage / 20, 0, 1)
```

This treats a higher share of young children as a heat-vulnerability proxy.

## 9. Priority bands

| Score range | Priority band | Meaning |
|---|---|---|
| 70 and above | Immediate priority | Highest combined heat and vulnerability signal |
| 50 to under 70 | High priority | Strong signal requiring investigation |
| 30 to under 50 | Moderate priority | Intermediate signal |
| Below 30 | Lower priority | Lower relative score in the current dataset |

These bands are project-defined categories and should be recalibrated if the data sources or validation outcomes change.

## 10. React frontend features

### Overview dashboard

- Hero section explaining the project.
- Real-data-only status label.
- Ward count and summary metrics.
- Average heat exposure.
- Highest-priority ward.
- Count of high and immediate priority wards.

### Filtering controls

- Search by ward name or ward code.
- Minimum score slider.
- Priority-band filter buttons.

### Ward map

- Mumbai ward polygons rendered as SVG.
- Ward colours represent priority score.
- Clicking a visible ward selects it for inspection.
- Selected wards are highlighted.

### Priority ranking

- Ranked list of the highest-scoring visible wards.
- Score and priority band for each ward.
- Clicking a ranking item opens its drill-down.

### Ward drill-down

- Composite score.
- Priority band.
- Mean apparent temperature.
- Peak apparent temperature.
- Population.
- Population density.
- Literacy rate.
- Children aged 0–6 percentage.
- Normalized score-component bars.

### Export

The frontend can download the currently filtered ward records as a CSV file.

## 11. Node.js API endpoints

### Health endpoint

```text
GET /api/health
```

Returns the API status and confirms the mode as `real_mumbai_only`.

### Dashboard endpoint

```text
GET /api/dashboard
```

Returns:

- Data mode
- Observation count
- Source URLs
- Score weights
- Summary metrics
- Ward score records
- Scored ward GeoJSON

The Node.js API reads the processed files written by R/Spark. It does not download source data or calculate the score.

## 12. How to run the JavaScript application

### Process the real data with R and Spark

From the project root in RStudio:

```r
source("run_project.R")
```

### Start the Node.js visualization API

From the project root:

```powershell
npm start
```

The API runs at:

```text
http://127.0.0.1:5000
```

### Start the React frontend

Open a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally:

```text
http://localhost:5173
```

## 13. Retained R/Spark workflow

From the project root in RStudio:

```r
source("run_project.R")
```

This runs the primary analytical pipeline:

1. Download real Mumbai Census, ward geometry, and Open-Meteo inputs.
2. Prepare ward demographics and weather files in R.
3. Read and aggregate weather records through Apache Spark.
4. Calculate the real-data score in R.
5. Write processed CSV files and static visualizations.

The Node.js API reads the processed files after this pipeline completes. The React application remains real-data-only and visualization-only.

## 14. Limitations

- Census indicators currently come from 2011 and may not represent current population conditions.
- The weather period is limited to April–May 2024.
- Apparent temperature is used as a heat-exposure measure rather than satellite land-surface temperature.
- Tree cover, impervious surface, income, cooling-centre access, and health outcomes are not currently included in the real-data score.
- Ward boundary names may change or require additional matching logic if the public source changes.
- The score is a transparent prototype and has not been validated against heat-related illness or mortality data.

## 15. Recommended future improvements

1. Add satellite-derived land-surface temperature.
2. Add tree canopy and impervious-surface layers.
3. Add updated demographic estimates.
4. Add income, housing, elderly-population, and cooling-centre indicators.
5. Process longer weather periods and multiple years.
6. Validate the score against heat-health outcomes.
7. Add automated data refresh and source-version tracking.
8. Deploy the Node.js API and React frontend for classroom or stakeholder access.

## 16. Presentation explanation

The project can be explained in five steps:

1. **Problem:** Heat affects wards differently because exposure and vulnerability vary spatially.
2. **Data:** Combine ward demographics, ward boundaries, and historical weather.
3. **Method:** Normalize the indicators and apply transparent weights.
4. **Frontend:** Use React to explore the map, rankings, filters, and ward details.
5. **Meaning:** The score helps prioritize investigation and planning; it is not a medical prediction.

## 17. Expected project outcome

The final product is an interactive, explainable Mumbai ward dashboard that helps a user move from raw public data to a ranked heat-inequality planning view. The project demonstrates data integration, scoring, spatial visualization, frontend development, and a separate R/Spark processing workflow for BDA coursework.
