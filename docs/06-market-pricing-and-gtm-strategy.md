# 06 — Competitor Intelligence, GBP Pricing Model & UK Go-To-Market Strategy

This document fulfills the commercial discovery and validation mandates of the **Linnet Score Project Charter v1.0** (**Phase 0: Discovery & Baseline** and **Phase 4: UK Market Validation**), directly addressing Deliverables `S-08`, `S-09`, `S-12`, `S-13`, Open Decisions `D-01`, `D-05`, `D-08`, and Risks `R-01`, `R-04`, `R-05`.

---

## 1. Competitive Landscape & Market Gap Analysis (`Phase 0`, `D-05`)

Music-tech companies currently face a broken "Build vs. Buy" dilemma: open-source OMR engines are fragile and lack modern web playback, while embeddable notation players require clean MusicXML that customers do not have (because their users upload raw PDFs or photos). **Linnet Score** bridges the entire workflow (**Upload PDF/Image $\rightarrow$ Digitize via OMR API $\rightarrow$ See SVG $\rightarrow$ Hear Playback in `<linnet-score-player>`**).

### A. Direct Music-Tech & OMR Competitors

| Competitor / Tool | Category | What They Offer | Critical Weakness / Why B2B Buyers Switch to **Linnet Score** |
| :--- | :--- | :--- | :--- |
| **Audiveris / Homr / Oemer** | Open-Source OMR | Java/Python open-source sheet music OCR | Fragile on real-world scans, heavy JVM/GPU hosting overhead, zero SLA, no embeddable web player or audio synth. |
| **Soundslice** | Embeddable Player + Sync | Web-based interactive notation player & practice tool (paid licensing) | Primarily focused on synced video/audio practice; OMR PDF import is capped inside their user ecosystem rather than exposed as a headless developer REST API. |
| **Flat.io (Tutteo)** | Cloud Notation Editor & Embed API | Web-based score editor + embeddable viewer (`S-14` territory) | Built around manual score creation/editing for schools; lacks a dedicated high-throughput headless OMR REST API as its core entry product. |
| **OpenSheetMusicDisplay (OSMD) / Verovio** | Open-Source Renderers | Renders MusicXML/MEI to SVG in the browser | **No OMR** (cannot read PDFs/images) and **no built-in audio synthesis** (requires complex third-party Web Audio wiring). |
| **PlayScore 2 / ScanScore / SmartScore** | Consumer / Prosumer OMR Apps | Mobile/desktop apps for end-user musicians (similar to the consumer **Linnet** app) | **Zero B2B API or embeddable Web SDK** for third-party developers (`S-17` boundary). |

### B. Adjacent B2B Specialized OCR APIs (Commercial Pricing Analogs — `D-05`)

To benchmark unit economics for specialized scientific/notation OCR APIs, **Mathpix OCR API** (which converts math/chemistry PDFs into LaTeX/MathML) is the closest technical and commercial analog:
- **Mathpix API Benchmark**: Charges a base platform fee + `$0.005`–`$0.04` per page depending on volume and complexity.
- **AWS Textract / Google Document AI**: Commodity text OCR (`$0.0015`–`$0.065`/page), completely incapable of reading musical staves, clefs, key signatures, or polyphonic voices.
- **Strategic Positioning**: Because OMR + Engraving + Audio Playback delivers 10x higher domain value than commodity text OCR and saves a B2B team 6–12 months of R&D, **Linnet Score** commands premium value-based B2B pricing (`£0.03`–`£0.08` per page + base platform subscription).

---

## 2. GBP (`£`) Pricing, Packaging & Unit-Economics Hypothesis (`S-09`, `D-05`)

Designed for the UK & European market (billed in `GBP £` with automatic UK VAT calculation via Stripe Tax per `D-06`, `R-07`):

### A. Recommended 4-Tier Packaging Structure

| Tier | Target Buyer | Monthly Base (`GBP`) | Included Quota | Overage Rate (`D-05` Per-Page Default) | Key Features & Guardrails |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Sandbox (Free Trial)** | Individual Developers & Technical Evaluators | **£0 / mo** *(No credit card required)* | **50 pages / mo** | Hard stop at 50 pages (Upgrade CTA) | `lnt_test_` key, 10 req/min rate limit, `<linnet-score-player>` SDK (`localhost` + 1 staging domain), 24h UK GDPR storage. |
| **2. Growth** | Indie Music-Learning Apps, Choir Platforms & Startups | **£79 / mo** | **1,000 pages / mo** | **£0.06 / page** *(configurable Hard Spend Cap)* | `lnt_live_` production keys, 60 req/min, up to 5 CORS Allowed Origins, HMAC-SHA256 webhooks, 99.5% uptime. |
| **3. Scale** | Established EdTech, Sheet-Music Marketplaces & Publishers | **£299 / mo** | **5,000 pages / mo** | **£0.04 / page** *(configurable Hard Spend Cap)* | 300 req/min priority queue, unlimited CORS Allowed Origins, 24h key rotation grace period, 99.9% SLA (`S-11`), priority UK engineering support. |
| **4. Enterprise & OEM** | Major Publishers, Exam Boards & White-Label Resellers (`R-05`) | **Custom (£1,250+ / mo)** | **25,000+ pages / mo** | **£0.02–£0.03 / page** *(Volume tiered)* | Explicit OEM/Reseller rights (`R-05`, `S-10`), custom DPA/MSA (`D-06`), dedicated worker concurrency, optional future on-prem (`S-15`). |

### B. Unit-Economics & Gross Margin Guardrail (`D-05`)
- **Estimated Server Cost per Page**: `~£0.0025` – `£0.0060` per page (GPU/CPU inference time on private worker + `eu-west-2` S3 24h ephemeral storage + Redis/DB metadata).
- **Target Gross Margin**: **88% – 93%** on Growth and Scale tiers.
- **Per-Page vs. Per-Job A/B Validation (`D-05`)**:
  - Single-page lead sheets and 12-page piano sonatas have vastly different compute costs. Therefore, **Per-Page** is the recommended primary unit (`1 credit = 1 page digitized`), while the database tracks both `pages_processed` and `jobs_processed` so enterprise publishers can optionally negotiate flat per-score/per-job bundles.

---

## 3. Ideal Customer Profile (ICP) & UK Market Validation Matrix (`D-01`, `S-13`)

During **Phase 0** and **Phase 4**, evaluate these 5 buyer segments across **Pain Severity**, **Willingness to Pay**, and **Integration Velocity**:

| Rank | ICP Segment (`icp_segment`) | Core Use Case for **Linnet Score** | Typical UK/EU Buyer Persona | Primary Value Driver |
| :--- | :--- | :--- | :--- | :--- |
| **#1** | **Music-Learning & Practice Apps** (`learning_app`) | Let students photograph/upload any physical sheet music book and immediately practice with tempo control & measure looping (`<linnet-score-player>`). | CTO / Head of Product | Eliminates 12 months of OMR + Web Audio R&D; drives user retention. |
| **#2** | **Choir, Worship & Ensemble Platforms** (`sheet_music_platform`) | Directors upload SATB choral PDFs so choir members can see the score and hear isolated part playback on web/mobile. | Founder / Technical Lead | Instant rehearsal playback from legacy PDF libraries. |
| **#3** | **UK/EU Music Publishers & Digital Distributors** (`publisher`) | Convert back-catalog PDF archives into interactive, transposable, playable digital editions on their storefront. | Head of Digital / Publishing Director | Monetizes static PDF back-catalogs into interactive web products. |
| **#4** | **EdTech, Exam Prep & Conservatoire LMS** (`edtech`) | Interactive sight-reading, music theory grading, and student assignment playback (aligned with UK ABRSM/Trinity/GCSE music curricula). | VP Product / Curriculum Tech Lead | UK GDPR compliance (`eu-west-2`, 24h deletion `D-07`) + zero-install browser SDK. |
| **#5** | **Accessible Music & Assistive Tech** (`other`) | Convert static sheet music PDFs into structured MusicXML for large-print reflow or Braille music translation. | Product Manager / Grant Lead | High institutional/grant funding in the UK & EU. |

---

## 4. Parallel Acquisition Strategy: Outbound + SEO + Targeted Ads (`R-04`, `S-08`, `S-13`)

To mitigate Risk **`R-04`** (*"SEO is treated as the only acquisition channel"*), **Linnet Score** runs three acquisition loops in parallel:

### Loop 1: "Show, Don't Tell" Technical Outbound (`S-13` — Weeks 1–8)
1. **Curate a Target List of 100 UK/EU Music-Tech & EdTech Companies**.
2. **The "Custom Playground Link" Hook**:
   - Before emailing a prospect's CTO or Head of Product, run one of their public sample scores through **Linnet Score**.
   - Send a concise, plain-text email or LinkedIn note with a direct link (or 20-second Loom GIF) showing **their own score** digitized and playing inside `<linnet-score-player>` with tempo/loop controls.
3. **Discovery Interview Call (`S-13`, `D-01`, `D-05`)**:
   - Offer a 500-page Sandbox boost (`utm_campaign=uk_outbound_q4`) in exchange for a 15-minute architecture & pricing feedback call.

### Loop 2: High-Intent Developer SEO & "Build vs. Buy" Content (`S-07`, `S-08`)
Instead of generic music blog posts (which attract consumers, not B2B buyers), publish technical engineering benchmarks that rank for exact developer queries:
1. **`/compare/audiveris-vs-linnet-score-api`**: Honest benchmark comparing open-source Audiveris accuracy, JVM memory footprint, and DevOps cost against a single `curl` call to `api.linnet.dev/v1/omr/jobs`.
2. **`/guides/pdf-to-musicxml-api-nodejs-python`**: Copy-pasteable tutorial for converting PDFs to `.mxl` in under 60 seconds.
3. **`/guides/embed-interactive-sheet-music-player-react`**: Showcasing `<linnet-score-player>` vs. wiring OpenSheetMusicDisplay + Tone.js from scratch.
4. **`/benchmarks` (`S-12`, `R-01`)**: Public, transparent OMR accuracy scorecard segmented by Solo Piano, Choral SATB, and Lead Sheets—building instant credibility with skeptical engineers.

### Loop 3: Precision Paid Acquisition (High-Intent Search & LinkedIn ABM)
1. **Google Search Ads (Exact & Phrase Match Only)**:
   - Target high-intent B2B keywords: `"optical music recognition api"`, `"pdf to musicxml api"`, `"musicxml player sdk"`, `"sheet music recognition sdk"`.
   - **Negative Keywords (Crucial for `S-17`)**: Exclude consumer queries (`"free sheet music"`, `"piano sheet music pdf"`, `"musescore download"`) so ad spend never leaks to end-user musicians.
2. **LinkedIn Matched Audience Ads (UK & EU)**:
   - Target job titles (`CTO`, `VP Engineering`, `Head of Product`, `Lead Frontend Developer`) at companies in the `Music`, `E-Learning`, and `Audio Software` industries across the UK & Europe.
   - Ad Creative: Warm Alabaster & Lush Cypress split-screen video showing a PDF transforming into an interactive `<linnet-score-player>` component in 10 lines of code.

