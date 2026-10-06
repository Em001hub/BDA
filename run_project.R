# Run the complete Urban Heat Inequality Intelligence System.

project_root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)

source(file.path(project_root, "R", "01_prepare_real_mumbai_data.R"), local = TRUE)
source(file.path(project_root, "R", "02_spark_heat_pipeline.R"), local = TRUE)
source(file.path(project_root, "R", "03_visualize_results.R"), local = TRUE)

message("Urban Heat Inequality Intelligence System complete.")
