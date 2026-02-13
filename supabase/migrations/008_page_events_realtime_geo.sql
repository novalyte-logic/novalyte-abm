-- Real-time geo enhancements for sub-second traffic map updates
ALTER TABLE page_events
  ADD COLUMN IF NOT EXISTS geo_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS geo_lng DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_page_events_geo_lat_lng
  ON page_events(geo_lat, geo_lng);
