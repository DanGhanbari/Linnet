# Linnet Score — Agent Architectural & Design Guardrails

You are working on **Linnet Score**, the B2B Optical Music Recognition (OMR) API and embeddable Web Component SDK platform engineered for the UK/EU enterprise market.

> [!IMPORTANT]
> ### 🏛️ Platform Boundary & Scope Mandate
> 1. **Do NOT build or rewrite a music-recognition / sound backend**: The proprietary sheet-music-to-sound recognition engine was **already built** by the engineering team. It runs isolated in the private Core IP Execution Plane.
> 2. **Do NOT generate server-side audio streams (MP3/WAV)**: The API Gateway returns recognized notation (`.musicxml` / `.mxl`). Audio synthesis is handled purely **client-side in the browser** by the `<linnet-score-player>` Web Audio synthesizer.
> 3. **What this repository builds**: The commercial platform, Go API Gateway (`api.linnet.dev/v1`), Stripe metered billing, PostgreSQL RLS multi-tenancy, Developer Portal, School/Educator Studio, and the embeddable Web Component SDK.

## 0. Brand & Product Ecosystem (`Linnet` App + `Linnet Score` B2B & School Platform)

- **Origin (`NoteAva` / `notavaa.com` $\rightarrow$ `Linnet`)**: The engineering team has already built the core music-recognition and practice application (**NoteAva** at `notavaa.com`, rebranded globally as **Linnet**) that lets musicians and students photograph/upload paper sheet music and immediately hear how the notes, melody, and rhythm sound.
- **Dual Ecosystem Architecture**:
  1. **Linnet (For Musicians & Students — Mobile/Consumer App)**: Helps learners scan physical sheet music, check notes/timing/intervals between lessons, and practice with audio playback. Because the iOS App Store and Google Play global releases are upcoming, the web platform includes a **Linnet App Showcase & Early Access / Direct Download section** for individual musicians.
  2. **Linnet Score (For Businesses, Developers & Music Schools — B2B API, SDK & Educator Studio)**:
     - **For Software Companies & Developers**: Exposes the B2B REST API (`api.linnet.dev/v1`), the `<linnet-score-player>` Web Component SDK, and the B2B Tenant Control Plane.
     - **For Music Schools, Conservatoires & Teachers**: Provides a **No-Code Educator Studio** in the dashboard where schools upload sheet music PDFs/photos and immediately generate **Shareable Student Practice Links (`/practice/{job_id}`)** and 1-click LMS `<iframe>` embeds for their music students.
- **Phase 1 Scope Gate (`R-03`, `S-14`–`S-16`)**: Keep Phase 1 focused on `P0` deliverables (**OMR API `S-01`**, **Score Viewer `S-05`**, **Playback SDK & Student Practice Player `S-06`**). Do not build the `P1` Score Editing SDK (`S-14`) or on-premise deployments (`S-15`) until Phase 4 customer demand gates are cleared.

## 1. Charter & Security Directives (Non-Negotiable)

1. **Strict Core IP Isolation**:
   - The proprietary Linnet OMR engine, vision pipeline, and model weights run strictly in the internal Core IP Execution Plane (Private VPC / mTLS only).
   - Never expose internal worker endpoints, model artifacts, or proprietary OMR source code in client bundles, public repositories, or API responses.
2. **Decoupled Public API Gateway (`v1` Contract — Mitigating `R-02` & `R-06`)**:
   - All external API traffic terminates at the Go API Gateway (`api.linnet.dev/v1`).
   - Maintain strict versioned contracts so internal OMR worker updates never break external customer integrations.
3. **API Key Security (`S-02`)**:
   - **Never** store raw API keys in PostgreSQL, logs, or analytics.
   - Persist only `key_prefix` (e.g., `lnt_live_8f9a` or `lnt_test_3c2d`) and the `SHA-256` `key_hash`. Display the full raw key only once in a modal upon creation or rotation.
4. **Multi-Tenancy & Row-Level Security (RLS — `S-02`, `R-02`)**:
   - Every tenant resource (`api_keys`, `omr_jobs`, `webhook_endpoints`, `sdk_allowed_origins`) must be scoped by `org_id` and protected by PostgreSQL Row-Level Security (`current_setting('app.current_org_id', true)::uuid`).
5. **Authentication & Step-Up Verification**:
   - Support 5 authentication modes via Better-Auth: **SMS OTP (`phoneNumber`)**, **WebAuthn Passkeys**, **GitHub OAuth**, **Google Workspace OAuth**, and **Email Magic Links**.
   - Enforce Redis rate-limiting on SMS OTP dispatch (max 3 OTPs per 10 minutes per phone/IP, 5-minute TTL, max 3 verification attempts).
   - Require step-up verification (Passkey or SMS OTP) for sensitive production mutations (rotating/revoking `lnt_live_` keys, modifying Allowed Origins, or raising hard spend caps).
6. **UK GDPR, Legal Terms & Data Residency (`eu-west-2` London — `S-10`, `D-07`, `R-07`)**:
   - All uploaded sheet music (`pdf`, `png`, `jpg`) and output notation (`musicxml`, `mxl`) are stored exclusively in encrypted `eu-west-2` buckets with a strict **24-hour auto-deletion lifecycle rule** (`D-07`).
   - Enforce UK API Terms & Anti-Resale acceptance (`S-10`, `R-05`) during organization onboarding.
7. **Client-Side SDK Rendering & Anti-Resale (`<linnet-score-player>` — `D-03`, `D-04`, `R-05`)**:
   - Deliver notation rendering and audio synthesis via the zero-dependency `<linnet-score-player>` Web Component SDK using SVG and Web Audio API.
   - Enforce CORS domain whitelisting and origin header telemetry to prevent unauthorized API wrapping or reselling (`R-05`).

## 2. UI/UX Design System: "Lush & Nude" Editorial Aesthetic

Never use generic dark-mode developer templates, neon purples/blues, or sterile pure-white (`#FFFFFF`) backgrounds. All frontend surfaces must use the **Lush & Nude** palette:

| Token Role | Name | Hex | CSS Variable |
| :--- | :--- | :--- | :--- |
| Primary Background | Warm Alabaster | `#FAF6F0` | `--bg-alabaster` |
| Elevated Surface | Soft Cashmere Nude | `#F2EAE1` | `--bg-cashmere` |
| Interactive Surface / Border | Sandstone Bisque | `#E4D6C8` | `--border-sandstone` |
| Muted Accent | Warm Taupe / Clay | `#C8B29E` | `--accent-taupe` |
| Primary Brand / CTA | Lush Cypress Green | `#1B3B2B` | `--brand-cypress` |
| Secondary Lush Accent | Velvet Moss | `#2E5A44` | `--accent-moss` |
| Primary Typography | Espresso Obsidian | `#1C1917` | `--text-obsidian` |
| Secondary Typography | Umber Slate | `#655B52` | `--text-umber` |
| Status: 200 OK / Healthy | Sage | `#2D6A4F` | `--status-sage` |
| Status: 429 / Quota Warning | Ochre | `#D97706` | `--status-ochre` |
| Status: Error / Revoked | Terracotta | `#B91C1C` | `--status-terracotta` |

### Typography Pairing
- **Display & Editorial Headings**: `Instrument Serif` (or `Playfair Display` fallback)
- **UI & Dashboard Controls**: `Plus Jakarta Sans` (or `Inter` fallback)
- **Code, API Keys, OTP Inputs & Logs**: `JetBrains Mono`

## 3. Workspace Documentation & Skills Reference

- Read `docs/01-architecture-and-charter.md` through `docs/06-market-pricing-and-gtm-strategy.md` for full specifications.
- Activate the specialized workspace skills in `.agents/skills/` when building or strategizing specific subsystems:
  - **Engineering & Architecture Skills**:
    - `linnet-design-system`: Building pages or components in `apps/web`.
    - `linnet-auth-multitenancy`: Implementing OAuth, Passkeys, SMS OTP, or PostgreSQL RLS.
    - `linnet-api-gateway`: Working on the Go API Gateway, Redis rate limits, S3 storage, or Stripe metering.
    - `linnet-score-sdk`: Building the `<linnet-score-player>` Web Component and Web Audio synthesizer.
  - **Commercial, Pricing & Marketing Skills**:
    - `linnet-competitor-pricing-intel`: Benchmarking OMR/notation competitors and modeling GBP (`£`) per-page/per-job unit economics (`S-09`, `D-05`).
    - `linnet-uk-gtm-and-outbound`: Scoring UK/EU ICP buyer segments (`D-01`), generating technical outbound sequences (`S-13`), and running B2B ad campaigns (`R-04`).
    - `linnet-seo-and-developer-content`: Writing high-intent developer SEO comparison pages (`S-07`, `S-08`), transparent OMR benchmark matrices (`S-12`, `R-01`), and conversion triggers.

### Local Development Ports
- Preserve Linnet Score's dedicated local ports (`3100` for `apps/web`, `8180` for `apps/gateway`, `5532` host $\rightarrow$ `5432` container for PostgreSQL, and `6479` host $\rightarrow$ `6379` container for Redis) to avoid collisions with standard `3000`/`8080`/`5432`/`6379` services.
