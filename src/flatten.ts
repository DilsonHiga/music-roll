/**
 * Flatten a hierarchical {@link Score} into flat arrays the piano-roll grid and
 * the audio player can consume directly:
 *
 *   - `notes`: every sounding note with an **absolute** start tick + MIDI pitch
 *   - `measures`: each bar's absolute tick span, resolved time signature & tempo
 *
 * Rests advance time but produce no note. Chords yield one note per pitch,
 * sharing a start tick and duration. Every note gets a stable id so renderers
 * can mark selection/targets/hits.
 */
import type { GlobalMeasure, Score, TimeSignature } from "music-json";
import { pitchToMidi } from "music-json";

export interface PlacedNote {
  /** Stable id (used for selection, hit-testing, and practice targets). */
  id: string;
  startTick: number;
  durTick: number;
  midi: number;
  pitch: string;
  /** `partId.staffId.voiceId` — used to color notes by voice. */
  voiceKey: string;
}

export interface MeasureMark {
  index: number;
  startTick: number;
  endTick: number;
  time: TimeSignature;
  bpm: number;
}

/** A distinct voice (part.staff.voice) with a human-friendly label for the UI. */
export interface VoiceInfo {
  key: string;
  label: string;
}

export interface FlatScore {
  divisions: number;
  notes: PlacedNote[];
  measures: MeasureMark[];
  totalTicks: number;
  minMidi: number;
  maxMidi: number;
  /** Distinct voice keys, in first-seen order — drives the color assignment. */
  voiceKeys: string[];
  voices: VoiceInfo[];
}

export const DEFAULT_TIME: TimeSignature = { beats: 4, beatType: 4 };
export const DEFAULT_BPM = 120;

/** Ticks occupied by one measure of the given time signature. */
export function measureTicks(time: TimeSignature, divisions: number): number {
  return time.beats * (4 / time.beatType) * divisions;
}

/** Resolve sticky time/tempo and compute each measure's absolute tick span. */
export function buildMeasureMarks(globals: GlobalMeasure[], divisions: number): MeasureMark[] {
  const measures: MeasureMark[] = [];
  let tick = 0;
  let time = DEFAULT_TIME;
  let bpm = DEFAULT_BPM;
  for (let i = 0; i < globals.length; i++) {
    const gm = globals[i];
    if (gm.time) time = gm.time;
    if (gm.tempo?.bpm) bpm = gm.tempo.bpm;
    const dur = measureTicks(time, divisions);
    measures.push({ index: i, startTick: tick, endTick: tick + dur, time, bpm });
    tick += dur;
  }
  return measures;
}

export interface FlattenOpts {
  /**
   * Merge tie chains (`tie: "start" → "continue"* → "stop"`) into single
   * sustained notes instead of one note per written event. Right for playback
   * and practice (a tied note is struck once); leave off to mirror the written
   * events one-to-one.
   */
  mergeTies?: boolean;
}

export function flattenScore(score: Score, opts: FlattenOpts = {}): FlatScore {
  const divisions = score.divisions ?? 480;
  const measures = buildMeasureMarks(score.measures ?? [], divisions);
  const totalTicks = measures.length ? measures[measures.length - 1].endTick : 0;

  const notes: PlacedNote[] = [];
  const voiceKeys: string[] = [];
  const voiceParts = new Map<string, { part: string; staff: string; voice: string }>();
  const seen = new Set<string>();
  // Tie-open notes eligible to be extended by the next event: `voice|midi` →
  // the note whose written duration ends where the continuation starts.
  const open = new Map<string, PlacedNote>();
  let minMidi = Infinity;
  let maxMidi = -Infinity;
  let counter = 0;

  for (const part of score.parts ?? []) {
    for (const staff of part.staves) {
      staff.measures.forEach((measure, mIdx) => {
        const base = measures[mIdx]?.startTick ?? 0;
        for (const voice of measure.voices) {
          const voiceKey = `${part.id}.${staff.id}.${voice.id}`;
          if (!seen.has(voiceKey)) {
            seen.add(voiceKey);
            voiceKeys.push(voiceKey);
            voiceParts.set(voiceKey, {
              part: part.name ?? part.id,
              staff: staff.id,
              voice: voice.id,
            });
          }
          let t = base;
          for (const ev of voice.events) {
            const tie = ev.tie ?? null;
            for (const pitch of ev.pitches) {
              const midi = pitchToMidi(pitch);
              minMidi = Math.min(minMidi, midi);
              maxMidi = Math.max(maxMidi, midi);

              const key = `${voiceKey}|${midi}`;
              if (opts.mergeTies && (tie === "stop" || tie === "continue")) {
                const prev = open.get(key);
                if (prev && prev.startTick + prev.durTick === t) {
                  prev.durTick += ev.duration;
                  if (tie === "stop") open.delete(key);
                  continue;
                }
              }
              const note: PlacedNote = {
                id: `n${counter++}`,
                startTick: t,
                durTick: ev.duration,
                midi,
                pitch,
                voiceKey,
              };
              notes.push(note);
              if (opts.mergeTies && (tie === "start" || tie === "continue")) open.set(key, note);
            }
            t += ev.duration;
          }
        }
      });
    }
  }

  if (!Number.isFinite(minMidi)) {
    minMidi = 60;
    maxMidi = 72;
  }

  const voices = buildVoiceLabels(voiceKeys, voiceParts);

  return { divisions, notes, measures, totalTicks, minMidi, maxMidi, voiceKeys, voices };
}

/**
 * Friendly labels for each voice: just the staff id when that's unambiguous,
 * disambiguated with the part name (multiple parts) and/or voice id (multiple
 * voices share a staff) only where needed.
 */
function buildVoiceLabels(
  voiceKeys: string[],
  parts: Map<string, { part: string; staff: string; voice: string }>,
): VoiceInfo[] {
  const distinctParts = new Set([...parts.values()].map((p) => p.part)).size;
  const voicesPerStaff = new Map<string, number>();
  for (const p of parts.values()) {
    const k = `${p.part}.${p.staff}`;
    voicesPerStaff.set(k, (voicesPerStaff.get(k) ?? 0) + 1);
  }
  return voiceKeys.map((key) => {
    const p = parts.get(key)!;
    let label = p.staff;
    if (distinctParts > 1) label = `${p.part} · ${label}`;
    if ((voicesPerStaff.get(`${p.part}.${p.staff}`) ?? 1) > 1) label = `${label} ${p.voice}`;
    return { key, label };
  });
}
