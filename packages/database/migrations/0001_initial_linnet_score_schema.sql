-- =============================================================================
-- Linnet Score — B2B OMR API & SDK Platform
-- Migration: 0001_initial_linnet_score_schema.sql
-- Charter Alignment: S-01..S-13, D-01..D-08, R-01..R-07
-- Strict Boundary: Linnet Score (B2B Platform) — excludes Linnet Consumer App (S-17)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tenant Organizations (Includes Charter D-01, D-05, D-06, D-08 & S-10 Telemetry)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    -- Charter D-01 & S-13: ICP Validation & Outbound Attribution (R-04)
    icp_segment TEXT CHECK (icp_segment IN ('edtech', 'publisher', 'sheet_music_platform', 'learning_app', 'software_agency', 'other')),
    acquisition_channel TEXT NOT NULL DEFAULT 'direct' CHECK (acquisition_channel IN ('seo', 'outbound', 'referral', 'direct')),
    utm_campaign TEXT,
    -- Charter S-10 & R-05: UK Legal & Anti-Resale Terms Acceptance
    api_terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    oem_reseller_agreement BOOLEAN NOT NULL DEFAULT FALSE,
    -- Charter S-09, D-05, D-06 & R-07: Billing, Flexible Metering & UK VAT
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    stripe_subscription_status TEXT DEFAULT 'inactive' CHECK (stripe_subscription_status IN ('inactive', 'trialing', 'active', 'past_due', 'canceled')),
    uk_vat_number VARCHAR(32),
    plan_tier TEXT NOT NULL DEFAULT 'sandbox' CHECK (plan_tier IN ('sandbox', 'growth', 'scale', 'enterprise')),
    pricing_metric TEXT NOT NULL DEFAULT 'per_page' CHECK (pricing_metric IN ('per_page', 'per_job')),
    monthly_page_quota INT NOT NULL DEFAULT 50,
    monthly_job_quota INT NOT NULL DEFAULT 50,
    hard_spend_cap_gbp_pence INT,
    -- Charter Critical DX Metric: Time to First Successful Integration
    first_api_call_at TIMESTAMPTZ,
    -- Charter R-03 & S-14: P1 Editing SDK Demand Signal
    requested_editing_sdk_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users (with E.164 Phone & SMS OTP Verification State)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_number VARCHAR(20) UNIQUE,          -- Normalized E.164 format, e.g. '+447700900077'
    phone_number_verified BOOLEAN NOT NULL DEFAULT FALSE,
    full_name TEXT,
    avatar_url TEXT,
    last_step_up_verified_at TIMESTAMPTZ,     -- Timestamp of last SMS OTP or Passkey step-up check
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Organization Memberships (Multi-Tenant Isolation Join)
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'developer' CHECK (role IN ('owner', 'admin', 'developer', 'billing')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, user_id)
);

-- 4. SMS OTP Verification Challenges (Hashed OTPs, 5-min TTL, Max 3 Attempts)
CREATE TABLE sms_otp_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(20) NOT NULL,        -- E.164 target phone number
    otp_hash TEXT NOT NULL,                   -- SHA-256(phone_number || ':' || otp_code || ':' || pepper)
    purpose TEXT NOT NULL CHECK (purpose IN ('signin', 'signup', 'verify_phone', 'step_up_key_rotation')),
    attempts INT NOT NULL DEFAULT 0,          -- Max 3 attempts allowed
    ip_address INET,
    expires_at TIMESTAMPTZ NOT NULL,          -- NOW() + INTERVAL '5 minutes'
    consumed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sms_otp_phone_created ON sms_otp_challenges (phone_number, created_at DESC);

-- 5. API Keys Vault (Deliverable S-02 — Never store raw keys)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,                       -- e.g., "Production Backend"
    key_prefix VARCHAR(16) NOT NULL,          -- e.g., "lnt_live_8f9a" (displayed in UI)
    key_hash TEXT NOT NULL UNIQUE,            -- SHA-256 hex digest of the full key
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
    rotated_from_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,                   -- Used for 24h dual-validity key rotation
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    last_used_origin TEXT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_api_keys_org_id ON api_keys (org_id);
CREATE INDEX idx_api_keys_hash ON api_keys (key_hash);

-- 6. OMR Jobs & Telemetry Ledger (Deliverables S-01, S-03, S-11, D-02, D-05)
CREATE TABLE omr_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    score_category TEXT NOT NULL DEFAULT 'general' CHECK (score_category IN ('solo_piano', 'choral_satb', 'lead_sheet', 'chamber', 'orchestral', 'general')),
    pages_processed INT NOT NULL DEFAULT 1,
    input_format TEXT NOT NULL CHECK (input_format IN ('pdf', 'png', 'jpg')),
    output_format TEXT NOT NULL DEFAULT 'mxl' CHECK (output_format IN ('musicxml', 'mxl')),
    input_s3_key TEXT,                        -- Auto-deleted after 24h in eu-west-2 (D-07)
    output_s3_key TEXT,                       -- Auto-deleted after 24h in eu-west-2 (D-07)
    processing_time_ms INT,
    confidence_score NUMERIC(4,3),            -- OMR quality confidence (0.000 - 1.000, S-12)
    customer_quality_rating TEXT CHECK (customer_quality_rating IN ('accurate', 'needs_correction')),
    error_code TEXT,                          -- e.g., 'ERR_LOW_DPI_IMAGE', 'ERR_UNSUPPORTED_LAYOUT'
    client_ip INET,
    client_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE INDEX idx_omr_jobs_org_created ON omr_jobs (org_id, created_at DESC);

-- 7. Webhook Endpoints & SDK Allowed Origins (Mitigating Risk R-05)
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    signing_secret_prefix VARCHAR(14) NOT NULL, -- e.g., "whsec_4a9c..."
    signing_secret_ciphertext TEXT NOT NULL,    -- KMS/AES-GCM encrypted for HMAC-SHA256 signing
    events TEXT[] NOT NULL DEFAULT ARRAY['omr.job.completed', 'omr.job.failed'],
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sdk_allowed_origins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    origin_pattern TEXT NOT NULL,             -- e.g., 'https://app.conservatoire.ac.uk'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_id, origin_pattern)
);

-- 8. OMR Benchmark Dataset & Quality Baseline (Deliverable S-12 & Risk R-01)
CREATE TABLE omr_benchmark_baselines (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    score_category TEXT NOT NULL CHECK (score_category IN ('solo_piano', 'choral_satb', 'lead_sheet', 'chamber', 'orchestral')),
    support_tier TEXT NOT NULL CHECK (support_tier IN ('p0_supported', 'p0_caveats', 'experimental', 'unsupported')),
    min_recommended_dpi INT NOT NULL DEFAULT 150,
    note_pitch_accuracy_pct NUMERIC(5,2) NOT NULL,
    rhythm_duration_accuracy_pct NUMERIC(5,2) NOT NULL,
    median_latency_ms INT NOT NULL,
    sample_musicxml_path TEXT NOT NULL,
    notes TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO omr_benchmark_baselines (
    id, title, score_category, support_tier, min_recommended_dpi,
    note_pitch_accuracy_pct, rhythm_duration_accuracy_pct, median_latency_ms,
    sample_musicxml_path, notes
) VALUES
    ('bench_piano_chopin_op9_no2', 'Chopin Nocturne Op. 9 No. 2 (Solo Piano)', 'solo_piano', 'p0_supported', 150, 99.20, 98.80, 1380, '/samples/chopin-nocturne-op9-no2.musicxml', 'Clean engraved grand staff piano score with polyphonic voices and pedal markings.'),
    ('bench_choral_bach_bwv244', 'J.S. Bach Chorale SATB (4-Part Vocal)', 'choral_satb', 'p0_supported', 150, 99.40, 99.10, 1290, '/samples/bach-chorale-satb.musicxml', '4-stave choral score with lyrics and standard key/time signatures.'),
    ('bench_leadsheet_autumn_jazz', 'Standard Jazz Lead Sheet (Melody + Chord Symbols)', 'lead_sheet', 'p0_supported', 150, 99.60, 99.30, 940, '/samples/jazz-lead-sheet.musicxml', 'Single-line melody with chord symbols and repeat barlines.'),
    ('bench_chamber_quartet_mozart', 'String Quartet in G Major K. 387 (Chamber)', 'chamber', 'p0_caveats', 200, 97.80, 97.40, 1850, '/samples/mozart-quartet-k387.musicxml', '4-part chamber score; requires >=200 DPI for dense ledger lines.');

-- 9. Row-Level Security (RLS — Deliverable S-02 & Risk R-02)
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE omr_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE sdk_allowed_origins ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_api_keys ON api_keys
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY tenant_isolation_omr_jobs ON omr_jobs
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY tenant_isolation_webhooks ON webhook_endpoints
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY tenant_isolation_origins ON sdk_allowed_origins
    USING (org_id = current_setting('app.current_org_id', true)::uuid);

-- 10. Charter Success Criteria Telemetry View (Decision D-08)
CREATE VIEW charter_kpi_summary AS
SELECT
    COUNT(*) FILTER (WHERE stripe_subscription_status = 'active' AND plan_tier IN ('growth', 'scale', 'enterprise')) AS paying_b2b_customers,
    COUNT(*) AS total_organizations,
    ROUND(
        100.0 * COUNT(*) FILTER (WHERE stripe_subscription_status = 'active') / NULLIF(COUNT(*), 0),
        2
    ) AS trial_to_paid_conversion_pct,
    ROUND(
        AVG(EXTRACT(EPOCH FROM (first_api_call_at - created_at))) FILTER (WHERE first_api_call_at IS NOT NULL),
        1
    ) AS avg_seconds_to_first_integration,
    COUNT(*) FILTER (WHERE requested_editing_sdk_at IS NOT NULL) AS p1_editing_sdk_demand_signals
FROM organizations;

