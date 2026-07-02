import { describe, expect, it } from "vitest";
import type { Score } from "music-json";
import { parseScoreOrThrow } from "music-json";
import { buildMeasureMarks, flattenScore, measureTicks } from "./flatten.js";
import twinkle from "../samples/twinkle.music.json";

const score = parseScoreOrThrow(JSON.stringify(twinkle));

describe("measureTicks", () => {
  it("computes ticks per measure from the time signature", () => {
    expect(measureTicks({ beats: 4, beatType: 4 }, 480)).toBe(1920);
    expect(measureTicks({ beats: 3, beatType: 4 }, 480)).toBe(1440);
    expect(measureTicks({ beats: 6, beatType: 8 }, 480)).toBe(1440);
  });
});

describe("buildMeasureMarks", () => {
  it("resolves sticky time and tempo across the timeline", () => {
    const marks = buildMeasureMarks(
      [
        { time: { beats: 3, beatType: 4 }, tempo: { bpm: 90 } },
        {},
        { time: { beats: 4, beatType: 4 } },
      ],
      480,
    );
    expect(marks).toHaveLength(3);
    expect(marks[0]).toMatchObject({ index: 0, startTick: 0, endTick: 1440, bpm: 90 });
    expect(marks[1]).toMatchObject({ index: 1, startTick: 1440, endTick: 2880, bpm: 90 });
    expect(marks[2]).toMatchObject({ index: 2, startTick: 2880, endTick: 4800, bpm: 90 });
  });
});

describe("flattenScore", () => {
  const flat = flattenScore(score);

  it("covers the whole timeline with contiguous measures", () => {
    expect(flat.measures.length).toBe(score.measures.length);
    let tick = 0;
    for (const m of flat.measures) {
      expect(m.startTick).toBe(tick);
      tick = m.endTick;
    }
    expect(flat.totalTicks).toBe(tick);
  });

  it("assigns stable unique ids to every note", () => {
    const ids = new Set(flat.notes.map((n) => n.id));
    expect(ids.size).toBe(flat.notes.length);
  });

  it("keeps every note within the timeline and the midi range", () => {
    for (const n of flat.notes) {
      expect(n.startTick).toBeGreaterThanOrEqual(0);
      expect(n.startTick + n.durTick).toBeLessThanOrEqual(flat.totalTicks);
      expect(n.midi).toBeGreaterThanOrEqual(flat.minMidi);
      expect(n.midi).toBeLessThanOrEqual(flat.maxMidi);
    }
  });

  it("labels the grand-staff voices by staff id", () => {
    expect(flat.voiceKeys.length).toBe(flat.voices.length);
    expect(flat.voices.map((v) => v.label)).toEqual(["treble", "bass"]);
  });

  it("handles an empty score with a sane default range", () => {
    const empty: Score = { format: "music.json", version: "0.1.0", measures: [], parts: [] };
    const f = flattenScore(empty);
    expect(f.notes).toEqual([]);
    expect(f.totalTicks).toBe(0);
    expect(f.minMidi).toBe(60);
    expect(f.maxMidi).toBe(72);
  });
});
