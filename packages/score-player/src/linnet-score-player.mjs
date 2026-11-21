/**
 * Linnet Score — <linnet-score-player> Autonomous Custom Element
 * - Shared constructed CSSStyleSheet via `adoptedStyleSheets`
 * - Zero-teardown SVG highlight & gliding compositor playback cursor
 * - Click-to-audition & keyboard-accessible note seeking
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
  container-type: inline-size;
  min-inline-size: 0;
  max-inline-size: 100%;
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

button:focus-visible,
input:focus-visible,
.score-canvas:focus-visible {
  outline: 2px solid var(--_brand-cypress);
  outline-offset: 2px;
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
  min-block-size: 230px;
  -webkit-overflow-scrolling: touch;
}

.score-canvas svg {
  max-width: 100%;
  height: auto;
  display: block;
}

/* Engraved SVG interactivity & smooth gliding playback cursor */
.measure-highlight {
  fill: #2E5A44;
  fill-opacity: 0;
  transition: fill-opacity 180ms ease;
}

.linnet-measure.is-active .measure-highlight {
  fill-opacity: 0.08;
}

.linnet-note {
  cursor: pointer;
  outline: none;
}

.linnet-note .note-halo {
  fill: #2E5A44;
  fill-opacity: 0;
  transition: fill-opacity 140ms ease;
}

.linnet-note:hover .note-halo,
.linnet-note:focus-visible .note-halo {
  fill-opacity: 0.14;
}

.linnet-note.is-active .note-halo {
  fill-opacity: 0.24;
}

.linnet-note.is-active ellipse {
  fill: #1B3B2B;
  stroke: #1B3B2B;
}

.linnet-note.is-active line {
  stroke: #1B3B2B;
}

.linnet-note:focus-visible ellipse {
  stroke: #1B3B2B;
  stroke-width: 2.3;
}

.linnet-playback-cursor {
  opacity: 0.35;
}

.linnet-playback-cursor[data-active="true"] {
  opacity: 0.95;
}

@media (prefers-reduced-motion: no-preference) {
  .linnet-playback-cursor {
    transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease;
  }
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

.btn-primary,
.btn-secondary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 8px;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease, box-shadow 150ms ease, scale 120ms ease-out;
}

.btn-primary {
  background: var(--_brand-cypress);
  color: var(--_bg-alabaster);
  border: 1px solid var(--_brand-cypress);
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
}

.btn-primary:hover {
  background: var(--_accent-moss);
  box-shadow: 0 2px 8px rgba(27, 59, 43, 0.22);
}

.btn-secondary {
  background: var(--_bg-alabaster);
  color: var(--_text-obsidian);
  border: 1px solid var(--_border-sandstone);
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 500;
}

.btn-secondary:hover {
  background: rgba(228, 214, 200, 0.5);
  box-shadow: 0 2px 6px rgba(28, 25, 23, 0.08);
}

.btn-primary:active,
.btn-secondary:active {
  scale: 0.97;
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

.measure-pill,
.pitch-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 11.5px;
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--_bg-alabaster);
  border: 1px solid var(--_border-sandstone);
  color: var(--_text-umber);
}

.pitch-pill[data-live="true"] {
  color: var(--_brand-cypress);
  border-color: rgba(27, 59, 43, 0.35);
}

.eq-bars {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 11px;
}

.eq-bars span {
  display: block;
  width: 2.5px;
  height: 4px;
  border-radius: 999px;
  background: var(--_brand-cypress);
  opacity: 0.4;
  transform-origin: bottom;
}

.player-shell[data-playing="true"] .eq-bars span {
  opacity: 1;
  height: 10px;
}

@media (prefers-reduced-motion: no-preference) {
  .player-shell[data-playing="true"] .eq-bars span {
    animation: eq-pulse 0.72s ease-in-out infinite alternate;
  }

  .player-shell[data-playing="true"] .eq-bars span:nth-child(2) {
    animation-delay: 0.14s;
  }

  .player-shell[data-playing="true"] .eq-bars span:nth-child(3) {
    animation-delay: 0.28s;
  }

  .player-shell[data-playing="true"] .eq-bars span:nth-child(4) {
    animation-delay: 0.42s;
  }
}

@keyframes eq-pulse {
  from {
    transform: scaleY(0.35);
  }
  to {
    transform: scaleY(1);
  }
}

@container (max-width: 640px) {
  .score-canvas {
    justify-content: flex-start;
    padding: 12px;
  }

  .score-canvas svg {
    min-inline-size: 620px;
    max-inline-size: none;
    height: auto;
  }
}

@container (max-width: 560px) {
  .transport-bar {
    padding: 12px;
    gap: 10px;
  }

  .transport-group {
    flex-wrap: wrap;
    width: 100%;
  }

  .tempo-control {
    flex: 1 1 100%;
  }

  .tempo-slider {
    flex: 1;
    min-inline-size: 110px;
  }
}

@media (pointer: coarse) {
  .btn-primary,
  .btn-secondary {
    min-block-size: 44px;
    min-inline-size: 44px;
    padding: 10px 14px;
  }

  .tempo-slider {
    min-block-size: 44px;
  }
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
    <div class="player-shell" data-playing="false">
      <div class="score-canvas" part="canvas" data-canvas tabindex="0" role="region" aria-label="Scrollable musical score notation"></div>
      <div class="transport-bar" part="transport" role="toolbar" aria-label="Score playback controls">
        <div class="transport-group">
          <button type="button" class="btn-primary" data-action="play-toggle" aria-label="Play or pause score">
            <svg data-icon-play aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="6,4 20,12 6,20"></polygon></svg>
            <svg data-icon-pause hidden aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"></rect><rect x="14" y="4" width="4" height="16" rx="1"></rect></svg>
            <span data-play-label>Play Score</span>
          </button>
          <button type="button" class="btn-secondary" data-action="stop" aria-label="Stop playback">
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"></rect></svg>
            <span>Stop</span>
          </button>
          <button type="button" class="btn-secondary" data-action="loop-toggle" aria-pressed="false">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
            <span>Loop</span>
          </button>
        </div>
        <div class="transport-group">
          <label class="tempo-control">
            <span>Tempo</span>
            <input type="range" class="tempo-slider" min="60" max="180" value="112" data-action="tempo-Input" aria-label="Playback tempo BPM" />
            <span data-tempo-label>112 BPM</span>
          </label>
          <span class="pitch-pill" data-pitch-wrap data-live="false">
            <span class="eq-bars" aria-hidden="true"><span></span><span></span><span></span><span></span></span>
            <span data-pitch-readout>Click any note</span>
          </span>
          <span class="measure-pill" data-measure-status>Measure 1 / 4</span>
          <button type="button" class="btn-secondary" data-action="p1-feedback" hidden>Request Notation Editing</button>
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

      // Deep-clone the template content so each instance gets its own nodes.
      this.shadowRoot.append(template.content.cloneNode(true));

      this.scoreModel = parseMusicXML(BENCHMARK_SCORES.solo_piano.musicXML);
      this.activeMeasure = 1;
      this.activeNoteGlobalIndex = -1;
      this.activePitch = null;
      this.activeFrequencyHz = 0;

      this.synth = new ScoreAudioSynthesizer({
        onStepChange: ({ measureNumber, globalNoteIndex, pitch, frequencyHz }) => {
          this.activeMeasure = measureNumber;
          this.activeNoteGlobalIndex = globalNoteIndex;
          this.activePitch = pitch || null;
          this.activeFrequencyHz = frequencyHz || 0;
          this.updatePlaybackHighlight();
          this.dispatchEvent(
            new CustomEvent("linnet:measurechange", {
              bubbles: true,
              composed: true,
              detail: { measure: measureNumber, noteIndex: globalNoteIndex, pitch, frequencyHz }
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
        this.updatePlayButtonLabel(false);
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
      const canvas = this.shadowRoot.querySelector("[data-canvas]");

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
            detail: { feature: "score_editing_sdk", requestedAt: new Date().toISOString() }
          })
        );
      });

      const activateNoteElement = (noteEl) => {
        if (!noteEl) return;
        const noteIdx = Number(noteEl.getAttribute("data-note-index"));
        const freq = Number(noteEl.getAttribute("data-freq"));
        if (Number.isNaN(noteIdx)) return;
        this.synth.seekToNote(noteIdx);
        if (!this.synth.isPlaying && freq > 0) {
          this.synth.previewNote(freq);
        }
      };

      canvas?.addEventListener("click", (e) => {
        const noteEl = e.target.closest?.(".linnet-note");
        activateNoteElement(noteEl);
      });

      canvas?.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        const noteEl = e.target.closest?.(".linnet-note");
        if (!noteEl) return;
        e.preventDefault();
        activateNoteElement(noteEl);
      });
    }

    loadMusicXML(xmlString) {
      this.scoreModel = parseMusicXML(xmlString);
      this.synth.loadScore(this.scoreModel);
      this.setTempo(this.scoreModel.defaultTempo);
      this.updatePlayButtonLabel(false);
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
      this.updatePlaybackHighlight();
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
      const shell = this.shadowRoot.querySelector(".player-shell");
      const playIcon = this.shadowRoot.querySelector("[data-icon-play]");
      const pauseIcon = this.shadowRoot.querySelector("[data-icon-pause]");
      const playLabel = this.shadowRoot.querySelector("[data-play-label]");
      if (shell) shell.setAttribute("data-playing", String(Boolean(playing)));
      if (playIcon) playIcon.hidden = Boolean(playing);
      if (pauseIcon) pauseIcon.hidden = !Boolean(playing);
      if (playLabel) playLabel.textContent = playing ? "Pause" : "Play Score";
    }

    updatePlaybackHighlight() {
      const canvas = this.shadowRoot.querySelector("[data-canvas]");
      const status = this.shadowRoot.querySelector("[data-measure-status]");
      const pitchWrap = this.shadowRoot.querySelector("[data-pitch-wrap]");
      const pitchReadout = this.shadowRoot.querySelector("[data-pitch-readout]");

      if (canvas) {
        canvas.querySelectorAll(".linnet-measure.is-active").forEach((m) => m.classList.remove("is-active"));
        const activeMeasureEl = canvas.querySelector(`.linnet-measure[data-measure-number="${this.activeMeasure}"]`);
        activeMeasureEl?.classList.add("is-active");

        canvas.querySelectorAll(".linnet-note.is-active").forEach((n) => n.classList.remove("is-active"));
        const activeNoteEl =
          this.activeNoteGlobalIndex >= 0
            ? canvas.querySelector(`.linnet-note[data-note-index="${this.activeNoteGlobalIndex}"]`)
            : null;
        activeNoteEl?.classList.add("is-active");

        const cursor = canvas.querySelector(".linnet-playback-cursor");
        if (cursor) {
          const defaultX = cursor.getAttribute("data-default-x") || "122";
          const targetX = activeNoteEl?.getAttribute("data-x") || defaultX;
          cursor.style.transform = `translateX(${targetX}px)`;
          cursor.setAttribute("data-active", this.activeNoteGlobalIndex >= 0 ? "true" : "false");
        }

        // Keep active note visible inside swipeable mobile score canvas without scrolling the page
        if (activeNoteEl && canvas.scrollWidth > canvas.clientWidth) {
          const svg = canvas.querySelector("svg");
          if (svg) {
            const noteX = Number(activeNoteEl.getAttribute("data-x") || 0);
            const scaledX = (noteX / 880) * svg.getBoundingClientRect().width;
            if (scaledX < canvas.scrollLeft + 40 || scaledX > canvas.scrollLeft + canvas.clientWidth - 40) {
              canvas.scrollTo({ left: Math.max(0, scaledX - canvas.clientWidth / 2), behavior: "smooth" });
            }
          }
        }
      }

      if (status) {
        status.textContent = `Measure ${this.activeMeasure} / ${this.scoreModel.totalMeasures}`;
      }
      if (pitchWrap && pitchReadout) {
        if (this.activeNoteGlobalIndex >= 0 && this.activePitch) {
          pitchWrap.setAttribute("data-live", "true");
          pitchReadout.textContent =
            this.activeFrequencyHz > 0 ? `${this.activePitch} · ${Math.round(this.activeFrequencyHz)} Hz` : this.activePitch;
        } else {
          pitchWrap.setAttribute("data-live", "false");
          pitchReadout.textContent = "Click any note";
        }
      }
    }

    renderCanvas() {
      const canvas = this.shadowRoot.querySelector("[data-canvas]");
      if (canvas) {
        canvas.innerHTML = renderScoreToSVG(this.scoreModel, {
          activeMeasure: this.activeMeasure,
          activeNoteGlobalIndex: this.activeNoteGlobalIndex
        });
      }
      this.updatePlaybackHighlight();
    }
  }

  customElements.define("linnet-score-player", LinnetScorePlayerElement);
}
