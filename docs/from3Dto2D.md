# from3Dto2D.md

*A discussion document about growing the 2D sprite generator by relying much more on group theory. The ideas come from [block-showroom](../block-showroom/), the youngest member of the family.*

Status: **first pass, 2026-10-06.** Follows on from [spritesnow.md](spritesnow.md).

Unlike `spritesnow.md`, the claims in §3 and §5 are **measured**: a script ran the real `fold()` from the 2D app and the real `GROUPS` from the showroom core. The method is in the appendix. Everything else, especially §6, is a proposal for discussion.

---

## Short version

- **The genes already flowed one way.** The showroom's `PLANAR` field table *is* six of the 2D generator's `FIELDS`: conic, cubic, trefoil, mixmul, xor and product. The 3D side borrowed the 2D side's fields. This document is about the return trip: the 2D side borrowing the 3D side's **group theory**.
- **The showroom treats symmetry as data.** A group is a set of element codes, built by closure from generators. Every cell is sent to the lexicographic minimum of its orbit, and the shape is decided **once per orbit**. Afterwards, `autOrder()` counts the symmetries the result actually has, which checks that the guarantee held.
- **The 2D generator treats symmetry as a `switch`.** Its seven `fold()` modes are hand-written index arithmetic. Measured across every size from 2×2 to 40×40:
  - **mirror, quadrant and even-sized square rot90 / D4 are exact.**
  - **rot180 breaks at odd heights.** For example, 30 cells at 31×31.
  - **rot90 breaks at odd square sizes.** For example, 60 cells at 31×31.
  - **On any non-square sprite, "rot90" silently becomes mirror-quadrant symmetry.** That is a different symmetry from the one the user chose, not just a smaller one.
  - moblocks found and documented the odd-size defect ([moblocks-viewer.html:336](moblocks-viewer.html#L336)). The non-square substitution is new here.
- **2D has its own small group to work with.** The 2D equivalent of the cube's 48 symmetries is **D4**: the 8 symmetries of a square, with 10 subgroups in 8 conjugacy classes. The 2D app reaches 6 of those 8 classes. **Missing:** a single diagonal mirror, and the pair of diagonal mirrors without the axis mirrors.
- **Old sprites can stay byte-identical.** Wherever the legacy fold is consistent, the cell it chooses is a true member of that cell's orbit. So an orbit engine can use the legacy choice as its tie-break and reproduce every existing sprite in all the cases where the old code was correct. Only the defective cases change, and those must change to be fixed.
- **Group data gives more than correctness.** Things the 2D generator gets almost free once the group is data:
  - the true symmetry count of every result, before and after rasterisation
  - a chirality flag and a "mirror twin" button
  - every distinct orientation of a sprite, using the coset code the showroom computes but never uses
  - an "orbit" colour channel
  - tiered "sprites made of sprites" with a separate group per tier
  - a contact sheet that walks the subgroup lattice
- **There are also two directions the showroom cannot offer**, because it is 3D and point-group-only:
  - groups with **translations** (the 17 wallpaper groups and 7 frieze groups), which give tileable textures and borders
  - **colour-permuting symmetry** ("counterchange"), where a mirror also swaps two inks

---

## 1. Meet block-showroom

| | |
|---|---|
| What | An endless 2D lattice of procedurally generated 3D voxel specimens ("bimoblocks"), rendered with three.js r128 |
| Lineage | Seeded on **2026-09-16** from `extended-bimoblock-showroom.html`, the 2,894-line file `discoveries.md` analysed. Refactored into ES modules on a plan ([refactorplan.md](../block-showroom/refactorplan.md)); last commit **2026-10-02** |
| Shape | About 4k lines of source in `src/`, with a pure core [bimoblock-core.js](../block-showroom/src/core/bimoblock-core.js) (1,069 lines, no DOM or THREE), a worker pool, an instancing renderer and a permalink |
| Tests | `npm test` checks FNV **golden hashes** of occupancy, mesh and `aut` for 7 fixed recipes. `npm run test:browser` uses headless Chrome |
| Docs | [add2tri.md](../block-showroom/add2tri.md) is a beginner-level walk from address to triangles. It is the clearest explanation of the group pipeline anywhere in the repo |

### Where it sits in the family

```
  2D sprite line  (spritesnow.md §2)                      bimoblock line
  ──────────────────────────────────                      ──────────────
  symmetrical_sprite_generator  ── FIELDS ──────────────►  extended-bimoblock-showroom
    │                              (conic, cubic,             │  Oh group, mixed-radix tiers
    ├─ …_3d                         trefoil, mixmul,          ▼
    └─ mosprites-ng                 xor, product)          block-showroom   (Sep 16 → Oct 2)
         └─ moblocks-viewer ◄─── B₃ orbit canonicalisation   modular, tested, instanced
                                  (same 48-element group,
                                   built independently)

  this document:  block-showroom ── group theory ──► 2D generator
```

moblocks and the showroom both use the full 48-element cube group, independently. moblocks uses it to compress storage: it canonicalises 8³ nodes. The showroom uses it to *generate*: it folds cells. Neither imports the other.

---

## 2. What the showroom does with group theory

Each item is something the 2D generator does not have yet.

| # | Mechanism | Where | What it does |
|---|---|---|---|
| G1 | **Elements as codes** | [core:11–46](../block-showroom/src/core/bimoblock-core.js#L11) | An element is `e = perm·8 + signbits`, with 6 axis permutations × 8 sign flips = 48. Each code has a matrix, so composing two elements is a multiply and `detE` gives the sign |
| G2 | **Groups by closure** | [core:47–92](../block-showroom/src/core/bimoblock-core.js#L47) | A group is listed by its *generators* (`Mx`, `R90y`, `cyc`, …) and `closure()` fills in the rest. Ten named subgroups, from `C1` to `Oh` |
| G3 | **Chirality as a group property** | [core:85](../block-showroom/src/core/bimoblock-core.js#L85), [recipe.js:19](../block-showroom/src/lattice/recipe.js#L19) | `chiral = every element has det > 0`. One flag per specimen, with a colour mode for it |
| G4 | **Orbit fold by lex-min** | [core:94](../block-showroom/src/core/bimoblock-core.js#L94) | Each cell goes to the lexicographically smallest member of its orbit. The rule is the same for every group and has no parity cases |
| G5 | **Decide once per orbit** | [core:997–1040](../block-showroom/src/core/bimoblock-core.js#L997) | Visit cells in scan order. An unvisited cell starts a new orbit: evaluate the envelope and field once, copy the result to every member, mark them visited. Measured: 46× fewer evaluations at R=243 under Oh |
| G6 | **Orbit index per cell** | [core:557](../block-showroom/src/core/bimoblock-core.js#L557), `orbit[]` | Uses `MUL`/`INV` tables to record *which* element carried each cell to its representative, with no search. This drives the "orbit" colour mode, one hue per symmetric copy |
| G7 | **Symmetry check afterwards** | [core:595](../block-showroom/src/core/bimoblock-core.js#L595) `autOrder` | Counts how many of the 48 elements leave the finished occupancy unchanged. The result is always ≥ the group's size. It appears in the HUD and in the golden tests |
| G8 | **Orbit-respecting density** | [core:1046–1052](../block-showroom/src/core/bimoblock-core.js#L1046) | Keeps the top fraction of cells using a quickselect cut and `≥ cut`. Because copies share one score, a mirror pair is never split |
| G9 | **Tiered (mixed-radix) symmetry** | [core:909](../block-showroom/src/core/bimoblock-core.js#L909) `tierFolder` | `R = r₀·r₁·…`. Each tier's digit triple can be folded by **its own group** using lookup tables. Example: the big blocks arranged with 4-fold symmetry, and the cells inside each block mirrored |
| G10 | **Tier fields** | [core:404](../block-showroom/src/core/bimoblock-core.js#L404) | Six fields defined on the *relation between tiers*. `t:wreath` picks an axis permutation and sign per block from that block's own address, which is literally a wreath-product element |
| G11 | **Cosets, computed and unused** | [core:86–90](../block-showroom/src/core/bimoblock-core.js#L86) | `cosetOf`/`cosets` are built for every group but read nowhere. `cosets` = 48/\|G\| = the number of distinct orientations of a specimen |
| G12 | **The address axes walk the groups** | [recipe.js:52](../block-showroom/src/lattice/recipe.js#L52) | x = archetype (12) and y = symmetry group (10), so one page is a contact sheet of every shape under every group, sharing one seed |
| G13 | **Districts** | [recipe.js:117](../block-showroom/src/lattice/recipe.js#L117) | Pin a specimen and its neighbours become relatives that drift further from it with each ring out. It stays a pure function of (address, generation, pin) |

---

## 3. Where the 2D generator stands today

The 2D symmetry is [`seedDims` + `fold`](symmetrical_sprite_generator.html#L472): a `switch` over seven modes that maps each cell into a "seed region" by index arithmetic. NG and the 3D app copied it verbatim, and moblocks reproduces it deliberately (the defect included) so that its z=0 slice matches the 2D sprite.

### Measured: is `fold()` a correct group fold?

A fold is correct when every member of an orbit maps to the same seed cell, so they share one value. I checked every mode on every grid from 2×2 to 40×40 against the true orbits of the group each mode names.

| Mode (group intended) | Square, even | Square, odd | Non-square |
|---|---|---|---|
| none (C1) | exact | exact | exact |
| horizontal, vertical (Cs) | exact | exact | exact |
| quadrant (D2) | exact | exact | exact |
| rot180 (C2) | exact | **broken: middle row** (8 cells at 9×9, 30 at 31×31, 32 at 33×33) | **broken whenever h is odd** |
| rot90 (C4) | exact | **broken: middle row and column** (16 at 9×9, 60 at 31×31, 64 at 33×33) | **becomes a different group**: you get mirror-quadrant (D2) symmetry, not rotation. 1,482 of 1,482 non-square sizes |
| diagonal, "Dihedral 8-fold" (D4) | exact | exact | becomes quadrant, which is fine. But in **38 grids** with `ceil(w/2) == ceil(h/2)` and `w ≠ h`, it transposes a non-square seed region, which is not a symmetry of the grid at all |

The default sprite is 16×16, which is why nobody noticed. The odd-square numbers match moblocks' own measurement.

**The non-square rule.** A rectangle's own symmetries are only {identity, mirror-x, mirror-y, rot180}. On a rectangle the best a group can do is **G ∩ Aut(grid)**. For C4 that is C2 (rot180), not D2. The showroom never meets this problem because its grid is always a cube.

### Measured: can a group engine reproduce existing sprites exactly?

Yes, everywhere the legacy fold is correct. In every consistent case outside non-square rot90 and those 38 diagonal grids, the legacy seed cell **is a member of the cell's own orbit**. So an orbit engine can choose its representative with a "legacy-domain" tie-break (pick the member `fold()` would have picked) and match every existing sprite cell for cell.

A plain lex-min representative, ordered by row then column as in moblocks' `orbitFold`, also agrees with the legacy choice for none, the two mirrors, quadrant and rot180. It **disagrees** for rot90 (for example 40 of 64 cells at 8×8) and for D4 (16 of 64). A lex-min-only engine would therefore silently change every rot90 and D4 sprite. That is the trap `discoveries.md` warned about: *"the choice of canonical cell is part of every recipe."*

---

## 4. The 2D group, made explicit

The square's symmetry group D4 (also called B₂) is the 2D version of the showroom's Oh. With 2 axis permutations × 4 sign flips = 8 elements, the showroom's encoding carries straight over: **`e = swap·4 + signbits`, 3 bits.**

All of D4's subgroups, measured and grouped by conjugacy:

| Class | Count | Order | Orbits at 16×16 | Orbits at 8×8 | Today's mode | Chiral? |
|---|---|---|---|---|---|---|
| C1 | 1 | 1 | 256 | 64 | none | yes |
| Cs, axis mirror | 2 | 2 | 128 | 32 | horizontal, vertical | no |
| **Cs, diagonal mirror** | 2 | 2 | 136 | 36 | **missing** | no |
| C2 | 1 | 2 | 128 | 32 | rot180 | yes |
| C4 | 1 | 4 | 64 | 16 | rot90 | yes |
| D2, axis mirrors | 1 | 4 | 64 | 16 | quadrant | no |
| **D2, diagonal mirrors** | 1 | 4 | 72 | 20 | **missing** | no |
| D4 | 1 | 8 | 36 | 10 | diagonal | no |

The "orbits" column counts the independent decisions per sprite. It is also the length of the bit-word that describes a two-colour sprite: an 8×8 D4 sprite is 10 bits, so there are 1,024 of them (the `discoveries.md` observation, now with the full table).

Compare 3D: Oh has **98 subgroups in 33 conjugacy classes**, and the showroom offers 10. In 2D the full set is small enough to offer all of it.

---

## 5. Measured: what a slice of a bimoblock inherits

This is "3D to 2D" taken literally. Slicing a specimen along an axis-aligned plane gives a sprite. Its symmetry is the part of the 3D group that maps the plane to itself, acting on that plane. Computed from the showroom's actual `GROUPS`:

| Showroom group | \|G\| | Midplane slices (z / y / x) | Off-centre slices (z / y / x) |
|---|---|---|---|
| C1:free | 1 | C1 / C1 / C1 | C1 / C1 / C1 |
| Cs:mirror-X | 2 | Cs / Cs / C1 | Cs / Cs / C1 |
| C2:rot180-Y | 2 | Cs / **C2** / Cs | C1 / C2 / C1 |
| C2v:bi-axial | 4 | Cs / D2 / Cs | Cs / D2 / Cs |
| C3:diag-3 | 3 | C1 / C1 / C1 | C1 / C1 / C1 |
| C4:pinwheel | 4 | Cs / **C4** / Cs | C1 / C4 / C1 |
| C4v:quad-4 | 8 | Cs / D4 / Cs | Cs / D4 / Cs |
| S6:diag-6 | 6 | C2 / C2 / C2 | C1 / C1 / C1 |
| Td:tetra-24 | 24 | D4 / D4 / D4 | **D2 (diagonal)** / D2 (diagonal) / D2 (diagonal) |
| Oh:octa-48 | 48 | D4 / D4 / D4 | D4 / D4 / D4 |

What this shows:

- **Td's off-centre slices land in the "D2, diagonal mirrors" class, one of the two classes the 2D app cannot produce today.** A 2D app that could slice bimoblocks would get that class for free.
- **Three-fold symmetry disappears.** C3 and S6 have no 3-fold symmetry visible in any axis-aligned slice. A square pixel grid cannot hold 3- or 6-fold symmetry at all. Getting it would need a hex or triangular grid (whose largest point group is D6, order 12). That is a stretch goal, noted in §6.
- **Midplane and off-centre slices differ for the groups that flip z** (C2, C4, S6, Td). Slicing a specimen front to back therefore gives frames with *different* symmetry at the centre. That is a natural animation, and §6 P7 builds on it.

---

## 6. Proposals: ways to grow the 2D generator

These are listed roughly from cheapest and safest to most speculative. Each one names the showroom mechanism it borrows (G1–G13).

### P1 — A group engine in place of the `switch`  *(G1, G2, G4, G5)*
- A `groups2d` module: D4 element codes, `closure()`, all 10 subgroups by name, and orbit enumeration that decides once per orbit and copies the result to every member.
- It is correct at every parity by construction, which fixes every defect in §3. It also adds the two missing classes (diagonal mirror, D2-diagonal) for free.
- **Non-square sprites:** use G ∩ Aut(grid), and **show the effective group in the UI** instead of silently substituting another.
- **Compatibility:**
  - Choose representatives with the legacy-domain tie-break, so every currently-correct sprite stays byte-identical.
  - Add `foldVersion` to the recipe. v1 reproduces the defects for old sessions, as moblocks does. v2 is correct.
  - Write golden hashes *before* switching, as the showroom does.
- **Caveat:** the field and shape-mask sources are evaluated point by point, so they move over cleanly. The `noise` source with CA smoothing and the `blob` mask depend on each cell's neighbours in the seed region, so they need their own definition on orbits.

### P2 — Readouts that come from the group  *(G3, G7, G11)*
- **aut(result):** count the D4 elements that preserve the finished sprite. It is ≥ \|G\| by construction, and anything above that is accidental extra symmetry, worth showing.
- **aut(raster):** the same count on the *rasterised* output. This generalises NG's N2 test (mirror survives only under `add` at q \| w) from one hard-coded claim to a measurement for every operator, order and scale. It also connects the group theory to the seam theory in `aamazing.md`.
- **Chirality** flag. **Orbit count** and the size of the recipe space (n colours ^ orbits). Distinct orientations = 8/\|G\|.

### P3 — Orientation sets, mirror twins and deduplication  *(G11, the unused cosets)*
- **Orientation sheet:** export a sprite in each of its 8/\|G\| distinct orientations, picking one element from each coset. These are the facing directions a game needs, with no duplicates.
- **Mirror twin:** a chiral sprite has a separate left- and right-handed version. Add one button to produce the twin.
- **Deduplicate the collection up to symmetry:** key each sprite by the minimum hash over its D4 images, so rotated copies of the same sprite are recognised.

### P4 — The orbit-index channel and colour symmetry  *(G6, then beyond the showroom)*
- **Colour by copy:** paint each symmetric copy by the element that carries it to the representative, like the showroom's "orbit" mode. It is a diagnostic and also a look in its own right.
- **Counterchange (two-colour) groups:** let an element act on *colour* as well as position. For example, a mirror that also swaps inks 1 ↔ 2 produces Escher-style counterchange patterns. In group terms, D4 acts on (cell, palette index), and the palette action is a homomorphism D4 → S_n. The showroom has nothing like this, so it is new ground for the 2D app.

### P5 — Tiered sprites: sprites made of sprites  *(G9, G10)*
- **Mixed-radix levels in 2D:** a 16×16 sprite becomes 4×4 blocks of 4×4 cells, with one group for the blocks and another for the cells inside them (`tierFolder` in 2D).
- **Port the six tier fields:** digit-swap, wreath, cross, carry, phasecell and prefix-hash. In 2D, `t:wreath` becomes: *each block shows one shared motif under a D4 element chosen from that block's address*. That is a wreath product D4 ≀ G, and it produces Truchet-like sprites by construction.
- This connects to moblocks' node tree, which uses the same macro/micro hierarchy for storage and LOD.

### P6 — The subgroup lattice as a way to navigate  *(G8, G12, G13)*
- **Contact sheet:** sheet columns walk the 8 classes and rows walk fields, with one seed for the whole page. That is the showroom's page, and it replaces today's grid of unrelated random cells with a readable comparison.
- **Raise or lower the symmetry while keeping the seed.** With nested representatives (lex-min, or the legacy domains, which are also nested: half ⊃ quadrant ⊃ D4 triangle), the sprite under a larger group copies values from the sprite under a smaller one. Every cell of the more symmetric sprite already appears in the less symmetric sprite at its representative. Moving up the subgroup diagram therefore *imposes* symmetry rather than re-rolling. This holds exactly for the field sources, because 2D uses a per-cell threshold.
- **Optional quantile density** (G8), so the fill fraction stays fixed when the group changes. It is the second meaning of "density" from `spritesnow.md`, so it should be named apart.
- **Districts** for the sprite sheet: pin a sprite, and its neighbours become relatives.

### P7 — Literally 3D to 2D: slices and space-time groups  *(§5)*
- **Slices as sprites:** call `createBimoblockCore().buildBlock` and take slices. The symmetry of each frame is known in advance from the table in §5.
- **Slices as animation frames:** if the 3D group contains a z-mirror, frame k equals frame D−1−k, which gives a guaranteed palindromic loop.
- **Space-time groups:** treat time as a *periodic* third axis and allow screw elements such as (x, y, t) → (−y, x, t + T/4). The result is an animation that rotates 90° every quarter cycle and loops by construction. The showroom's machinery works almost unchanged; only the t-axis needs a wraparound, like the `wrapR` used in its nested lift.

### P8 — Translations: wallpaper and frieze groups  *(beyond the showroom)*
- Point groups describe a single object. Adding translations gives the **17 wallpaper groups** (seamless, tileable textures) and the **7 frieze groups** (borders and strips). The 2D app's "global seam phase" already treats the sheet as one surface, and this would make that surface periodic by design.
- This is where 2D can go *further* than the showroom, which is limited to point groups.

### P9 — Curiosity: Z/M is a group too
- The modulus already makes the field a cyclic group Z/M. Two consequences:
  - The "cycle residue" colour mode is a group homomorphism only when nc divides M.
  - Multiplying the field by a unit k of Z/M permutes residues, which gives a family of related sprites with the same partition structure.
- Low cost and possibly pretty, but untested. It is listed here so it is not lost.

---

## 7. Engineering habits worth borrowing

The showroom's process is as useful as its maths:

- **A pure core**: no DOM, no THREE, runs in Node and in workers. moblocks' UMD core has the same shape.
- **Golden hashes as the behaviour contract.** FNV over occupancy, mesh and `aut` for fixed recipes. Regenerate them only for *intended* changes, and say so in the commit.
- **Symmetry by construction, checked afterwards.** Fold so that asymmetry is impossible, then *count* the symmetry (`autOrder`) in the tests anyway.
- **The address or recipe is the identity.** Nothing is stored that cannot be rebuilt, and a permalink is the recipe.

---

## 8. A suggested first step

1. **Golden hashes for 2D `generateSprite`** over every mode, a set of sizes (even/odd, square/non-square) and a few seeds, in Node. These pin current behaviour, defects included.
2. **`groups2d`** (P1) with three tests:
   - byte-identical to the goldens on every case §3 marks exact
   - `aut ≥ |G|` on every case
   - the effective group reported correctly on non-square grids
3. **The readouts from P2.** They are cheap, and they turn §3 and §5 into live numbers in the UI.
4. Then choose a direction. P3 and P5 look like the best value for game assets; P7 and P8 are the most novel.

---

## 9. Questions for discussion

1. **Fix or preserve?** Should `foldVersion: 2` become the default for new sprites, with old sessions pinned to v1? Or should odd-size rot180/rot90 sprites just change?
2. **Non-square rot90:** quietly reduce it to C2 and say so in the UI, or refuse the mode?
3. **Which group set appears in the UI?** All 8 classes, or all 10 subgroups (which also distinguishes horizontal from vertical, and the two diagonals)?
4. **How far beyond point groups?** Is the 2D app a sprite tool (P1–P6), or also a tile and texture tool (P8) and an animation tool (P7)?
5. **Where does this code live?** In the planned merged core from `spritesnow.md` and `combine.md`, or first as a module beside the 2D app?
6. **Shared engine?** moblocks (storage), the showroom (generation) and a future `groups2d` would all be "groups as data". Should they share one element-code and closure module across dimensions?

---

## Appendix: how the measurements were made

- **§3 fold checks.** The real `seedDims`/`fold` were extracted from [symmetrical_sprite_generator.html](symmetrical_sprite_generator.html#L472) and run in Node. For each mode, the elements of the intended group that map the w×h grid to itself were applied to every cell to get its true orbit. A cell "breaks symmetry" when its orbit's members fold to more than one seed cell. Representatives were then compared with the legacy fold and with a row-then-column lex-min. All grids from 2×2 to 40×40 were checked.
- **§4–5 group counts.** The showroom core was imported directly (`createBimoblockCore()`). Subgroups of Oh and of D4 (the elements that fix the z axis) were enumerated as closures of every set of ≤3 generators, then grouped by conjugacy. Each slice's group is the stabiliser of the plane, conjugated onto the xy plane and classified by its rotations and reflections.
- The scripts are in this session's scratchpad (`foldcheck.js`, `groups.mjs`). Say if you want them kept in the repo as tests. Step 1 of §8 would absorb them.
