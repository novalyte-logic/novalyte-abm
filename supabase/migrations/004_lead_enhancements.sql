-- Lead enhancements: device tracking, contact preferences, voice transcripts
-- Run in Supabase Dashboard SQL Editor (CLI is on a different account)

ALTER TABLE leads ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_preference TEXT[] DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS voice_transcript TEXT;

-- Index for device type filtering
CREATE INDEX IF NOT EXISTS idx_leads_device ON leads(device_type);
