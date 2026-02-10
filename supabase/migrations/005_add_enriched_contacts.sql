-- Add enriched_contacts JSONB column to clinics table
-- Stores all decision maker contacts found via Apollo/NPI/email intel enrichment
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS enriched_contacts JSONB;
