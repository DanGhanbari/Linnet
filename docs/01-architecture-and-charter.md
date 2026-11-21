# 01 — Architecture & Project Charter v1.0 Alignment

> [!IMPORTANT]
> ### 🏛️ Platform Boundary & Scope Mandate
> 1. **Do NOT build or rewrite an OMR / sound backend**: The proprietary sheet-music-to-sound recognition engine was **already built** by the engineering team. It runs isolated in the private Core IP Execution Plane.
> 2. **Do NOT generate server-side audio streams (MP3/WAV)**: The API Gateway returns recognized notation (`.musicxml` / `.mxl`). Audio synthesis is handled purely **client-side in the browser** by the `<linnet-score-player>` Web Audio synthesizer.
> 3. **What this repository builds**: The commercial platform, Go API Gateway (`api.linnet.dev/v1`), Stripe metered billing, PostgreSQL RLS multi-tenancy, Developer Portal, School/Educator Studio, and the embeddable Web Component SDK.

## 1. Project Identity & Unified Product Ecosystem

- **Technological Heritage (`notavaa.com`)**: Our engineering team has already developed **NoteAva ([notavaa.com](https://notavaa.com/))**, a sheet-music recognition and practice platform where musicians and students take a photo of paper sheet music and immediately hear how the melody, timing, and intervals sound.
- **Global Brand Evolution (`Linnet` & `Linnet Score`)**:
  1. **Linnet (Consumer & Student Mobile App)**: The end-user practice companion app (preparing for UK/Global iOS App Store and Google Play launch). The commercial website features a dedicated **Linnet App Download & App Store / Google Play Waitlist** section so individual musicians and students visiting the site can get the app.
  2. **Linnet Score (B2B API, Web SDK & Music School Platform)**:
     - **For Software Companies & Developers**: Commercializes the OMR & playback engine via REST APIs (`/v1/omr/jobs`) and the embeddable `<linnet-score-player>` Web Component SDK.
     - **For Music Schools, Conservatoires & Teachers**: Includes a **No-Code Educator Studio** inside `/dashboard` where schools upload sheet music and generate **Shareable Student Practice Links (`/practice/{job_id}`)** and LMS embeds for their music students without writing code.
- **Market & Stage**: London / UK & Europe — Discovery + MVP Commercialization (`v1.0`)

---

## 2. Initial Product Proposition & Priority Matrix

| Component | Purpose | Initial Form | Launch Priority | Customer Value | Architectural Enforcement |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **OMR API** | Convert PDF/image sheet music into digital notation | REST API (`/v1/omr/jobs`) | **P0 (MVP)** | Digitization | Go Gateway (`apps/gateway`) + internal OMR workers; outputs `.musicxml` / `.mxl` (`D-02`). |
| **Score Viewer** | Render recognized digital sheet in customer's product | Embeddable Web SDK (`<linnet-score-player>`) | **P0 (MVP)** | See the result | Zero-dependency Custom Element rendering MusicXML to crisp SVG (`D-03`). |
| **Playback** | Play digital score with basic playback controls | Embeddable Web SDK (`<linnet-score-player>`) | **P0 (MVP)** | Hear the result | Client-side Web Audio API synth (`play/pause/stop`, `tempo`, `repeat/loop`) (`D-04`). |
| **Editing** | Correct or modify recognized notation | SDK + Backend APIs | **P1 (Post-MVP)** | Fix OMR errors | Gated behind validated Phase 4 customer demand (`S-14`, `R-03`). |
| **Advanced Platform** | Storage, versions, batch OMR, collaboration, practice | API / SDK | **P2 (Expansion)** | Workflow expansion | Out of initial MVP scope (`R-03`). |

---

## 3. Full Charter Scope & Deliverables Traceability (`S-01` – `S-17`)

| ID | Deliverable / Scope Item | In / Out | Priority | Architectural & Codebase Implementation |
| :--- | :--- | :--- | :--- | :--- |
| **S-01** | Production-ready OMR REST API | **IN** | P0 | `apps/gateway` (`POST /v1/omr/jobs`, `GET /v1/omr/jobs/{id}`) with `.musicxml`/`.mxl` output. |
| **S-02** | API authentication, API keys & tenant separation | **IN** | P0 | Better-Auth (SMS OTP, Passkeys, OAuth) + SHA-256 `api_keys` vault + PostgreSQL RLS (`org_id`). |
| **S-03** | Usage metering, quotas & rate limiting | **IN** | P0 | Sub-2ms Redis Lua sliding-window rate limiter + monthly page/job quota enforcement. |
| **S-04** | Public OMR web playground | **IN** | P0 | `app/(marketing)` interactive split-pane Playground (Upload $\rightarrow$ Digitize $\rightarrow$ See $\rightarrow$ Hear). |
| **S-05** | Embeddable score viewer | **IN** | P0 | `packages/score-player` MusicXML/MXL-to-SVG renderer inside Shadow DOM. |
| **S-06** | Playback component / SDK | **IN** | P0 | `packages/score-player` Web Audio API scheduler (`play/pause/stop`, `tempo`, `loop`). |
| **S-07** | Developer documentation + quick start | **IN** | P0 | `app/(marketing)/docs` + 30-second pre-populated Sandbox `curl` quickstart in Dashboard. |
| **S-08** | Commercial website / landing pages | **IN** | P0 | `app/(marketing)/page.tsx` in "Lush & Nude" palette with Hero, Playground, SDK & Pricing. |
| **S-09** | Pricing, packaging & billing approach | **IN** | P0 | `app/(dashboard)/billing` + Stripe Billing subscriptions & metered overage events (`D-05`). |
| **S-10** | UK API terms, privacy, IP & anti-resale controls | **IN** | P0 | Onboarding clickwrap acceptance (`api_terms_accepted_at`), CORS origin lock, UK GDPR 24h TTL. |
| **S-11** | Monitoring, logs, incident handling & basic SLA | **IN** | P0 | `app/(dashboard)/logs` OMR Job Inspector drawer + structured `ERR_*` diagnostics + SLA status. |
| **S-12** | Benchmark dataset & OMR quality baseline | **IN** | P0 | Automated benchmark runner & published Supported Score Matrix (Piano, SATB, Lead Sheet). |
| **S-13** | Targeted market validation / outbound interviews | **IN** | P0 | Onboarding ICP segmentation (`icp_segment`), UTM/outbound attribution, trial funnel telemetry. |
| **S-14** | Editing SDK / score correction experience | **OUT (Phase 1)** | P1 | Backlog — gated until validated customer demand (`R-03`); tracked via in-product waitlist hook. |
| **S-15** | Enterprise on-premise OMR deployment | **OUT (Phase 1)** | P2 | Backlog — separate commercial OEM/enterprise decision. |
| **S-16** | Full customer-facing music application | **OUT** | P2 | Excluded — not needed to validate B2B API business. |
| **S-17** | General Library / **Linnet** consumer features | **OUT** | P2 | Excluded — existing consumer **Linnet** app is strictly separate from **Linnet Score** B2B scope. |

---

## 4. Risk Register & Architectural Mitigations (`R-01` – `R-07`)

| ID | Risk | Prob / Impact | Technical & Commercial Mitigation in Linnet Score |
| :--- | :--- | :--- | :--- |
| **R-01** | OMR quality is not competitive enough for target use cases | Med / High | Build benchmark dataset (`S-12`) before market claims; segment by score type; clearly publish supported (engraved Solo Piano, Choral SATB, Lead Sheet) vs. unsupported cases in Docs & Playground; return explicit `ERR_LOW_DPI_IMAGE` / `ERR_UNSUPPORTED_LAYOUT` codes. |
| **R-02** | API is technically exposed before security, tenancy & rate controls are ready | Med / High | Enforce Go API Gateway (`api.linnet.dev/v1`), SHA-256 key hashing, Redis sliding-window rate limits, quotas, and PostgreSQL RLS (`org_id`) in **Phase 1** prior to external access. |
| **R-03** | We build viewer/playback/editing platform before validating demand | High / High | Restrict Phase 1–3 strictly to `P0` (`OMR API` + `Viewer` + `Playback`); gate `P1` Editing (`S-14`) and `P2` features behind an in-dashboard *"Request Score Editing"* demand signal counter. |
| **R-04** | SEO is treated as the only acquisition channel | Med / High | Run SEO and targeted outbound (`S-13`) in parallel; track `acquisition_channel`, `utm_campaign`, and outbound trial invite codes in `organizations` to measure qualified lead activation. |
| **R-05** | Customers wrap and resell API as a competing standalone service | Med / Med | Enforce contractual anti-resale terms (`S-10`), per-customer keys, CORS `sdk_allowed_origins` domain whitelisting, and IP/Origin anomaly detection; require separate OEM agreement for resale. |
| **R-06** | Internal app code/API is not stable enough for external version commitments | Med / High | Decouple public `/v1/` API Gateway contract from internal **Linnet** OMR worker implementation via versioned DTOs and async queues. |
| **R-07** | UK legal/privacy/tax/payment setup blocks launch | Med / High | Host data in `eu-west-2` London with 24h auto-deletion (`D-07`), configure Stripe Billing for GBP (`£`) + UK B2B VAT collection (`D-06`), and record API Terms acceptance (`S-10`). |

---

## 5. Open Decisions Register (`D-01` – `D-08`) & How the Architecture Supports Them

| ID | Decision | Current Position | How the Codebase Supports Validation & Resolution |
| :--- | :--- | :--- | :--- |
| **D-01** | Exact first ICP / buyer segment | Remain broad during validation | Onboarding captures self-reported `icp_segment` (`edtech`, `publisher`, `sheet_music_platform`, `learning_app`, `other`) to correlate with usage & conversion. |
| **D-02** | Output formats at launch | MusicXML / MXL first | `omr_jobs.output_format` supports `mxl` (default compressed) and `musicxml`, extensible via capability config. |
| **D-03** | Viewer implementation strategy | Embeddable Web Component first | Delivered as `<linnet-score-player>` (`packages/score-player`) rendering responsive SVG inside Shadow DOM. |
| **D-04** | Playback implementation strategy | Client-side SDK, not remote "play API" | Synthesized in-browser via Web Audio API inside `<linnet-score-player>`, avoiding audio streaming licensing liability. |
| **D-05** | Pricing metric | Test subscription + usage | Usage ledger records **both** `pages_processed` and `jobs_processed` per tenant so Business can test per-page, per-job, or tiered subscription packaging without code rewrites. |
| **D-06** | UK company / selling entity / reseller structure | TBD (Before first paid contract) | Stripe Billing & invoice templates parameterized for UK entity details, GBP currency, and B2B VAT IDs. |
| **D-07** | Data residency / retention policy | UK/EU (`eu-west-2`), 24h ephemeral | All input PDFs/images and output MusicXML/MXL stored in `eu-west-2` S3/R2 with automated 24-hour lifecycle deletion. |
| **D-08** | First-year success target & baseline KPIs | Baseline during Discovery/Phase 4 | Database tracks all 6 Charter Success Metrics, including automatic calculation of **Time to First Successful Integration** (`first_api_call_at - created_at`). |

---

## 6. Charter Success Criteria Telemetry

Every metric in the Project Charter's **Success Criteria** table is instrumented directly in the control plane:

1. **Paying B2B Customers**: Count of `organizations` with `stripe_subscription_status = 'active'` and `plan_tier IN ('growth', 'enterprise')`.
2. **MRR / API Revenue**: Base subscription MRR + metered overage revenue synced from Stripe webhooks.
3. **Trial-to-Paid Conversion**: Percentage of activated Sandbox `organizations` converting to a paid tier within 30 days.
4. **OMR Processing Quality**: Automated benchmark accuracy score (`S-12`) + per-job customer feedback flag in `/logs`.
5. **API Reliability**: Gateway availability (`99.9%+`), HTTP `5xx` error rate, and `p50`/`p95` `processing_time_ms`.
6. **Time to First Successful Integration (Critical DX Metric)**: Measured to the second via `EXTRACT(EPOCH FROM (organizations.first_api_call_at - organizations.created_at))`.
