# octodance

Draw a creature, drop in a track, and watch it dance. Every stroke you draw becomes a limb: strokes that meet rotate about the joint where they touch, parts enclosed by a bigger shape ride along with it, and an audio-reactive rig bends the whole figure to the bass, mids, highs and beat of the music.

Live at **<https://octodance.jyz.land>**.

## Features

- Freehand drawing on a plain canvas — colour picker, removable palette swatches, thickness, eraser, 30-step undo, clear.
- Audio-reactive animation. Three bundled CC0 chiptunes load and play in one click; you can also upload your own file. Bass drives sway, mids drive the bob, highs drive tilt, and an onset detector snaps the pose on each beat.
- An articulation rig, not a whole-image transform. Contacts are found at stroke endpoints, so joints stay welded as the figure moves, and a limb never drags an unenclosed neighbour with it.
- Your drawing survives a reload. Strokes persist to `localStorage` and are restored on mount.
- Light and dark themes. The canvas stays a light sheet of "paper" in both, so ink drawn in one theme can never disappear in the other.
- Hand-rolled `<canvas>` rendering — no drawing library — with a per-frame redraw driven by an `AnalyserNode`.

## Tech stack

- **Next 16** (App Router, Turbopack) + **React 19**
- **TypeScript 7** (native port), `strict`, path alias `@/*` → `./src/*`
- **Tailwind CSS 4** via `@tailwindcss/postcss`
- **Biome 2** (lint + format) · **Bun** (runtime, package manager)
- `react-colorful` for the colour picker; Web Audio API for the analysis
- Self-hosted fonts via `next/font/local`: Satoshi (variable, body) and Code Pro (display)

## Getting started

```bash
bun install
bun dev
```

Open <http://localhost:3000>. Draw something, then hit one of the Chiptune buttons — the figure only dances once a track is playing.

## Scripts

- `bun dev` — dev server
- `bun run build` — production build
- `bun start` — serve the production build
- `bun check` — `biome check --write`

## Repo layout

```
src/
  app/                    layout, page, globals.css, icon.svg, opengraph-image.tsx
  lib/canvas/
    strokes.ts            stroke model (normalized points)
    rig.ts                articulation: contacts, groups, containment
    render.ts             renderScene — the single draw path for edit and play
    audio.ts              useAudio() — decode, AnalyserNode, onset detection
    persist.ts            localStorage encode/decode
    palette.ts            default swatches
  ui/
    components/canvas.tsx the drawing UI
    fonts.ts              next/font/local definitions
public/
  fonts/                  Satoshi + Code Pro
  music/                  bundled CC0 tracks
```

## Credits

Music: three CC0 loops by Juhani Junkala. Fonts: Satoshi and Code Pro. Sources and licence details in [`CREDITS.md`](./CREDITS.md).

## License

[MIT](./LICENSE) © Jeffrey JYZ
