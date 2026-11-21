# 04 — Go API Gateway, Rate Limiting, Benchmark Baseline & Webhooks

The **Linnet Score** API Gateway (`apps/gateway`) is built in Go (`net/http` + `go-chi/chi/v5`) and deployed in `eu-west-2` (London). It enforces a strict security and versioning boundary (`R-02`, `R-06`) between external B2B integrations and the internal Core IP OMR Execution Plane shared with the **Linnet** engine.

> [!NOTE]
> **Local Development Defaults**: By default, the Go gateway listens on `http://localhost:8180` (configurable via `PORT`), seeds `http://localhost:3100` in the demo tenant's CORS `AllowedOrigins`, and expects local Docker Redis on `localhost:6479`.

---

## 1. Public API Endpoints (`v1` Contract — `S-01`)

| Method | Path | Description |
| :--- | :--- | :--- |
| `POST` | `/v1/omr/jobs` | Submit a sheet music file (`pdf`, `png`, `jpg`) or URL for asynchronous or synchronous OMR digitization into `.mxl` or `.musicxml` (`D-02`). |
| `GET` | `/v1/omr/jobs/{job_id}` | Poll job status, processing telemetry, confidence score, and signed 24-hour download URLs for `.mxl` / `.musicxml`. |
| `GET` | `/v1/omr/jobs/{job_id}/score` | Stream the digitized `.mxl` or `.musicxml` payload directly into `<linnet-score-player>` (validates CORS `Origin` against `sdk_allowed_origins`). |
| `GET` | `/v1/usage` | Retrieve current billing period quota usage (pages & jobs), remaining quota, and rate-limit headers (`S-03`). |

---

## 2. Sub-2ms Authentication, Quota & DX Telemetry Pipeline (Redis Lua Script)

When a client sends `Authorization: Bearer lnt_live_...` or `lnt_test_...`:

1. **Key Hashing (`S-02`)**: The Go gateway computes `sha256.Sum256([]byte(rawToken))` in memory (`<5µs`).
2. **Atomic Redis Check (`<2ms`, `S-03`)**: Executes a single atomic Redis Lua script that:
   - Resolves `key_hash -> {org_id, key_id, env, status, expires_at, rpm_limit, monthly_page_quota, monthly_job_quota, pricing_metric}`.
   - Rejects revoked or expired keys with `401 Unauthorized`.
   - Evaluates a sliding-window rate limiter (`ZREMRANGEBYSCORE` + `ZCARD` on `rl:{org_id}:{window}`) and returns `429 Too Many Requests` with `Retry-After` if exceeded.
   - Evaluates monthly consumption (`usage:pages:{org_id}:{YYYY-MM}` and `usage:jobs:{org_id}:{YYYY-MM}`) against the organization's quota and `hard_spend_cap_gbp_pence`.
3. **Time to First Successful Integration Telemetry (Charter DX Metric)**:
   - On an organization's very first successful API call (`first_api_call_at IS NULL`), the gateway asynchronously sets `organizations.first_api_call_at = NOW()` so the control plane records exact signup-to-integration time.
4. **Anti-Resale Telemetry (`R-05`, `S-10`)**:
   - Captures `Origin`, `Referer`, `User-Agent`, and client IP ASN asynchronously to detect anomalous multi-domain API wrapping or unauthorized resale patterns.

---

## 3. Multipart File Validation & Ephemeral UK Storage (`D-07`, `R-01`)

1. **Streaming Magic-Byte & Quality Inspection**:
   - Reads the first 512 bytes (`http.DetectContentType`) to verify genuine `application/pdf`, `image/png`, or `image/jpeg` payloads (max 25 MB per file, max 50 pages per PDF).
   - Rejects malformed or low-resolution images early with structured error diagnostics (`S-11`, `R-01`):
     - `ERR_LOW_DPI_IMAGE`: Image resolution below 150 DPI minimum.
     - `ERR_UNSUPPORTED_LAYOUT`: Non-standard graphic or handwritten layout outside `P0` supported benchmarks.
     - `ERR_INVALID_MIME_TYPE`: Unsupported file container.
2. **Encrypted `eu-west-2` S3/R2 Upload (`D-07`)**:
   - Streams the validated input to `s3://linnet-score-ephemeral-eu-west-2/inputs/{org_id}/{job_id}.{ext}` with `SSE-S3` / `SSE-KMS` encryption.
   - Bucket lifecycle rules enforce **automatic permanent deletion 24 hours after object creation** for strict UK GDPR compliance.

---

## 4. OMR Benchmark Dataset & Quality Baseline (`S-12`, `R-01`)

Before publishing external accuracy claims, `packages/database/benchmarks` and `apps/gateway/cmd/benchmark` maintain a repeatable OMR evaluation suite across four segmented categories:

1. **Tier 1 (P0 Core Supported)**: Clean engraved *Solo Piano*, *Choral SATB*, and *Single-Line Lead Sheets* (`>= 150 DPI` PDF/PNG).
2. **Tier 2 (P0 Supported with Minor Caveats)**: Standard *Chamber Music* scores (2–4 staves per system).
3. **Tier 3 (Experimental / Flagged in Docs)**: Full orchestral condensed scores and vintage scanned prints.
4. **Out of Scope (`R-01`)**: Dense handwritten manuscripts and non-Western graphic notation.

---

## 5. Flexible Stripe Metered Billing (`S-09`, `D-05`) & HMAC-SHA256 Webhooks

Upon job completion from the internal OMR Execution Plane:

1. **Stripe Billing Meter Event (`S-09`, `D-05`)**:
   - Supports testing both per-page and per-job commercial models (`organizations.pricing_metric`): emits idempotent Stripe Meter Events (`omr_pages_processed` and `omr_jobs_processed`) keyed by `job_id`.
2. **Signed Customer Webhook Delivery**:
   - Constructs the JSON payload (`omr.job.completed` or `omr.job.failed`).
   - Signs the payload using the tenant's webhook secret:
     `Linnet-Signature: t=<unix_timestamp>,v1=<hmac_sha256(timestamp + "." + body)>`
   - Delivers with exponential backoff (up to 5 retries over 6 hours) and logs HTTP status codes for inspection in `app/(dashboard)/logs`.
