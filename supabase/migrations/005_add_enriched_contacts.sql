-- Add enriched_contacts JSONB column to clinics table
-- Stores all decision maker contacts found via Apollo/NPI/email intel enrichment
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS enriched_contacts JSONB;

-- Add email verification columns to decision_makers table
ALTER TABLE decision_makers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE decision_makers ADD COLUMN IF NOT EXISTS email_verification_status TEXT;
