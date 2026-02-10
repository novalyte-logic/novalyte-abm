-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 006: Fix Missing Columns
-- Run this in Supabase Dashboard SQL Editor: https://supabase.com/dashboard/project/zatsxsaetybdyzhxbnnj/sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Add missing columns to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS device_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contact_preference TEXT[];
ALTER TABLE leads ADD COLUMN IF NOT EXISTS voice_transcript TEXT;

-- Index for device type filtering
CREATE INDEX IF NOT EXISTS idx_leads_device ON leads(device_type);

-- 2. Add missing columns to decision_makers table
ALTER TABLE decision_makers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE decision_makers ADD COLUMN IF NOT EXISTS email_verification_status TEXT;

-- 3. Add missing column to clinics table
ALTER TABLE clinics ADD COLUMN IF NOT EXISTS enriched_contacts JSONB;

-- 4. Verify the changes
SELECT 'leads' as table_name, column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'leads' AND column_name IN ('device_type', 'contact_preference', 'voice_transcript')
UNION ALL
SELECT 'decision_makers', column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'decision_makers' AND column_name IN ('email_verified', 'email_verification_status')
UNION ALL
SELECT 'clinics', column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'clinics' AND column_name = 'enriched_contacts';
