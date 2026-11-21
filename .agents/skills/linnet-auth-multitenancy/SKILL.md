---
name: linnet-auth-multitenancy
description: >-
  Use this skill when implementing or modifying authentication, SMS OTP verification,
  WebAuthn Passkeys, OAuth (GitHub/Google), organization workspaces, zero-friction
  sandbox provisioning, step-up MFA, or PostgreSQL Row-Level Security (RLS) in Linnet Score.
---

# Linnet Score Multi-Modal Authentication & RLS Multi-Tenancy Skill

Follow this runbook when building authentication flows, SMS OTP verification, step-up MFA, or tenant-isolated database queries in **Linnet Score**.

## 1. Better-Auth Configuration (OAuth + Passkeys + SMS OTP)

Configure `Better-Auth` in `apps/web/lib/auth.ts` with the following plugins:
1. `organization()`: Manages `organizations` and `organization_members` (`owner`, `admin`, `developer`, `billing`).
2. `passkey()`: Enables WebAuthn / FIDO2 hardware biometric login.
3. `phoneNumber()`: Enables **SMS OTP (One-Time Password)** sign-in, sign-up, and phone verification.
4. `magicLink()`: Passwordless email sign-in fallback.
5. Social providers: `github` and `google`.

### SMS OTP Security & Rate-Limiting Protocol
Whenever implementing or modifying `sendOTP` and `verifyOTP`:
1. **E.164 Normalization**: Parse and validate phone numbers to strict E.164 format (e.g., `+447700900077`) using `libphonenumber-js`. Default the UI country selector to `GB (+44)`.
2. **Redis Rate Limit (Anti-SMS-Pumping)**:
   - Enforce max **3 OTP sends per 10 minutes** per `phone_number` AND per client IP address (`otp:rl:phone:{e164}` and `otp:rl:ip:{ip}`).
3. **Cryptographic OTP Generation & Hashing**:
   - Generate a 6-digit code via `crypto.randomInt(100000, 999999).toString()`.
   - Never store or log the raw OTP. Store `SHA-256(phone_number + ":" + otp + ":" + process.env.AUTH_OTP_PEPPER)` in `sms_otp_challenges` (or Redis) with a **5-minute TTL** and `attempts = 0` (max 3 attempts).
4. **UK/EU SMS Delivery (`eu-west-2` / `eu1`)**:
   - Dispatch via Twilio Verify (`eu1` Dublin/London edge) or Vonage UK API using sender ID `LinnetScore`.

## 2. Step-Up Verification for Sensitive Production Actions

Require a fresh (`< 5 minutes` old) step-up verification (`last_step_up_verified_at`) via **SMS OTP** or **WebAuthn Passkey** before executing:
- Creating, rotating, or revoking a `live` API key (`lnt_live_...`).
- Removing or wildcarding `sdk_allowed_origins`.
- Increasing `hard_spend_cap_gbp_pence` in `/billing`.

## 3. Zero-Friction 60-Second Onboarding & Charter Validation Hook

On a user's first registration (`afterUserCreate` hook):
1. Within a single PostgreSQL transaction:
   - Insert default organization into `organizations` (`plan_tier = 'sandbox'`, `monthly_page_quota = 50`, `monthly_job_quota = 50`, `api_terms_accepted_at = NOW()`, plus optional `icp_segment` and `acquisition_channel` per Charter `D-01`, `S-10`, `S-13`).
   - Insert `organization_members` (`role = 'owner'`).
   - Generate raw key `lnt_test_<32_base62_chars>`, extract `key_prefix` (`lnt_test_` + first 4 chars), and compute `key_hash = SHA-256(raw_key)`.
   - Insert into `api_keys` (`environment = 'sandbox'`).
2. Store the one-time `raw_key` in an encrypted, single-read HTTP-only flash cookie or Redis key (`onboarding:flash:{user_id}`, TTL `300s`) so the dashboard overview immediately populates the copyable `curl` command.

## 4. PostgreSQL Row-Level Security (RLS) Wrapper

Never run tenant queries without setting the transaction-local `org_id`. Use a helper wrapper for all database queries:

```typescript
export async function withTenantOrg<T>(orgId: string, fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
    return fn(tx);
  });
}
```

## 5. Reference Specification

See [docs/02-database-and-auth-spec.md](../../../docs/02-database-and-auth-spec.md) for the complete SQL DDL and RLS policy definitions.
