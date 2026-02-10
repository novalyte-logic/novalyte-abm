-- Real-time page events for landing page analytics
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS page_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Session identification
  session_id TEXT NOT NULL,
  
  -- Event data
  event_type TEXT NOT NULL, -- page_view, quiz_start, quiz_progress, quiz_complete, lead_capture, clinic_click, dropoff
  event_data JSONB DEFAULT '{}',
  
  -- Attribution
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_term TEXT,
  utm_content TEXT,
  gclid TEXT,
  referrer TEXT,
  landing_page TEXT,
  
  -- Geo
  geo_city TEXT,
  geo_state TEXT,
  geo_zip TEXT,
  geo_country TEXT,
  
  -- Device
  device_type TEXT, -- mobile, tablet, desktop
  browser TEXT,
  os TEXT,
  screen_width INT,
  screen_height INT,
  
  -- Timing
  time_on_page INT -- seconds since session start
);

-- Index for fast queries
CREATE INDEX IF NOT EXISTS idx_page_events_created_at ON page_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_events_session_id ON page_events(session_id);
CREATE INDEX IF NOT EXISTS idx_page_events_event_type ON page_events(event_type);
CREATE INDEX IF NOT EXISTS idx_page_events_utm_source ON page_events(utm_source);
CREATE INDEX IF NOT EXISTS idx_page_events_gclid ON page_events(gclid);

-- Enable real-time for this table
ALTER PUBLICATION supabase_realtime ADD TABLE page_events;

-- RLS: Allow anonymous inserts (landing page), authenticated reads (dashboard)
ALTER TABLE page_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous inserts" ON page_events
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "Allow authenticated reads" ON page_events
  FOR SELECT TO authenticated USING (true);

-- Also allow anon to read for now (simpler setup)
CREATE POLICY "Allow anon reads" ON page_events
  FOR SELECT TO anon USING (true);
