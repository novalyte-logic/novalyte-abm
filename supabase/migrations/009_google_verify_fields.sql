-- Google verification fields (official website + confirmed contact email)
-- Used by the ABM UI "Verify with Google" feature.

ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS google_verify_status TEXT,
  ADD COLUMN IF NOT EXISTS google_verify_official_website TEXT,
  ADD COLUMN IF NOT EXISTS google_verify_confirmed_email TEXT,
  ADD COLUMN IF NOT EXISTS google_verify_found_emails TEXT[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS google_verify_checked_at TIMESTAMPTZ;

