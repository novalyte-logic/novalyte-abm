-- Patient leads from assessment platform (ads.novalyte.io)
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Contact Information
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  zip_code TEXT NOT NULL DEFAULT '',
  website TEXT DEFAULT '',
  source TEXT DEFAULT '',

  -- Treatment Selection
  treatment TEXT NOT NULL DEFAULT 'general',

  -- TRT Questionnaire
  trt_primary_concern TEXT,
  trt_energy_levels TEXT,
  trt_previous_therapy TEXT,

  -- GLP-1 Weight Loss Questionnaire
  glp1_weight_goal TEXT,
  glp1_previous_medications TEXT,
  glp1_metabolic_indicators TEXT,

  -- Peptide Therapy Questionnaire
  peptide_optimization_area TEXT,
  peptide_injectable_experience TEXT,

  -- Longevity Questionnaire
  longevity_success_definition TEXT,
  longevity_diagnostics_interest TEXT,

  -- Sexual Wellness Questionnaire
  sexual_primary_concern TEXT,
  sexual_duration TEXT,

  -- Common Questions
  financial_readiness TEXT,
  timeline TEXT,

  -- AI Analysis Results
  analysis_result JSONB,
  match_score INTEGER,
  urgency TEXT,
  eligibility_status TEXT DEFAULT 'qualified',

  -- Lead Management
  status TEXT NOT NULL DEFAULT 'new',
  notes TEXT,
  assigned_clinic TEXT,
  follow_up_date TIMESTAMPTZ,

  -- Raw Data Backup
  answers_raw JSONB DEFAULT '{}',

  -- UTM Tracking
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  ip_address TEXT,
  user_agent TEXT
);

-- Indexes for dashboard queries
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_treatment ON leads(treatment);
CREATE INDEX IF NOT EXISTS idx_leads_zip ON leads(zip_code);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_score ON leads(match_score DESC);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);

-- RLS
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='leads' AND policyname='allow_all_leads') THEN
    CREATE POLICY allow_all_leads ON leads FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_leads_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_leads_updated_at();
