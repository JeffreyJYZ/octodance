# octodance

Minimal Next.js App Router site.

## Stack

- Next `16.3.8` (App Router, Turbopack) + React `19.3.0`
- TypeScript `7.0.2` (native port), `strict`, path alias `@/*` → `./src/*`
- Tailwind CSS `4.3.3` via `@tailwindcss/postcss` (`src/app/globals.css` = `@import "tailwindcss";`)
- Biome `2.5.15` — formatter + linter (tabs, width 4)

## Commands

- Package manager: **bun**.
- `bun dev` · `bun run build` · `bun check` (= `biome check --write`)

## Gotchas

- **Next rewrites `tsconfig.json` on the first build** — sets `jsx` to `react-jsx` (from `preserve`), `allowJs` to `true`, and expands `lib`. It reformats to 2-space. Run `bun run check` (or `biome format --write`) afterwards to restore tabs; the next build then leaves it alone.
- Biome 2.5 deprecated `linter.rules.recommended` → use `"rules": { "preset": "recommended" }`.
- Biome does not read `.gitignore`; `.next`/`node_modules` are excluded explicitly in `biome.json` (`files.includes`).
- **Fonts**: definitions in `src/ui/fonts.ts` (`next/font/local`), file assets in `public/fonts/`; consumed in `src/app/layout.tsx` via `@/ui/fonts`.
  - `Satoshi-Variable.woff2` + `Satoshi-VariableItalic.woff2` → `--font-satoshi` (weight `300 900`) → Tailwind `--font-sans` (default body font).
  - `CODE-Light.otf` (300) + `CODE-Bold.otf` (700) → `--font-code` → Tailwind `--font-display` (`font-display`). Code Pro is a display face, **not** mono.
  - Source: `~/dev/fonts` (`satoshi/`, `code/`). Copy files in; they are committed.
  - **Build emits them twice and that is accepted**: `next/font/local` copies each file to `.next/static/media/<hash>` (what the built CSS references) while `public/fonts/` also serves the originals at `/fonts/…`, which nothing references. ~134 KB of unreferenced assets ship; not a bug, keep `next/font/local` (preload + fallback metrics) rather than a hand-rolled `@font-face`.
- **Client-component barrels break Turbopack builds.** A Server Component importing a Client Component through a barrel `index.ts` that itself lacks `"use client"` fails with `Export X doesn't exist in target module` ("module has no exports at all"). Import the component file directly, or add `"use client"` to the barrel. Components here are flat files, so keep imports direct.
- Biome needs **`css.parser.tailwindDirectives: true`** to parse `@theme`/`@import "tailwindcss"` in `globals.css`, otherwise `biome check` errors on the Tailwind syntax.

## Components

- Flat files under `src/ui/components/`, one component per file, **no per-component folder** (e.g. `src/ui/components/canvas.tsx`). Import as `@/ui/components/<name>`.
- **Music**: the panel offers 3 bundled CC0 demo tracks (`DEMO_TRACKS` in `canvas.tsx`; files in `public/music/`; provenance in `CREDITS.md`) that load and play in one click via `useAudio().loadUrl()`, plus an upload fallback. The figure is **audio-reactive** (analyser features → `motion.ts`: bass→sway, mid→bob, high→rotate, beat/level→pulse, level→ripple), so it barely moves with no track loaded.
- `canvas.tsx`: drawing UI + **Edit mode**. Hand-rolled `<canvas>` for live input (no drawing lib) + `react-colorful` `HexColorPicker`; palette swatches (custom removable, `Add` disabled when present); thickness + preview; Draw/Eraser; Undo/Clear driven by a stroke-model history (cap 30). Canvas is DPR-aware, has **no fixed height**, and is sized from `parent.clientWidth/clientHeight` (border must not be included, else it overflows/clips); it's `absolute inset-0` inside the left grid cell so the control column drives the row height and both columns stay equal.
- **Two modes over one stroke model** (`src/lib/canvas/`): *Edit* renders the in-progress stroke through the **same** `renderScene` (it's appended to the render list each move), so the live view *is* the committed view — **releasing a stroke never changes it**. (An earlier live-raster version drew a start dot + per-segment caps, so strokes visibly popped/thinned on release; don't reintroduce a separate live path.) *Play* runs a `requestAnimationFrame` loop that redraws the whole scene each frame with audio-driven motion. Nothing animates while drawing, and drawing is ignored while playing.
  - `strokes.ts` — pure geometry: `Point`/`InkStroke`/`EraseStroke`/`Stroke` (points normalized 0..1, `width` a fraction of `min(w,h)`). No per-stroke motion data.
  - `motion.ts` — `displace(x, y, features, time, intensity)` returns the deformed position; displacement is a **pure function of position**, so coincident points always get the same offset and **joints between strokes can never separate**; different regions still move differently, which is what reads as stroke-level motion. `isStill(features)` gates the static path. Amplitudes: bass→sway, mid→bob, high→curl (low spatial frequency), beat/level→radial breathing about the canvas center.
  - `render.ts` — `renderScene(ctx, strokes, features, time, w, h, intensity)`; deforms **every point** through `displace` (ink **and** erase, so holes stay aligned) and rebuilds the `Path2D` each frame while animating; caches paths only for the still/editing case (`WeakMap`, keyed by canvas size **and point count** — the key must include the point count or the in-progress stroke renders stale/truncated); 1-point strokes render as dots.
  - **Motion design constraints (both were bugs):** independent per-stroke transforms pull coincident points apart, so joints visibly split — a position-based field is the fix. A single rigid whole-scene transform is the opposite mistake: joints hold, but it reads as "the whole thing moving on its own" and is too subtle. Keep the field continuous in position.
  - `audio.ts` — `useAudio()`: upload (`load(File)`) or bundled demo (`loadUrl(url, name)`) → `decodeAudioData` → source → `AnalyserNode` (smoothing 0.6); `sample()` returns bass/mid/high/level/beat at call time (never React state), consumed by the rAF loop; spectrum bins get a gamma curve so dynamics read.
  - Loop/stroke state lives in refs (no per-frame `setState`); resize re-renders from the model, so history survives (unlike the old pixel-copy approach).
