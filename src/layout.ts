/**
 * Grid geometry for the piano roll. Maps between musical coordinates
 * (tick, MIDI pitch) and pixel coordinates. Higher pitches sit at the top;
 * each row is one semitone, each column one 16th-note slot.
 */
import type { FlatScore } from "./flatten.js";

export interface GridLayout {
  rowH: number;
  /** Pixel width of one 16th-note slot. */
  colW: number;
  /** Ticks per column (divisions / 4). */
  slotTicks: number;
  /** Width of the left piano-keyboard gutter. */
  leftGutter: number;
  minMidi: number;
  maxMidi: number;
  rows: number;
  totalTicks: number;
  /** Full drawable size (gutter + grid). */
  contentWidth: number;
  contentHeight: number;
  tickToX(tick: number): number;
  xToTick(x: number): number;
  midiToY(midi: number): number;
  /** MIDI pitch of the row at pixel `y` (floored to a row). */
  yToMidi(y: number): number;
}

export interface LayoutOpts {
  rowH?: number;
  colW?: number;
  leftGutter?: number;
  /** Extra semitones of headroom above/below the content. */
  padSemis?: number;
}

export function makeLayout(flat: FlatScore, opts: LayoutOpts = {}): GridLayout {
  const rowH = opts.rowH ?? 15;
  const colW = opts.colW ?? 22;
  const leftGutter = opts.leftGutter ?? 56;
  const padSemis = opts.padSemis ?? 2;

  const minMidi = flat.minMidi - padSemis;
  const maxMidi = flat.maxMidi + padSemis;
  const rows = maxMidi - minMidi + 1;

  const slotTicks = flat.divisions / 4;
  const cols = Math.max(1, Math.ceil(flat.totalTicks / slotTicks));

  const contentWidth = leftGutter + cols * colW;
  const contentHeight = rows * rowH;

  return {
    rowH,
    colW,
    slotTicks,
    leftGutter,
    minMidi,
    maxMidi,
    rows,
    totalTicks: flat.totalTicks,
    contentWidth,
    contentHeight,
    tickToX: (tick) => leftGutter + (tick / slotTicks) * colW,
    xToTick: (x) => ((x - leftGutter) / colW) * slotTicks,
    midiToY: (midi) => (maxMidi - midi) * rowH,
    yToMidi: (y) => maxMidi - Math.floor(y / rowH),
  };
}
