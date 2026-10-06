# Create visual outputs from the neighborhood-level score table.

if (!requireNamespace("ggplot2", quietly = TRUE)) {
  stop("ggplot2 is required. Install it with install.packages('ggplot2').")
}
library(ggplot2)

project_root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
scores_file <- file.path(project_root, "data", "processed", "neighborhood_heat_inequality_scores.csv")
output_dir <- file.path(project_root, "outputs")

if (!file.exists(scores_file)) {
  stop("Processed scores are missing. Run 02_spark_heat_pipeline.R first.")
}

scores <- read.csv(scores_file, stringsAsFactors = FALSE)

heat_map <- ggplot(scores, aes(x = longitude, y = latitude, fill = heat_inequality_score)) +
  geom_tile() +
  coord_equal() +
  scale_fill_viridis_c(option = "inferno", name = "Inequality\nscore") +
  labs(
    title = "Urban Heat Inequality Priority Map",
    subtitle = "Real Mumbai ward data; higher values indicate greater intervention priority",
    x = "Longitude", y = "Latitude"
  ) +
  theme_minimal(base_size = 11)

ggsave(file.path(output_dir, "urban_heat_inequality_map.png"), heat_map, width = 9, height = 7, dpi = 160)

vulnerability_plot <- ggplot(scores, aes(x = literacy_rate, y = mean_heat_index_c, size = population_density, color = heat_inequality_score)) +
  geom_point(alpha = 0.78) +
  scale_color_viridis_c(option = "plasma", name = "Inequality\nscore") +
  labs(
    title = "Heat Exposure and Literacy Vulnerability",
    subtitle = "Bubble size represents population density",
    x = "Literacy rate (%)", y = "Mean apparent temperature (C)"
  ) +
  theme_minimal(base_size = 11)

ggsave(file.path(output_dir, "heat_vs_literacy.png"), vulnerability_plot, width = 9, height = 7, dpi = 160)
message("Visualizations written to outputs/.")
