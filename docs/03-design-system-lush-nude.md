# 03 — UI/UX Design System: "Lush & Nude" Editorial Palette

**Linnet Score** pairs an organic, musical identity with a warm, tactile **Lush & Nude** editorial aesthetic. While the existing **Linnet** consumer app serves end-user musicians, **Linnet Score** elevates this visual heritage into an authoritative B2B developer platform where black musical staves and notes pop with razor-sharp contrast against Warm Alabaster and Soft Cashmere Nude surfaces.

---

## 1. Color Tokens (`tailwind.config.ts` & CSS Variables)

| Token Role | Name | Hex Code | Tailwind Class | UI Application |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Background** | Warm Alabaster | `#FAF6F0` | `bg-alabaster` | Main landing page background and sheet music canvas backdrop. |
| **Elevated Surface** | Soft Cashmere Nude | `#F2EAE1` | `bg-cashmere` | Dashboard cards, sidebar navigation, API key tables, and authentication modals. |
| **Interactive Surface / Border** | Sandstone Bisque | `#E4D6C8` | `border-sandstone` | Input field borders, subtle dividers, hover states, and secondary buttons. |
| **Muted Accent** | Warm Taupe / Clay | `#C8B29E` | `text-taupe` | Badges, inactive tabs, chart gridlines, and secondary icons. |
| **Primary Brand / CTA** | Lush Cypress Green | `#1B3B2B` | `bg-cypress` | Primary CTA buttons ("Generate API Key", "Start Free Trial"), active nav states, and **Linnet Score** brand logo. |
| **Secondary Lush Accent** | Velvet Moss | `#2E5A44` | `bg-moss` | Button hover states, usage progress bars, and positive telemetry indicators. |
| **Primary Typography** | Espresso Obsidian | `#1C1917` | `text-obsidian` | Headings, body copy, and rendered musical notation notes/staves. |
| **Secondary Typography** | Umber Slate | `#655B52` | `text-umber` | Subtitles, form labels, timestamps, and documentation captions. |
| **Semantic Status: Healthy** | Sage | `#2D6A4F` | `text-sage` | `200 OK` healthy status, active webhook status, verified phone badge. |
| **Semantic Status: Warning** | Ochre | `#D97706` | `text-ochre` | `429` Quota Warning, rotating API key grace period badge. |
| **Semantic Status: Error** | Terracotta | `#B91C1C` | `text-terracotta` | Revoked API key, `ERR_LOW_DPI_IMAGE`, failed job status. |

---

## 2. Typography Pairing

- **Display & Editorial Headings**: `Instrument Serif` (or `Playfair Display` fallback) — echoes classic engraved sheet music titles and gives the **Linnet Score** landing page an executive, high-fashion feel.
- **UI & Dashboard Controls**: `Plus Jakarta Sans` (or `Inter` fallback) — crisp, modern geometric legibility for tables, billing metrics, and forms.
- **Code, API Keys, OTP Inputs & Logs**: `JetBrains Mono` — used for API key prefixes (`lnt_live_...`), 6-digit SMS OTP input slots, JSON response previews, and webhook payload inspection.

---

## 3. Core Route Group Blueprints (`apps/web/app`)

### Module 1: Commercial Landing Page (`app/(marketing)/page.tsx` — `S-04`, `S-08`, `S-12`, `R-01`)
- **Hero Section**:
  - Editorial serif headline: *"Sheet Music Intelligence, Engineered for Developers."*
  - Subheadline positioning **Linnet Score** as the B2B OMR API & Embeddable Score SDK powering UK & European music-tech products.
  - Dual CTA: **"Get API Key — Free Trial"** (`#1B3B2B` Lush Cypress button) and **"Read the Docs"** (`#E4D6C8` Sandstone outline).
- **Interactive Live OMR Playground (`S-04`)**:
  - Directly below the fold on a `#F2EAE1` Cashmere Nude split-pane card:
  - **Left Pane**: Drag-and-drop a PDF/image score or select 1 of 3 pre-loaded benchmark samples (*Solo Piano*, *Choral SATB*, *Lead Sheet*).
  - **Right Pane**: Tabs switching between the **Rendered Score Viewer + Audio Playback Bar (`<linnet-score-player>`)**, the **raw MusicXML Code Tree**, and the **API Response Telemetry** (`status: 200 OK`, `latency: 1.4s`, `confidence: 99.2%`).
- **Supported Score Types & Benchmark Transparency Matrix (`S-12`, Mitigating `R-01`)**:
  - Editorial Cashmere cards clearly detailing production-ready `P0` score categories (*Engraved Solo Piano*, *Choral SATB*, *Single-Line Lead Sheets*, *Standard Chamber Parts*) vs. experimental/unsupported inputs (*Low-DPI <150dpi camera scans*, *Dense handwritten graphic notation*), setting accurate buyer expectations before sign-up.
- **SDK Integration Showcase (`S-05`, `S-06`)**:
  - 10-line code snippet showing how a developer drops `<linnet-score-player>` into React, Vue, or Vanilla HTML alongside the REST `curl` command.
- **Transparent Pricing Calculator (`S-09`, `D-05`)**:
  - Interactive GBP (`£`) slider estimating monthly pages/jobs processed, comparing the **Sandbox Tier** (50 free pages, no credit card required) against **Growth** and **Enterprise / OEM** tiers.

### Module 2: Low-Friction Sign-Up & Sign-In (`app/(auth)/...` — `S-02`, `S-10`, `D-01`)
- **Split-Screen Layout**:
  - **Left Panel (`#FAF6F0` Warm Alabaster)**: Clean authentication form supporting:
    - **SMS OTP (Phone Number)**: Country code selector (default `🇬🇧 +44`) + phone input $\rightarrow$ transitions smoothly into a 6-slot `JetBrains Mono` OTP verification input with auto-advance and paste support.
    - **WebAuthn Passkeys**: One-tap biometric sign-in.
    - **GitHub SSO & Google Workspace SSO**.
    - **Email Magic Link**.
    - **Lightweight Onboarding Step**: 1-click buyer segment pills (`EdTech / Learning App`, `Sheet Music Publisher`, `Digital Score Platform`, `Other` — `D-01`) + UK API Terms & Anti-Resale checkbox (`S-10`, `R-05`).
  - **Right Panel (`#1B3B2B` Lush Cypress Green)**: Live animated preview of an OMR scan transforming a vintage manuscript into crisp digital SVG notation with a `curl` terminal snippet underneath.

### Module 3: B2B Developer Dashboard (`app/(dashboard)/...` — `S-02`, `S-03`, `S-09`, `S-11`, `R-03`)
- **Overview & Quickstart (`/`)**:
  - **30-Second Quickstart Banner**: Copyable `curl -X POST https://api.linnet.dev/v1/omr/jobs` pre-populated with their Sandbox token and a sample sheet music URL.
  - **KPI Cards (`#F2EAE1` Cashmere containers)**: Pages Processed This Month, Remaining Quota Bar (`#2E5A44` Velvet Moss fill), Average Processing Latency, and API Success Rate (`99.9%`).
- **API Keys Vault (`/keys` — Deliverable `S-02`)**:
  - Create, label, rotate (with configurable 24h dual-validity grace period), and revoke keys.
  - Step-up SMS OTP / Passkey prompt before rotating or revoking `live` keys.
  - Displays raw key only once inside a modal upon creation; subsequently shows `lnt_live_9a8b...` with "Last Used" timestamp and IP/Origin tracking.
- **OMR Job Inspector & Request Logs (`/logs` — Deliverable `S-11`)**:
  - Filterable table of every API call (Job ID, Timestamp, Score Category, Input Type, Pages, Duration, HTTP Status).
  - Clicking a row opens a slide-over drawer showing request metadata, error diagnostics (e.g., `ERR_LOW_DPI_IMAGE`), a quality rating toggle (`Accurate` / `Needs Correction` for `S-12`), a button to test the output in the embedded Score Viewer, and a **"Need in-browser Score Editing? Request P1 Beta"** trigger (`S-14`, `R-03`).
- **Webhooks & SDK Security (`/webhooks` — Mitigating Risk `R-05`)**:
  - Configure destination URLs for `omr.job.completed` and `omr.job.failed` events with HMAC-SHA256 signing secrets.
  - **Allowed Origins (CORS Lock)**: Domain whitelist where the customer's `<linnet-score-player>` Web SDK is permitted to render.
- **Usage & Stripe Billing (`/billing` — Deliverable `S-09`, `R-07`)**:
  - Visual breakdown of base GBP (`£`) subscription + metered overage pages/jobs, UK VAT number configuration, hard spend caps, and a direct deep-link button into the Stripe Customer Portal.
