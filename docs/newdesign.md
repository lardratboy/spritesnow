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

### 5.3 Animated sprites (M6)

From [from3Dto2D.md](from3Dto2D.md) P7. Time becomes a third axis. An animation is a w×h×T volume, its frames are slices of that volume, and a **space-time group** acts on (x, y, t). The t axis wraps around, so every animation loops by construction.

**Space-time elements.** An element is a pair (e, τ). e is a D4 element, which acts on every frame. τ acts on frame numbers in one of two ways:
- a **shift**, t → t + k (mod T)
- a **reversal**, t → c − t (mod T)

A **motion** is a list of such elements. The frames' own symmetry is still `gen.symmetry`, which is the element (g, no change in t) for each g in the group. Each motion element adds a relation between frames.

**Measured** with a scratchpad prototype on 2026-10-07, at 16×16 with T = 16 and `symmetry: none` unless noted. A still sprite with no symmetry has 256 free cells per frame, so 4,096 over 16 frames:

| Motion | Elements | Free cells | Free frames | Group of every frame | What it does |
|---|---|---|---|---|---|
| none | — | 4,096 | 16 | none | frames are independent |
| loop ×2 | (id, +T/2) | 2,048 | 8 | none | the first half plays twice |
| ping-pong | (id, t → −t) | 2,304 | 9 | none | frames 0 to 8, then back again |
| spin | (rot90, +T/4) | 1,024 | 4 | none | each quarter of the loop is the previous quarter turned 90° |
| quarter turn, half loop | (rot90, +T/2) | 1,024 | 8 | rot180 | applying it twice gives (rot180, +T) = (rot180, no change in t), so every frame becomes rot180-symmetric |
| flip | (rot180, +T/2) | 2,048 | 8 | none | the second half is the first turned 180° |
| glide | (mirror-x, +T/2) | 2,048 | 8 | none | the second half mirrors the first: a walk cycle's left and right steps |
| sway | (mirror-x, t → −t) | 2,048 | 9 | none, but frames 0 and 8 are mirror-x | the back half mirrors the front half, played backwards |
| spin, on `mirror-x` | (rot90, +T/4) | 256 | 4 | quadrant | spinning a mirror-x sprite adds the top/bottom mirror too |

As with tiers, the result can be more symmetric than what was asked for, and the extra symmetry can differ from frame to frame (in sway, only the turning frames are mirrored). The UI therefore shows **each frame's group**, the number of free frames, and the free cells against T × the still count. A shift must divide evenly: (rot90, +T/4) needs 4 | T. A motion that does not fit stays in the recipe, switched off, and the UI says why, just as tiers do.

**Generation.** A motion changes only the orbit table, so it follows the tier pattern:
- `src/core/spacetime.js` builds the table over all w×h×T cells. Each frame starts from that frame's ordinary table (or its tiered table when tiers are on). Each motion element is a permutation of the volume, and orbits are joined with union-find. An orbit's representative is in its **earliest frame**, and within that frame it is the first ordinary representative in row-major order. So the seed volume is T copies of the ordinary seed rectangle.
- **The RNG is consumed in an order that does not depend on the motion.** Colours, params and the blob mask are drawn once, exactly as now. The noise source then draws frame 0's seed rectangle, which gives exactly the still sprite's draws, followed by frames 1 to T−1. Every frame is drawn even when its cells are copies, so changing the motion never shifts the noise. CA smoothing runs per frame.
- **`gen.frames` defaults to 1**, which is the current code path, so every golden stays as it is. `generateSprite` is unchanged. `generateFrames(seed, gen, palette)` returns the frames, and with one frame its frame is the `generateSprite` grid. As with tiers, animation needs `fold: 2`.
- **Frame 0 is the still sprite** whenever the motion adds no symmetry to frame 0. The prototype checked 400 random cases (sizes 4 to 32, T from 2 to 24, 0 to 2 motion elements, all 10 groups). Every motion element left the frames unchanged in all 400, and frame 0 equalled the still sprite in all 281 cases where the motion added no symmetry to it.
- The outline is drawn per frame. When tiers are on, M5's orbit rule applies across the space-time orbits.

**Drives: how time enters the field.** Without a drive, every free frame would evaluate the same field. A drive changes what the field sees in frame t, in the same way a tier field does. It is a coordinate map or a parameter change, it is the identity at t = 0, and its constants do not touch the RNG stream:
- `phase` (the default): the threshold window slides through `driveAmount` whole cycles per loop. The field values do not change, so the bands flow, like palette cycling.
- `spin`: frame t reads the field at coordinates turned by 360° · `driveAmount` · t / T about the sprite's centre. Doubled coordinates are used, as in `groups2d`, so a quarter turn is exact on any square grid.
- `drift`: the offsets (ox, oy) travel round a circle of radius `driveAmount` px.
- The noise source needs no drive, because every frame draws fresh noise, so it boils.

**Fit.** A motion overrides any frame that is not free, so it can disagree with what the drive would have drawn. Measured: the fraction of cells that differ from the same drive running with no motion. The setup was 16×16, T = 16, M = 17, averaged over 8 fields and 6 seeds:

| Motion | `phase` | `spin` | `drift` |
|---|---|---|---|
| ping-pong | 0.35 | 0.31 | 0.30 |
| spin, turning the same way as the drive | 0.52 | **0.06** | 0.53 |
| spin, turning the other way | 0.52 | 0.38 | 0.54 |
| flip | 0.34 | **0.04** | 0.35 |
| glide | 0.34 | 0.35 | 0.36 |

When the drive already has the motion's symmetry (`spin` with a spin or flip), the motion only corrects rounding, at 4–6% of cells. Otherwise it overrides a third to a half of the cells, and the loop jumps visibly where the copied frames meet the free ones. Both results are valid animations, and the space-time symmetry holds either way. The inspector shows the fit ("the motion overrides 35% of the drive"). Choosing a motion preset also suggests the drive that matches it. M6a decides which of D4's two quarter-turn codes (5 and 6) is "rot90", and the `spin` drive must turn the same way.

*(M6a)* What was decided and measured while building it:
- **rot90 is code 5**, (U, V) → (−V, U): with y pointing down, a clockwise quarter turn on screen, and the generator of C4 · pinwheel. rot270 is code 6. The `spin` drive with a positive amount turns the same way.
- **Exact turns.** Angles come from `turnCS` (`src/core/spacetime.js`), a series using only + − × ÷, rounded to 1/65536, so frames are the same bytes in every browser (`Math.cos` is not specified that tightly). In doubled coordinates a quarter turn is then exact, and a spin or flip with the matching `spin` drive overrides **0%** of the drive, not the prototype's 4–6%. Re-measured on eight real fields (16×16, T = 16, M = 17, six seeds, amount 1): ping-pong 0.32 / 0.29 / 0.18 (phase / spin / drift), spin 0.49 / **0.00** / 0.52, spin the other way 0.49 / 0.35 / 0.52, flip 0.32 / **0.00** / 0.35, glide 0.33 / 0.33 / 0.32.
- **A matching drive can still be overridden.** When the motion adds symmetry to the frames, no drive supplies it. Spin on a `mirror-x` sprite makes every frame both-mirrors, so even the matching `spin` drive is overridden 51% of the time. The table therefore also reports each frame's group with no motion (`stillGroup`) and whether the motion adds any (`addsSymmetry`), and the controls only say "the motion only corrects rounding" when it adds none. On a 2×2 or 3×3 grid one frame's own group can already be larger than the effective group (every rot180 2×2 sprite is also diagonal-mirrored), so the comparison is always with `stillGroup`.
- **Spin with a tier field.** A turned cell can leave the sprite (at angles that are not quarter turns). The tier field then reads it wrapped into the sprite and adds the wrap back to its result, so the tiered pattern behaves as if tiled across the plane.
- **Suggestion.** A drive *matches* a motion when every element is a shift whose element the drive reproduces: `phase` with amount a matches `id +p/q` when a·p/q is whole; `spin` matches a turn by k quarters at +p/q when a·p/q ≡ k/4 (mod 1). Reversals and mirrors match no drive. The suggestion is the matching drive with the smallest amount (positive first), offered as a button, not applied silently.
- **Fold 1.** Animation needs fold 2, as tiers do: frames above 1 stay in the recipe, switched off, and the UI says why.
- **`sheet.fps` moves to M6b**, with the playback that uses it.

Pixel difference does not measure smoothness here. With these mod-M fields, a 1 px shift changes 53–71% of cells, close to the 72% that differ between two unrelated sprites. Rigid drives (`spin`, `drift`) still read as motion, because the whole pattern moves together.

**Recipe.**
- `gen.frames`: 1 to 64, default 1 (a still).
- `gen.motion`: a string, like `gen.tiers`, so permalinks, sessions and timeline labels need no new machinery. `''` is off. Otherwise it is a list of elements separated by `, `, each an element name followed by a time action:
  - element names: `id`, `mirror-x`, `mirror-y`, `mirror-diag`, `mirror-anti`, `rot180`, `rot90`, `rot270`
  - time actions: `+1/4` shifts by that fraction of the loop; `~` reverses (t → −t); `~c` reverses as t → c − t
  - examples: `'rot90 +1/4'` (spin), `'mirror-x +1/2'` (glide), `'id ~'` (ping-pong)
- `gen.drive`: `phase`, `spin` or `drift`. `gen.driveAmount`: an integer, default 1.
- `sheet.fps`: default 8. It is used by the view and by animated export.
- The controls get a Frames number, a Motion preset (the table above), up to two element and time pickers for a custom motion, and Drive and Amount.

**Tests.**
- All 1,568 reference goldens and 1,056 tiered goldens unchanged.
- `generateFrames` with `frames: 1` equals `generateSprite` on every fixture.
- The prototype's checks become `spacetime.test.js`:
  - every motion element preserves the frames, outlines and tiers included
  - frame 0 is the still sprite whenever the motion adds no symmetry to it
  - each frame's `aut` is at least the order of the group reported for that frame
  - the free-cell and frame-group counts in the table above reproduce
- **Animated goldens.** A new `test/golden-frames.json`, written by `npm run golden:frames` and pinned from the port. The same rule as the other golden files applies.
- The permalink and session files round-trip with a motion set.

**Steps.**
- **M6a**: the space-time engine, `generateFrames`, the recipe keys and the controls. Until M6b, the sheet shows frame 0 and the inspector shows the selected sprite's frames as a strip.
- **M6b**: playback and export. The R8 atlas holds T slots per sprite, and a `u_frame` uniform picks the slot. The 2D view draws the current frame's raster. Play and pause, fps and a frame scrubber. The pruner's hash covers every frame. Export writes a strip PNG (frames side by side) and an APNG: `png.js` gains the `acTL`/`fcTL`/`fdAT` chunks, and every browser plays APNG. A cap on atlas memory (frames × sprites × cells) falls back to drawing fewer frames, and the UI says when it does.
- **M6c**: slices of 3D groups, the literal "3D to 2D". When w = h = T, the frames are the z-slices of a cube, and the motion can name a 3D group. `src/core/groups3d.js` holds the showroom's 48 element codes (e = perm·8 + signs), closure and its 10 named groups. A `depth` drive lifts the field to 3D with the showroom's three lifts, done in integers. The §5 table of from3Dto2D.md becomes a test: each slice's measured group matches the prediction. For example, Td's off-centre slices land in the `diagonals` class, and C3's slices have no symmetry, even though the stack of slices as a whole is 3-fold symmetric.

*(M6b)* What was decided and measured while building it:
- **The cap.** `ATLAS_CAP` (`src/workshop/sheet.js`) is 4M sprite cells (frames × sprites × w × h): 4 MB of atlas, and under a second to generate at 40 to 150 ns a cell. The default sheet at 64 frames uses 0.8M. Over the cap, a sheet holds every k-th frame, with k the smallest stride that fits (`framePlan`). Each loop keeps its length and plays coarser. When even one frame per sprite is over the cap, it holds frame 0 only. A still sheet is never thinned. The status line and the playbar say so. The inspector and every export still have every frame.
- **Only the held frames are generated.** `generateFrames` takes `times`, a list of frame numbers. It draws only the seed rectangles those frames copy from, except that noise draws every frame up to the last one needed, in order. The property test checks 678 lists (strides and random subsets) against full builds, and every frame is identical. So a capped 50×50 sheet of 16×16 sprites at 24 frames builds in 240 ms in Node (177 ms in headless Chrome), not four times that.
- **Slots and the shader.** Each cell holds F slots, F being the most frames any cell holds; slot i·F + j is cell i's frame j. Each instance carries its loop T and stride, and the vertex shader picks the slot from `u_frame`: slot + ⌊(t mod T) / stride⌋. Playing therefore uploads nothing. A cell with a new number of frames repacks the atlas.
- **The clock.** Time is a whole number of frames, counted at `sheet.fps` from when play was pressed (or the recipe last changed), whatever the display's refresh rate. Each sprite loops on its own T. The player's loop is the lcm of the cells' frame counts (at most 65,536), so a sheet with a locked 5-frame cell among 8-frame cells loops after 40. Play, pause and the frame are view state, like the block grid. The sheet starts playing unless the system asks for reduced motion.
- **The pruner's hash** is the 8×8 average hash of every frame the sheet holds, in order. The distance is the most bits that differ in any one frame, so the threshold means the same as for stills. Hashes of different frame counts are 64 apart. A still sheet's hash is unchanged. Changing Amount on link A of `test/smoke.md` leaves frame 0 the same, but the hashes are 41 to 44 bits apart, so the pruner keeps both entries.
- **Exports.** Sheet PNG and the sprite's PNG save the frame shown (named `-t9` / `-f9`). ↓ Sheet APNG saves every frame of the loop. The inspector adds ↓ Strip (frames side by side, frame 0 on the left) and ↓ APNG. The APNG is written by `encodeAPNG` in `src/raster/png.js`: RGBA frames compressed with the platform's zlib (`CompressionStream`), each frame full size with blend SOURCE and dispose NONE, a delay of 1/fps, looping forever. It runs in Node, so the tests decode it. An export is refused when one frame would not fit a canvas, or when all frames together would be more than 512 MB raw. Collection exports stay stills (frame 0).
- **Measured** (Node, 2026-10-07): the default 8×6 sheet at 16 frames builds in 31 ms and hashes in 13 ms; its APNG at scale 4 is 152 KB, encoded in 101 ms. At 64 frames: 45 ms, 17 ms, and 606 KB in 282 ms.

**[decide] Not in M6.**
- **Slicing the showroom's actual bimoblocks.** That would mean vendoring its 1,069-line core and its quantile density. M6c uses our own fields lifted to 3D instead.
- **GIF export.** APNG is lossless and needs no new encoder.
- Frames with different sizes, and per-cell motions chosen the way `vary` chooses fields.

## 6. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** ✅ | **Scaffold and oracle** | The project runs on `npm run serve`. `npm test` loads the old generator from `reference/` and writes goldens for the fixture matrix. *Done 2026-10-06: 1,568 goldens (7 modes × 8 sizes × 7 sources × 4 seeds), and the reference file's hash is pinned* |
| **M1** ✅ | **Core and symmetry engine** | The ported core matches the goldens wherever the old fold was correct. `groups.test.js` passes for all 10 groups on every grid from 2×2 to 40×40. The measurement scripts from `from3Dto2D.md` become these tests. *✅ 2026-10-06. M1a: the core is ported, and with `fold: 1` it matches all 1,568 goldens and the reference's recipe text. M1b: the D4 engine covers all 10 subgroups, decides once per orbit, and reports the effective group and `aut()`. With `fold: 2` every sprite is symmetric on every grid from 2×2 to 40×40, and on all 1,204 fixtures where the old fold was exact it matches the old output byte for byte* |
| **M2** ✅ | **Minimal app (v1)** | A browser user can generate a sheet, pick from all 10 symmetries, see the effective group and aut, copy a recipe or permalink, export PNG, and load an old v4 session. *Done 2026-10-06: recipe schema, permalink, old-session import (locked cells included, checked against the reference) and an integer-scale rasteriser, all Node-tested. Browser checklist in `test/smoke.md`* |
| **M3** ✅ | **Workshop** | Timeline (NG's take/keyframe version), collection, lock and reroll are ported. Three steps: **M3a ✅ timeline**, **M3b ✅ lock and reroll**, **M3c ✅ collection and session save/load**. *M3a done 2026-10-06: the take is a pure module (`src/workshop/timeline.js`) holding whole recipes: append-only with branch pointers, REC, ◆ keyframes, keys-only filter, slider-drag coalescing, a 400-entry cap that spares keyframes, and the pruner. NG's T1–T6 timeline self-tests are Node tests. Two deliberate changes from NG: the pruner's 8×8 average hash is computed from the rasterised sheet, not a browser-smoothed thumbnail, so it is exact and testable; and a new entry is labelled against the entry it branched from. An old v4 session now loads as its whole timeline (bookmarks become keyframes), appended after the current entries rather than replacing them, since sessions cannot be saved until M3* *M3b done 2026-10-06: a lock is a per-cell override (`src/workshop/cells.js`), the same thing imported old locks already were; a locked cell keeps its settings and palette while the sheet changes, checked cell for cell against the old app's lockCfg. Reroll gives one cell a new seed and unlocks it; Regenerate skips locked cells. ⌘/Ctrl-click locks, Shift-click rerolls, L and Shift+R act on the selection; each action is a timeline entry. As in the old app, a locked sprite larger than the sheet's cells overlaps its neighbours* *M3c done 2026-10-06: the collection is a pure module (`src/workshop/collection.js`) outside the timeline, as in the old apps. A kept item stores one cell's seed, settings and palette seed (a locked cell's own), so it re-renders exactly. Keep (K, Alt-click, + Keep), rename, drag or Alt+↑/↓ to reorder, restore (a timeline entry), copy, PNG, and a packed-sheet export. Sessions are saved as `spritesnow-session/1` (`src/workshop/session.js`): the timeline with branches, keyframes, REC state and any unrecorded sheet, plus the collection, with seed arrays pooled. The same loader reads old v4 sessions and now brings in their collections, checked sprite for sprite against the reference. Two deliberate changes: loading any session now replaces the timeline and collection (after asking, when there is work to lose), where M3a appended old timelines; and restore keeps the sheet's size, where the old app also restored the columns, rows, spacing and scale the sprite was kept under* |
| **M4** ✅ | **Rendering** (§5.1) | Two steps. **M4a ✅ scale-1 sheet and sprite cache** (branch `m4a/…`): the screen sheet is rasterised at scale 1 and the view's zoom is multiplied by `scale`, with smoothing already off, so the on-screen image no longer grows with `scale²`. Sheet export (`export-sheet` in `main.js`) rasterises at `scale` on demand instead of reusing the screen image. A per-cell sprite cache keyed on (seed, gen, palette seed) means reroll, lock and selection regenerate only the cells that changed. Before switching, check whether the pruner's `averageHash` input (currently the image at scale) gives the same hashes at scale 1. If it does not, either keep hashing a scale-independent image or record the change as deliberate; never change pruning silently. Done when the 50×50 / 32 px / scale 16 sheet renders in the browser (it cannot today), `npm test` is green with no golden changes, and the status-bar time for a one-cell reroll is close to the time for one sprite. *M4a done 2026-10-07: `src/workshop/sheet.js` builds the screen sheet at scale 1 from an LRU sprite cache (8,192 sprites, keyed on seed, settings and palette seed). When the layout is unchanged and every sprite fits its cell, only the cells whose sprite changed are redrawn, and only those boxes are copied to the canvas. The view multiplies its zoom by `scale`, and outlines and clicks use that effective zoom. Sheet, collection and sprite exports rasterise at `scale` on demand; a sheet past a browser canvas limit (32,767 px a side, 16,384² px in all) is refused before allocation, with the largest scale that fits. Measured in headless Chrome: 50×50 / 32 px / scale 16 builds in 220 ms on a 1700² image, and a one-cell reroll reports "1 generated, built in 1.5 ms" (one sprite alone: 0.13 ms; before M4a, every reroll rebuilt the whole sheet). Exports equal the pre-M4a sheet byte for byte (Node tests). **Deliberate change to pruning:** the pruner's hash at scale 1 differs from the hash at the sheet's scale in 433 of 720 sampled sheets (mean 2 bits of 64, worst 19), because the 8×8 block boundaries fall differently. The pruner now hashes the scale-1 sheet, so an entry's hash no longer depends on its scale, much as NG's fixed-size thumbnail hash did. Hashes are never saved in session files (they are recomputed on load), so no file changes* **M4b ✅ WebGL2 sheet view** (branch `m4b/…`): `src/ui/sheet-view.js` draws with the index atlas, palette texture and one instanced quad per sprite (§5.1). The overlay canvas keeps selection and lock outlines. Falls back to the M4a 2D path when WebGL2 is unavailable. Done when the GL view and the 2D path show the same pixels at integer zoom (a browser check in `test/smoke.md`, and a headless pixel test if it is cheap, like block-showroom's `render-modes.test.js`), pan and zoom do not re-rasterise, and `npm test` is green with no golden changes. Generation in workers (block-showroom's `jobs.js`) only if generation is still the bottleneck after M4a. *M4b done 2026-10-07: `src/raster/atlas.js` (pure) packs the R8 index atlas (one slot per cell, all the size of the largest sprite), one palette row per cell, and 8 ints per instance. A changed sprite that fits its slot is rewritten in place and only its slot and palette row are re-uploaded. `src/ui/gl-sheet.js` draws one instanced quad per sprite; the fragment shader finds the sheet pixel as a 2D canvas does, floor((pixel centre − offset) / zoom), with the view origin split into a whole sheet pixel and a remainder so the float maths stays small far into a big sheet. `sheet-view.js` puts the GL canvas under the 2D outline canvas, and falls back to the M4a path without WebGL2, on a lost context, for a sheet too big for the GPU's textures, or with `?gl=0`. The status line names the renderer. Verified: Node tests run the shader's rule on the CPU (`drawAtlas`) and match `rasterizeSheet` byte for byte after packs and in-place updates; `npm run test:browser` (headless Chrome, SwiftShader, harness copied from block-showroom) shows WebGL2 and 2D screenshots identical at three whole-number views of two recipes (one with an overlapping locked sprite), and after a one-cell reroll, and fails on a one-pixel shader shift. Pan and zoom rebuild and upload nothing. Outlines are compared hidden: over the GL layer their antialiased edges blend one colour level differently. Canvases are now sized in whole device pixels with a matching CSS size, so a fractional stage no longer resamples them. 50×50 / 32 px / scale 16 builds in about 220 ms either way. Workers not needed: a one-cell reroll is a few ms* |
| **M5** ✅ | **Tiered sprites** (§5.2) | Three steps. **M5a ✅ tier engine** (branch `m5a/…`): `src/core/tiers.js` builds the tiered orbit table (block and copy groups, union-find, representatives from the ordinary seed rectangle), `generate.js` uses it when `gen.tiers` is set, `src/recipe/tiers.js` parses and prints `gen.tiers`, and the controls gain a Tiers picker that offers only the splits of the current size, with a block group and a copy group per tier. Each tier's resulting group and the orbit count are shown, as is the reason when tiers are off. Done when `tiers.test.js` passes, all 1,568 goldens are unchanged, every fixture with group-free tiers is byte-identical to the same fixture without tiers, `test/golden-tiers.json` exists, and the §5.2 table's examples can be opened in the browser from permalinks listed in `test/smoke.md`. *M5a done 2026-10-07: `src/core/tiers.js` builds every block and copy generator as a cell permutation, joins orbits with union-find, and takes each orbit's representative as the first ordinary (fold 2) representative in row-major order. Each tier reports the group asked for, the part that fits its block (or digit grid), and the group it is actually guaranteed: every element whose action keeps each orbit whole, which can be more than was asked for. `gen.tiers` is canonicalised by `normalize`, and kept (switched off, with the reason) when it no longer fits the size, cannot be read, or the fold is v1. The Tiers section of the controls offers Across and Down selects listing only the factorizations of the width and height, with lengths both share (a single list of every split would have 686 entries at 60×60). Down follows Across on a square split, and otherwise takes the nearest split of the height. Per tier: Blocks and Copies pickers, the resulting groups, and a "does not fit" note; then the free-cell count against the untiered count. Verified: all 1,568 goldens unchanged; every fixture under every split of its size with no groups is byte-identical to no tiers (11,760 sprites); the outer block group alone reproduces `orbitTable` exactly over every group and every split of seven sizes; a seeded property test (every square size 4–36 split into 2 or 3 tiers, plus three rectangles, random groups, outlines included) finds every generator keeps the sprite and aut ≥ the guaranteed group; the §5.2 orbit counts reproduce; permalinks and session files round-trip with tiers; `test/golden-tiers.json` pins 336 tiered sprites (`npm run golden:tiers`). The §5.2 links in `test/smoke.md` are checked by a Node test, and the picker was driven in headless Chrome. One correction to the §5.2 table, noted there.* **M5b ✅ tier fields** (branch `m5b/…`): `gen.tierField` with the six fields of §5.2, each defined for a single tier, with constants from `hash32(seed)`. `golden-tiers.json` gains tier-field fixtures (an intended change, said in the commit). Done when turning a tier field on leaves a sprite's colours and parameters unchanged and tiered symmetry still holds with every tier field. *M5b done 2026-10-07: `src/core/tierfields.js` gives each field as a cell remap (wreath, digit-swap), a params change (prefix-hash) or an integer added before mod M (phasecell, cross, carry), from constants `hash32(seed, salt)`; `generate.js` applies it in the field loop only when it is on, so the untiered path is unchanged. `gen.tierField` (default `none`) is in the schema, permalinks, sessions and timeline labels ("Tier field none → wreath"); the Tiers section gains a Field select with a hint per field, and an amber note when the field is set but off. The recipe text gains "· tier field <id>". Verified: all 1,568 goldens and the 336 M5a tiered goldens unchanged; on all 720 new tier-field fixtures, the colours and the recipe text (field, modulus, stride, offsets, conic coefficients, mask) equal those with the field off, and the grid differs in over 90% of them; a field that is off gives the same sprite, byte for byte; the M5a property test, repeated with each of the six fields on every case (square sizes 4–36 in 1–3 tiers, four rectangles), finds every generator keeps the sprite and aut ≥ the guaranteed group; each field's shape is tested (digit-swap's formula, wreath a block-preserving bijection that is one D4 element on one tier, prefix-hash and phasecell constant per innermost block, carry equal to Kummer's carries up to its mirrors, cross a circle on one tier), and on a single tier every field acts and no two act alike. `golden-tiers.json` now pins 1,056 sprites. Smoke links in `test/smoke.md` (checked by a Node test); the picker, notes, timeline label and inspector were driven in headless Chrome. One correction to §5.2's digit-swap formula, noted there.* **M5c ✅ tier view and readouts** (branch `m5c/…`): a block-grid toggle on the M4b overlay canvas, per-tier groups and orbit counts in the inspector, and a smoke checklist. Done when the overlay lines up with block edges at every whole-number zoom, in both the GL and 2D views. *M5c done 2026-10-07: `blockEdges` (`src/workshop/sheet.js`, pure) lists where each tiered sprite's blocks meet, each edge once at its outermost tier, placed as the raster places the sprite (locked sprites of another size included). The Blocks button in the toolbar (or G) draws them on the overlay canvas in device pixels, with the rule the shader and drawImage share (an edge at sheet x lands on the first device pixel whose centre shows x or more), outer tiers stronger; it is a view setting, not in the recipe, link or timeline. The inspector lists the tiers, each tier's shape and resulting block and copy groups, and the free cells once its groups are added to the outer tiers' (`tierReadout`, `src/recipe/tiers.js`); free cells against the untiered count; a "With tiers" row and a guaranteed count from the tiered group when the tiers add symmetry; and tiers or a tier field that are off, with the reason. Verified: all 1,568 goldens and 1,056 tiered goldens unchanged; `blockEdges` matches the edges found from block addresses on every split of six sizes; in headless Chrome, at zooms 1, 2, 3, 4, 7, 8 and 16 with odd pans, on four sheets (two and three tiers, a rectangle, a locked tiered sprite on a plain sheet), the grid changes no pixel off its expected lines, at least 99% of those, and exactly the same pixels in WebGL2 and 2D. Smoke steps 54–61 in `test/smoke.md`, links checked by a Node test. **Fix to M4a's fit:** a sheet too big for 1× was fitted at view.s = 0.05 whatever its size (`Math.min(0.05, s)`); it now fits at the largest whole number of screen px per sheet px, so pixels stay sharp and the grid shows.* |
| **M6** | **Animated sprites** (§5.3) | Three steps. **M6a ✅ space-time engine** (branch `m6a/…`): `src/core/spacetime.js` parses `gen.motion` and builds the w×h×T orbit table (per-frame ordinary or tiered tables, then motion elements joined with union-find, representatives in the earliest frame); `generateFrames` with the `phase`, `spin` and `drift` drives; `gen.frames`, `gen.motion`, `gen.drive` and `gen.driveAmount` in the schema, permalinks, sessions and timeline labels; and Frames, Motion and Drive controls. The inspector shows each frame's group, free frames and cells, the fit, and the frame strip. Done when all 1,568 + 1,056 goldens are unchanged, `frames: 1` equals `generateSprite` on every fixture, `spacetime.test.js` passes, and `test/golden-frames.json` exists. *M6a done 2026-10-07: `src/core/spacetime.js` parses `gen.motion` (canonicalised by `normalize`, kept and switched off with a reason when a shift does not divide the frames, a swap meets a rectangle, the text cannot be read, or the fold is v1), builds the w×h×T table by union-find over the per-frame (tiered) tables and each element's volume permutation, and reports each frame's group, the free frames and cells, and whether the motion adds symmetry. `generate.js` now shares its setup, seed-frame and outline steps between `generateSprite` (unchanged output) and `generateFrames`, which draws colours, params and the blob mask once, then each frame's seed rectangle in order (noise: frame 0 is exactly the still's draws), copies through the table, outlines per frame (the space-time orbit rule with tiers on), and measures the fit. The `phase`, `spin` and `drift` drives are the identity at t = 0 and use exact integer turns (`turnCS`). `gen.frames`, `gen.motion`, `gen.drive` and `gen.driveAmount` are in the schema, permalinks, sessions and timeline labels ("Motion rot90 +1/4 → off"); the recipe text gains "· frames 16 · motion … · drive spin 1". The controls' Animation section has Frames, a Motion preset (§5.3's table) or Custom with element and time pickers, Drive and Amount, a "Use spin 1" button when a drive would match, and notes for what the drive does, why a motion is off, and the free frames and cells. The sheet shows frame 0 (built alone, since it never reads later frames); the inspector shows every frame as a strip, free frames outlined, with Frames, Motion, Free frames, All frames, Frame groups, Fit, and a "With motion" row when the motion adds symmetry to frame 0. Verified: all 1,568 goldens and 1,056 tiered goldens unchanged; `generateFrames` equals `generateSprite` on all 4,192 fixtures (reference fixtures at fold 1 and 2, tiered fixtures), with and without a motion set at one frame; the §5.3 table's free cells, free frames and frame groups reproduce exactly; a seeded property test over 360 random animations (sizes 4–32, rectangles, T from 2 to 24, 0–2 elements, every group, tiers and tier fields, outlines, all sources and drives) finds every motion element keeps the frames (341 elements), every frame's reported group holds and aut ≥ its order, every tier generator holds in every frame, frame 0 is the still sprite in all 285 cases where the motion adds nothing to it, and building only the first frames gives the same frames; the phase drive equals the still at phase t/T; the spin drive is exactly rot90's turn at quarter turns on squares of four sizes; noise boils and a motion never shifts it; permalinks and session files round-trip with a motion. `test/golden-frames.json` pins 364 animations (`npm run golden:frames`). Smoke steps 62–72 in `test/smoke.md`, links checked by a Node test; the controls, suggestion, custom pickers, notes and inspector were driven in headless Chrome. Decisions and re-measured fits are in §5.3 under (M6a).* **M6b ✅ playback and export** (branch `m6b/…`): T atlas slots per sprite with a `u_frame` uniform, the 2D view drawing per frame, play/pause/fps/scrub, a pruner hash over every frame, and strip-PNG and APNG export. Done when the GL and 2D views match at several frames in headless Chrome, and every APNG frame equals the matching strip frame. *M6b done 2026-10-07: the screen sheet holds every frame of every sprite, or every k-th frame over the 4M-cell `ATLAS_CAP` (`framePlan`; `generateFrames` gains `times`, so only held frames are generated). The atlas has a slot per frame, and the vertex shader picks each sprite's slot from `u_frame`, its own loop and its stride. The 2D path is handed `sheetFrame`'s image. A playbar over the sheet has play/pause, a scrubber and "frame / loop"; P, comma and full stop are the keys, and FPS (`sheet.fps`, default 8) is in the Animation section. The inspector's preview follows the clock, the strip marks the frame shown, and clicking a frame shows it. The pruner's hash covers every held frame. Exports: Sheet PNG at the frame shown, Sheet APNG, and the sprite's PNG, Strip and APNG; the APNG writer in `src/raster/png.js` adds `acTL`, `fcTL` and `fdAT`. Verified: all goldens unchanged (1,568 + 1,056 + 364 animated); 678 frame lists from `times` equal the full builds; `drawAtlas(atlas, t)` equals `sheetFrame` and a fresh build at every time tried, with mixed loops (lcm 40), a locked still, and in-place updates; the capped 50×50 sheet holds frames 0, 4, …, 20, each exact; every APNG frame equals the strip's frame, and a sheet APNG's frame t is the sheet at time t. In headless Chrome (`test/browser/animation.test.js`): WebGL2 and 2D match pixel for pixel at five frames each on three sheets (spin, mixed loops, capped), and different frames differ; playing at 20 fps uploads nothing; the page's own ↓ Sheet APNG, ↓ Strip, ↓ APNG and ↓ PNG downloads decode to the frames Node draws, and Chrome's `ImageDecoder` reads the same 12 frames, looping forever. Smoke steps 73–81 in `test/smoke.md`, with their links checked by a Node test. Decisions and measurements are in §5.3 under (M6b).* **M6c 3D slices** (branch `m6c/…`): `groups3d.js`, the `depth` drive, cube animations under a 3D group, and the from3Dto2D §5 table as a test |
| M7+ | Choose from the backlog | Readouts and orientation sheets (from3Dto2D P2–P3), the seam kernel (a natural fit for the M4b shader), tier gaps, tiling (P8), counterchange (P4) |

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
