-- Novalyte ABM Schema
-- Markets
CREATE TABLE IF NOT EXISTS markets (
  id TEXT PRIMARY KEY,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  metropolitan_area TEXT NOT NULL,
  median_income NUMERIC NOT NULL DEFAULT 0,
  population INTEGER NOT NULL DEFAULT 0,
  affluence_score NUMERIC NOT NULL DEFAULT 0,
  lat NUMERIC NOT NULL DEFAULT 0,
  lng NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Clinics
CREATE TABLE IF NOT EXISTS clinics (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  street TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  country TEXT DEFAULT 'USA',
  phone TEXT,
  email TEXT,
  website TEXT,
  google_place_id TEXT,
  yelp_id TEXT,
  rating NUMERIC,
  review_count INTEGER,
  manager_name TEXT,
  manager_email TEXT,
  owner_name TEXT,
  owner_email TEXT,
  services TEXT[] DEFAULT '{}',
  market_id TEXT REFERENCES markets(id),
  discovered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Decision makers
CREATE TABLE IF NOT EXISTS decision_makers (
  id TEXT PRIMARY KEY,
  clinic_id TEXT REFERENCES clinics(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  title TEXT,
  role TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  confidence NUMERIC DEFAULT 0,
  enriched_at TIMESTAMPTZ,
  source TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CRM Contacts
CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  clinic_id TEXT REFERENCES clinics(id) ON DELETE CASCADE,
  decision_maker_id TEXT REFERENCES decision_makers(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'new',
  priority TEXT NOT NULL DEFAULT 'medium',
  score INTEGER NOT NULL DEFAULT 0,
  tags TEXT[] DEFAULT '{}',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_contacted_at TIMESTAMPTZ,
  next_follow_up TIMESTAMPTZ
);

-- Keyword trends
CREATE TABLE IF NOT EXISTS keyword_trends (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  market_id TEXT REFERENCES markets(id),
  trend_score NUMERIC DEFAULT 0,
  search_volume INTEGER DEFAULT 0,
  growth_rate NUMERIC DEFAULT 0,
  competitor_activity TEXT DEFAULT 'low',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Contact keyword matches junction
CREATE TABLE IF NOT EXISTS contact_keyword_matches (
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  keyword_trend_id TEXT REFERENCES keyword_trends(id) ON DELETE CASCADE,
  PRIMARY KEY (contact_id, keyword_trend_id)
);

-- Activities
CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Voice calls
CREATE TABLE IF NOT EXISTS voice_calls (
  id TEXT PRIMARY KEY,
  contact_id TEXT REFERENCES contacts(id) ON DELETE CASCADE,
  agent_id TEXT,
  start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
  end_time TIMESTAMPTZ,
  duration INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  outcome TEXT,
  transcript TEXT,
  recording_url TEXT,
  sentiment TEXT,
  notes TEXT,
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_date TIMESTAMPTZ
);

-- Campaigns
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  script TEXT DEFAULT '',
  start_date TIMESTAMPTZ,
  end_date TIMESTAMPTZ,
  stats JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_clinics_market ON clinics(market_id);
CREATE INDEX IF NOT EXISTS idx_contacts_clinic ON contacts(clinic_id);
CREATE INDEX IF NOT EXISTS idx_contacts_status ON contacts(status);
CREATE INDEX IF NOT EXISTS idx_contacts_priority ON contacts(priority);
CREATE INDEX IF NOT EXISTS idx_activities_contact ON activities(contact_id);
CREATE INDEX IF NOT EXISTS idx_keyword_trends_market ON keyword_trends(market_id);
CREATE INDEX IF NOT EXISTS idx_voice_calls_contact ON voice_calls(contact_id);

-- RLS
ALTER TABLE markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_makers ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE keyword_trends ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_keyword_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE voice_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- Permissive policies (single-user app)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='markets' AND policyname='allow_all_markets') THEN
    CREATE POLICY allow_all_markets ON markets FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='clinics' AND policyname='allow_all_clinics') THEN
    CREATE POLICY allow_all_clinics ON clinics FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='decision_makers' AND policyname='allow_all_dms') THEN
    CREATE POLICY allow_all_dms ON decision_makers FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contacts' AND policyname='allow_all_contacts') THEN
    CREATE POLICY allow_all_contacts ON contacts FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='keyword_trends' AND policyname='allow_all_kw') THEN
    CREATE POLICY allow_all_kw ON keyword_trends FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='contact_keyword_matches' AND policyname='allow_all_ckm') THEN
    CREATE POLICY allow_all_ckm ON contact_keyword_matches FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='activities' AND policyname='allow_all_activities') THEN
    CREATE POLICY allow_all_activities ON activities FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='voice_calls' AND policyname='allow_all_calls') THEN
    CREATE POLICY allow_all_calls ON voice_calls FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='campaigns' AND policyname='allow_all_campaigns') THEN
    CREATE POLICY allow_all_campaigns ON campaigns FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
