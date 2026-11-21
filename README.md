# Linnet Score

**Sheet Music Intelligence, Engineered for Developers.**

> [!IMPORTANT]
> ### 🏛️ Platform Boundary & Scope Executive Summary
>
> 1. **What This Platform IS**:
>    - **The Commercial B2B API & Developer Gateway (`Linnet Score`)**: Multi-tenant developer portal, Stripe metered/subscription billing, sub-2ms Go API gateway (`api.linnet.dev/v1`), PostgreSQL Row-Level Security (`org_id`), and secure SHA-256 API key management.
>    - **The School & Educator Studio**: A dedicated no-code portal where music schools, conservatoires, and teachers subscribe, upload sheet music, and generate **Shareable Student Practice Links (`/practice/{job_id}`)** and LMS embeds for their students.
>    - **The Embeddable Client SDK (`<linnet-score-player>`)**: Zero-dependency browser Web Component that renders recognized notation into SVG and synthesizes audio **client-side in the browser** using the Web Audio API.
>    - **The Consumer App Showcase**: Landing page storefront and early access / download hub for the consumer **Linnet** mobile app.
>
> 2. **What This Platform IS NOT (Strict Architectural Boundary)**:
>    - **NOT a sheet-music-to-sound recognition engine backend**: The core OMR engine, computer vision models, and notation extraction algorithms were **already built** by the engineering team (originating from `NoteAva` / `notavaa.com`).
>    - **NOT an audio-rendering server**: The backend does **not** convert sheet music into MP3/WAV audio streams. The backend returns digital notation (`.musicxml` / `.mxl`), and audio is synthesized purely on the client side inside the user's browser.
>    - **Strict IP Isolation**: The existing proprietary recognition engine runs inside an isolated private VPC / mTLS execution plane. This platform only communicates with it via internal secure workers, protecting the core IP.

---

## Product Ecosystem (`NoteAva` / `notavaa.com` $\rightarrow$ `Linnet` & `Linnet Score`)

Built on the proven sheet-music-to-sound engine developed for **NoteAva ([notavaa.com](https://notavaa.com/))**, the **Linnet** ecosystem serves three connected audiences from one core OMR & playback technology:

| Pillar | Target Audience | How They Use It |
| :--- | :--- | :--- |
| **1. LinnetScore B2B API & SDK** | **App Developers, Music-Tech Companies & Publishers** | Integrate the REST API (`api.linnet.dev/v1`) and `<linnet-score-player>` Web Component SDK to add sheet-music scanning, SVG notation viewing, and audio playback inside their own products. |
| **2. Linnet Score for Music Schools & Educators** | **Music Schools, Conservatoires, Academies & Teachers** | Use the **No-Code Educator Studio** in `/dashboard` to upload sheet music PDFs/photos and instantly generate **Shareable Student Practice Links (`/practice/{job_id}`)** or `<iframe>` embeds for student portals. |
| **3. Linnet Mobile App** | **Individual Musicians & Music Students** | The practice companion app (evolving from `notavaa.com`) where learners photograph paper sheet music and hear how it sounds between lessons. Featured on the landing page with Direct Download & iOS/Google Play launch waitlist signup. |

---

## Architectural Highlights

1. **3-Plane Decoupled Topology**:
   - **Plane 1 — Commercial & DX Plane (`Next.js App Router + TypeScript`)**: Public landing page (`S-08`), supported score benchmark showcase (`S-12`, `R-01`), interactive OMR web playground (`S-04`), MDX developer docs (`S-07`), and B2B tenant dashboard.
   - **Plane 2 — Gateway & Control Plane (`Go Chi + Redis + PostgreSQL`)**: Sub-2ms SHA-256 API key authentication (`S-02`), sliding-window rate limiting and quota ledger (`S-03`), flexible per-page/per-job Stripe metered billing (`S-09`, `D-05`), and `eu-west-2` (London) ephemeral object storage with 24h GDPR auto-deletion (`D-07`).
   - **Plane 3 — Core IP Execution Plane (`Private VPC / mTLS Workers`)**: Strictly isolated proprietary Linnet OMR vision and notation pipeline with zero public internet exposure.
2. **Multi-Modal Passwordless Authentication & RLS Multi-Tenancy**:
   - Powered by **Better-Auth** supporting **SMS OTP (One-Time Password)**, **WebAuthn Passkeys**, **GitHub OAuth**, **Google Workspace OAuth**, and **Magic Links**.
   - **Zero-Friction Onboarding Hook**: Automatically provisions an Organization Workspace, 50-page Sandbox quota, and an active `lnt_test_...` API key on signup so developers execute their first `curl` call in under 60 seconds.
   - **PostgreSQL Row-Level Security (RLS)**: Enforces strict `org_id` tenant isolation across every database table (`R-02`).
3. **Embeddable `<linnet-score-player>` Web Component SDK (`S-05`, `S-06`, `D-03`, `D-04`)**:
   - Zero-dependency Vanilla TypeScript Custom Element that renders MusicXML/MXL to razor-sharp `#1C1917` Espresso Obsidian SVG notation and synthesizes audio client-side via the Web Audio API.
   - Protected by tenant-configured CORS Allowed Origins to prevent unauthorized API wrapping or reselling (`R-05`, `S-10`).

---

## Local Development & Port Allocation

Linnet Score uses dedicated local ports (`3100`, `8180`, `5532`, `6479`) so it can run concurrently alongside standard `3000`/`8080`/`5432`/`6379` services without port collisions:

| Service | Default Port | Command / Config | Override / Connection |
| :--- | :--- | :--- | :--- |
| **Web Control Plane (`apps/web`)** | `3100` | `npm run start:web` | `PORT=3101 npm run start:web` |
| **Go API Gateway (`apps/gateway`)** | `8180` | `npm run start:gateway` | `PORT=8181 npm run start:gateway` |
| **PostgreSQL (`infra/docker-compose.yml`)** | `5532` (host $\rightarrow$ `5432` container) | `docker compose -f infra/docker-compose.yml up -d` | `postgres://linnet_admin:linnet_local_dev_password@localhost:5532/linnet_score` |
| **Redis (`infra/docker-compose.yml`)** | `6479` (host $\rightarrow$ `6379` container) | `docker compose -f infra/docker-compose.yml up -d` | `redis://localhost:6479` |

---

## Documentation Index

| Document | Description |
| :--- | :--- |
| [01 — Architecture & Project Charter v1.0 Alignment](./docs/01-architecture-and-charter.md) | 3-Plane topology, full Charter audit (`S-01`..`S-17`, `D-01`..`D-08`, `R-01`..`R-07`), Phases 0–5 roadmap, and `Linnet Score` vs. `Linnet` consumer app boundary. |
| [02 — Database Schema & Multi-Modal Auth (SMS OTP + Passkeys)](./docs/02-database-and-auth-spec.md) | PostgreSQL + RLS schema, SHA-256 API key vault, SMS OTP verification flow, Charter KPI telemetry (`D-01`, `D-05`, `D-08`), and 60-second onboarding hook. |
| [03 — UI/UX Design System: "Lush & Nude"](./docs/03-design-system-lush-nude.md) | Color tokens (`#FAF6F0` Warm Alabaster, `#F2EAE1` Cashmere Nude, `#1B3B2B` Lush Cypress), typography (`Instrument Serif`, `Plus Jakarta Sans`, `JetBrains Mono`), and page blueprints. |
| [04 — Go API Gateway, Quotas, Benchmark Baseline & Webhooks](./docs/04-api-gateway-and-webhooks.md) | `api.linnet.dev/v1` specification, `<2ms` Redis sliding-window Lua scripts, OMR Benchmark quality baseline (`S-12`), Stripe metered billing, and HMAC-SHA256 webhooks. |
| [05 — `<linnet-score-player>` Web Component SDK](./docs/05-score-player-sdk.md) | Client-side MusicXML-to-SVG rendering (`S-05`), Web Audio synthesis (`S-06`), playback controls, P1 Editing demand hook (`S-14`), and CORS origin locking (`R-05`). |
| [06 — Competitor Intelligence, GBP Pricing & UK GTM Strategy](./docs/06-market-pricing-and-gtm-strategy.md) | Competitor gap analysis (Audiveris, Soundslice, Flat.io, OSMD, Mathpix), 4-tier GBP (`£`) pricing & unit economics (`S-09`, `D-05`), UK ICP ranking (`D-01`), and parallel Outbound + SEO + Ads playbook (`R-04`, `S-13`). |

---

## Agent Skills & Customizations

This repository includes 7 specialized Antigravity agent skills under `.agents/skills/` and always-on rules in [AGENTS.md](./AGENTS.md):

### Engineering & Product Skills
- **`.agents/skills/linnet-design-system`**: Enforces the "Lush & Nude" palette, Tailwind tokens, and editorial typography across `(marketing)`, `(auth)`, and `(dashboard)`.
- **`.agents/skills/linnet-auth-multitenancy`**: Runbook for Better-Auth with SMS OTP (`phoneNumber` plugin), WebAuthn Passkeys, OAuth, step-up verification, and PostgreSQL RLS.
- **`.agents/skills/linnet-api-gateway`**: Runbook for the Go (`Chi`) API Gateway, SHA-256 key validation, Redis rate limiting, `eu-west-2` S3 lifecycle rules, and Stripe metered billing.
- **`.agents/skills/linnet-score-sdk`**: Runbook for the `<linnet-score-player>` Custom Element, SVG score rendering, Web Audio API synth, and origin telemetry.

### Commercial, Pricing & Marketing Skills
- **`.agents/skills/linnet-competitor-pricing-intel`**: Competitor teardown matrix, GBP (`£`) 4-tier pricing model, per-page vs. per-job unit economics (`D-05`), and gross margin guardrails (`S-09`).
- **`.agents/skills/linnet-uk-gtm-and-outbound`**: UK/EU ICP buyer scoring (`D-01`), "Live Playground" technical outbound sequences, *Mom Test* discovery interview scripts (`S-13`), and B2B Google/LinkedIn ad guardrails (`R-04`).
- **`.agents/skills/linnet-seo-and-developer-content`**: Programmatic B2B developer SEO comparison pages (`S-07`, `S-08`), honest OMR benchmark scorecards (`S-12`, `R-01`), and Playground-to-Paid funnel optimization (`D-08`).
