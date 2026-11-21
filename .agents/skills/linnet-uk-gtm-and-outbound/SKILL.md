---
name: linnet-uk-gtm-and-outbound
description: >-
  Use this skill when planning UK/EU go-to-market campaigns, scoring Ideal Customer
  Profiles (ICP — Decision D-01), generating targeted B2B outbound sequences and
  discovery interview scripts (Deliverable S-13, Risk R-04), or configuring paid
  search/LinkedIn ad campaigns for Linnet Score.
---

# Linnet Score UK Go-To-Market, Outbound & Advertising Skill

Follow this runbook when executing **Phase 0 (Market Discovery)** and **Phase 4 (UK Market Validation)** of the Project Charter (`S-13`, `D-01`, `D-05`, `R-04`).

## 1. ICP Prioritization & Scoring (`D-01`)

Score every B2B prospect or marketing campaign against our 5 core segments:
1. **Tier 1A — Music-Learning & Practice Apps (`learning_app`)**: Apps where students upload sheet music PDFs/photos and need tempo/loop practice playback.
2. **Tier 1B — Choir, Worship & Ensemble Platforms (`sheet_music_platform`)**: Platforms needing instant SATB PDF-to-audio rehearsal playback.
3. **Tier 2A — UK/EU Sheet Music Publishers & Distributors (`publisher`)**: Publishers digitizing static PDF back-catalogs into interactive web previews.
4. **Tier 2B — EdTech & Conservatoire LMS (`edtech`)**: Music education software aligned with UK ABRSM/Trinity/GCSE curricula requiring UK GDPR (`eu-west-2`) compliance.
5. **Tier 3 — Accessible Music & Assistive Tech (`other`)**: PDF-to-MusicXML conversion for Braille and large-print reflow.

## 2. "Live Playground" Outbound Playbook (Mitigating `R-04`, `S-13`)

Never send generic cold sales emails. Follow the **3-Step Technical Proof Sequence**:
1. **Pre-Outreach Preparation**:
   - Take a publicly available PDF sheet music sample relevant to the prospect's domain (e.g., a choral score for a choir app, or an exam piece for an EdTech platform).
   - Process it through the **Linnet Score** Playground (`S-04`).
2. **Message 1 (Technical Proof — Day 1)**:
   - Subject: `[Company Name] sheet music PDF -> interactive SVG + Web Audio in 1.4s`
   - Body: 3 short sentences showing how their exact score renders and loops inside `<linnet-score-player>` with a 10-line code snippet and a pre-activated 500-page UK Sandbox invite code (`?utm_source=outbound&utm_campaign=uk_icp_validation`).
3. **Discovery Interview Script (`S-13` — *The Mom Test* Rules)**:
   - Never ask *"Would you buy our API?"*
   - Ask:
     1. *"How do your users currently get sheet music into your product today?"*
     2. *"Have you ever evaluated open-source OMR like Audiveris or renderers like OSMD? What broke or took too much engineering time?"*
     3. *"If an API digitized a page and gave you an embeddable player, would per-page or per-score pricing fit your unit economics better?"* (`D-05`)
     4. *"How critical is in-browser notation editing (`S-14`) versus read-only playback (`S-06`) for your initial release?"* (`R-03`)

## 3. Paid Advertising Guardrails (Google Search & LinkedIn ABM)

1. **Strict Consumer Traffic Exclusion (`S-17`)**:
   - Every Google Ads campaign must include negative keywords: `free sheet music`, `piano pdf download`, `musescore`, `chords`, `tabs`, `consumer app`.
   - Target strictly B2B developer & product intent: `"musicxml api"`, `"omr rest api"`, `"embed sheet music player javascript"`, `"pdf to musicxml sdk"`.
2. **Honest Benchmark Creative (`R-01`)**:
   - Ads must never claim "100% perfection on messy handwritten manuscripts." Lead with verified latency (`1.4s`), supported engraved score benchmarks (`S-12`), and zero-dependency Web Component integration.

## 4. Reference Documentation

See [docs/06-market-pricing-and-gtm-strategy.md](../../../docs/06-market-pricing-and-gtm-strategy.md) for complete ICP matrices and campaign templates.

