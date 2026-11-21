/**
 * Linnet Score — SVG Score Engraver
 * Renders parsed MusicXML into an interactive, zoomable SVG score sheet using
 * the "Lush & Nude" palette (#FAF6F0 Warm Alabaster canvas, #1C1917 Espresso Obsidian staves/notes,
 * #1B3B2B Lush Cypress playback cursor).
 */

const STEP_DIATONIC_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

function escapeXml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatPitchLabel(note) {
  if (note.isRest || !note.step) return "Rest";
  const acc = note.alter === 1 ? "♯" : note.alter === -1 ? "♭" : "";
  return `${note.step}${acc}${note.octave}`;
}

/**
 * Calculates vertical Y position on a treble staff where bottom line E4 = staffTop + 40 (10px line spacing).
 */
export function pitchToStaffY(step, octave, staffTop = 110, lineSpacing = 10) {
  const diatonicFromC4 = (Number(octave) - 4) * 7 + (STEP_DIATONIC_INDEX[step] ?? 0);
  // Bottom line of Treble clef is E4 (diatonicFromC4 = 2), located at staffTop + 4 * lineSpacing
  const halfSpaceStepsFromE4 = diatonicFromC4 - 2;
  return staffTop + 4 * lineSpacing - halfSpaceStepsFromE4 * (lineSpacing / 2);
}

/**
 * Renders a parsed MusicXML score object into a complete SVG string with interactive measure & note attributes.
 */
export function renderScoreToSVG(scoreModel, { activeMeasure = 1, activeNoteGlobalIndex = -1, zoom = 1.0 } = {}) {
  const width = 880;
  const height = 270;
  const staffTop = 115;
  const lineSpacing = 10;
  const staffLeft = 48;
  const staffRight = width - 36;
  const usableWidth = staffRight - staffLeft - 72; // Leave room for clef + time signature
  const measureCount = Math.max(1, scoreModel.measures.length);
  const measureWidth = usableWidth / measureCount;

  const staffLinesSvg = [0, 1, 2, 3, 4]
    .map((lineIdx) => {
      const y = staffTop + lineIdx * lineSpacing;
      return `<line x1="${staffLeft}" y1="${y}" x2="${staffRight}" y2="${y}" stroke="#1C1917" stroke-width="1.25" stroke-opacity="0.78" />`;
    })
    .join("\n    ");

  let globalNoteCounter = 0;
  let cursorX = staffLeft + 74;

  const measuresSvg = scoreModel.measures
    .map((measure, mIdx) => {
      const mStartX = staffLeft + 72 + mIdx * measureWidth;
      const mEndX = mStartX + measureWidth;
      const isMeasureActive = measure.measureNumber === activeMeasure;

      const highlightRect = `<rect class="measure-highlight" x="${mStartX}" y="${staffTop - 18}" width="${measureWidth}" height="${lineSpacing * 4 + 36}" rx="6" />`;

      const chordSvg = measure.chordSymbols
        .map(
          (chord, cIdx) =>
            `<text x="${mStartX + 18 + cIdx * 48}" y="${staffTop - 22}" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="600" fill="#1B3B2B">${escapeXml(chord)}</text>`
        )
        .join("");

      const noteCount = Math.max(1, measure.notes.length);
      const noteSpacing = (measureWidth - 28) / noteCount;

      const notesSvg = measure.notes
        .map((note, nIdx) => {
          const currentGlobalIdx = globalNoteCounter++;
          const nx = mStartX + 20 + nIdx * noteSpacing;
          const ny = note.isRest ? staffTop + 20 : pitchToStaffY(note.step, note.octave, staffTop, lineSpacing);
          const isNoteActive = currentGlobalIdx === activeNoteGlobalIndex;
          if (isNoteActive) {
            cursorX = nx;
          }

          const pitchLabel = formatPitchLabel(note);
          const freqVal = note.isRest ? 0 : note.frequencyHz || 0;
          const noteColor = isNoteActive ? "#1B3B2B" : "#1C1917";
          const noteRadiusX = 6.2;
          const noteRadiusY = 4.6;
          const isHollow = note.noteType === "half" || note.noteType === "whole";
          const hasStem = note.noteType !== "whole";
          const stemUp = ny >= staffTop + 20;
          const stemX = stemUp ? nx + 5.2 : nx - 5.2;
          const stemY2 = stemUp ? ny - 30 : ny + 30;

          // Ledger line for C4 (below bottom line E4) or A5 (above top line F5)
          let ledgerSvg = "";
          if (!note.isRest && ny >= staffTop + 5 * lineSpacing) {
            ledgerSvg = `<line x1="${nx - 10}" y1="${staffTop + 5 * lineSpacing}" x2="${nx + 10}" y2="${staffTop + 5 * lineSpacing}" stroke="#1C1917" stroke-width="1.3" />`;
          } else if (!note.isRest && ny <= staffTop - lineSpacing) {
            ledgerSvg = `<line x1="${nx - 10}" y1="${staffTop - lineSpacing}" x2="${nx + 10}" y2="${staffTop - lineSpacing}" stroke="#1C1917" stroke-width="1.3" />`;
          }

          const accidentalSymbol = note.alter === 1 ? "♯" : note.alter === -1 ? "♭" : "";
          const accidentalSvg = accidentalSymbol
            ? `<text x="${nx - 16}" y="${ny + 4}" font-family="serif" font-size="14" fill="${noteColor}">${accidentalSymbol}</text>`
            : "";

          const lyricSvg = note.lyricText
            ? `<text x="${nx}" y="${staffTop + 66}" text-anchor="middle" font-family="'Figtree', sans-serif" font-size="11" fill="#655B52">${escapeXml(note.lyricText)}</text>`
            : "";

          const interactiveAttrs = note.isRest
            ? `role="presentation"`
            : `tabindex="0" role="button" aria-label="Play ${escapeXml(pitchLabel)} in measure ${measure.measureNumber}"`;

          return `<g class="linnet-note${isNoteActive ? " is-active" : ""}" data-measure="${measure.measureNumber}" data-note-index="${currentGlobalIdx}" data-x="${nx.toFixed(1)}" data-pitch="${escapeXml(pitchLabel)}" data-freq="${freqVal}" ${interactiveAttrs}>
        <circle class="note-halo" cx="${nx}" cy="${ny}" r="12" />
        ${ledgerSvg}
        ${accidentalSvg}
        <ellipse cx="${nx}" cy="${ny}" rx="${noteRadiusX}" ry="${noteRadiusY}" transform="rotate(-18 ${nx} ${ny})" fill="${isHollow ? "#FAF6F0" : noteColor}" stroke="${noteColor}" stroke-width="1.8" />
        ${hasStem ? `<line x1="${stemX}" y1="${ny}" x2="${stemX}" y2="${stemY2}" stroke="${noteColor}" stroke-width="1.6" />` : ""}
        ${lyricSvg}
        <rect class="note-hit" x="${(nx - 12).toFixed(1)}" y="${(ny - 18).toFixed(1)}" width="24" height="36" rx="6" fill="transparent" />
      </g>`;
        })
        .join("\n      ");

      const barlineSvg = `<line x1="${mEndX}" y1="${staffTop}" x2="${mEndX}" y2="${staffTop + 4 * lineSpacing}" stroke="#1C1917" stroke-width="${mIdx === measureCount - 1 ? "2.6" : "1.3"}" />`;
      const measureNumSvg = `<text x="${mStartX + 4}" y="${staffTop - 8}" font-family="'JetBrains Mono', monospace" font-size="9.5" fill="#655B52">${measure.measureNumber}</text>`;

      return `<g class="linnet-measure${isMeasureActive ? " is-active" : ""}" data-measure-number="${measure.measureNumber}">
      ${highlightRect}
      ${measureNumSvg}
      ${chordSvg}
      ${notesSvg}
      ${barlineSvg}
    </g>`;
    })
    .join("\n    ");

  const firstMeasure = scoreModel.measures[0] || { beats: 4, beatType: 4 };
  const scaledWidth = Math.round(width * zoom);
  const scaledHeight = Math.round(height * zoom);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${scaledWidth}" height="${scaledHeight}" role="img" aria-label="${escapeXml(scoreModel.title)} musical notation score">
  <rect width="${width}" height="${height}" rx="10" fill="#FAF6F0" />
  <!-- Score Engraved Title & Attribution -->
  <text x="${width / 2}" y="38" text-anchor="middle" font-family="'Chillax', sans-serif" font-size="22" font-weight="600" fill="#1C1917">${escapeXml(scoreModel.title)}</text>
  <text x="${staffRight}" y="58" text-anchor="end" font-family="'Figtree', sans-serif" font-size="11.5" fill="#655B52">${escapeXml(scoreModel.composer)}</text>
  <text x="${staffLeft}" y="58" font-family="'JetBrains Mono', monospace" font-size="11" font-weight="600" fill="#2E5A44">♩ = ${scoreModel.defaultTempo} BPM</text>

  <!-- 5-Line Engraved Staff -->
  <g class="linnet-staff">
    ${staffLinesSvg}
    <line x1="${staffLeft}" y1="${staffTop}" x2="${staffLeft}" y2="${staffTop + 4 * lineSpacing}" stroke="#1C1917" stroke-width="2" />
    <!-- Treble Clef & Time Signature -->
    <text x="${staffLeft + 8}" y="${staffTop + 34}" font-family="serif" font-size="44" fill="#1C1917">𝄞</text>
    <text x="${staffLeft + 44}" y="${staffTop + 18}" font-family="serif" font-size="17" font-weight="700" fill="#1C1917">${firstMeasure.beats}</text>
    <text x="${staffLeft + 44}" y="${staffTop + 36}" font-family="serif" font-size="17" font-weight="700" fill="#1C1917">${firstMeasure.beatType}</text>
  </g>

  <!-- Engraved Measures & Notes -->
  <g class="linnet-measures">
    ${measuresSvg}
  </g>

  <!-- Smooth Gliding Lush Cypress Playback Cursor -->
  <line class="linnet-playback-cursor" x1="0" y1="${staffTop - 16}" x2="0" y2="${staffTop + 4 * lineSpacing + 16}" stroke="#1B3B2B" stroke-width="2.2" stroke-dasharray="3,2" data-default-x="${(staffLeft + 74).toFixed(1)}" data-active="${activeNoteGlobalIndex >= 0 ? "true" : "false"}" style="transform: translateX(${cursorX.toFixed(1)}px)" />
</svg>`;
}
