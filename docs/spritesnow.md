# spritesnow.md

*A discussion document for merging the four apps in `claude/mosprites/` into one. It has two goals: find out where the technology overlaps, and agree on what "best" means before choosing parts.*

Status: **first pass, 2026-10-06.** This pass covers lineage and overlap. The "best" criteria in §7 are a proposal for discussion, not a verdict.

---

## Short version

- **All four apps are one family.** Each one turns `(seed, cfg)` into a sprite through the same pipeline: a modulo-arithmetic field, a mask, a symmetry fold, and a palette. The 20-entry `FIELDS` table, the 11 `MASKS`, `seedDims`/`fold`, `paletteFor` and `mulberry32` all appear in every file. Three files have them almost verbatim; moblocks reimplements them and tests them against the original.
- **The family has two branches from one ancestor**, the 2D generator at session format v3:
  - **Branch A (camera):** `symmetrical_sprite_generator_3d.html`. It puts a three.js camera over the unchanged 2D sheet.
  - **Branch B (raster → volume):** `symmetrical_sprite_generator.html` v4 → `mosprites-ng.html` → `moblocks-viewer.html`. Each step built on the one before it.
- **Branch A is a dead end in code.** None of its code reached NG or moblocks. Its ideas did: moblocks builds the "mode C — voxels from f: Z³→Z" step that the 3D app explicitly left unbuilt.
- **The same seam-colour theory (`aamazing.md`) is implemented four times:** Canvas2D `fillRect` (2D), a GLSL magnification shader plus a CPU fallback (3D), a software kernel (NG), and a 3D lift of that kernel (moblocks). This is the biggest overlap to settle.
- **The apps split into workshops and viewers.** The three sprite apps share the exploration tools: timeline, collection, lock, reroll and recipe. moblocks has none of them. It is a viewer for a single seed.
- **NG corrects a known bug.** `discoveries.md` found that the 2D app's "mirror intact" readout uses the wrong rule. NG's `seamReport` uses the corrected rule (mirror symmetry survives only with `add` at q | w) and tests it (N2).

---

## 1. What is in the folder

| File | Lines | Modified | Title / role | Session format | External deps |
|---|---|---|---|---|---|
| [symmetrical_sprite_generator.html](symmetrical_sprite_generator.html) | 1,595 | Aug 8 | 2D modulo-field sprite sheet with timeline and collection. Adds the seam/export policy. | `sprite-gen-timeline` **v4** | none |
| [symmetrical_sprite_generator_3d.html](symmetrical_sprite_generator_3d.html) | 3,270 | Aug 9 | The same generator under a three.js camera, built as rungs R0–R5 plus Rv and Wire | `sprite-gen-timeline` **v3** + `mosprites-manifest/1` | three r128 + OrbitControls |
| [mosprites-ng.html](mosprites-ng.html) | 2,630 | Aug 11 | "MoSprites NG". The 2D v4 app with Canvas2D replaced by a pure software raster kernel | `mosprites-ng` v1 | none |
| [moblocks-viewer.html](moblocks-viewer.html) | 2,499 | Aug 12 | "moblocks · multi-resolution voxel sprites". An NG recipe lifted to a voxel volume and stored as an orbit-canonical node tree | `moblocks/1` (model JSON) | three r128 (no OrbitControls) |

The 2D and 3D files are **byte-identical** to the copies in [../../sprite-discussion-area/](../../sprite-discussion-area/), which `discoveries.md` and `combine.md` already analysed. That analysis covered a different set of four: these two plus the two bimoblock showrooms. **mosprites-ng and moblocks-viewer are new to the discussion.**

### Design documents the code cites

| Cited as | Found? | Cited by |
|---|---|---|
| `aamazing.md` (fractional scale as colour synthesis) | yes, [../../sprite-discussion-area/aamazing.md](../../sprite-discussion-area/aamazing.md) | 2D, NG |
| `panzoomwow.md` (three-projection camera, rungs, §5 modes A–D, §7 resample, §10 export) | yes, [../../sprite-discussion-area/panzoomwow.md](../../sprite-discussion-area/panzoomwow.md) | 3D |
| `panzoom-r0-harness.js` | not found | 3D |
| "ng §2.2, §4, §6" (NG spec) | **not found** | NG |
| moblocks brief ("section 1", "section 2.4", "session one/two") | **not found** | moblocks |
| `ref.js` (= NG lines 466–987) plus the K/R/B/G/M test suites | **not found** (the tests are headless, outside the HTML) | moblocks |
| `blocks-all-the-way-down` (`intern`, `materialize`, `expandRef`) | not found here | moblocks |

---

## 2. Lineage

```
        2D generator v1 → v3            (not in folder; implied by session version numbers)
                 │
       ┌─────────┴───────────────────────────────┐
       │                                         │
  BRANCH A — camera                         BRANCH B — raster → volume
       │                                         │
  symmetrical_sprite_generator_3d.html     symmetrical_sprite_generator.html  v4   (Aug 8)
  (v3 + panzoomwow rungs, Aug 9)             + seam phase, matte, export presets,
   R0  camera model                            seamReport()  ← aamazing.md
   R0.5 CPU resample (fillRect model)             │
   R1  1:1 atlas + GLSL resample shader           ▼
   R2  OrbitControls rig                    mosprites-ng.html  (Aug 11)
   R3  instanced cards, elevation channel     + software raster kernel (axisPlan/blit/resolve)
   R4  asset/view/turntable export, §10.4     + operators over/add/mul, 6 traversal orders, linear light
   R5  timeline as Z-stack                    + conformance vs Canvas2D (measureDivergence)
   Rv  voxel extrusion (height = palette idx) + take/keyframes/REC, perceptual-hash pruner
   Wire mesh overlay                          + in-page self-test suite (K1–K11, A1–A6, T1–T6, N2)
       │                                         │   "ref.js" = NG lines 466–987
       ✕ no code descendants                     ▼
                                           moblocks-viewer.html  (Aug 12)
                                             session 1: FIELDS3 lift, buildVolume, B₃ orbit
                                               canonicalisation, node store, structure tensor/FA,
                                               raster3, mip3, buildModel/serialise
                                             session 2: viewer, planar mode, LOD, hand-rolled orbit
```

### Evidence for the tree

- **3D forked from v3, before v4.** The 3D app writes `version:3` and its `CFG_KEYS` lack `seamphase` and `matte`. The 2D app writes `version:4` and its `writeUI` says *"pre-v4 sessions lack the newer keys"*. The 3D file has the later mtime, so the two branches were developed in parallel.
- **NG descends from 2D v4, not from 3D.** NG shares 50% of its unique script lines with 2D. It shares 41% with 3D, and every one of those lines is also in 2D: no line is shared by 3D and NG alone. NG keeps the v4 keys (`seamphase`, `matte`, presets) and adds `operator`, `order` and `space`.
- **moblocks descends from NG, explicitly.** Its header says the core is *"gated by tests that compare against the REAL generator (mosprites-ng.html lines 466–987, loaded unmodified as ref.js)"*. It shares only about 7% of lines verbatim because it is a clean UMD-module rewrite. Step 6 says `axisPlan` and `resolve` carry over *"UNCHANGED … byte-identical to the 2D version"*.
- **moblocks builds the step the 3D app deferred.** The 3D app's Rv comment says: *"NOT mode C (§5) — that needs f: Z³ → Z and touches generation."* moblocks Step 1 is exactly that function (`FIELDS3`), anchored by `f3(u,v,0) == f2(u,v)`.

---

## 3. The shared spine

Every app implements this pipeline, Φ:

```
seed ──mulberry32──► per-sprite params (formula, modulus M, stride, offset, conic coeffs, colours)
                        │
cell (x,y[,z]) ──fold(sym)──► canonical cell ──field f(u,v[,w]) mod M──► threshold by coverage/phase
                        │                                                       │
                        └────────────── mask (11 shapes or CA blob) ────────────┤
                                                                                ▼
                                                  palette index ──► paletteFor(seed, bpc) ──► colour
```

| Piece | 2D | 3D | NG | moblocks |
|---|---|---|---|---|
| `mulberry32`, `popcount`, `digitSum`, `pascalMod` | ✓ | ✓ identical | ✓ identical | ✓ reproduced; adds `trinomMod`, `binomMod` |
| `FIELDS` (20) | ✓ | ✓ identical | ✓ identical | `FIELDS3`, lifted to 3 variables (17 symmetric, 3 with a declared "signature") |
| `MASKS` (11) | ✓ | ✓ | ✓ | used inside `buildVolume` |
| `seedDims` / `fold` (7 symmetries) | ✓ | ✓ | ✓ | ✓ plus a `z` mirror, `orbitFold`, `foldZ` |
| `paletteFor(seed,bpc)` | ✓ | ✓ | ✓ | ✓ |
| `generateSprite` | ✓ | ✓ | ✓, and it also returns `field`, `fid`, `p`, `st` | `buildVolume` / `buildVolumePlanar` |
| noise + CA source, custom JS expression | ✓ | ✓ | ✓ | field only (no noise/custom path found yet) |

**The spine is the merge's least risky part.** It is already shared and already pure. moblocks has already restructured it as a headless UMD module with no DOM, which is the shape `combine.md` asks for.

---

## 4. What each app adds

### 2D generator v4: the reference workshop
- Exploration tools: an append-only timeline with branch pointers (`from`), bookmarks, playback, a 400-entry cap, and coalescing of slider drags.
- Per-cell lock (which freezes the cfg), reroll and recipe copy. Collection: keep, rename, drag to reorder, export as a packed sheet.
- `aamazing.md` turned into controls: **seam phase** (global/local), **matte**, export **presets** (as seen / asset / screenshot), integer magnify after rasterising, and a live `seamReport()`. The report's mirror rule is wrong (see `discoveries.md`).
- Rasterises with Canvas2D `fillRect`. Seam colours therefore come from whatever Skia does.

### 3D generator: the camera branch
- One camera state, three projections: top-down, 2:1 dimetric, true isometric, and free perspective. Each has a preset. Zoom is anchored to the cursor.
- The atlas drops to **1:1 texels**, so `scale` leaves generation and becomes a **live shader uniform**. The fractional-scale colouring is redone as a GLSL magnification shader, with a CPU reference (`coverage1D`/`buildResampled`).
- Scene modes `quad | cards | voxels | stack`. Cards carry an **elevation channel** (lock, luma, ink coverage, colour count): the sheet becomes a terrain you read by orbiting.
- **R5: the timeline as a Z-stack.** History becomes a solid, and clicking a layer scrubs to it.
- Export: asset (CPU, exact), view (GPU, supersampled), turntable, manifest, and a **"Verify §10.4"** check that the two exports are byte-identical at top-down.
- Engineering note: R2 reverses `panzoomwow.md` §3.6. The hand-rolled damped rig *"kept blowing up"*, so the app adopted OrbitControls with damping off.

### mosprites-ng: the raster-correctness branch
- **Canvas2D never writes pixels.** A software kernel does: separable analytic coverage (`axisPlan`), one hot loop (`blit`), and float premultiplied accumulation with a single `resolve()` boundary that unpremultiplies and then applies the transfer curve.
- New compositing controls: **operator** (`over`, which is non-commutative and "a light direction"; `add`, which is commutative and keeps symmetry; `mul`), **traversal order** (row-major, column-major, serpentine, radial, Morton, and **byField**, where the modulo field decides paint order), and **colour space** (sRGB or linear).
- **Conformance measurement:** `measureDivergence` compares the kernel with Canvas2D and splits the result into opaque pixels (any difference is our bug) and translucent pixels (Skia's rounding).
- Timeline becomes a curated **take**. REC on/off, ◆ keyframes, a "keys only" filter, and a **perceptual-hash pruner** (8×8 average hash, Hamming threshold) that collapses near-duplicate frames. Branch pointers are remapped when frames are removed.
- **An in-page self-test suite** (`runSelfTest`) checks the closed-form seam maths, the equality of the kernel and declarative forms, coverage-plan invariants, resolve ordering, mirror symmetry, and timeline surgery.

### moblocks-viewer: the volume branch
- **FIELDS3:** every 2D field lifted to 3D such that the z=0 slice is the 2D sprite exactly. Elementary symmetric polynomials keep their index, so `uv` becomes `uv+vw+wu`.
- **Planar mode:** a solid whose three shadows are three sprites, composed by `and` (visual hull), `maj`, `or`, `xor`, `add`, `mod` or `mul`.
- **B₃ orbit canonicalisation** (48 transforms) plus a content-addressed node store with 6-bit orientations. The code reports 4.6× to 12.1× sharing, against about 1.08× without canonicalisation.
- **Shading payload:** a per-node structure tensor whose fractional anisotropy (FA) drives roughness. The comments say the mean normal is identically zero, so it is not stored.
- **mip3 is raster3 at p = 1/8.** The NG kernel is reused as the LOD reducer, and the choice of operator becomes the shading model.
- Viewer: voxels or one cube per 8³ block (mip), colour by material, FA, LOD or position, auto-orbit, model JSON download. **No timeline, collection, lock or export pipeline.**

---

## 5. Overlap matrix

| Capability | 2D | 3D | NG | moblocks | Notes |
|---|:-:|:-:|:-:|:-:|---|
| Pure Φ(seed,cfg) generator | ● | ● | ● | ● (3D) | The shared spine |
| Timeline (history) | ● | ● (+Z-stack) | ● (+take/keys/prune) | – | Three variants of one log |
| Collection / keep / lock / recipe | ● | ● | ● | – | Nearly identical code |
| Session save/load | v4 | v3 | ng/1 | model only | **Three incompatible formats** |
| Fractional-scale seam colour | Canvas2D (implicit) | GLSL + CPU ref | software kernel | raster3 | **Four implementations of one theory** |
| Seam phase / matte / presets | ● | partial (asset/view) | ● | – | |
| Operators / order / linear light | – | kernel cycle (J) | ● | ● (mip op, order) | |
| Camera / orbit | 2D pan-zoom | OrbitControls rig | 2D pan-zoom | hand-rolled orbit | **Two 3D rigs** |
| Voxels | – | extrusion (height = palette idx) | – | true f(u,v,w) + planar | Different objects |
| LOD / hierarchy | – | – | – | ● node tree + mip | |
| Self-tests | – | Verify §10.4 | ● in-page | ● headless (not in file) | |
| Perf work | – | atlas watermark, instancing | Int32 seq cache, coverage plans, memoised resolve | content addressing | |

---

## 6. Where they conflict

1. **Seam colour has four engines.** The GLSL shader (3D) and the software kernel (NG) both claim to be "the" model of `fillRect`. The merged app needs **one reference** (most likely NG's kernel, since it is tested and browser-independent), with every other path tested against it, as 3D's §10.4 already does for exports.
2. **Two orbit rigs that disagree.** The 3D app found that a damped hand-rolled rig is structurally unstable with cursor-anchored zoom, and switched to OrbitControls. moblocks then hand-rolled an orbit again, because OrbitControls is *"absent from the UMD build"* (3D loads it from jsdelivr instead). Pick one.
3. **Session formats.** v3, v4, ng/1 and moblocks/1. Recipes from the 2D side should load everywhere. At minimum: a v3/v4 → ng migration, and moblocks accepting an NG recipe directly, which its header says it already does.
4. **The meaning of "voxel".** 3D Rv extrudes the 2D result (height = palette index). moblocks evaluates a true 3D field. Both are useful, but the merged app should name them differently.
5. **The workshop/viewer split.** moblocks has the deepest model and the thinnest UI. The workshop tools (timeline, collection, lock) would need to work over a volume recipe as well as a sheet.
6. **Single-file size.** The four files total about 10k lines, and the largest is 3.3k. `combine.md` already recommends ES modules plus a one-file `vite build`. moblocks' UMD core is the template for that.

---

## 7. What does "best" mean? (proposal)

Below are candidate criteria and a way to measure each. The ratings are a **first read from the source only** (nothing has been run). They are there to start the argument, not to settle it.

| # | Criterion | How to measure | 2D | 3D | NG | moblocks |
|---|---|---|:-:|:-:|:-:|:-:|
| C1 | **Determinism**: same recipe gives the same bytes, in every browser | Hash the export across Chrome/Firefox/Safari for N fixed recipes | ◐ Skia-dependent at fractional scale | ◐ GPU-dependent for view; asset exact | ● pure software | ● pure software |
| C2 | **Verified correctness**: claims backed by executable tests | Count of tests and what they cover; do they pass? | ○ | ◐ one byte-identity check | ● ~25 in-page | ● suites exist but not in the file |
| C3 | **Expressive range**: distinct looks reachable from the UI | Sample 500 random recipes and count perceptual-hash clusters | ◐ | ● (camera, elevation) | ● (op × order × space) | ● (3D, planar) |
| C4 | **Exploration ergonomics**: find, compare, keep, recover | Task timings: "find 5 sprites you like and export a sheet" | ● | ● | ● (curation, pruning) | ○ |
| C5 | **Output usefulness**: assets that drop into an engine | Export modes; pixel-exact asset path; 3D formats (.obj per `combine.md`) | ● PNG | ● PNG, turntable, manifest | ● PNG | ◐ model JSON |
| C6 | **Performance**: interactive at realistic sizes | ms per render at 8×6 sheets of 16², 32²; 48³ and 64³ volumes | ◐ | ◐ | ● after its perf pass | ? (to measure) |
| C7 | **Code health**: modular, testable, small surface | Headless-runnable core? DOM coupling? Lines per concern | ○ | ○ | ◐ | ● (UMD core) |
| C8 | **Recipe compatibility**: old work still loads and reproduces | Load v3/v4 sessions; reproduce sprites byte-for-byte | ● v4 | ● v3 | ◐ own format | ◐ NG recipe in |

● strong · ◐ partial · ○ weak or absent · ? unknown

**First-read takeaway.** No single app wins: each leads on different criteria. A plausible merge takes:

- **Core:** moblocks' UMD module shape, holding the shared Φ spine plus `FIELDS3`.
- **Pixels:** NG's kernel as the single reference rasteriser, with its self-tests promoted to a headless suite.
- **Workshop:** NG's timeline (take, keyframes, pruner) on top of the 2D/3D collection and lock code.
- **Viewing:** 3D's camera model, its cards/elevation/Z-stack ideas and its §10.4 export invariant, rendering moblocks volumes as well as sheets.

Treat this as a hypothesis for §8 to test, not a decision.

---

## 8. Questions for discussion

1. **Weights.** Which of C1–C8 matter most? If the product is the recipe → `.obj` API from `combine.md`, then C1, C2, C5 and C8 dominate and C4 is a tooling concern.
2. **Scope.** Should this merge stay within these four sprite apps, or fold into the larger `combine.md` plan with the bimoblock showrooms? moblocks overlaps heavily with the showrooms' B₃/Oh group work.
3. **Reference raster.** Is NG's software kernel the source of truth, with the GLSL shader becoming a fast path that must match it within a stated tolerance?
4. **Missing specs.** Do the NG spec ("ng §…"), the moblocks brief, `ref.js`, the moblocks test suites and `panzoom-r0-harness.js` exist somewhere? They would turn several ◐ ratings into measurements.
5. **Measurement harness.** Should step 1 be a small headless harness that loads each app's core and computes C1, C3 and C6 for a fixed recipe set? That would replace the first-read ratings in §7 with numbers.
6. **The 3D branch's camera code.** Port it forward (OrbitControls, presets, Z-stack) or rebuild it on moblocks' rig? The 3D app's R2 notes are a strong argument against hand-rolled damping.
