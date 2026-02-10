-- Add missing columns for device tracking, contact preferences, and voice transcripts
-- These columns are written by intel-landing (ads.novalyte.io) and read by the ABM dashboard

ALTER TABLE leads ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_preference TEXT[];
ALTER TABLE leads ADD COLUMN IF NOT EXISTS voice_transcript TEXT;
