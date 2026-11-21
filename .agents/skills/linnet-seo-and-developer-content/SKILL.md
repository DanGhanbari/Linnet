---
name: linnet-seo-and-developer-content
description: >-
  Use this skill when writing developer documentation (Deliverable S-07), creating
  technical SEO landing pages and comparison guides (Deliverable S-08, Risk R-04),
  publishing OMR benchmark transparency pages (Deliverable S-12, Risk R-01), or
  optimizing the Playground-to-Paid conversion funnel (Decision D-08).
---

# Linnet Score Developer SEO, Content & Funnel Optimization Skill

Follow this skill when creating content in `apps/web/app/(marketing)` and `apps/web/app/(marketing)/docs` (`S-07`, `S-08`, `S-12`).

## 1. High-Intent B2B Developer SEO Architecture (`S-08`, `R-04`)

Never write generic music theory or consumer music blog posts. Every page on `linnet.dev` must target software engineers, CTOs, and music-tech product managers searching for technical solutions:

### Core Landing & Comparison Routes to Build/Maintain
1. **`/compare/audiveris-vs-linnet-score`**: Technical teardown comparing self-hosted Java Audiveris vs. `api.linnet.dev/v1/omr/jobs` (latency, DPI resilience, DevOps cost, and built-in `<linnet-score-player>`).
2. **`/compare/osmd-verovio-vs-linnet-score-player`**: Comparison showing why `<linnet-score-player>` (built-in Web Audio synth + loop/tempo controls + OMR backend) saves months over stitching together raw SVG renderers.
3. **`/guides/pdf-to-musicxml-api`**: Interactive tutorial with copy-pasteable `curl`, TypeScript/Next.js, Python, and Go snippets.
4. **`/benchmarks` (`S-12`, Mitigating `R-01`)**:
   - Public, interactive benchmark explorer displaying input PDF scans side-by-side with recognized MusicXML and `<linnet-score-player>` audio across *Solo Piano*, *Choral SATB*, *Lead Sheets*, and *Chamber Music*.
   - Explicitly lists **Supported (`P0`)** vs. **Unsupported / Experimental** score types so expectations are transparent before purchase (`R-01`).

## 2. Developer Experience (DX) & Copywriting Principles (`S-07`)

1. **Code Within First Scroll**: Every technical landing page and documentation guide must show a working `curl` command or `<linnet-score-player>` snippet within the first viewport scroll.
2. **Editorial "Lush & Nude" Voice**:
   - Tone: Authoritative, precise, architectural, and warm (inspired by Stripe, Linear, and Anthropic documentation—never hype-driven or gimmicky).
3. **60-Second Integration Promise**:
   - Every CTA on documentation and comparison pages should deep-link into the **Interactive OMR Playground (`S-04`)** or **1-Click Sandbox Key Sign-Up** (via SMS OTP, Passkey, or GitHub SSO).

## 3. Funnel Telemetry & Conversion Triggers (`D-08`)

Instrument and optimize these 4 funnel stages:
1. `playground_score_played`: User uploads or clicks a benchmark sample in the Playground and presses Play.
   - *Trigger*: Slide up a subtle Soft Cashmere (`#F2EAE1`) banner: *"Want to embed this exact score in your app? Get your free 50-page Sandbox API Key in 30 seconds."*
2. `sandbox_account_created`: User completes SMS OTP / Passkey / OAuth sign-up.
3. `first_api_call_succeeded`: Gateway records `organizations.first_api_call_at` (Charter Critical DX Metric).
4. `sandbox_quota_80_percent`: Organization reaches 40 of 50 free pages $\rightarrow$ trigger in-dashboard Ochre (`#D97706`) upgrade prompt to the `£79/mo` Growth plan.

