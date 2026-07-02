/**
 * Web Audio playback + transport clock for a {@link FlatScore}. Builds a
 * per-measure tempo map (seconds⇄ticks), schedules a short triangle-wave voice
 * per note, and exposes {@link Player.currentTick} so renderers can draw a
 * moving playhead.
 *
 * `load` accepts a tempo factor (< 1 plays slower); `play` can run silently
 * (`withSound = false`) to act as a pure transport clock for play-along
 * practice. This is intentionally a simple synth (no samples/soundfont) —
 * enough to hear the score.
 */
import type { FlatScore } from "./flatten.js";

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Per-note peak amplitude, compensated for pitch. The ear is much less
 * sensitive to low frequencies (equal-loudness contours) and a triangle wave
 * has almost no harmonic content to help small speakers, so bass notes sound
 * far quieter than treble at equal gain. Boost ~0.5 dB per semitone below
 * middle C, capped at +10 dB (~3.2×), so low notes become audible.
 */
function peakForMidi(midi: number, base: number): number {
  const semisBelowMiddleC = Math.max(0, 60 - midi);
  const boostDb = Math.min(10, semisBelowMiddleC * 0.5);
  return base * Math.pow(10, boostDb / 20);
}

/**
 * Harmonic amplitudes for the voice. A bare triangle is nearly a pure tone and
 * sounds thin; adding a falling series of harmonics (index n = n-th harmonic)
 * gives body. The gentle rolloff keeps it warm rather than buzzy. The wave is
 * normalized by the Web Audio API, so peak amplitude stays comparable.
 */
const HARMONICS = [0, 1, 0.6, 0.4, 0.28, 0.2, 0.14, 0.1, 0.07, 0.05];

function buildVoice(ctx: AudioContext): PeriodicWave {
  const imag = new Float32Array(HARMONICS);
  const real = new Float32Array(HARMONICS.length);
  return ctx.createPeriodicWave(real, imag);
}

interface ScheduledNote {
  startSec: number;
  durSec: number;
  freq: number;
  peak: number;
}

interface MeasureTiming {
  startTick: number;
  endTick: number;
  startSec: number;
  secPerTick: number;
}

export interface PlayerOpts {
  /** Base per-note peak amplitude before the low-pitch boost. Default 0.25. */
  basePeak?: number;
}

export interface PlayOpts {
  /** Click on every beat (accented on downbeats), following the tempo map. */
  metronome?: boolean;
  /**
   * With `metronome`, click one full measure (the first measure's meter and
   * tempo) before the music starts. The playhead sits at tick 0 meanwhile.
   */
  countIn?: boolean;
}

interface Click {
  /** Seconds relative to the start of the music. */
  sec: number;
  accent: boolean;
}

export class Player {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private active: OscillatorNode[] = [];
  private scheduled: ScheduledNote[] = [];
  private timings: MeasureTiming[] = [];
  private clicks: Click[] = [];
  private countInClicks: Click[] = [];
  private countInSec = 0;
  private basePeak: number;
  private totalSec = 0;
  private startTime = 0;
  private endTimer: number | null = null;

  playing = false;
  onEnded: (() => void) | null = null;

  constructor(opts: PlayerOpts = {}) {
    this.basePeak = opts.basePeak ?? 0.25;
  }

  /** Build the tempo map + note schedule. `tempoScale` < 1 plays slower. */
  load(flat: FlatScore, tempoScale = 1): void {
    this.stop();
    const scale = Math.max(0.05, tempoScale);

    // Build the per-measure tempo map + the metronome click track.
    this.timings = [];
    this.clicks = [];
    let sec = 0;
    for (const m of flat.measures) {
      const secPerTick = 60 / m.bpm / flat.divisions / scale;
      this.timings.push({ startTick: m.startTick, endTick: m.endTick, startSec: sec, secPerTick });
      const beatSec = ((flat.divisions * 4) / m.time.beatType) * secPerTick;
      for (let b = 0; b < m.time.beats; b++) {
        this.clicks.push({ sec: sec + b * beatSec, accent: b === 0 });
      }
      sec += (m.endTick - m.startTick) * secPerTick;
    }
    this.totalSec = sec;

    // Count-in: one measure of clicks in the first measure's meter and tempo.
    const first = flat.measures[0];
    const t0 = this.timings[0];
    if (first && t0) {
      this.countInSec = (t0.endTick - t0.startTick) * t0.secPerTick;
      const beatSec = ((flat.divisions * 4) / first.time.beatType) * t0.secPerTick;
      this.countInClicks = Array.from({ length: first.time.beats }, (_, b) => ({
        sec: b * beatSec,
        accent: b === 0,
      }));
    } else {
      this.countInSec = 0;
      this.countInClicks = [];
    }

    this.scheduled = flat.notes.map((n) => {
      const startSec = this.tickToSec(n.startTick);
      const endSec = this.tickToSec(n.startTick + n.durTick);
      return {
        startSec,
        durSec: Math.max(0.03, endSec - startSec),
        freq: midiToFreq(n.midi),
        peak: peakForMidi(n.midi, this.basePeak),
      };
    });
  }

  private tickToSec(tick: number): number {
    if (this.timings.length === 0) return 0;
    for (const t of this.timings) {
      if (tick < t.endTick) {
        return t.startSec + (Math.max(tick, t.startTick) - t.startTick) * t.secPerTick;
      }
    }
    const last = this.timings[this.timings.length - 1];
    return last.startSec + (tick - last.startTick) * last.secPerTick;
  }

  private secToTick(sec: number): number {
    if (this.timings.length === 0) return 0;
    for (const t of this.timings) {
      const measureSec = (t.endTick - t.startTick) * t.secPerTick;
      if (sec < t.startSec + measureSec) {
        return t.startTick + (sec - t.startSec) / t.secPerTick;
      }
    }
    return this.timings[this.timings.length - 1].endTick;
  }

  get durationSec(): number {
    return this.totalSec;
  }

  play(withSound = true, opts: PlayOpts = {}): void {
    if (this.playing) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.6;
    // Gentle low-pass tames the upper harmonics so the richer voice stays warm.
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 4500;
    lowpass.Q.value = 0.7;
    this.master.connect(lowpass).connect(ctx.destination);

    const base = ctx.currentTime + 0.05;
    const lead = opts.metronome && opts.countIn ? this.countInSec : 0;
    const t0 = base + lead;
    this.startTime = t0;

    if (opts.metronome) {
      if (lead > 0) for (const c of this.countInClicks) this.scheduleClick(ctx, base + c.sec, c.accent);
      for (const c of this.clicks) this.scheduleClick(ctx, t0 + c.sec, c.accent);
    }

    if (withSound) {
      const voice = buildVoice(ctx);
      for (const note of this.scheduled) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.setPeriodicWave(voice);
        osc.frequency.value = note.freq;

        const start = t0 + note.startSec;
        const end = start + note.durSec;
        const peak = note.peak;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(peak, start + 0.008);
        gain.gain.setValueAtTime(peak, Math.max(start + 0.008, end - 0.05));
        gain.gain.linearRampToValueAtTime(0, end);

        osc.connect(gain).connect(this.master);
        osc.start(start);
        osc.stop(end + 0.02);
        this.active.push(osc);
      }
    }

    this.playing = true;
    this.endTimer = window.setTimeout(() => {
      this.stop();
      this.onEnded?.();
    }, (lead + this.totalSec + 0.2) * 1000);
  }

  /** A short metronome blip: square wave, higher and louder on the downbeat. */
  private scheduleClick(ctx: AudioContext, when: number, accent: boolean): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 1800 : 1200;
    const peak = accent ? 0.4 : 0.25;
    gain.gain.setValueAtTime(0, when);
    gain.gain.linearRampToValueAtTime(peak, when + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.001, when + 0.06);
    osc.connect(gain).connect(this.master!);
    osc.start(when);
    osc.stop(when + 0.08);
    this.active.push(osc);
  }

  stop(): void {
    if (this.endTimer != null) {
      clearTimeout(this.endTimer);
      this.endTimer = null;
    }
    for (const osc of this.active) {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    }
    this.active = [];
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
    this.playing = false;
  }

  /** Current playback position in ticks, or `null` when not playing. */
  currentTick(): number | null {
    if (!this.playing || !this.ctx) return null;
    const elapsed = this.ctx.currentTime - this.startTime;
    return elapsed < 0 ? 0 : this.secToTick(elapsed);
  }
}
