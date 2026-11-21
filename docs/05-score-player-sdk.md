# 05 — `<linnet-score-player>` Web Component SDK

To fulfill Charter Decisions `D-03` & `D-04` and Deliverables `S-05` (Embeddable Score Viewer) & `S-06` (Playback Component / SDK), **Linnet Score** ships its notation viewer and audio engine as a zero-dependency, framework-agnostic Web Component (`packages/score-player`) rather than a remote audio streaming API.

---

## 1. Developer Integration Experience (10-Line Drop-In)

B2B customers can embed `<linnet-score-player>` in React, Vue, Svelte, or Vanilla HTML inside their own web and mobile WebView products:

```html
<script type="module" src="https://cdn.linnet.dev/sdk/v1/linnet-score-player.min.js"></script>

<linnet-score-player
  job-id="job_01j8x9k2m4p7q"
  client-token="lnt_pub_live_9a8b7c..."
  theme="lush-alabaster"
  tempo="120"
  loop="true"
  controls="play,tempo,loop,zoom,download"
></linnet-score-player>
```

---

## 2. Internal SDK Architecture (`packages/score-player`)

1. **Shadow DOM Encapsulation & "Lush & Nude" Styling**:
   - Renders inside an isolated Shadow Root styled with Warm Alabaster (`#FAF6F0`) sheet canvas, Soft Cashmere (`#F2EAE1`) transport bar, Espresso Obsidian (`#1C1917`) engraved notes/staves, and Lush Cypress (`#1B3B2B`) active playback cursor and controls.
2. **MusicXML / MXL Parser & SVG Engraver (`S-05`, `D-03`)**:
   - Accepts either a `job-id` (fetched from `GET /v1/omr/jobs/{id}/score`), a `src` URL, or raw MusicXML string via `.loadMusicXML(xmlString)`.
   - Decompresses `.mxl` ZIP containers in-browser and renders responsive, zoomable SVG staves with measure-level bounding boxes and an animated note-head playback cursor.
3. **Client-Side Web Audio API Synthesizer (`S-06`, `D-04`)**:
   - Uses `AudioContext` with a lightweight, high-craft acoustic piano wavetable/sample set and lookahead scheduler (`25ms` scheduling tick, `100ms` lookahead window) for jitter-free playback.
   - Supports the Charter's agreed `P0` playback controls:
     - **Play / Pause / Stop**: `.play()`, `.pause()`, `.stop()`
     - **Tempo Control**: `.setTempo(bpm)` (50% to 200% speed / explicit BPM slider)
     - **Repeat / Loop**: `.setLoop(startMeasure, endMeasure)` (full-score loop or A–B measure range loop)
   - Dispatches DOM events: `linnet:ready`, `linnet:play`, `linnet:pause`, `linnet:stop`, `linnet:measurechange`, `linnet:error`.
4. **CORS Origin Lock & Anti-Resale Protection (`R-05`, `S-10`)**:
   - When fetching score data from `api.linnet.dev/v1/omr/jobs/{id}/score`, the browser sends the host application's `Origin` header.
   - The Go Gateway validates the `Origin` against the tenant's `sdk_allowed_origins` whitelist before returning the MusicXML payload.
5. **Phase 1 Gate on Score Editing (`S-14`, `R-03`)**:
   - Per Charter Deliverable `S-14` and Risk `R-03`, interactive notation editing/correction is **not** bundled in the `P0` runtime bundle to prevent premature platform bloat.
   - Instead, when embedded inside the **Linnet Score** Dashboard Inspector (`/logs`), an optional `enable-feedback="true"` attribute surfaces a lightweight *"Flag Measure / Request P1 Score Editing SDK"* action that records validated customer demand in `organizations.requested_editing_sdk_at`.
