import { describe, expect, it } from "vitest";
import type { FlatScore } from "./flatten.js";
import { makeLayout } from "./layout.js";

const flat: FlatScore = {
  divisions: 480,
  notes: [],
  measures: [],
  totalTicks: 4 * 1920,
  minMidi: 48,
  maxMidi: 72,
  voiceKeys: [],
  voices: [],
};

describe("makeLayout", () => {
  const layout = makeLayout(flat);

  it("pads the midi range and sizes the content", () => {
    expect(layout.minMidi).toBe(46);
    expect(layout.maxMidi).toBe(74);
    expect(layout.rows).toBe(29);
    expect(layout.contentHeight).toBe(29 * layout.rowH);
    // 16th-note slots: 4 measures of 16 slots each.
    expect(layout.contentWidth).toBe(layout.leftGutter + 64 * layout.colW);
  });

  it("round-trips tick ⇄ x and midi ⇄ y", () => {
    for (const tick of [0, 480, 1920, flat.totalTicks]) {
      expect(layout.xToTick(layout.tickToX(tick))).toBeCloseTo(tick, 6);
    }
    for (const midi of [layout.minMidi, 60, layout.maxMidi]) {
      // midiToY gives the row's top edge; sample the row's middle.
      expect(layout.yToMidi(layout.midiToY(midi) + layout.rowH / 2)).toBe(midi);
    }
  });

  it("honors a custom column width", () => {
    const wide = makeLayout(flat, { colW: 24 });
    expect(wide.colW).toBe(24);
    expect(wide.contentWidth).toBe(wide.leftGutter + 64 * 24);
  });
});
