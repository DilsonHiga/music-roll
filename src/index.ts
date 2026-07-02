/**
 * `music-roll` — shared piano-roll engine for `.music.json` apps.
 *
 * Score flattening, grid geometry, canvas rendering, and Web Audio playback.
 * Both the editor app and the piano trainer depend on this; the `.music.json`
 * format itself lives in the sibling `music-json` package.
 */
export {
  flattenScore,
  buildMeasureMarks,
  measureTicks,
  DEFAULT_TIME,
  DEFAULT_BPM,
  type FlatScore,
  type PlacedNote,
  type MeasureMark,
  type VoiceInfo,
} from "./flatten.js";

export { makeLayout, type GridLayout, type LayoutOpts } from "./layout.js";

export {
  drawScene,
  drawKeyboard,
  buildVoiceColorMap,
  hitTestNote,
  isBlack,
  roundRect,
  VOICE_COLORS,
  KEYBOARD_WIDTH,
  type SceneState,
  type DraftNote,
} from "./render.js";

export { Player, type PlayerOpts } from "./player.js";
