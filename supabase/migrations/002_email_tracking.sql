-- Sent emails tracking
CREATE TABLE IF NOT EXISTS sent_emails (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  to_email TEXT NOT NULL,
  from_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  clinic_name TEXT,
  market TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_event TEXT NOT NULL DEFAULT 'sent',
  last_event_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  sequence_step TEXT,
  ai_generated BOOLEAN DEFAULT false
);

-- Webhook events audit log
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB DEFAULT '{}',
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sent_emails_contact ON sent_emails(contact_id);
CREATE INDEX IF NOT EXISTS idx_sent_emails_event ON sent_emails(last_event);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_source ON webhook_events(source);

-- RLS
ALTER TABLE sent_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

DO $ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='sent_emails' AND policyname='allow_all_sent_emails') THEN
    CREATE POLICY allow_all_sent_emails ON sent_emails FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='webhook_events' AND policyname='allow_all_webhook_events') THEN
    CREATE POLICY allow_all_webhook_events ON webhook_events FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $;
