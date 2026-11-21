---
name: linnet-api-gateway
description: >-
  Use this skill when building or modifying the Linnet Score Go API Gateway (`apps/gateway`),
  SHA-256 API key validation, Redis sliding-window rate limiting and quota checks,
  `eu-west-2` S3/R2 ephemeral file handling, OMR benchmark validation, Stripe metered
  billing events, or HMAC-SHA256 customer webhooks.
---

# Linnet Score Go API Gateway & Control Plane Skill

> [!IMPORTANT]
> **Platform Boundary**: The Go Gateway is the commercial distribution layer (auth, rate limiting, S3 ephemeral storage, Stripe metering). It does **not** process OMR or synthesize audio internally; it proxies requests to the existing isolated OMR execution engine (`Linnet`) and returns notation data (`.musicxml`/`.mxl`).

Follow this skill when working on `apps/gateway` (`api.linnet.dev/v1`). The gateway isolates the internal Core IP OMR Execution Plane (shared with the **Linnet** engine) from external B2B traffic while guaranteeing `<2ms` auth/quota overhead (`R-02`, `R-06`).

## 1. API Key Format & SHA-256 Validation (`S-02`, `S-03`)

- **Key Formats**:
  - Sandbox: `lnt_test_<32_base62_chars>`
  - Production: `lnt_live_<32_base62_chars>`
- **Validation Steps**:
  1. Extract bearer token from `Authorization: Bearer <token>`.
  2. Validate prefix (`lnt_test_` or `lnt_live_`) and length before hashing.
  3. Compute `hash := sha256.Sum256([]byte(token))` and hex-encode.
  4. Execute the atomic Redis Lua script to verify key status (including 24h rotation grace window `expires_at`), sliding-window rate limit, and monthly page/job quota (`monthly_page_quota`, `monthly_job_quota`).
  5. On an organization's first successful call (`first_api_call_at IS NULL`), asynchronously record `first_api_call_at = NOW()` to measure the Charter's **Time to First Successful Integration** metric.

## 2. Multipart Upload & `eu-west-2` GDPR Lifecycle (`D-07`, `R-01`)

1. Enforce `http.MaxBytesReader` (`25 MB` max payload).
2. Inspect the first 512 bytes with `http.DetectContentType` to allow only:
   - `application/pdf`
   - `image/png`
   - `image/jpeg`
3. Check image resolution / DPI headers where applicable; return structured JSON error codes (`S-11`, `R-01`):
   ```json
   {
     "error": {
       "code": "ERR_LOW_DPI_IMAGE",
       "message": "Input image resolution is below the 150 DPI minimum required for reliable OMR notation extraction.",
       "doc_url": "https://linnet.dev/docs/errors#ERR_LOW_DPI_IMAGE"
     }
   }
   ```
4. Stream validated files directly to the `eu-west-2` S3/R2 bucket under `inputs/{org_id}/{job_id}.{ext}`. Ensure the bucket's 24-hour `Expiration` lifecycle policy is active.

## 3. Flexible Stripe Metered Events (`S-09`, `D-05`) & HMAC-SHA256 Webhooks

1. When a worker marks a job `completed`:
   - Increment both `usage:pages:{org_id}:{YYYY-MM}` (by `pages_processed`) and `usage:jobs:{org_id}:{YYYY-MM}` (by `1`) so per-page and per-job pricing models (`D-05`) are both supported.
   - For `live` keys, emit a Stripe Billing Meter Event matching the organization's `pricing_metric` (`omr_pages_processed` or `omr_jobs_processed`) with idempotency key `job_id`.
2. For each active `webhook_endpoints` row matching the organization:
   - Compute `mac := hmac.New(sha256.New, signingSecret)` over `fmt.Sprintf("%d.%s", timestamp, payloadBytes)`.
   - Send header `Linnet-Signature: t=<timestamp>,v1=<hex(mac)>`.

## 4. Reference Specification

- **Local Development Ports**: Gateway defaults to `8180` (`PORT` env override), Web Control Plane CORS origin defaults to `http://localhost:3100`, PostgreSQL runs on host port `5532` (container `5432`), and Redis runs on host port `6479` (container `6379`).
- See [docs/04-api-gateway-and-webhooks.md](../../../docs/04-api-gateway-and-webhooks.md) for endpoint contracts and architecture details.
