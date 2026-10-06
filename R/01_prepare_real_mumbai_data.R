# Download and prepare real Mumbai ward demographics, geometry, and weather inputs.

if (!requireNamespace("jsonlite", quietly = TRUE)) stop("jsonlite is required. Install it with install.packages('jsonlite').")
if (!requireNamespace("httr", quietly = TRUE)) stop("httr is required. Install it with install.packages('httr').")

library(jsonlite)
library(httr)

project_root <- normalizePath(getwd(), winslash = "/", mustWork = TRUE)
raw_dir <- file.path(project_root, "data", "raw")
dir.create(raw_dir, recursive = TRUE, showWarnings = FALSE)

census_url <- "https://raw.githubusercontent.com/mickeykedia/Mumbai-Population-Map/refs/heads/master/ward_level_collated.csv"
geojson_url <- "https://raw.githubusercontent.com/sanjanakrishnan/mumbai_spatial_data/refs/heads/main/BMC_admin_wards.geojson"
weather_url <- "https://archive-api.open-meteo.com/v1/archive"

census_file <- file.path(raw_dir, "mumbai_ward_demographics.csv")
geojson_file <- file.path(raw_dir, "mumbai_wards.geojson")
download.file(census_url, census_file, mode = "wb", quiet = TRUE)
download.file(geojson_url, geojson_file, mode = "wb", quiet = TRUE)

census <- read.csv(census_file, stringsAsFactors = FALSE)
census$ward_code <- toupper(trimws(as.character(census$Ward_Alphabet)))
census <- census[!is.na(census$ward_code) & census$ward_code != "NAN", ]

geo <- fromJSON(geojson_file, simplifyVector = FALSE)
property_keys <- c("NAME", "WARDNAME", "WARD_NAME", "Ward", "ward", "name")
flatten_points <- function(value, output = list()) {
  if (length(value) == 0) return(output)
  if (is.numeric(value[[1]])) return(append(output, list(unlist(value))))
  for (child in value) output <- flatten_points(child, output)
  output
}

centroids <- do.call(rbind, lapply(geo$features, function(feature) {
  properties <- feature$properties
  label <- NA_character_
  for (key in property_keys) {
    if (!is.null(properties[[key]]) && nzchar(as.character(properties[[key]]))) {
      label <- toupper(trimws(as.character(properties[[key]])))
      break
    }
  }
  points <- flatten_points(feature$geometry$coordinates)
  if (is.na(label) || length(points) == 0) return(NULL)
  coordinates <- do.call(rbind, points)
  data.frame(ward_code = label, longitude = mean(coordinates[, 1]), latitude = mean(coordinates[, 2]))
}))
centroids <- centroids[!duplicated(centroids$ward_code), ]
wards <- merge(census, centroids, by = "ward_code")
if (nrow(wards) < 10) stop("Could not match the Census ward codes to the Mumbai ward boundaries.")

weather_query <- list(
  latitude = paste(sprintf("%.6f", wards$latitude), collapse = ","),
  longitude = paste(sprintf("%.6f", wards$longitude), collapse = ","),
  start_date = "2024-04-01",
  end_date = "2024-05-31",
  hourly = "temperature_2m,relative_humidity_2m,apparent_temperature",
  timezone = "Asia/Kolkata"
)
weather_response <- GET(weather_url, query = weather_query)
stop_for_status(weather_response)
weather_payload <- fromJSON(content(weather_response, "text", encoding = "UTF-8"), simplifyVector = FALSE)
if (!is.list(weather_payload[[1]])) weather_payload <- list(weather_payload)

weather_rows <- do.call(rbind, lapply(seq_along(weather_payload), function(index) {
  apparent <- as.numeric(unlist(weather_payload[[index]]$hourly$apparent_temperature))
  if (length(apparent) == 0) stop("Historical weather response did not include apparent temperature.")
  data.frame(
    ward_code = wards$ward_code[index],
    mean_heat_index_c = mean(apparent, na.rm = TRUE),
    peak_heat_index_c = max(apparent, na.rm = TRUE),
    heat_event_observations = sum(apparent >= 35, na.rm = TRUE),
    observation_count = sum(!is.na(apparent))
  )
}))

wards$population <- as.numeric(wards$TOT_P)
wards$population_density <- as.numeric(wards$TOT_P_DEN)
wards$child_pct <- 100 * as.numeric(wards$P_06) / wards$population
wards$literacy_rate <- 100 * as.numeric(wards$P_LIT) / wards$population
wards$ward_name <- ifelse(is.na(wards$Ward_Names), wards$ward_code, wards$Ward_Names)
ward_inputs <- wards[, c("ward_code", "ward_name", "latitude", "longitude", "population", "population_density", "child_pct", "literacy_rate")]

write.csv(ward_inputs, file.path(raw_dir, "mumbai_ward_demographics.csv"), row.names = FALSE)
write.csv(weather_rows, file.path(raw_dir, "mumbai_weather.csv"), row.names = FALSE)
writeLines(toJSON(list(census = census_url, geometry = geojson_url, weather = weather_url), auto_unbox = TRUE, pretty = TRUE), file.path(raw_dir, "data_sources.json"))
message(sprintf("Prepared real Mumbai data for %s wards and %s weather observations.", nrow(ward_inputs), sum(weather_rows$observation_count)))
