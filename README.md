# music-roll

Shared piano-roll engine for `.music.json` apps. Extracted from the
`music-editor` and `piano-trainer` siblings so the score flattening, grid
geometry, canvas rendering, and Web Audio playback have exactly one
implementation.

The `.music.json` format itself (types, JSON Schema, parser/validator, pitch &
chord helpers) lives in the sibling [`music-json`](../music-json-spec) package —
this package builds on top of it and never re-implements it.

## What's here

| Module | Exports | Purpose |
|--------|---------|---------|
| `flatten` | `flattenScore`, `buildMeasureMarks`, `measureTicks`, `FlatScore`, `PlacedNote`, `MeasureMark`, `VoiceInfo` | Flatten a hierarchical `Score` into absolute-tick notes + a measure/tempo timeline. Every note gets a stable id. |
| `layout` | `makeLayout`, `GridLayout` | Pure pixel ⇄ (tick, MIDI) geometry for the roll grid. |
| `render` | `drawScene`, `drawKeyboard`, `buildVoiceColorMap`, `hitTestNote`, `isBlack`, `roundRect`, `VOICE_COLORS`, `KEYBOARD_WIDTH`, `SceneState` | Canvas 2D renderer. One pure entry point; the optional `SceneState` covers both editing overlays (selection, draft note) and practice state (held keys, targets, muted voices). |
| `player` | `Player` | Web Audio playback + transport clock with a per-measure tempo map, tempo scaling, and an optional silent mode. |

A reference score lives at `samples/twinkle.music.json`, importable as
`music-roll/samples/twinkle.music.json`.

## Usage

```ts
import { flattenScore, makeLayout, drawScene, buildVoiceColorMap, Player } from "music-roll";

const flat = flattenScore(score);           // score: Score from `music-json`
const layout = makeLayout(flat, { colW: 24 });
const colors = buildVoiceColorMap(flat.voiceKeys);
drawScene(ctx, layout, flat, colors, { playheadTick: null });

const player = new Player();
player.load(flat);
player.play();
```

Consumed by the siblings as a `file:` dependency:

```json
{ "dependencies": { "music-roll": "file:../music-roll" } }
```

## Develop

```
npm install     # also builds dist/ via the prepare script
npm run build
npm run typecheck
```
