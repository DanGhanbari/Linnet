---
name: linnet-score-sdk
description: >-
  Use this skill when developing, updating, or embedding the Linnet Score `<linnet-score-player>`
  Vanilla TypeScript Web Component SDK (`packages/score-player`), MusicXML-to-SVG
  notation rendering, client-side Web Audio API synthesis, playback controls, or
  CORS origin lock enforcement.
---

# Linnet Score `<linnet-score-player>` Web Component SDK Skill

> [!IMPORTANT]
> **Client-Side Synthesis Boundary**: The SDK receives digital sheet notation (`.musicxml`/`.mxl`) and renders SVG + plays audio **entirely inside the client browser** using the Web Audio API. The backend server does **not** stream MP3/WAV audio files.

Follow this runbook when working on `packages/score-player` or embedding `<linnet-score-player>` inside the landing page OMR Playground (`S-04`) and Dashboard Job Inspector (`S-11`).

## 1. Custom Element Contract (`<linnet-score-player>` — `S-05`, `S-06`, `D-03`, `D-04`)

The SDK compiles to a zero-dependency ES module and IIFE bundle registering the `<linnet-score-player>` Custom Element.

### Observed Attributes
- `job-id`: **Linnet Score** OMR Job UUID (fetches `.mxl`/`.musicxml` from `/v1/omr/jobs/{job-id}/score`).
- `src`: Direct URL to a `.musicxml` or `.mxl` file (used for pre-loaded benchmark samples in the Playground).
- `client-token`: Public publishable token (`lnt_pub_...`) bound to the tenant's `sdk_allowed_origins`.
- `tempo`: Playback BPM override (default extracted from MusicXML or `120`).
- `loop`: `"true"` | `"false"` (enables measure-range or full-score looping).
- `controls`: Comma-separated control bar features (`"play,tempo,loop,zoom,download"`).
- `enable-feedback`: `"true"` | `"false"` (surfaces the `P1` Score Editing demand-validation button inside the Dashboard Inspector per `S-14` & `R-03`).

### Public Methods & Events
- Methods: `play()`, `pause()`, `stop()`, `seekToMeasure(measureNumber: number)`, `setTempo(bpm: number)`, `setLoop(startMeasure: number, endMeasure: number)`, `loadMusicXML(xml: string)`.
- Custom Events (dispatched with `bubbles: true, composed: true`):
  - `linnet:ready` (`detail: { measures, parts, durationSeconds, defaultTempo }`)
  - `linnet:play`, `linnet:pause`, `linnet:stop`
  - `linnet:measurechange` (`detail: { measure, beat, timestamp }`)
  - `linnet:error` (`detail: { code, message }`)

## 2. Shadow DOM Styling ("Lush & Nude" Theme)

Inside the Shadow Root:
- Score Sheet Backdrop: `#FAF6F0` (Warm Alabaster)
- Engraved Staves, Barlines, Clefs & Notes: `#1C1917` (Espresso Obsidian)
- Active Playback Cursor & Highlighted Noteheads: `#1B3B2B` (Lush Cypress Green) with `#2E5A44` (Velvet Moss) glow
- Bottom Transport Control Bar: `#F2EAE1` (Soft Cashmere Nude) with `1px solid #E4D6C8` (Sandstone Bisque) border

## 3. Web Audio API Scheduler (`D-04`) & P1 Scope Gate (`R-03`, `S-14`)

- Never stream server-rendered audio files; synthesize notes locally via `window.AudioContext`.
- Use a two-tier lookahead timer (`setInterval` at `25ms` scheduling `AudioNode` events `100ms` ahead on `audioContext.currentTime`) so visual tab throttling never causes rhythmic drift.
- Synchronize the SVG playback cursor via `requestAnimationFrame` reading `audioContext.currentTime`.
- **Do not bundle interactive score editing (`S-14`) in Phase 1 (`P0`)**: Keep the SDK lightweight (`Viewer` + `Playback`). Use the `enable-feedback` hook to capture validated customer demand for Phase 5 expansion.

## 4. Reference Specification

See [docs/05-score-player-sdk.md](../../../docs/05-score-player-sdk.md) for usage examples and CORS protection rules.
