-- Persistent Smart Verification Workflow
-- Queue + controls + fallback enrollment storage

-- 1) Clinic verification state
ALTER TABLE clinics
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'Ready',
  ADD COLUMN IF NOT EXISTS verification_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- 2) Queue control (singleton row)
CREATE TABLE IF NOT EXISTS verification_queue_control (
  id TEXT PRIMARY KEY DEFAULT 'global',
  is_paused BOOLEAN NOT NULL DEFAULT false,
  emergency_stop BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT
);

INSERT INTO verification_queue_control (id, is_paused, emergency_stop)
VALUES ('global', false, false)
ON CONFLICT (id) DO NOTHING;

-- 3) Verification jobs (DB-backed queue)
CREATE TABLE IF NOT EXISTS verification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'processing',
    'awaiting_webhook',
    'completed_success',
    'completed_fallback',
    'failed',
    'cancelled'
  )),
  call_id TEXT,
  call_status TEXT,
  outcome_reason TEXT,
  call_result JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_by TEXT,
  locked_at TIMESTAMPTZ,
  dispatched_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_status_next_attempt
  ON verification_jobs(status, next_attempt_at, priority DESC, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_clinic
  ON verification_jobs(clinic_id);

CREATE INDEX IF NOT EXISTS idx_verification_jobs_call_id
  ON verification_jobs(call_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_verification_jobs_active_per_clinic
  ON verification_jobs(clinic_id)
  WHERE status IN ('pending', 'processing', 'awaiting_webhook');

-- 4) Email fallback enrollment audit
CREATE TABLE IF NOT EXISTS verification_sequence_enrollments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID REFERENCES verification_jobs(id) ON DELETE SET NULL,
  clinic_id TEXT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  campaign TEXT NOT NULL DEFAULT 'onboarding_drip',
  email TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_verif_seq_enroll_campaign_status
  ON verification_sequence_enrollments(campaign, status, created_at DESC);

-- 5) Updated-at triggers
CREATE OR REPLACE FUNCTION set_verification_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verification_jobs_updated_at ON verification_jobs;
CREATE TRIGGER trg_verification_jobs_updated_at
BEFORE UPDATE ON verification_jobs
FOR EACH ROW EXECUTE FUNCTION set_verification_updated_at();

DROP TRIGGER IF EXISTS trg_verification_queue_control_updated_at ON verification_queue_control;
CREATE TRIGGER trg_verification_queue_control_updated_at
BEFORE UPDATE ON verification_queue_control
FOR EACH ROW EXECUTE FUNCTION set_verification_updated_at();

DROP TRIGGER IF EXISTS trg_verification_sequence_enrollments_updated_at ON verification_sequence_enrollments;
CREATE TRIGGER trg_verification_sequence_enrollments_updated_at
BEFORE UPDATE ON verification_sequence_enrollments
FOR EACH ROW EXECUTE FUNCTION set_verification_updated_at();

-- 6) Claim function for workers (skip locked = safe concurrency)
CREATE OR REPLACE FUNCTION claim_verification_jobs(p_worker TEXT, p_batch INTEGER DEFAULT 10)
RETURNS SETOF verification_jobs
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  paused_state BOOLEAN;
BEGIN
  SELECT is_paused INTO paused_state
  FROM verification_queue_control
  WHERE id = 'global';

  IF COALESCE(paused_state, false) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT v.id
    FROM verification_jobs v
    WHERE v.status = 'pending'
      AND v.next_attempt_at <= now()
    ORDER BY v.priority DESC, v.created_at ASC
    LIMIT GREATEST(p_batch, 1)
    FOR UPDATE SKIP LOCKED
  ), updated AS (
    UPDATE verification_jobs v
    SET
      status = 'processing',
      locked_by = p_worker,
      locked_at = now(),
      attempts = v.attempts + 1,
      updated_at = now()
    FROM picked p
    WHERE v.id = p.id
    RETURNING v.*
  )
  SELECT * FROM updated;
END;
$$;

-- 7) Clear queue function (kill switch helper)
CREATE OR REPLACE FUNCTION clear_pending_verification_jobs(p_clinic_ids TEXT[] DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  affected_count INTEGER := 0;
BEGIN
  WITH target AS (
    SELECT id, clinic_id
    FROM verification_jobs
    WHERE status IN ('pending', 'processing', 'awaiting_webhook')
      AND (p_clinic_ids IS NULL OR clinic_id = ANY(p_clinic_ids))
  ), updated AS (
    UPDATE verification_jobs v
    SET
      status = 'cancelled',
      outcome_reason = 'Cleared by operator',
      completed_at = now(),
      updated_at = now()
    FROM target t
    WHERE v.id = t.id
    RETURNING t.clinic_id
  )
  SELECT COUNT(*) INTO affected_count FROM updated;

  UPDATE clinics
  SET
    verification_status = 'Ready',
    verification_updated_at = now()
  WHERE (p_clinic_ids IS NULL OR id = ANY(p_clinic_ids));

  RETURN affected_count;
END;
$$;

-- 8) RLS + permissive policies to match existing project pattern
ALTER TABLE verification_queue_control ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_sequence_enrollments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_queue_control' AND policyname = 'allow_all_verification_queue_control'
  ) THEN
    CREATE POLICY allow_all_verification_queue_control ON verification_queue_control
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_jobs' AND policyname = 'allow_all_verification_jobs'
  ) THEN
    CREATE POLICY allow_all_verification_jobs ON verification_jobs
      FOR ALL USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'verification_sequence_enrollments' AND policyname = 'allow_all_verification_sequence_enrollments'
  ) THEN
    CREATE POLICY allow_all_verification_sequence_enrollments ON verification_sequence_enrollments
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
