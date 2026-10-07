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

### 5.2 Tiered sprites (M5)

From [from3Dto2D.md](from3Dto2D.md) P5, borrowing block-showroom's `tierFolder` and tier fields (G9, G10). A tiered sprite is a sprite made of sprites: a 16×16 sprite read as 4×4 blocks of 4×4 cells, with its own symmetry at each level.

**Tiers.** A tier list gives the radices from outer to inner, and their product is the sprite's size: 16 = 4·4, 32 = 4·8, 16 = 2·2·4. A cell's x and y each become a list of mixed-radix digits, one digit per tier, as in the showroom's `decomposeDigits`. A tier may have different radices across and down (`4x2`), so rectangles work too.

**Two ways a group can act on a tier.** The showroom has only the second.

- **Block symmetry**: the group acts on each block of the tier *together with everything inside it*, so a block's contents turn or mirror with it. The whole sprite is the outermost block, so today's `symmetry` setting is already the outer tier's block symmetry. Nothing about it changes.
- **Copy symmetry**: the group rearranges a tier's blocks but *slides* their contents into place without turning or mirroring them. This is the showroom's `tierFolder`, which folds each tier's digits on their own. It makes repeats, not symmetry: `copy:rot90` puts copies of one block in a four-fold pattern, but the sprite is not four-fold symmetric.

The sprite's group is everything these generate together. That can be larger than the groups as written. A rot90 sprite turns a block's left/right mirror into a top/bottom mirror too, so the blocks end up with both mirrors. The UI shows each tier's resulting group, just as it shows the effective group on a rectangle today. The rectangle rule carries over: a tier's group is G ∩ Aut(that tier's block). Swaps (diagonal mirrors, quarter turns) need a square block.

**Measured** with a scratchpad prototype on 2026-10-07. "Orbits" is the number of free cells, each one an independent choice:

| 16×16 sprite | Orbits | aut | Notes |
|---|---|---|---|
| `symmetry: dihedral`, no tiers | 36 | 8 | today |
| `dihedral`, tiers `4 / 4`, no tier groups | 36 | 8 | same orbits as no tiers, so the same sprite |
| `none`, `4 copy:dihedral / 4 copy:dihedral` (the showroom's mode) | 9 | 8 | only 9 free cells, so very repetitive. *Corrected in M5a: the prototype said aut 1, but copying every tier with the same element is that element acting on the whole sprite (15 − (4a + b) = 4(3 − a) + (3 − b)), so the sprite is D4-symmetric* |
| `none`, `4 / 4 dihedral` | 48 | 1 | 16 blocks, each D4-symmetric |
| `rot90`, `4 / 4 mirror-x` | 16 | 4 | blocks end up with both mirrors |
| `mirror-x`, `4 / 4 rot90` | 32 | 2 | |
| `none`, `4 copy:rot90 / 4` | 64 | 1 | four-fold repeats, no symmetry |

The prototype also checked, on every square size from 4 to 36 with every split into 2 or 3 tiers and random groups (plus two rectangles):
- every generator leaves the sprite unchanged (4,101 checks)
- `aut ≥` the order of the sprite group's effective part
- the outer block symmetry alone gives exactly the orbits of today's engine (50 of 50 cases)

A size has a handful of splits (16 has 8: 16, 2·8, 8·2, 4·4, 2·2·4, 2·4·2, 4·2·2, 2·2·2·2), and a prime size has only itself.

**Generation.** Tiers change only the orbit table. `src/core/tiers.js` builds each generator as a permutation of the w×h cells, joins orbits with union-find, and returns a table of the same shape as `orbitTable()`. `generate.js` then copies seed cells exactly as it does now. Two rules keep old sprites safe:

- **The seed rectangle stays the ordinary one** for `gen.symmetry` (fold 2), so the RNG is consumed in the same order. A tiered orbit is a union of ordinary orbits, and each of those already has its representative in that rectangle. The tiered representative is the one that comes first in row-major order. So a tier list that adds no groups gives the same sprite, byte for byte, as no tiers at all.
- **No tiers means the current code path.** `gen.tiers` defaults to off, every golden stays as it is, and `fold: 1` recipes cannot have tiers.

Masks and fields are evaluated at the representative and copied, so symmetry holds by construction whatever the formula. A round mask therefore looks tiered too.

*(M5a)* The outline is the one step after the copy, and it reads neighbours, which block and copy actions do not keep. With tiers on, an empty cell is therefore outlined when any cell of its orbit would be, so the outline is symmetric too. Without tiers this changes nothing, because every element of D4 keeps neighbours.

**Tier fields.** These are the showroom's six fields, re-derived for 2D.
- **They are not added to `FIELDS`.** `mix` and `vary` pick from `FIELDS` by index, so changing its length changes old sprites. A tier field is a separate setting, `gen.tierField` (default `none`).
- **It changes what the base field sees.** It alters the base field's input coordinates (u, v) or its parameters p, using the cell's digits. The base field is still chosen as today, `mix` and `vary` included, and acts as the motif. Values stay integers, so the `mod M` pipeline is unchanged.
- **Its constants come from `hash32(seed)`, not the sprite's RNG stream.** Turning a tier field on then leaves the colours and parameters unchanged, and the before and after can be compared.

The six:
- `wreath`: each block shows the motif under a D4 element chosen from that block's address and the seed, cascading inward through the tiers as in the showroom. This is D4 ≀ G, and it gives Truchet-like sprites.
- `digit-swap`: the digits' significance is reversed before the base field is evaluated. With tiers r₀ / r₁, a coordinate a·r₁ + b reads as b·r₀ + a. *(Corrected in M5b: this line said r₀·a + b reads as r₁·b + a, which puts each radix on the wrong digit.)*
- `prefix-hash`: a hash of the chain of block addresses varies p (offsets and coefficients), so each block holds a variant of the motif.
- `phasecell`: each block gets a phase offset, so its bands shift.
- `cross`: integer dot and cross products of the centred digit vectors of adjacent tiers are added to the base value.
- `carry`: the mixed-radix odometer term from the showroom, in integers.

Each field defines what it does with a single tier, which is where the showroom had a bug (its `wreath` fell through to another mode).

*(M5b)* The definitions, as built in `src/core/tierfields.js`. The cell lies in one block of every tier: tier 0's block is the whole sprite, and tier i's block is addressed by the digits of the tiers outside it. A single tier therefore has one block, the sprite.
- `wreath`: every tier's block, the sprite included, reads its contents under a D4 element hashed from its address, outer to inner. A swap is used only where every tier from there in is square, so blocks stay blocks. One tier: the whole motif under one element.
- `digit-swap`: one tier swaps the across and down digits (a transpose).
- `prefix-hash`: the hash chain shifts the offsets (±4) and the conic's coefficients (±1, ±2). One tier: one variant for the whole sprite.
- `phasecell`: the sprite's bands shift by a seeded step, then each outer tier's digit adds an affine step (a multiplier coprime to rx·ry). One tier: the seeded step alone.
- `cross`: for adjacent tiers, seeded weights times the dot and cross products of the doubled centred digits. One tier pairs with itself, so it adds a weighted circle.
- `carry`: tier i carries when (x mod bw)·bh + (y mod bh)·bw ≥ bw·bh, each tier with a seeded mirror and weight. On square tiers, unmirrored, that is exactly the carries of x + y (Kummer). One tier: one carry, across the sprite's anti-diagonal.

Tier fields act on `field` and `custom` sources, only while tiers are on. A field that cannot act (no tiers, tiers that do not fit, fold 1, or noise) stays in the recipe, switched off, and the UI says why.

**Recipe.** `gen.tiers` is a string, so the existing schema, timeline labels and permalinks handle it unchanged: `''` (off), or tiers from outer to inner separated by ` / `. Each tier is a radix (`4` or `4x2`), then optionally a block group and a `copy:` group. The outer tier has no block group, because that is `gen.symmetry`. For example:
- `'4 / 4 mirror-x'`: 4×4 blocks, each mirrored left/right
- `'4 copy:rot90 / 4'`: 4×4 blocks, arranged in a four-fold pattern of copies

The parser and printer live in `src/recipe/tiers.js`. The core takes the parsed list. *(M5a: the grammar itself is in `src/core/tiers.js` and `src/recipe/tiers.js` re-exports it, because `generateSprite` reads `gen.tiers` and the core never imports from `src/recipe/`.)*

When `w` or `h` changes and the tiers no longer multiply out to the sprite's size, the tiers stay in the recipe but switch off, and the UI says why (for example, "tiers off: 4·4 = 16, sprite is 16×12"). Changing the size back turns them on again. Nothing is dropped or substituted silently.

**Tests.**
- All 1,568 goldens unchanged.
- Each fixture, under each split into tiers with no groups and no tier field, is byte-identical to the same fixture without tiers.
- The prototype's checks become `tiers.test.js`:
  - every generator preserves the sprite
  - `aut ≥ |effective sprite group|`
  - the outer block symmetry alone reproduces today's orbits
- **Tiered goldens.** Tiered sprites have no oracle, so a new `test/golden-tiers.json` pins the port's output from M5a onward. A separate `npm run golden:tiers` writes it. `npm run golden` keeps writing only the reference goldens. The same rule applies to both: regenerate only for an intended change, and say so in the commit.
- The permalink and session files round-trip with tiers set.

**Not in M5.** The showroom's per-tier `gap` would draw blocks apart (an exploded view). In 2D it would be raster-only, so goldens would not care, but it changes pixel sizes and atlas slots, so it waits. M5c's block-grid overlay shows the structure without it. Also left for later: colouring each copy by its orbit element (P4), and choosing tier groups per cell the way `vary` chooses fields.

## 6. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** ✅ | **Scaffold and oracle** | The project runs on `npm run serve`. `npm test` loads the old generator from `reference/` and writes goldens for the fixture matrix. *Done 2026-10-06: 1,568 goldens (7 modes × 8 sizes × 7 sources × 4 seeds), and the reference file's hash is pinned* |
| **M1** ✅ | **Core and symmetry engine** | The ported core matches the goldens wherever the old fold was correct. `groups.test.js` passes for all 10 groups on every grid from 2×2 to 40×40. The measurement scripts from `from3Dto2D.md` become these tests. *✅ 2026-10-06. M1a: the core is ported, and with `fold: 1` it matches all 1,568 goldens and the reference's recipe text. M1b: the D4 engine covers all 10 subgroups, decides once per orbit, and reports the effective group and `aut()`. With `fold: 2` every sprite is symmetric on every grid from 2×2 to 40×40, and on all 1,204 fixtures where the old fold was exact it matches the old output byte for byte* |
| **M2** ✅ | **Minimal app (v1)** | A browser user can generate a sheet, pick from all 10 symmetries, see the effective group and aut, copy a recipe or permalink, export PNG, and load an old v4 session. *Done 2026-10-06: recipe schema, permalink, old-session import (locked cells included, checked against the reference) and an integer-scale rasteriser, all Node-tested. Browser checklist in `test/smoke.md`* |
| **M3** ✅ | **Workshop** | Timeline (NG's take/keyframe version), collection, lock and reroll are ported. Three steps: **M3a ✅ timeline**, **M3b ✅ lock and reroll**, **M3c ✅ collection and session save/load**. *M3a done 2026-10-06: the take is a pure module (`src/workshop/timeline.js`) holding whole recipes: append-only with branch pointers, REC, ◆ keyframes, keys-only filter, slider-drag coalescing, a 400-entry cap that spares keyframes, and the pruner. NG's T1–T6 timeline self-tests are Node tests. Two deliberate changes from NG: the pruner's 8×8 average hash is computed from the rasterised sheet, not a browser-smoothed thumbnail, so it is exact and testable; and a new entry is labelled against the entry it branched from. An old v4 session now loads as its whole timeline (bookmarks become keyframes), appended after the current entries rather than replacing them, since sessions cannot be saved until M3* *M3b done 2026-10-06: a lock is a per-cell override (`src/workshop/cells.js`), the same thing imported old locks already were; a locked cell keeps its settings and palette while the sheet changes, checked cell for cell against the old app's lockCfg. Reroll gives one cell a new seed and unlocks it; Regenerate skips locked cells. ⌘/Ctrl-click locks, Shift-click rerolls, L and Shift+R act on the selection; each action is a timeline entry. As in the old app, a locked sprite larger than the sheet's cells overlaps its neighbours* *M3c done 2026-10-06: the collection is a pure module (`src/workshop/collection.js`) outside the timeline, as in the old apps. A kept item stores one cell's seed, settings and palette seed (a locked cell's own), so it re-renders exactly. Keep (K, Alt-click, + Keep), rename, drag or Alt+↑/↓ to reorder, restore (a timeline entry), copy, PNG, and a packed-sheet export. Sessions are saved as `spritesnow-session/1` (`src/workshop/session.js`): the timeline with branches, keyframes, REC state and any unrecorded sheet, plus the collection, with seed arrays pooled. The same loader reads old v4 sessions and now brings in their collections, checked sprite for sprite against the reference. Two deliberate changes: loading any session now replaces the timeline and collection (after asking, when there is work to lose), where M3a appended old timelines; and restore keeps the sheet's size, where the old app also restored the columns, rows, spacing and scale the sprite was kept under* |
| **M4** ✅ | **Rendering** (§5.1) | Two steps. **M4a ✅ scale-1 sheet and sprite cache** (branch `m4a/…`): the screen sheet is rasterised at scale 1 and the view's zoom is multiplied by `scale`, with smoothing already off, so the on-screen image no longer grows with `scale²`. Sheet export (`export-sheet` in `main.js`) rasterises at `scale` on demand instead of reusing the screen image. A per-cell sprite cache keyed on (seed, gen, palette seed) means reroll, lock and selection regenerate only the cells that changed. Before switching, check whether the pruner's `averageHash` input (currently the image at scale) gives the same hashes at scale 1. If it does not, either keep hashing a scale-independent image or record the change as deliberate; never change pruning silently. Done when the 50×50 / 32 px / scale 16 sheet renders in the browser (it cannot today), `npm test` is green with no golden changes, and the status-bar time for a one-cell reroll is close to the time for one sprite. *M4a done 2026-10-07: `src/workshop/sheet.js` builds the screen sheet at scale 1 from an LRU sprite cache (8,192 sprites, keyed on seed, settings and palette seed). When the layout is unchanged and every sprite fits its cell, only the cells whose sprite changed are redrawn, and only those boxes are copied to the canvas. The view multiplies its zoom by `scale`, and outlines and clicks use that effective zoom. Sheet, collection and sprite exports rasterise at `scale` on demand; a sheet past a browser canvas limit (32,767 px a side, 16,384² px in all) is refused before allocation, with the largest scale that fits. Measured in headless Chrome: 50×50 / 32 px / scale 16 builds in 220 ms on a 1700² image, and a one-cell reroll reports "1 generated, built in 1.5 ms" (one sprite alone: 0.13 ms; before M4a, every reroll rebuilt the whole sheet). Exports equal the pre-M4a sheet byte for byte (Node tests). **Deliberate change to pruning:** the pruner's hash at scale 1 differs from the hash at the sheet's scale in 433 of 720 sampled sheets (mean 2 bits of 64, worst 19), because the 8×8 block boundaries fall differently. The pruner now hashes the scale-1 sheet, so an entry's hash no longer depends on its scale, much as NG's fixed-size thumbnail hash did. Hashes are never saved in session files (they are recomputed on load), so no file changes* **M4b ✅ WebGL2 sheet view** (branch `m4b/…`): `src/ui/sheet-view.js` draws with the index atlas, palette texture and one instanced quad per sprite (§5.1). The overlay canvas keeps selection and lock outlines. Falls back to the M4a 2D path when WebGL2 is unavailable. Done when the GL view and the 2D path show the same pixels at integer zoom (a browser check in `test/smoke.md`, and a headless pixel test if it is cheap, like block-showroom's `render-modes.test.js`), pan and zoom do not re-rasterise, and `npm test` is green with no golden changes. Generation in workers (block-showroom's `jobs.js`) only if generation is still the bottleneck after M4a. *M4b done 2026-10-07: `src/raster/atlas.js` (pure) packs the R8 index atlas (one slot per cell, all the size of the largest sprite), one palette row per cell, and 8 ints per instance. A changed sprite that fits its slot is rewritten in place and only its slot and palette row are re-uploaded. `src/ui/gl-sheet.js` draws one instanced quad per sprite; the fragment shader finds the sheet pixel as a 2D canvas does, floor((pixel centre − offset) / zoom), with the view origin split into a whole sheet pixel and a remainder so the float maths stays small far into a big sheet. `sheet-view.js` puts the GL canvas under the 2D outline canvas, and falls back to the M4a path without WebGL2, on a lost context, for a sheet too big for the GPU's textures, or with `?gl=0`. The status line names the renderer. Verified: Node tests run the shader's rule on the CPU (`drawAtlas`) and match `rasterizeSheet` byte for byte after packs and in-place updates; `npm run test:browser` (headless Chrome, SwiftShader, harness copied from block-showroom) shows WebGL2 and 2D screenshots identical at three whole-number views of two recipes (one with an overlapping locked sprite), and after a one-cell reroll, and fails on a one-pixel shader shift. Pan and zoom rebuild and upload nothing. Outlines are compared hidden: over the GL layer their antialiased edges blend one colour level differently. Canvases are now sized in whole device pixels with a matching CSS size, so a fractional stage no longer resamples them. 50×50 / 32 px / scale 16 builds in about 220 ms either way. Workers not needed: a one-cell reroll is a few ms* |
| **M5** ✅ | **Tiered sprites** (§5.2) | Three steps. **M5a ✅ tier engine** (branch `m5a/…`): `src/core/tiers.js` builds the tiered orbit table (block and copy groups, union-find, representatives from the ordinary seed rectangle), `generate.js` uses it when `gen.tiers` is set, `src/recipe/tiers.js` parses and prints `gen.tiers`, and the controls gain a Tiers picker that offers only the splits of the current size, with a block group and a copy group per tier. Each tier's resulting group and the orbit count are shown, as is the reason when tiers are off. Done when `tiers.test.js` passes, all 1,568 goldens are unchanged, every fixture with group-free tiers is byte-identical to the same fixture without tiers, `test/golden-tiers.json` exists, and the §5.2 table's examples can be opened in the browser from permalinks listed in `test/smoke.md`. *M5a done 2026-10-07: `src/core/tiers.js` builds every block and copy generator as a cell permutation, joins orbits with union-find, and takes each orbit's representative as the first ordinary (fold 2) representative in row-major order. Each tier reports the group asked for, the part that fits its block (or digit grid), and the group it is actually guaranteed: every element whose action keeps each orbit whole, which can be more than was asked for. `gen.tiers` is canonicalised by `normalize`, and kept (switched off, with the reason) when it no longer fits the size, cannot be read, or the fold is v1. The Tiers section of the controls offers Across and Down selects listing only the factorizations of the width and height, with lengths both share (a single list of every split would have 686 entries at 60×60). Down follows Across on a square split, and otherwise takes the nearest split of the height. Per tier: Blocks and Copies pickers, the resulting groups, and a "does not fit" note; then the free-cell count against the untiered count. Verified: all 1,568 goldens unchanged; every fixture under every split of its size with no groups is byte-identical to no tiers (11,760 sprites); the outer block group alone reproduces `orbitTable` exactly over every group and every split of seven sizes; a seeded property test (every square size 4–36 split into 2 or 3 tiers, plus three rectangles, random groups, outlines included) finds every generator keeps the sprite and aut ≥ the guaranteed group; the §5.2 orbit counts reproduce; permalinks and session files round-trip with tiers; `test/golden-tiers.json` pins 336 tiered sprites (`npm run golden:tiers`). The §5.2 links in `test/smoke.md` are checked by a Node test, and the picker was driven in headless Chrome. One correction to the §5.2 table, noted there.* **M5b ✅ tier fields** (branch `m5b/…`): `gen.tierField` with the six fields of §5.2, each defined for a single tier, with constants from `hash32(seed)`. `golden-tiers.json` gains tier-field fixtures (an intended change, said in the commit). Done when turning a tier field on leaves a sprite's colours and parameters unchanged and tiered symmetry still holds with every tier field. *M5b done 2026-10-07: `src/core/tierfields.js` gives each field as a cell remap (wreath, digit-swap), a params change (prefix-hash) or an integer added before mod M (phasecell, cross, carry), from constants `hash32(seed, salt)`; `generate.js` applies it in the field loop only when it is on, so the untiered path is unchanged. `gen.tierField` (default `none`) is in the schema, permalinks, sessions and timeline labels ("Tier field none → wreath"); the Tiers section gains a Field select with a hint per field, and an amber note when the field is set but off. The recipe text gains "· tier field <id>". Verified: all 1,568 goldens and the 336 M5a tiered goldens unchanged; on all 720 new tier-field fixtures, the colours and the recipe text (field, modulus, stride, offsets, conic coefficients, mask) equal those with the field off, and the grid differs in over 90% of them; a field that is off gives the same sprite, byte for byte; the M5a property test, repeated with each of the six fields on every case (square sizes 4–36 in 1–3 tiers, four rectangles), finds every generator keeps the sprite and aut ≥ the guaranteed group; each field's shape is tested (digit-swap's formula, wreath a block-preserving bijection that is one D4 element on one tier, prefix-hash and phasecell constant per innermost block, carry equal to Kummer's carries up to its mirrors, cross a circle on one tier), and on a single tier every field acts and no two act alike. `golden-tiers.json` now pins 1,056 sprites. Smoke links in `test/smoke.md` (checked by a Node test); the picker, notes, timeline label and inspector were driven in headless Chrome. One correction to §5.2's digit-swap formula, noted there.* **M5c ✅ tier view and readouts** (branch `m5c/…`): a block-grid toggle on the M4b overlay canvas, per-tier groups and orbit counts in the inspector, and a smoke checklist. Done when the overlay lines up with block edges at every whole-number zoom, in both the GL and 2D views. *M5c done 2026-10-07: `blockEdges` (`src/workshop/sheet.js`, pure) lists where each tiered sprite's blocks meet, each edge once at its outermost tier, placed as the raster places the sprite (locked sprites of another size included). The Blocks button in the toolbar (or G) draws them on the overlay canvas in device pixels, with the rule the shader and drawImage share (an edge at sheet x lands on the first device pixel whose centre shows x or more), outer tiers stronger; it is a view setting, not in the recipe, link or timeline. The inspector lists the tiers, each tier's shape and resulting block and copy groups, and the free cells once its groups are added to the outer tiers' (`tierReadout`, `src/recipe/tiers.js`); free cells against the untiered count; a "With tiers" row and a guaranteed count from the tiered group when the tiers add symmetry; and tiers or a tier field that are off, with the reason. Verified: all 1,568 goldens and 1,056 tiered goldens unchanged; `blockEdges` matches the edges found from block addresses on every split of six sizes; in headless Chrome, at zooms 1, 2, 3, 4, 7, 8 and 16 with odd pans, on four sheets (two and three tiers, a rectangle, a locked tiered sprite on a plain sheet), the grid changes no pixel off its expected lines, at least 99% of those, and exactly the same pixels in WebGL2 and 2D. Smoke steps 54–61 in `test/smoke.md`, links checked by a Node test. **Fix to M4a's fit:** a sheet too big for 1× was fitted at view.s = 0.05 whatever its size (`Math.min(0.05, s)`); it now fits at the largest whole number of screen px per sheet px, so pixels stay sharp and the grid shows.* |
| M6+ | Choose from the backlog | Readouts and orientation sheets (from3Dto2D P2–P3), the seam kernel (a natural fit for the M4b shader), tier gaps, 3D, tiling |

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
