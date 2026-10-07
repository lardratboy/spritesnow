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
│   └── ui/                    controls, sheet view, inspector
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

## 6. Milestones

| | Milestone | Done when |
|---|---|---|
| **M0** ✅ | **Scaffold and oracle** | The project runs on `npm run serve`. `npm test` loads the old generator from `reference/` and writes goldens for the fixture matrix. *Done 2026-10-06: 1,568 goldens (7 modes × 8 sizes × 7 sources × 4 seeds), and the reference file's hash is pinned* |
| **M1** ✅ | **Core and symmetry engine** | The ported core matches the goldens wherever the old fold was correct. `groups.test.js` passes for all 10 groups on every grid from 2×2 to 40×40. The measurement scripts from `from3Dto2D.md` become these tests. *✅ 2026-10-06. M1a: the core is ported, and with `fold: 1` it matches all 1,568 goldens and the reference's recipe text. M1b: the D4 engine covers all 10 subgroups, decides once per orbit, and reports the effective group and `aut()`. With `fold: 2` every sprite is symmetric on every grid from 2×2 to 40×40, and on all 1,204 fixtures where the old fold was exact it matches the old output byte for byte* |
| **M2** | **Minimal app (v1)** | A browser user can generate a sheet, pick from all 10 symmetries, see the effective group and aut, copy a recipe or permalink, export PNG, and load an old v4 session |
| M3 | Workshop | Timeline (NG's take/keyframe version), collection, lock and reroll are ported |
| M4+ | Choose from the backlog | Readouts and orientation sheets (from3Dto2D P2–P3), the seam kernel, tiered sprites, 3D, tiling |

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
