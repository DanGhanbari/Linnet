import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMusicXML,
  pitchToFrequency,
  BENCHMARK_SCORES,
  renderScoreToSVG
} from "../src/index.mjs";

test("S-05 & S-12: parseMusicXML parses all 3 benchmark scores (Solo Piano, Choral SATB, Lead Sheet)", () => {
  for (const [key, preset] of Object.entries(BENCHMARK_SCORES)) {
    const model = parseMusicXML(preset.musicXML);
    assert.equal(model.totalMeasures, 4, `Expected 4 measures for ${key}`);
    assert.ok(model.defaultTempo >= 90 && model.defaultTempo <= 140);
    assert.ok(model.measures[0].notes.length >= 3);
  }
});

test("S-06: pitchToFrequency calculates accurate A4=440Hz and C4=261.63Hz frequencies for Web Audio synth", () => {
  const a4 = pitchToFrequency("A", 4, 0);
  assert.equal(a4.midi, 69);
  assert.equal(a4.frequencyHz, 440);

  const c4 = pitchToFrequency("C", 4, 0);
  assert.equal(c4.midi, 60);
  assert.equal(c4.frequencyHz, 261.63);
});

test("S-05 & D-03: renderScoreToSVG engraves #FAF6F0 Warm Alabaster canvas, #1C1917 Obsidian notes, and #1B3B2B Cypress cursor", () => {
  const model = parseMusicXML(BENCHMARK_SCORES.solo_piano.musicXML);
  const svg = renderScoreToSVG(model, { activeMeasure: 2, activeNoteGlobalIndex: 4 });

  assert.ok(svg.startsWith("<svg"));
  assert.ok(svg.includes("#FAF6F0"), "Should use Warm Alabaster canvas backdrop");
  assert.ok(svg.includes("#1C1917"), "Should use Espresso Obsidian for staves and notes");
  assert.ok(svg.includes("#1B3B2B"), "Should use Lush Cypress for active playback cursor");
  assert.ok(svg.includes("Chillax"), "Should use Chillax display font in engraved SVG title");
  assert.ok(svg.includes("Nocturne in E-Flat Major"), "Should engrave score title");
  assert.ok(svg.includes('data-x='), "Should emit data-x coordinates for smooth cursor translation");
  assert.ok(svg.includes('data-pitch='), "Should emit data-pitch metadata for live pitch readout");
  assert.ok(svg.includes('role="button"'), "Should mark playable notes as interactive buttons");
  assert.ok(svg.includes("linnet-playback-cursor"), "Should render playback cursor element");
});

