/**
 * Linnet Score — <linnet-score-player> Autonomous Custom Element (Deliverables S-05, S-06, Decisions D-03, D-04)
 * Implements Modern Web Guidance best practices:
 * - Shared constructed CSSStyleSheet via `adoptedStyleSheets` (no per-instance style re-parse)
 * - Private `--_*` custom properties on `:host` reading public `--linnet-*` variables (no `:host-context()`)
 * - Explicit `font: inherit; color: inherit;` on internal `<button>` and `<input>` elements inside Shadow DOM
 * - Same-tree ARIA labels and `::part(canvas)` / `::part(transport)` exposure
 */

import { parseMusicXML, BENCHMARK_SCORES } from "./musicxml-parser.mjs";
import { renderScoreToSVG } from "./svg-engraver.mjs";
import { ScoreAudioSynthesizer } from "./audio-synth.mjs";

const PLAYER_CSS = `
:host {
  --_bg-alabaster: var(--linnet-bg-alabaster, #FAF6F0);
  --_bg-cashmere: var(--linnet-bg-cashmere, #F2EAE1);
  --_border-sandstone: var(--linnet-border-sandstone, #E4D6C8);
  --_brand-cypress: var(--linnet-brand-cypress, #1B3B2B);
  --_accent-moss: var(--linnet-accent-moss, #2E5A44);
  --_text-obsidian: var(--linnet-text-obsidian, #1C1917);
  --_text-umber: var(--linnet-text-umber, #655B52);

  display: block;
  font-family: 'Figtree', -apple-system, BlinkMacSystemFont, sans-serif;
  color: var(--_text-obsidian);
  background: var(--_bg-alabaster);
  border: 1px solid var(--_border-sandstone);
  border-radius: 14px;
  overflow: hidden;
}

:host([hidden]) {
  display: none;
}

button, input, select {
  font: inherit;
  color: inherit;
}

.player-shell {
  display: flex;
  flex-direction: column;
}

.score-canvas {
  background: var(--_bg-alabaster);
  padding: 16px 20px;
  overflow-x: auto;
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 250px;
}

.score-canvas svg {
  max-width: 100%;
  height: auto;
  display: block;
}

.transport-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--_bg-cashmere);
  border-top: 1px solid var(--_border-sandstone);
}

.transport-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-primary {
  background: var(--_brand-cypress);
  color: var(--_bg-alabaster);
  border: 1px solid var(--_brand-cypress);
  border-radius: 8px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 150ms ease;
}

.btn-primary:hover {
  background: var(--_accent-moss);
}

.btn-secondary {
  background: var(--_bg-alabaster);
  color: var(--_text-obsidian);
  border: 1px solid var(--_border-sandstone);
  border-radius: 8px;
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
}

.btn-secondary[aria-pressed="true"] {
  background: var(--_accent-moss);
  color: var(--_bg-alabaster);
  border-color: var(--_accent-moss);
}

.tempo-control {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: var(--_text-umber);
}

.tempo-slider {
  accent-color: var(--_brand-cypress);
  cursor: pointer;
  width: 96px;
}

.measure-pill {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--_bg-alabaster);
  border: 1px solid var(--_border-sandstone);
  color: var(--_text-umber);
}
`;

let sharedStyleSheet = null;
function getSharedStyleSheet() {
  if (!sharedStyleSheet && typeof CSSStyleSheet !== "undefined" && "replaceSync" in CSSStyleSheet.prototype) {
    sharedStyleSheet = new CSSStyleSheet();
    sharedStyleSheet.replaceSync(PLAYER_CSS);
  }
  return sharedStyleSheet;
}

export function defineLinnetScorePlayer() {
  if (typeof window === "undefined" || typeof HTMLElement === "undefined") return;
  if (customElements.get("linnet-score-player")) return;

  const template = document.createElement("template");
  template.innerHTML = `
    <div class="player-shell">
      <div class="score-canvas" part="canvas" data-canvas></div>
      <div class="transport-bar" part="transport" role="toolbar" aria-label="Score playback controls">
        <div class="transport-group">
          <button type="button" class="btn-primary" data-action="play-toggle" aria-label="Play or pause score">▶ Play Score</button>
          <button type="button" class="btn-secondary" data-action="stop" aria-label="Stop playback">⏹ Stop</button>
          <button type="button" class="btn-secondary" data-action="loop-toggle" aria-pressed="false">↻ Loop</button>
        </div>
        <div class="transport-group">
          <label class="tempo-control">
            <span>Tempo</span>
            <input type="range" class="tempo-slider" min="60" max="180" value="112" data-action="tempo-Input" aria-label="Playback tempo BPM" />
            <span data-tempo-label>112 BPM</span>
          </label>
          <span class="measure-pill" data-measure-status>Measure 1 / 4</span>
          <button type="button" class="btn-secondary" data-action="p1-feedback" hidden title="Charter S-14 Demand Signal">✦ Request Score Editing (P1)</button>
        </div>
      </div>
    </div>
  `;

  class LinnetScorePlayerElement extends HTMLElement {
    static get observedAttributes() {
      return ["preset", "tempo", "loop", "enable-feedback", "job-id"];
    }

    constructor() {
      super();
      this.attachShadow({ mode: "open" });

      const sheet = getSharedStyleSheet();
      if (sheet && "adoptedStyleSheets" in this.shadowRoot) {
        this.shadowRoot.adoptedStyleSheets = [sheet];
      } else {
        const styleEl = document.createElement("style");
        styleEl.textContent = PLAYER_CSS;
        this.shadowRoot.append(styleEl);
      }

      // MANDATORY: deep-clone the template content so each instance gets its own nodes.
      this.shadowRoot.append(template.content.cloneNode(true));

      this.scoreModel = parseMusicXML(BENCHMARK_SCORES.solo_piano.musicXML);
      this.activeMeasure = 1;
      this.activeNoteGlobalIndex = -1;

      this.synth = new ScoreAudioSynthesizer({
        onStepChange: ({ measureNumber, globalNoteIndex }) => {
          this.activeMeasure = measureNumber;
          this.activeNoteGlobalIndex = globalNoteIndex;
          this.renderCanvas();
          this.dispatchEvent(
            new CustomEvent("linnet:measurechange", {
              bubbles: true,
              composed: true,
              detail: { measure: measureNumber, noteIndex: globalNoteIndex }
            })
          );
        },
        onPlaybackEnded: () => {
          this.updatePlayButtonLabel(false);
          this.dispatchEvent(new CustomEvent("linnet:stop", { bubbles: true, composed: true }));
        }
      });
    }

    connectedCallback() {
      this.bindEvents();
      this.syncFromAttributes();
      this.synth.loadScore(this.scoreModel);
      this.renderCanvas();
      this.dispatchEvent(
        new CustomEvent("linnet:ready", {
          bubbles: true,
          composed: true,
          detail: {
            title: this.scoreModel.title,
            measures: this.scoreModel.totalMeasures,
            defaultTempo: this.scoreModel.defaultTempo
          }
        })
      );
    }

    disconnectedCallback() {
      this.synth.stop();
    }

    attributeChangedCallback() {
      if (this.isConnected) {
        this.syncFromAttributes();
        this.renderCanvas();
      }
    }

    syncFromAttributes() {
      const presetKey = this.getAttribute("preset") || "solo_piano";
      if (BENCHMARK_SCORES[presetKey]) {
        this.scoreModel = parseMusicXML(BENCHMARK_SCORES[presetKey].musicXML);
        this.synth.loadScore(this.scoreModel);
      }

      const tempoAttr = this.getAttribute("tempo");
      const targetTempo = tempoAttr ? Number(tempoAttr) : this.scoreModel.defaultTempo;
      this.setTempo(targetTempo);

      const loopAttr = this.getAttribute("loop") === "true";
      this.setLoop(loopAttr);

      const feedbackBtn = this.shadowRoot.querySelector('[data-action="p1-feedback"]');
      if (feedbackBtn) {
        feedbackBtn.hidden = this.getAttribute("enable-feedback") !== "true";
      }
    }

    bindEvents() {
      if (this._bound) return;
      this._bound = true;

      const playBtn = this.shadowRoot.querySelector('[data-action="play-toggle"]');
      const stopBtn = this.shadowRoot.querySelector('[data-action="stop"]');
      const loopBtn = this.shadowRoot.querySelector('[data-action="loop-toggle"]');
      const tempoSlider = this.shadowRoot.querySelector('[data-action="tempo-Input"]');
      const feedbackBtn = this.shadowRoot.querySelector('[data-action="p1-feedback"]');

      playBtn?.addEventListener("click", () => {
        if (this.synth.isPlaying) {
          this.pause();
        } else {
          this.play();
        }
      });

      stopBtn?.addEventListener("click", () => this.stop());

      loopBtn?.addEventListener("click", () => {
        this.setLoop(!this.synth.loopEnabled);
      });

      tempoSlider?.addEventListener("input", (e) => {
        this.setTempo(Number(e.target.value));
      });

      feedbackBtn?.addEventListener("click", () => {
        this.dispatchEvent(
          new CustomEvent("linnet:feedback", {
            bubbles: true,
            composed: true,
            detail: { feature: "S-14_score_editing_sdk", requestedAt: new Date().toISOString() }
          })
        );
      });
    }

    loadMusicXML(xmlString) {
      this.scoreModel = parseMusicXML(xmlString);
      this.synth.loadScore(this.scoreModel);
      this.setTempo(this.scoreModel.defaultTempo);
      this.renderCanvas();
    }

    play() {
      this.synth.play();
      this.updatePlayButtonLabel(true);
      this.dispatchEvent(new CustomEvent("linnet:play", { bubbles: true, composed: true }));
    }

    pause() {
      this.synth.pause();
      this.updatePlayButtonLabel(false);
      this.dispatchEvent(new CustomEvent("linnet:pause", { bubbles: true, composed: true }));
    }

    stop() {
      this.synth.stop();
      this.updatePlayButtonLabel(false);
      this.renderCanvas();
    }

    setTempo(bpm) {
      this.synth.setTempo(bpm);
      const slider = this.shadowRoot.querySelector('[data-action="tempo-Input"]');
      const label = this.shadowRoot.querySelector("[data-tempo-label]");
      if (slider) slider.value = String(this.synth.tempoBpm);
      if (label) label.textContent = `${this.synth.tempoBpm} BPM`;
    }

    setLoop(enabled) {
      this.synth.setLoop(enabled);
      const loopBtn = this.shadowRoot.querySelector('[data-action="loop-toggle"]');
      if (loopBtn) {
        loopBtn.setAttribute("aria-pressed", String(Boolean(enabled)));
      }
    }

    updatePlayButtonLabel(playing) {
      const playBtn = this.shadowRoot.querySelector('[data-action="play-toggle"]');
      if (playBtn) {
        playBtn.textContent = playing ? "⏸ Pause" : "▶ Play Score";
      }
    }

    renderCanvas() {
      const canvas = this.shadowRoot.querySelector("[data-canvas]");
      const status = this.shadowRoot.querySelector("[data-measure-status]");
      if (canvas) {
        canvas.innerHTML = renderScoreToSVG(this.scoreModel, {
          activeMeasure: this.activeMeasure,
          activeNoteGlobalIndex: this.activeNoteGlobalIndex
        });
      }
      if (status) {
        status.textContent = `Measure ${this.activeMeasure} / ${this.scoreModel.totalMeasures}`;
      }
    }
  }

  customElements.define("linnet-score-player", LinnetScorePlayerElement);
}

