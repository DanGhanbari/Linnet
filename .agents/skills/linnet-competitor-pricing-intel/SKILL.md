---
name: linnet-competitor-pricing-intel
description: >-
  Use this skill when researching OMR/music-tech competitors, modeling GBP (£)
  API pricing tiers, calculating per-page vs. per-job unit economics (Decision D-05),
  designing the Pricing Calculator component (Deliverable S-09), or positioning
  Linnet Score against open-source tools (Audiveris, OSMD, Verovio) and commercial
  players (Soundslice, Flat.io, Mathpix).
---

# Linnet Score Competitor Intelligence & Pricing Strategy Skill

Follow this runbook whenever conducting competitor research, refining pricing tiers (`S-09`, `D-05`), updating the interactive Pricing Calculator on `app/(marketing)/page.tsx`, or drafting "Build vs. Buy" positioning for **Linnet Score**.

## 1. Competitor Positioning Matrix (`Phase 0` Baseline)

Always frame **Linnet Score** around the complete **Digitize (`S-01`) + See (`S-05`) + Hear (`S-06`)** developer value chain:

1. **Against Open-Source OMR (`Audiveris`, `Homr`, `Oemer`)**:
   - *Their pain*: Requires maintaining heavy Java/Python GPU workers, fails on varied scan lighting, and outputs raw XML with no browser renderer or audio engine.
   - *Linnet Score advantage*: Sub-second Go API gateway, proprietary server-side vision pipeline, 99.9% SLA, and drop-in `<linnet-score-player>` Web Component.
2. **Against Open-Source Renderers (`OpenSheetMusicDisplay`, `Verovio`, `VexFlow`)**:
   - *Their pain*: Cannot ingest PDFs/images (require pre-existing MusicXML) and have no built-in Web Audio synthesizer.
   - *Linnet Score advantage*: End-to-end PDF-to-Playable-Score pipeline in 10 lines of HTML/TS.
3. **Against Closed Ecosystem Players (`Soundslice`, `Flat.io`)**:
   - *Their pain*: Designed primarily as destination web apps or rigid iframe embeds rather than headless OMR infrastructure + zero-dependency Web Components styled to match the host product.
4. **Against Consumer Apps (`PlayScore 2`, `ScanScore`, or our own consumer `Linnet` app — `S-17`)**:
   - *Strict Boundary*: Never position **Linnet Score** for individual musicians scanning a single song. Position strictly for B2B software teams, publishers, and EdTech platforms integrating sheet-music intelligence into their own products.

## 2. GBP (`£`) Pricing & Unit-Economics Rules (`S-09`, `D-05`, `R-07`)

When building pricing tables, calculators, or Stripe Billing configs:
1. **Default Currency**: British Pounds (`GBP £`), excluding UK VAT (with automatic 20% UK VAT / EU B2B Reverse-Charge handling in Stripe Tax per `R-07`).
2. **4-Tier Architecture**:
   - **Sandbox**: `£0/mo` (50 free pages, no credit card required — optimizes *Time to First Successful Integration*).
   - **Growth**: `£79/mo` (includes 1,000 pages + `£0.06/page` overage).
   - **Scale**: `£299/mo` (includes 5,000 pages + `£0.04/page` overage, 99.9% SLA, 24h key rotation grace window).
   - **Enterprise / OEM**: Custom (`£1,250+/mo`, volume per-page or flat per-job bundles, explicit OEM/Reseller rights per `R-05`).
3. **Gross Margin Formula**:
   - Always verify that `(Tier Price + Overage Revenue - (Pages * £0.005 est. compute/storage cost)) / Total Revenue >= 0.85` (85%+ gross margin target).
4. **Anti-Surprise-Bill Guarantee**:
   - Always highlight configurable **Hard Spend Caps** (`hard_spend_cap_gbp_pence`) on the pricing page and `/billing` dashboard to eliminate developer fear of runaway usage bills.

## 3. Reference Documentation

See [docs/06-market-pricing-and-gtm-strategy.md](../../../docs/06-market-pricing-and-gtm-strategy.md) for full competitor tables and unit-economics models.

