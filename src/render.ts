/**
 * Canvas 2D renderer for the piano roll. One pure entry point, {@link drawScene},
 * paints the whole view; components call it on changes and on each animation
 * frame while playing.
 *
 * The scene state covers both consumers' needs: editing overlays (selection,
 * click-drag draft note) and live practice state (held keys as green bands +
 * lit gutter keys, wait-mode target notes, muted voices). Every field is
 * optional — pass only what the app uses.
 */
import { midiToPitch } from "music-json";
import type { FlatScore, PlacedNote } from "./flatten.js";
import type { GridLayout } from "./layout.js";

const BLACK_PCS = new Set([1, 3, 6, 8, 10]); // C# D# F# G# A#

/** Whether a MIDI pitch is a black key. */
export function isBlack(midi: number): boolean {
  return BLACK_PCS.has(((midi % 12) + 12) % 12);
}

/** Palette assigned to voices in first-seen order. */
export const VOICE_COLORS = [
  "#4f8cff",
  "#ff6b6b",
  "#34c759",
  "#ff9f0a",
  "#bf5af2",
  "#5ac8fa",
  "#ffd60a",
];

const COLORS = {
  bg: "#11151c",
  rowWhite: "#1a2029",
  rowBlack: "#141923",
  line16th: "#222a36",
  lineBeat: "#33414f",
  lineMeasure: "#5b6b7d",
  octaveLine: "#2b3645",
  gutterWhite: "#e9edf2",
  gutterBlack: "#2a2f38",
  gutterText: "#5a6675",
  gutterBorder: "#0c0f14",
  gutterHeld: "#34c759",
  heldBand: "rgba(52, 199, 89, 0.16)",
  noteStroke: "rgba(0,0,0,0.45)",
  target: "#ffd60a",
  playhead: "#ff4d4d",
};

export function buildVoiceColorMap(voiceKeys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  voiceKeys.forEach((key, i) => map.set(key, VOICE_COLORS[i % VOICE_COLORS.length]));
  return map;
}

/** Note being created by a click-drag, drawn as a translucent preview. */
export interface DraftNote {
  startTick: number;
  durTick: number;
  midi: number;
}

export interface SceneState {
  playheadTick?: number | null;
  /** Keys currently held on the instrument — green bands + lit gutter keys. */
  heldMidi?: Set<number>;
  /** Ids of the current wait-mode target notes, outlined with a yellow glow. */
  targetIds?: Set<string>;
  /** Voices disabled in wait mode — drawn dimmed and never marked as targets. */
  mutedVoices?: Set<string>;
  /** Id of the currently selected note, highlighted with a bright outline. */
  selectedId?: string | null;
  /** Note being created by a click-drag, drawn as a translucent preview. */
  draft?: DraftNote | null;
  /** Color for the draft preview (the active voice's color). */
  draftColor?: string;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** Trace a note's rounded rectangle (shared by fill, selection, and draft). */
function traceNoteRect(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  startTick: number,
  durTick: number,
  midi: number,
): void {
  const { rowH, colW, slotTicks } = layout;
  const x = layout.tickToX(startTick);
  const w = Math.max(2, (durTick / slotTicks) * colW - 1);
  const y = layout.midiToY(midi);
  roundRect(ctx, x + 0.5, y + 0.5, w, rowH - 1, 3);
}

function drawRows(ctx: CanvasRenderingContext2D, layout: GridLayout): void {
  const { minMidi, maxMidi, leftGutter, contentWidth, rowH } = layout;
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const y = layout.midiToY(midi);
    ctx.fillStyle = isBlack(midi) ? COLORS.rowBlack : COLORS.rowWhite;
    ctx.fillRect(leftGutter, y, contentWidth - leftGutter, rowH);
    // Subtle separator below each B→C boundary (octave line).
    if (((midi % 12) + 12) % 12 === 0) {
      ctx.fillStyle = COLORS.octaveLine;
      ctx.fillRect(leftGutter, y + rowH - 1, contentWidth - leftGutter, 1);
    }
  }
}

function drawHeldBands(ctx: CanvasRenderingContext2D, layout: GridLayout, held: Set<number>): void {
  ctx.fillStyle = COLORS.heldBand;
  for (const midi of held) {
    if (midi < layout.minMidi || midi > layout.maxMidi) continue;
    ctx.fillRect(layout.leftGutter, layout.midiToY(midi), layout.contentWidth - layout.leftGutter, layout.rowH);
  }
}

function drawGridLines(ctx: CanvasRenderingContext2D, layout: GridLayout, flat: FlatScore): void {
  const { slotTicks, contentHeight } = layout;
  const measureStarts = new Set(flat.measures.map((m) => m.startTick));

  // Beat ticks: per measure, a beat = divisions * 4 / beatType.
  const beatStarts = new Set<number>();
  for (const m of flat.measures) {
    const beatLen = (flat.divisions * 4) / m.time.beatType;
    for (let t = m.startTick; t < m.endTick; t += beatLen) beatStarts.add(t);
  }

  const line = (tick: number, color: string) => {
    const x = Math.round(layout.tickToX(tick)) + 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, contentHeight);
    ctx.stroke();
  };

  // 16th lines first (faintest), then beats, then measures on top.
  for (let tick = 0; tick <= flat.totalTicks; tick += slotTicks) {
    if (measureStarts.has(tick) || beatStarts.has(tick)) continue;
    line(tick, COLORS.line16th);
  }
  for (const tick of beatStarts) {
    if (measureStarts.has(tick)) continue;
    line(tick, COLORS.lineBeat);
  }
  // Thin vertical lines separating measures (incl. the final barline).
  for (const tick of measureStarts) line(tick, COLORS.lineMeasure);
  line(flat.totalTicks, COLORS.lineMeasure);
}

function drawNotes(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  notes: PlacedNote[],
  colors: Map<string, string>,
  targetIds: ReadonlySet<string>,
  mutedVoices?: Set<string>,
): void {
  for (const note of notes) {
    const muted = mutedVoices?.has(note.voiceKey) ?? false;
    traceNoteRect(ctx, layout, note.startTick, note.durTick, note.midi);
    ctx.globalAlpha = muted ? 0.25 : 1;
    ctx.fillStyle = colors.get(note.voiceKey) ?? VOICE_COLORS[0];
    ctx.fill();
    if (!muted && targetIds.has(note.id)) {
      ctx.strokeStyle = COLORS.target;
      ctx.lineWidth = 2.5;
    } else {
      ctx.strokeStyle = COLORS.noteStroke;
      ctx.lineWidth = 1;
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawFingerLabels(ctx, layout, notes, mutedVoices);
}

/** Fingering numbers inside the note rectangles (when annotated and legible). */
function drawFingerLabels(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  notes: PlacedNote[],
  mutedVoices?: Set<string>,
): void {
  const { rowH, colW, slotTicks } = layout;
  if (rowH < 10) return;
  ctx.font = "bold 9px ui-monospace, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.75)";
  for (const note of notes) {
    if (note.finger == null || mutedVoices?.has(note.voiceKey)) continue;
    const w = (note.durTick / slotTicks) * colW;
    if (w < 14) continue;
    const x = layout.tickToX(note.startTick);
    ctx.fillText(String(note.finger), x + 4, layout.midiToY(note.midi) + rowH / 2);
  }
  ctx.textAlign = "left";
}

function drawSelection(ctx: CanvasRenderingContext2D, layout: GridLayout, note: PlacedNote): void {
  traceNoteRect(ctx, layout, note.startTick, note.durTick, note.midi);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawDraft(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  draft: DraftNote,
  color: string,
): void {
  traceNoteRect(ctx, layout, draft.startTick, draft.durTick, draft.midi);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.55;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawGutter(ctx: CanvasRenderingContext2D, layout: GridLayout, held?: Set<number>): void {
  const { minMidi, maxMidi, leftGutter, rowH } = layout;
  ctx.fillStyle = COLORS.gutterBorder;
  ctx.fillRect(0, 0, leftGutter, layout.contentHeight);
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    const y = layout.midiToY(midi);
    if (held?.has(midi)) {
      ctx.fillStyle = COLORS.gutterHeld;
    } else {
      ctx.fillStyle = isBlack(midi) ? COLORS.gutterBlack : COLORS.gutterWhite;
    }
    ctx.fillRect(0, y, leftGutter - 1, rowH - 1);
    // Label every C.
    if (((midi % 12) + 12) % 12 === 0) {
      ctx.fillStyle = COLORS.gutterText;
      ctx.fillText(midiToPitch(midi), 6, y + rowH / 2);
    }
  }
}

function drawPlayhead(ctx: CanvasRenderingContext2D, layout: GridLayout, tick: number): void {
  const x = Math.round(layout.tickToX(tick)) + 0.5;
  ctx.strokeStyle = COLORS.playhead;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, 0);
  ctx.lineTo(x, layout.contentHeight);
  ctx.stroke();
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  flat: FlatScore,
  colors: Map<string, string>,
  state: SceneState = {},
): void {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, layout.contentWidth, layout.contentHeight);
  drawRows(ctx, layout);
  if (state.heldMidi?.size) drawHeldBands(ctx, layout, state.heldMidi);
  drawGridLines(ctx, layout, flat);
  drawNotes(ctx, layout, flat.notes, colors, state.targetIds ?? EMPTY_IDS, state.mutedVoices);
  if (state.selectedId != null) {
    const sel = flat.notes.find((n) => n.id === state.selectedId);
    if (sel) drawSelection(ctx, layout, sel);
  }
  if (state.draft) drawDraft(ctx, layout, state.draft, state.draftColor ?? VOICE_COLORS[0]);
  drawGutter(ctx, layout, state.heldMidi);
  if (state.playheadTick != null) drawPlayhead(ctx, layout, state.playheadTick);
}

export const KEYBOARD_WIDTH = 72;

const KB = {
  bg: "#0c0f14",
  white: "#e9edf2",
  whiteEdge: "#b9c1cc",
  black: "#1b2027",
  label: "#5a6675",
};

/**
 * Draw a vertical piano keyboard (one key per pitch row, aligned with the grid)
 * into a `KEYBOARD_WIDTH`-wide canvas. `highlight` keys are lit. Drawn into its
 * own canvas so it can be pinned beside the scrollable roll.
 */
export function drawKeyboard(
  ctx: CanvasRenderingContext2D,
  layout: GridLayout,
  highlight: Set<number>,
  hiliteColor = COLORS.gutterHeld,
): void {
  const { minMidi, maxMidi, rowH } = layout;
  const w = KEYBOARD_WIDTH;

  ctx.fillStyle = KB.bg;
  ctx.fillRect(0, 0, w, layout.contentHeight);

  // White keys span the full width.
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (isBlack(midi)) continue;
    const y = layout.midiToY(midi);
    ctx.fillStyle = highlight.has(midi) ? hiliteColor : KB.white;
    ctx.fillRect(0, y, w, rowH);
    ctx.strokeStyle = KB.whiteEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y + rowH - 0.5);
    ctx.lineTo(w, y + rowH - 0.5);
    ctx.stroke();
  }

  // Black keys are narrower and protrude from the roll-facing (left) edge.
  const blackW = Math.round(w * 0.62);
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (!isBlack(midi)) continue;
    const y = layout.midiToY(midi);
    ctx.fillStyle = highlight.has(midi) ? hiliteColor : KB.black;
    ctx.fillRect(0, y + 1, blackW, rowH - 2);
  }

  // Octave labels on each C.
  ctx.font = "10px ui-monospace, monospace";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  ctx.fillStyle = KB.label;
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (((midi % 12) + 12) % 12 === 0) ctx.fillText(midiToPitch(midi), w - 5, layout.midiToY(midi) + rowH / 2);
  }
  ctx.textAlign = "left";
}

/** Find the topmost note at a content-space pixel position, or null. */
export function hitTestNote(layout: GridLayout, notes: PlacedNote[], x: number, y: number): PlacedNote | null {
  const { rowH, colW, slotTicks } = layout;
  for (let i = notes.length - 1; i >= 0; i--) {
    const n = notes[i];
    const nx = layout.tickToX(n.startTick);
    const nw = (n.durTick / slotTicks) * colW;
    const ny = layout.midiToY(n.midi);
    if (x >= nx && x <= nx + nw && y >= ny && y <= ny + rowH) return n;
  }
  return null;
}

/** Trace a rounded rectangle path (no fill/stroke). */
export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
