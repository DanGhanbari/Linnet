/**
 * Linnet Score — Client-Side Web Audio API Synthesizer & Lookahead Scheduler
 * Uses a 25ms scheduling tick and 100ms lookahead window on AudioContext.currentTime for jitter-free playback.
 */

export class ScoreAudioSynthesizer {
  constructor({ onStepChange = () => {}, onPlaybackEnded = () => {} } = {}) {
    this.audioCtx = null;
    this.isPlaying = false;
    this.tempoBpm = 112;
    this.loopEnabled = false;
    this.scoreModel = null;
    this.flattenedNotes = [];
    this.currentNoteIndex = 0;
    this.nextNoteTime = 0;
    this.timerId = null;
    this.onStepChange = onStepChange;
    this.onPlaybackEnded = onPlaybackEnded;
  }

  loadScore(scoreModel) {
    this.stop();
    this.scoreModel = scoreModel;
    this.tempoBpm = scoreModel.defaultTempo || 112;

    const flat = [];
    scoreModel.measures.forEach((m) => {
      m.notes.forEach((n) => {
        flat.push({
          ...n,
          measureNumber: m.measureNumber,
          globalIndex: flat.length
        });
      });
    });
    this.flattenedNotes = flat;
  }

  ensureAudioContext() {
    if (!this.audioCtx && typeof window !== "undefined") {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      return this.audioCtx.resume();
    }
    return null;
  }

  scheduleWarmPianoTone(frequencyHz, startTime, durationSec) {
    if (!this.audioCtx || !frequencyHz || frequencyHz <= 0) return;

    const oscFundamental = this.audioCtx.createOscillator();
    const oscHarmonic = this.audioCtx.createOscillator();
    const gainNode = this.audioCtx.createGain();

    oscFundamental.type = "triangle";
    oscFundamental.frequency.setValueAtTime(frequencyHz, startTime);

    oscHarmonic.type = "sine";
    oscHarmonic.frequency.setValueAtTime(frequencyHz * 2, startTime);

    const harmonicGain = this.audioCtx.createGain();
    harmonicGain.gain.setValueAtTime(0.12, startTime);

    // Warm acoustic piano ADSR envelope
    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(0.24, startTime + 0.018);
    gainNode.gain.exponentialRampToValueAtTime(0.08, startTime + Math.min(0.25, durationSec * 0.6));
    gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + Math.max(0.08, durationSec * 0.96));

    oscFundamental.connect(gainNode);
    oscHarmonic.connect(harmonicGain);
    harmonicGain.connect(gainNode);
    gainNode.connect(this.audioCtx.destination);

    oscFundamental.start(startTime);
    oscHarmonic.start(startTime);
    oscFundamental.stop(startTime + durationSec);
    oscHarmonic.stop(startTime + durationSec);
  }

  async previewNote(frequencyHz, durationSec = 0.42) {
    if (!frequencyHz || frequencyHz <= 0) return;
    const resumePromise = this.ensureAudioContext();
    if (resumePromise) {
      try {
        await resumePromise;
      } catch {
        return;
      }
    }
    if (!this.audioCtx) return;
    this.scheduleWarmPianoTone(frequencyHz, this.audioCtx.currentTime + 0.01, durationSec);
  }

  async play() {
    if (!this.flattenedNotes.length || this.isPlaying) return;
    const resumePromise = this.ensureAudioContext();
    this.isPlaying = true;

    if (resumePromise) {
      try {
        await resumePromise;
      } catch {
        // Keep visual playback running if browser autoplay blocks audio resume
      }
    }
    if (!this.isPlaying) return;

    const now = this.audioCtx ? this.audioCtx.currentTime : performance.now() / 1000;
    this.nextNoteTime = now + 0.04;

    const tick = () => {
      if (!this.isPlaying) return;
      const currentTime = this.audioCtx ? this.audioCtx.currentTime : performance.now() / 1000;

      while (this.nextNoteTime < currentTime + 0.1) {
        if (this.currentNoteIndex >= this.flattenedNotes.length) {
          if (this.loopEnabled) {
            this.currentNoteIndex = 0;
          } else {
            this.stop();
            this.onPlaybackEnded();
            return;
          }
        }

        const note = this.flattenedNotes[this.currentNoteIndex];
        const secondsPerBeat = 60 / Math.max(40, Math.min(240, this.tempoBpm));
        const durationSec = Math.max(0.15, (note.durationBeats || 1) * secondsPerBeat);

        if (!note.isRest && note.frequencyHz > 0) {
          this.scheduleWarmPianoTone(note.frequencyHz, this.nextNoteTime, durationSec);
        }

        const acc = note.alter === 1 ? "♯" : note.alter === -1 ? "♭" : "";
        this.onStepChange({
          measureNumber: note.measureNumber,
          globalNoteIndex: note.globalIndex,
          pitch: note.step ? `${note.step}${acc}${note.octave}` : "Rest",
          frequencyHz: note.isRest ? 0 : note.frequencyHz || 0
        });

        this.nextNoteTime += durationSec;
        this.currentNoteIndex += 1;
      }
    };

    tick();
    this.timerId = setInterval(tick, 25);
  }

  pause() {
    this.isPlaying = false;
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  stop() {
    this.pause();
    this.currentNoteIndex = 0;
    this.onStepChange({
      measureNumber: 1,
      globalNoteIndex: -1,
      pitch: null,
      frequencyHz: 0
    });
  }

  setTempo(bpm) {
    const clamped = Math.max(40, Math.min(220, Number(bpm) || 112));
    this.tempoBpm = clamped;
  }

  setLoop(enabled) {
    this.loopEnabled = Boolean(enabled);
  }

  seekToNote(globalNoteIndex) {
    if (!this.flattenedNotes.length) return;
    const clamped = Math.max(0, Math.min(this.flattenedNotes.length - 1, Number(globalNoteIndex) || 0));
    this.currentNoteIndex = clamped;
    const target = this.flattenedNotes[clamped];
    if (this.isPlaying) {
      const currentTime = this.audioCtx ? this.audioCtx.currentTime : performance.now() / 1000;
      this.nextNoteTime = currentTime + 0.04;
    }
    const acc = target.alter === 1 ? "♯" : target.alter === -1 ? "♭" : "";
    this.onStepChange({
      measureNumber: target.measureNumber,
      globalNoteIndex: target.globalIndex,
      pitch: target.step ? `${target.step}${acc}${target.octave}` : "Rest",
      frequencyHz: target.isRest ? 0 : target.frequencyHz || 0
    });
  }

  seekToMeasure(measureNumber) {
    const idx = this.flattenedNotes.findIndex((n) => n.measureNumber === Number(measureNumber));
    if (idx >= 0) {
      this.seekToNote(idx);
    }
  }
}
