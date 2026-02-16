-- Outreach reply tracking + provider support

-- Track which provider sent a message (resend vs smtp).
ALTER TABLE IF EXISTS sent_emails
  ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'resend';

-- Inbound replies (best-effort matching back to a sent email/contact).
CREATE TABLE IF NOT EXISTS email_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  sent_email_id TEXT REFERENCES sent_emails(id) ON DELETE SET NULL,
  from_email TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT,
  snippet TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  raw JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_email_replies_contact ON email_replies(contact_id);
CREATE INDEX IF NOT EXISTS idx_email_replies_received_at ON email_replies(received_at);

ALTER TABLE email_replies ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'email_replies' AND policyname = 'allow_all_email_replies'
  ) THEN
    CREATE POLICY allow_all_email_replies ON email_replies
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

