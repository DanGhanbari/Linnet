---
name: linnet-design-system
description: >-
  Use this skill whenever creating, styling, or updating frontend pages, layouts,
  or UI components in Linnet Score (`apps/web` or `packages/score-player`). Enforces
  the "Lush & Nude" editorial color palette, typography pairing (Instrument Serif,
  Plus Jakarta Sans, JetBrains Mono), and page blueprints for (marketing), (auth),
  and (dashboard).
---

# Linnet Score "Lush & Nude" Design System Skill

Follow this skill whenever building or modifying any frontend surface in **Linnet Score** (the B2B OMR API & SDK platform, distinct from the consumer **Linnet** app per Charter `S-17`). **Linnet Score** pairs an organic, musical brand identity with a high-craft editorial palette inspired by warm sheet-music paper and botanical acoustic greens.

## 1. CSS Variables & Tailwind Configuration

Always define and reference these exact semantic tokens in `globals.css` and `tailwind.config.ts`:

```css
:root {
  --bg-alabaster: #FAF6F0;      /* Primary background & sheet music canvas */
  --bg-cashmere: #F2EAE1;       /* Elevated cards, sidebar, modals, split panes */
  --border-sandstone: #E4D6C8;  /* Input borders, dividers, secondary buttons */
  --accent-taupe: #C8B29E;      /* Badges, inactive tabs, chart gridlines */
  --brand-cypress: #1B3B2B;     /* Primary CTA buttons, active nav, brand mark */
  --accent-moss: #2E5A44;       /* CTA hover states, quota progress bars */
  --text-obsidian: #1C1917;     /* Primary headings, body copy, musical notes */
  --text-umber: #655B52;        /* Subtitles, form labels, timestamps */
  --status-sage: #2D6A4F;       /* 200 OK healthy status, verified badges */
  --status-ochre: #D97706;      /* 429 Quota warning, key rotation grace period */
  --status-terracotta: #B91C1C; /* Revoked key, error diagnostics */
}
```

## 2. Typography Rules

1. **Editorial Headings (`font-serif` -> `Instrument Serif`)**:
   - Use for `h1`, `h2`, hero headlines, pricing tier titles, and authentication welcome headers.
   - Track slightly tight (`tracking-tight`), line-height `1.08` to `1.15`, color `#1C1917` (`text-obsidian`).
2. **UI Controls & Tables (`font-sans` -> `Plus Jakarta Sans`)**:
   - Use for body copy, navigation links, form inputs, KPI metrics, and table cells.
3. **Code, API Keys, SMS OTP Slots & Telemetry (`font-mono` -> `JetBrains Mono`)**:
   - Use for `lnt_live_...` / `lnt_test_...` prefixes, `curl` snippets, 6-digit SMS OTP input boxes, latency badges (`1.4s`), and MusicXML tree viewers.

## 3. Component & Route Group Blueprints

### A. `(marketing)` Landing Page (`S-04`, `S-08`, `S-12`, `R-01`)
- **Hero**: `#FAF6F0` background, `Instrument Serif` headline, primary CTA in `#1B3B2B` (`hover:bg-[#2E5A44]` text `#FAF6F0`), secondary CTA with `border-[#E4D6C8]` and `bg-[#F2EAE1]/60`.
- **Interactive Live OMR Playground (`S-04`)**:
  - Split-pane `#F2EAE1` Cashmere card with `1px solid #E4D6C8`.
  - Left pane: Drag-and-drop dropzone + 3 benchmark pill selectors (*Solo Piano*, *Choral SATB*, *Lead Sheet*).
  - Right pane: Tabbed view (`Rendered Score + Audio`, `MusicXML Tree`, `API Telemetry`).
- **Supported Score Types & Benchmark Transparency Matrix (`S-12`, `R-01`)**:
  - Clearly distinguishes `P0` supported engraved scores from unsupported handwritten/low-DPI inputs.

### B. `(auth)` Split-Screen Sign-In / Sign-Up (`S-02`, `S-10`, `D-01`)
- **Left Panel (`#FAF6F0` Warm Alabaster)**:
  - Unified auth switcher supporting **Phone SMS OTP** (with country code selector defaulting to `🇬🇧 +44` and 6-box `JetBrains Mono` OTP input), **Passkey**, **GitHub**, **Google**, and **Magic Link**.
  - Includes 1-click buyer segment pills (`D-01`) and UK API Terms & Anti-Resale clickwrap (`S-10`, `R-05`).
- **Right Panel (`#1B3B2B` Lush Cypress)**:
  - Animated manuscript-to-SVG notation scanner + live `curl` preview in `#FAF6F0` text.

### C. `(dashboard)` B2B Tenant Workspace (`S-02`, `S-03`, `S-09`, `S-11`, `R-03`)
- **Overview (`/`)**: 30-second pre-populated `curl` quickstart banner at top + 4 `#F2EAE1` KPI cards.
- **API Keys (`/keys`)**: Modal displays raw key **once** on creation with copy button; table displays `key_prefix`, environment pill (`sandbox` vs `live`), `last_used_at`, and `Rotate` / `Revoke` actions guarded by SMS OTP or Passkey step-up modal.
- **Logs (`/logs`)**: Filterable table + slide-over drawer with `ERR_*` diagnostics, quality feedback toggle (`S-12`), embedded `<linnet-score-player>` preview button, and *"Request P1 Score Editing SDK"* demand hook (`S-14`, `R-03`).

## 4. Verification Checklist

1. Confirm zero `#000000` or `#FFFFFF` raw backgrounds are used where `#FAF6F0`, `#F2EAE1`, or `#1C1917` belong.
2. Verify WCAG AA contrast on all text pairs (`#1C1917` and `#655B52` on `#FAF6F0` and `#F2EAE1`; `#FAF6F0` on `#1B3B2B`).
3. Refer to [docs/03-design-system-lush-nude.md](../../../docs/03-design-system-lush-nude.md) for complete token definitions.
