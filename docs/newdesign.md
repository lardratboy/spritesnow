# newdesign.md

*Design for a new project that replaces the four mosprites apps with one tested core. Working name: **spritesnow**.*

Status: **draft, 2026-10-06.** Decisions marked **[decide]** carry a recommended default. Change any default you disagree with, and the rest of the doc still holds.

Background lives in [spritesnow.md](spritesnow.md) and [from3Dto2D.md](from3Dto2D.md). You don't need to read them to use this doc.

---

## 1. What it is

A 2D procedural sprite generator whose core is a pure, tested function: **recipe in, sprite out, same bytes every time**. Its symmetry comes from an explicit group engine, not hand-written folds.

## 2. v1 scope

v1 is done when all of these are true:

1. **The core is ported.** The shared generator from the 2D app (RNG, 20 fields, 11 masks, palette, `generateSprite`) runs as plain ES modules with no DOM, in both Node and the browser.
2. **The symmetry engine replaces `fold()`.** It covers all 10 subgroups of the square's symmetry group, and it is correct at every size by construction.
3. **Old sprites reproduce exactly.** Every sprite the old 2D app generated *correctly* comes out byte-identical. The old app is the test oracle.
4. **There is a minimal app.** It shows a sheet of sprites at integer scale, has controls for the recipe, gives a copyable recipe and permalink, exports PNG, and imports old v4 sessions.

## 3. Non-goals for v1

These are deferred, not rejected. Each one has a home in the earlier docs.

- 3D: camera, voxels, bimoblocks, slices
- Fractional-scale seam colour (the NG software kernel)
- Timeline, collection and lock (milestone 3, after v1)
- Tiling (wallpaper/frieze groups), animation, counterchange, tiered sprites
- Merging with block-showroom

## 4. Decisions

| # | Decision | Recommended default |
|---|---|---|
| D1 | **[decide] Project name and folder** | `spritesnow`, as a sibling of `block-showroom` |
| D2 | **[decide] Sprites the old fold got wrong** (rot180 at odd height, rot90 at odd size or non-square) | The recipe carries `fold: 1 \| 2`. Imported old recipes use `1`, which reproduces the old output defects included. New recipes use `2`, which is correct |
| D3 | **[decide] Non-square rot90** | Reduce it to the largest symmetry the rectangle allows (rot180), and **show** the effective group in the UI |
| D4 | **[decide] Symmetry choices in the UI** | All 10 subgroups by name. This keeps horizontal and vertical as separate choices, as today, and adds both diagonal mirrors and the diagonal pair |
| D5 | Code structure | Copy block-showroom: buildless ES modules with an import map, `python3 -m http.server`, Node's built-in test runner, no `node_modules` |
| D6 | Save format | A versioned JSON recipe `spritesnow/1`. A session is a list of recipes. Write an importer for `sprite-gen-timeline` v4 (and v3 if it's cheap) |
| D7 | Testing | Golden FNV hashes of sprite grids for a fixed recipe matrix. Regenerate them only for an intended change, and say so in the commit |
| D8 | Branching | `main` is protected; work on feature branches, one milestone step per commit (block-showroom's workflow) |

## 5. Architecture

```
spritesnow/
├── index.html                 entry; import map; no build step
├── src/
│   ├── core/                  pure: no DOM, runs in Node and workers
│   │   ├── rng.js             mulberry32, hashes
│   │   ├── fields.js          the 20 modulo fields (+ popcount, digitSum, pascalMod)
│   │   ├── masks.js           the 11 masks, including the CA blob
│   │   ├── groups2d.js        D4 element codes, closure, 10 subgroups, orbits, aut()
│   │   ├── palette.js         paletteFor(seed, bpc)
│   │   └── generate.js        generateSprite(seed, recipe) → { grid, colors, meta }
│   ├── recipe/                schema, defaults, validate, permalink, v4 importer
│   ├── raster/                integer-scale sheet and solo rasteriser, PNG export
│   ├── workshop/              pure: timeline (take, keyframes, pruner), frame hash
│   └── ui/                    controls, sheet view, inspector, timeline strip
├── reference/
│   └── symmetrical_sprite_generator.html   the old v4 app, read-only, the oracle
└── test/
    ├── load-reference.js      pulls the old generator out of reference/ into Node
    ├── fixtures.js            recipe matrix: modes × sizes × seeds
    ├── golden.json
    ├── core.test.js           port == reference, byte for byte
    └── groups.test.js         orbits correct at every size; aut ≥ |G|; effective group
```

Three rules:

- **Nothing in `core/` touches the DOM**, and `Math.random` stays out of `core/`. Every random choice comes from the recipe's seed.
- **The symmetry engine decides once per orbit.** It visits cells in scan order and makes one decision per orbit, at the orbit's representative cell. It uses the old fold's choice of representative (when `fold: 1`, or wherever that choice was correct), so the old sprites reproduce. Otherwise it uses the lexicographic minimum.
- **Symmetry is guaranteed by construction and checked afterwards.** `aut()` counts the symmetries of the finished sprite, and the tests require it to be ≥ the group's order.

### 5.1 Rendering (M4)

Up to M3, the screen bakes the sheet at *export* scale: `rasterizeSheet` writes `scale²` RGBA pixels per sprite cell, and the view then zooms that image. At scale 4 this is 64× more bytes than the sprite data (one palette index per cell). Measured in Node on 2026-10-07:

| Sheet | Generate | Rasterise | Image |
|---|---|---|---|
| 8×6, 16 px sprites, scale 4 (default) | 13 ms | 7 ms | 576×432, 1 MB |
| 50×50, 16 px, scale 4 | 82 ms | 53 ms | 3600², 52 MB |
| 50×50, 32 px, scale 8 | 232 ms | 512 ms | 13600², 740 MB |
| 50×50, 32 px, scale 16 | 247 ms | 2158 ms | 27200², 3 GB, too big for a browser canvas |

Every `render()` also regenerates every sprite, even when one cell is rerolled or locked.

M4 follows block-showroom's lead ("centres → instances → GPU"): the GPU is given the compact data, not the expanded image. In 2D the compact data is the sprite grid itself:

- **Instance data.** An R8 index atlas holds every sprite's `grid`, one byte per cell. A palette texture holds one row per palette. Each sprite gets one instanced quad, carrying its sheet position, atlas slot, size and palette row.
- **Shader.** The fragment shader samples the atlas with nearest filtering and looks up the colour. Scale, pan and zoom are uniforms, so changing them costs nothing.
- **Plain WebGL2.** Three.js is not needed for 2D.
- **CPU raster stays.** `src/raster/` remains the only source of exported PNGs and of pixels for Node tests, because those must be byte-exact. The GPU view is for the screen only.
- **Overlays stay on a 2D canvas.** Selection and lock outlines are drawn on a 2D canvas layered over the GL canvas, as in `sheet-view.js` today.
- **Goldens are unaffected.** They hash grids, not pixels, so no golden changes are expected in M4.

## 6. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** ✅ | **Scaffold and oracle** | The project runs on `npm run serve`. `npm test` loads the old generator from `reference/` and writes goldens for the fixture matrix. *Done 2026-10-06: 1,568 goldens (7 modes × 8 sizes × 7 sources × 4 seeds), and the reference file's hash is pinned* |
| **M1** ✅ | **Core and symmetry engine** | The ported core matches the goldens wherever the old fold was correct. `groups.test.js` passes for all 10 groups on every grid from 2×2 to 40×40. The measurement scripts from `from3Dto2D.md` become these tests. *✅ 2026-10-06. M1a: the core is ported, and with `fold: 1` it matches all 1,568 goldens and the reference's recipe text. M1b: the D4 engine covers all 10 subgroups, decides once per orbit, and reports the effective group and `aut()`. With `fold: 2` every sprite is symmetric on every grid from 2×2 to 40×40, and on all 1,204 fixtures where the old fold was exact it matches the old output byte for byte* |
| **M2** ✅ | **Minimal app (v1)** | A browser user can generate a sheet, pick from all 10 symmetries, see the effective group and aut, copy a recipe or permalink, export PNG, and load an old v4 session. *Done 2026-10-06: recipe schema, permalink, old-session import (locked cells included, checked against the reference) and an integer-scale rasteriser, all Node-tested. Browser checklist in `test/smoke.md`* |
| **M3** ✅ | **Workshop** | Timeline (NG's take/keyframe version), collection, lock and reroll are ported. Three steps: **M3a ✅ timeline**, **M3b ✅ lock and reroll**, **M3c ✅ collection and session save/load**. *M3a done 2026-10-06: the take is a pure module (`src/workshop/timeline.js`) holding whole recipes: append-only with branch pointers, REC, ◆ keyframes, keys-only filter, slider-drag coalescing, a 400-entry cap that spares keyframes, and the pruner. NG's T1–T6 timeline self-tests are Node tests. Two deliberate changes from NG: the pruner's 8×8 average hash is computed from the rasterised sheet, not a browser-smoothed thumbnail, so it is exact and testable; and a new entry is labelled against the entry it branched from. An old v4 session now loads as its whole timeline (bookmarks become keyframes), appended after the current entries rather than replacing them, since sessions cannot be saved until M3* *M3b done 2026-10-06: a lock is a per-cell override (`src/workshop/cells.js`), the same thing imported old locks already were; a locked cell keeps its settings and palette while the sheet changes, checked cell for cell against the old app's lockCfg. Reroll gives one cell a new seed and unlocks it; Regenerate skips locked cells. ⌘/Ctrl-click locks, Shift-click rerolls, L and Shift+R act on the selection; each action is a timeline entry. As in the old app, a locked sprite larger than the sheet's cells overlaps its neighbours* *M3c done 2026-10-06: the collection is a pure module (`src/workshop/collection.js`) outside the timeline, as in the old apps. A kept item stores one cell's seed, settings and palette seed (a locked cell's own), so it re-renders exactly. Keep (K, Alt-click, + Keep), rename, drag or Alt+↑/↓ to reorder, restore (a timeline entry), copy, PNG, and a packed-sheet export. Sessions are saved as `spritesnow-session/1` (`src/workshop/session.js`): the timeline with branches, keyframes, REC state and any unrecorded sheet, plus the collection, with seed arrays pooled. The same loader reads old v4 sessions and now brings in their collections, checked sprite for sprite against the reference. Two deliberate changes: loading any session now replaces the timeline and collection (after asking, when there is work to lose), where M3a appended old timelines; and restore keeps the sheet's size, where the old app also restored the columns, rows, spacing and scale the sprite was kept under* |
| M4 | **Rendering** (§5.1) | Two steps. **M4a ✅ scale-1 sheet and sprite cache** (branch `m4a/…`): the screen sheet is rasterised at scale 1 and the view's zoom is multiplied by `scale`, with smoothing already off, so the on-screen image no longer grows with `scale²`. Sheet export (`export-sheet` in `main.js`) rasterises at `scale` on demand instead of reusing the screen image. A per-cell sprite cache keyed on (seed, gen, palette seed) means reroll, lock and selection regenerate only the cells that changed. Before switching, check whether the pruner's `averageHash` input (currently the image at scale) gives the same hashes at scale 1. If it does not, either keep hashing a scale-independent image or record the change as deliberate; never change pruning silently. Done when the 50×50 / 32 px / scale 16 sheet renders in the browser (it cannot today), `npm test` is green with no golden changes, and the status-bar time for a one-cell reroll is close to the time for one sprite. *M4a done 2026-10-07: `src/workshop/sheet.js` builds the screen sheet at scale 1 from an LRU sprite cache (8,192 sprites, keyed on seed, settings and palette seed). When the layout is unchanged and every sprite fits its cell, only the cells whose sprite changed are redrawn, and only those boxes are copied to the canvas. The view multiplies its zoom by `scale`, and outlines and clicks use that effective zoom. Sheet, collection and sprite exports rasterise at `scale` on demand; a sheet past a browser canvas limit (32,767 px a side, 16,384² px in all) is refused before allocation, with the largest scale that fits. Measured in headless Chrome: 50×50 / 32 px / scale 16 builds in 220 ms on a 1700² image, and a one-cell reroll reports "1 generated, built in 1.5 ms" (one sprite alone: 0.13 ms; before M4a, every reroll rebuilt the whole sheet). Exports equal the pre-M4a sheet byte for byte (Node tests). **Deliberate change to pruning:** the pruner's hash at scale 1 differs from the hash at the sheet's scale in 433 of 720 sampled sheets (mean 2 bits of 64, worst 19), because the 8×8 block boundaries fall differently. The pruner now hashes the scale-1 sheet, so an entry's hash no longer depends on its scale, much as NG's fixed-size thumbnail hash did. Hashes are never saved in session files (they are recomputed on load), so no file changes* **M4b, WebGL2 sheet view** (branch `m4b/…`): `src/ui/sheet-view.js` draws with the index atlas, palette texture and one instanced quad per sprite (§5.1). The overlay canvas keeps selection and lock outlines. Falls back to the M4a 2D path when WebGL2 is unavailable. Done when the GL view and the 2D path show the same pixels at integer zoom (a browser check in `test/smoke.md`, and a headless pixel test if it is cheap, like block-showroom's `render-modes.test.js`), pan and zoom do not re-rasterise, and `npm test` is green with no golden changes. Generation in workers (block-showroom's `jobs.js`) only if generation is still the bottleneck after M4a |
| M5+ | Choose from the backlog | Readouts and orientation sheets (from3Dto2D P2–P3), the seam kernel (a natural fit for the M4b shader), tiered sprites, 3D, tiling |

## 7. Starter zip contents

What the zip should hold, so that M0 is the first session's work:

- The full folder tree from §5, with **empty module stubs** that export the planned function names
- `reference/symmetrical_sprite_generator.html`, copied unchanged
- `package.json` with `serve`, `test` and `golden` scripts, like block-showroom's
- `CLAUDE.md`: commands, the workflow rules (D7, D8), the "pure core" rule, and a pointer to this doc
- `README.md`: how to run, how to test
- `docs/`: this file, plus `spritesnow.md` and `from3Dto2D.md` as background
- `.gitignore`, `.gitattributes`, and a `LICENSE` copied from block-showroom

## 8. Open questions

These don't block M0 or M1:

1. Does the eventual merged product stay a browser app, or become the recipe → file API from `combine.md`? A pure core keeps both paths open.
2. Should moblocks and block-showroom eventually share `groups2d`'s style of element codes, with one engine across dimensions?
