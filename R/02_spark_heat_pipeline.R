# Aggregate real Mumbai weather observations with Apache Spark and calculate the score.

if (!requireNamespace("sparklyr", quietly = TRUE)) stop("sparklyr is required. Install it with install.packages('sparklyr').")
if (!requireNamespace("dplyr", quietly = TRUE)) stop("dplyr is required. Install it with install.packages('dplyr').")
library(sparklyr)
library(dplyr)

project_root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
raw_dir <- file.path(project_root, "data", "raw")
processed_dir <- file.path(project_root, "data", "processed")
output_dir <- file.path(project_root, "outputs")
dir.create(processed_dir, recursive = TRUE, showWarnings = FALSE)
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

demographics_file <- file.path(raw_dir, "mumbai_ward_demographics.csv")
weather_file <- file.path(raw_dir, "mumbai_weather.csv")
if (!file.exists(demographics_file) || !file.exists(weather_file)) stop("Real Mumbai inputs are missing. Run 01_prepare_real_mumbai_data.R first.")

message("Connecting to local Spark...")
sc <- spark_connect(master = "local", version = "3.3")
demographics_tbl <- spark_read_csv(sc, name = "mumbai_ward_demographics", path = demographics_file, header = TRUE, infer_schema = TRUE)
weather_tbl <- spark_read_csv(sc, name = "mumbai_weather", path = weather_file, header = TRUE, infer_schema = TRUE)
message(sprintf("Spark weather rows: %s", sdf_nrow(weather_tbl)))

weather_summary <- weather_tbl %>%
  group_by(ward_code) %>%
  summarise(
    mean_heat_index_c = mean(mean_heat_index_c, na.rm = TRUE),
    peak_heat_index_c = max(peak_heat_index_c, na.rm = TRUE),
    heat_event_observations = sum(heat_event_observations),
    observation_count = sum(observation_count),
    .groups = "drop"
  )

scores <- demographics_tbl %>%
  inner_join(weather_summary, by = "ward_code") %>%
  collect() %>%
  mutate(
    zone_id = paste0("WARD-", ward_code),
    heat_component = pmin(pmax((mean_heat_index_c - 28) / 12, 0), 1),
    low_literacy_component = pmin(pmax(1 - literacy_rate / 100, 0), 1),
    density_component = pmin(pmax(population_density / quantile(population_density, 0.9, na.rm = TRUE), 0), 1),
    child_component = pmin(pmax(child_pct / 20, 0), 1),
    heat_inequality_score = 100 * (0.50 * heat_component + 0.25 * low_literacy_component + 0.15 * density_component + 0.10 * child_component),
    priority_band = case_when(
      heat_inequality_score >= 70 ~ "Immediate priority",
      heat_inequality_score >= 50 ~ "High priority",
      heat_inequality_score >= 30 ~ "Moderate priority",
      TRUE ~ "Lower priority"
    )
  ) %>%
  arrange(desc(heat_inequality_score))

write.csv(scores, file.path(processed_dir, "neighborhood_heat_inequality_scores.csv"), row.names = FALSE)
write.csv(head(scores, 20), file.path(output_dir, "top_20_priority_neighborhoods.csv"), row.names = FALSE)
message("Top five priority neighborhoods:")
print(scores[1:min(5, nrow(scores)), c("zone_id", "heat_inequality_score", "priority_band")])
spark_disconnect(sc)
message("Spark pipeline complete.")
