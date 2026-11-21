# 02 — Database Schema, Multi-Tenancy & Authentication (with SMS OTP)

## 1. Multi-Modal Authentication Architecture (`Better-Auth`)

To optimize the Project Charter's critical Developer Experience (DX) metric—**Time to First Successful Integration**—while satisfying enterprise security policies in the UK/EU market, **Linnet Score** implements `Better-Auth` with five unified authentication flows and automatic organization provisioning:

### Supported Authentication Methods
1. **SMS OTP (One-Time Password — `phoneNumber` Plugin)**:
   - **Primary Login & Sign-Up**: Developers or finance admins can sign in using an E.164 phone number (with a UK `+44` default country selector and international support).
   - **Step-Up MFA for High-Risk Dashboard Actions**: Required before rotating or revoking live production keys (`lnt_live_...`), modifying Allowed Origins CORS rules, or increasing monthly hard spend caps (unless verified via WebAuthn Passkey within the last 5 minutes).
   - **Security & Anti-Abuse Controls**:
     - **OTP Format**: 6-digit cryptographically random numeric code (`crypto.randomInt(100000, 999999)`).
     - **TTL & Attempt Cap**: 5-minute expiration; maximum 3 verification attempts per code before automatic invalidation.
     - **Redis Sliding-Window Rate Limit**: Max 3 SMS dispatches per 10 minutes per normalized E.164 phone number and per client IP/subnet to prevent SMS pumping fraud.
     - **Storage**: Only the `SHA-256` hash of the 6-digit OTP is stored in Redis/PostgreSQL; raw OTPs are never logged.
     - **UK/EU Data Residency**: Dispatched via Twilio Verify (`eu1` Dublin/London edge) or Vonage UK with registered sender ID `LinnetScore`.
2. **WebAuthn Passkeys (`passkey` Plugin)**:
   - Hardware-bound FIDO2/WebAuthn biometric authentication (TouchID, FaceID, Windows Hello, YubiKey).
3. **GitHub SSO**:
   - One-click developer onboarding.
4. **Google Workspace SSO**:
   - Enterprise team and billing administrator onboarding.
5. **Email Magic Links**:
   - Passwordless email fallback.

---

## 2. Zero-Friction 60-Second Onboarding & Charter Validation Hook

The moment a user completes initial registration on **Linnet Score** (via SMS OTP, Passkey, GitHub, or Google), a transactional server hook executes:

1. Creates a default `organizations` workspace (`plan_tier = 'sandbox'`, `monthly_page_quota = 50`), recording:
   - `api_terms_accepted_at` (`S-10`, `R-05` UK API & Anti-Resale Terms clickwrap timestamp).
   - `icp_segment` (`D-01`, `S-13` self-selected buyer segment: `edtech`, `publisher`, `sheet_music_platform`, `learning_app`, `other`).
   - `acquisition_channel` & `utm_source` (`R-04` SEO vs. targeted outbound tracking).
2. Binds the user as `role = 'owner'` in `organization_members`.
3. Generates a working Sandbox API key (`lnt_test_<32_random_base62_chars>`).
4. Computes `SHA-256(full_key)` and inserts `key_prefix` + `key_hash` into `api_keys`.
5. Seals the raw `lnt_test_...` key in a short-lived (5-minute, single-read) encrypted session flash token so the user's very first screen in `app/(dashboard)/page.tsx` renders a copy-pasteable `curl` command ready to run in under 60 seconds.

---

## 3. Core PostgreSQL Schema with Row-Level Security (RLS)

Never store raw API keys or raw SMS OTP codes in PostgreSQL. Store only prefixes (for UI identification) and `SHA-256` hashes.

> [!NOTE]
> **Local Development Ports**: `infra/docker-compose.yml` maps host port `5532` $\rightarrow$ container `5432` for PostgreSQL and host port `6479` $\rightarrow$ container `6379` for Redis so Linnet Score avoids conflicts with standard `5432`/`6379` instances.

```sql
-- Enable cryptographic UUID and hashing extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Tenant Organizations (Includes Charter D-01, D-05, D-06, D-08 & S-10 Telemetry)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    -- Charter D-01 & S-13: ICP Validation & Outbound Attribution (R-04)
    icp_segment TEXT CHECK (icp_segment IN ('edtech', 'publisher', 'sheet_music_platform', 'learning_app', 'software_agency', 'other')),
    acquisition_channel TEXT DEFAULT 'direct' CHECK (acquisition_channel IN ('seo', 'outbound', 'referral', 'direct')),
    utm_campaign TEXT,
    -- Charter S-10 & R-05: UK Legal & Anti-Resale Terms Acceptance
    api_terms_accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    oem_reseller_agreement BOOLEAN NOT NULL DEFAULT FALSE,
    -- Charter S-09, D-05, D-06 & R-07: Billing, Flexible Metering & UK VAT
    stripe_customer_id TEXT UNIQUE,
    stripe_subscription_id TEXT,
    uk_vat_number VARCHAR(32),
    plan_tier TEXT NOT NULL DEFAULT 'sandbox' CHECK (plan_tier IN ('sandbox', 'growth', 'enterprise')),
    pricing_metric TEXT NOT NULL DEFAULT 'per_page' CHECK (pricing_metric IN ('per_page', 'per_job')), -- Supports Decision D-05 testing
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

-- 4. SMS OTP Verification Challenges (Hashed OTPs, 5-min TTL)
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

-- 5. API Keys Vault (Deliverable S-02)
CREATE TABLE api_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name TEXT NOT NULL,                       -- e.g., "Production Backend"
    key_prefix VARCHAR(14) NOT NULL,          -- e.g., "lnt_live_8f9a" (displayed in UI)
    key_hash TEXT NOT NULL UNIQUE,            -- SHA-256 hash of the full key
    environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'live')),
    rotated_from_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ,                   -- Used for 24h grace-period key rotation
    last_used_at TIMESTAMPTZ,
    last_used_ip INET,
    last_used_origin TEXT,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. OMR Jobs & Telemetry Ledger (Deliverables S-01, S-03, S-11, D-02, D-05)
CREATE TABLE omr_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    api_key_id UUID REFERENCES api_keys(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    score_category TEXT DEFAULT 'general' CHECK (score_category IN ('solo_piano', 'choral_satb', 'lead_sheet', 'chamber', 'orchestral', 'general')),
    pages_processed INT NOT NULL DEFAULT 1,
    input_format TEXT NOT NULL CHECK (input_format IN ('pdf', 'png', 'jpg')),
    output_format TEXT NOT NULL DEFAULT 'mxl' CHECK (output_format IN ('musicxml', 'mxl')),
    input_s3_key TEXT,                        -- Auto-deleted after 24h (eu-west-2, D-07)
    output_s3_key TEXT,                       -- Auto-deleted after 24h (eu-west-2, D-07)
    processing_time_ms INT,
    confidence_score NUMERIC(4,3),            -- Internal OMR quality confidence (0.000 - 1.000, S-12)
    customer_quality_rating TEXT CHECK (customer_quality_rating IN ('accurate', 'needs_correction')),
    error_code TEXT,                          -- e.g., 'ERR_LOW_DPI_IMAGE', 'ERR_UNSUPPORTED_LAYOUT'
    client_ip INET,
    client_origin TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 7. Webhook Endpoints & SDK Allowed Origins (Mitigating Risk R-05)
CREATE TABLE webhook_endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    signing_secret_prefix VARCHAR(12) NOT NULL, -- e.g., "whsec_4a9c..."
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
```

---

## 4. Row-Level Security (RLS) Enforcement

Every tenant-scoped table enables PostgreSQL RLS so no query can ever leak data across organizations (`R-02`):

```sql
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
```
