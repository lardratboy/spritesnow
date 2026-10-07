# Browser smoke test (M2, M3a, M3b, M3c, M4a, M4b, M5a, M5b, M5c)

What to check by hand after a change to the UI. About five minutes.

Start the server from the `spritesnow` folder:

    npm run serve

then open <http://localhost:8000/>.

1. **First load.** A sheet of 48 sprites appears, each one mirror-symmetric
   left/right. The status line at the bottom says how long the build took.
2. **Inspect.** Click any sprite. The right panel shows a large preview, its
   seed, its symmetry, how many symmetries it actually has ("2 of 8
   (guaranteed 2)"), and its recipe text. Click empty space to clear it.
3. **Pan and zoom.** Drag to pan, scroll to zoom, then press **F** (or Fit) to
   fit the sheet again. Sprite pixels stay crisp at any zoom.
4. **Symmetry.** Try each of the 10 entries in Symmetry. The two diagonal
   mirrors and "D2 · both diagonal mirrors" are new: the old app could not
   make them.
5. **Non-square.** Set Symmetry to "C4 · pinwheel", then set Height to 12. An
   amber note under Symmetry says the sprite becomes "C2 · rotate 180°", and
   the inspector shows an amber "Effective" row.
6. **Regenerate and palette.** Press **R**: new sprites, same settings. Click
   "New palette": same shapes, new colours.
7. **Permalink.** Click "Copy link", open a new tab and paste. You get the
   exact same sheet.
8. **Old session.** Click "↑ Load session" and choose a `sprite_session.json`
   saved by `symmetrical_sprite_generator.html`. The sheet should match what
   the old app showed at its playhead. Fold reads "Old app, exact (v1)", and a
   fractional scale is reported as rounded.
9. **Old defect, side by side.** After importing, or by setting Width and
   Height to 15 and Symmetry to "C2 · rotate 180°": switch Fold between v1 and
   v2. With v1 the middle row of each sprite is not truly symmetric. With v2
   it is.
10. **Export.** "↓ Sheet PNG" downloads the sheet with a transparent
    background. "↓ PNG" in the inspector downloads the selected sprite alone.

## Timeline (M3a)

The strip under the sheet. Each entry is a whole recipe, so clicking one
rebuilds exactly what was on screen then.

11. **Recording.** On first load the strip has one entry, "session start".
    Change Symmetry: a second entry appears, labelled with the change.
    Drag the Phase slider back and forth for a few seconds: it adds **one**
    entry, not dozens. Press **R**: an entry "new seeds".
12. **Rewind and branch.** Press **←** twice. The sheet goes back, the label
    says "rewound", and "Copy link" now gives that older sheet. Change
    Colours: a new entry appears at the **end** (nothing is lost), and its
    tooltip says "branched from #…". Its label names only Colours.
13. **Keyframes.** Press **B** (or ◇): the entry gets an amber ◆ and border.
    Click "◆ only": the strip shows only keyframes and the current entry.
    Click it again to show everything.
14. **REC off.** Click REC to turn it off, then change a setting. The sheet
    changes but no entry is added, and the label says "● unrecorded".
    Press **B**: the current state becomes a new keyframe. Click REC to
    turn recording back on.
15. **Prune.** Make several small changes, then click ✂. Slide
    "Similarity": the line reports how many entries it would remove and
    that keyframes are protected. "Remove" removes them; the current entry
    and keyframes always stay.
16. **Delete and replay.** Hover a thumbnail and click its ✕, or press
    **Delete** to remove the current entry. Press **Space** to replay the
    timeline from the start; it stops at the end.
17. **Old session timeline.** "↑ Load session" with an old session loads
    its whole timeline (bookmarks become keyframes) and shows the entry it
    was saved at. Since M3c it replaces the current timeline, as loading
    any session does (step 30).

## Lock and reroll (M3b)

18. **Lock.** Click a sprite, then press **L** (or the inspector's Lock
    button, or ⌘-click / Ctrl-click the sprite). It gets a red outline
    with a corner tab, and the timeline adds "lock #…".
19. **Locked sprites stay put.** Change Symmetry, Gamut and click "New
    palette". Every other sprite changes; the locked one does not. Select
    it: the inspector says "keeps its own Symmetry, Gamut, Palette".
20. **Regenerate around locks.** Press **R**: every unlocked sprite
    changes, the locked ones stay, and the timeline label says how many
    locked sprites were kept.
21. **Reroll.** Shift-click a sprite (or select it and press **Shift+R**,
    or the Reroll button). Only that sprite changes, and if it was locked
    it is now unlocked.
22. **Unlock.** Press **L** again on a locked sprite: it follows the sheet
    settings again. **Esc** clears the selection.
23. **Locks are saved.** Copy the link and open it in a new tab: the same
    sprites are locked. Exported PNGs never show the red outlines.

## Collection and sessions (M3c)

The collection is a shelf of kept sprites under the inspector. It sits
outside the timeline: scrubbing never removes a kept sprite.

24. **Keep.** Click a sprite and press **K** (or "+ Keep" in the
    inspector, or Alt-click / Option-click the sprite). It appears under
    "Collection" with a name like "trefoil·17", its size, the timeline
    entry it came from and its seed. Keep the same kind of sprite twice:
    the second is named "… (2)".
25. **Kept means kept.** Change Symmetry, click "New palette" and press
    **R**. The sheet changes; the kept thumbnails do not. Lock a sprite
    and keep it: it is kept with the settings it was locked with.
26. **Rename and reorder.** Click a name, type a new one, press Enter.
    Drag a row above another: a blue line shows where it will land. With
    the cursor in a name, **Alt+↑ / Alt+↓** moves that row.
27. **Restore.** Click ⟲ on a kept sprite. The sheet takes that sprite's
    settings, the first cell shows exactly that sprite (selected), the
    sheet keeps its size, and the timeline adds "restore …".
28. **Export.** ↓ on a row downloads that sprite as a PNG at the sheet
    scale, named after it. "↓ Sheet" in the Collection header downloads
    every kept sprite on one packed, about-square sheet. ⧉ copies the
    sprite's recipe, and ✕ removes it.
29. **Save.** Turn REC off and move a slider, so the label says
    "● unrecorded". Click "↓ Save session": a
    `spritesnow-session-<date>.json` downloads, and the status line says
    what it saved, including the unrecorded sheet.
30. **Load.** Reload the page (the timeline and collection are empty
    again), then "↑ Load session" with that file. Everything comes back:
    every timeline entry with its keyframes and branches, REC off, the
    unrecorded sheet still marked unrecorded, and the collection with its
    names and order. With work on screen, loading first asks before
    replacing it; Cancel changes nothing.
31. **Old sessions bring their collection.** Load an old
    `sprite_session.json` that had kept sprites: they appear in the
    collection, looking as they did in the old app. A file that is not a
    session gives a red message in the status line and changes nothing.

## Rendering (M4a)

The screen shows the sheet at scale 1 and zooms it by Scale; sprites
come from a cache, so only changed cells are generated.

32. **Status line.** On first load it ends "48 generated, built in … ms".
    Shift-click a sprite: "1 generated". Lock one: "0 generated". Change
    Scale: "0 generated", and the sheet refits at the new size.
33. **Big sheet.** Set Columns and Rows to 50, Width and Height to 32,
    and Scale to 16. The sheet appears (it could not before M4a) and fits
    the stage. Shift-click a sprite: "1 generated", built in a few ms.
    Zoom in with scroll or **+**: pixels stay crisp and outlines line up.
34. **Export limits.** On that sheet, "↓ Sheet PNG" gives a red message:
    27200×27200 px is too big for a browser, and scale 9 fits. Back on
    the default sheet (scale 4) it downloads a 576×432 PNG, as before.

## WebGL2 view (M4b)

The sprites are drawn by the GPU from their palette indices; the 2D path
is the fallback. `npm run test:browser` checks most of this headlessly.

35. **Renderer.** The status line ends "· WebGL2". Open
    <http://localhost:8000/?gl=0>: it ends "· 2D" (the fallback).
36. **Same pixels.** On the default sheet click "Copy link" and paste it in
    a second tab, adding `?gl=0` before the `#` (so it starts
    `http://localhost:8000/?gl=0#r=`). Press **F** in both and flip
    between the tabs: no sprite moves or changes colour.
37. **Outlines.** Lock a sprite and select another: the red and blue
    outlines sit exactly around their cells at any zoom, as in step 33.
38. **Big sheet.** Repeat step 33 in the WebGL2 tab. Panning and zooming
    stay smooth, the status line does not change while you do (nothing is
    rebuilt), and a Shift-click still says "1 generated".

## Tiered sprites (M5a)

A tiered sprite is a sprite made of sprites (newdesign.md §5.2). The
Tiers section sits under Sprite in the left panel. Each link below opens
one row of §5.2's table on a fresh 16×16 sheet; the Tiers section should
show the free-cell count in the last column. `tiers.test.js` checks that
these links decode to these recipes and counts.

| Symmetry | Tiers | Link | Free cells |
|---|---|---|---|
| D4 | off | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIn0sInAiOjF9> | 36 |
| D4 | `4 / 4` | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCJ9LCJwIjoxfQ> | 36 |
| none | `4 copy:dihedral / 4 copy:dihedral` | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6Im5vbmUiLCJ0aWVycyI6IjQgY29weTpkaWhlZHJhbCAvIDQgY29weTpkaWhlZHJhbCJ9LCJwIjoxfQ> | 9 |
| none | `4 / 4 dihedral` | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6Im5vbmUiLCJ0aWVycyI6IjQgLyA0IGRpaGVkcmFsIn0sInAiOjF9> | 48 |
| C4 | `4 / 4 mirror-x` | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6InJvdDkwIiwidGllcnMiOiI0IC8gNCBtaXJyb3IteCJ9LCJwIjoxfQ> | 16 |
| mirror-x | `4 / 4 rot90` | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6Im1pcnJvci14IiwidGllcnMiOiI0IC8gNCByb3Q5MCJ9LCJwIjoxfQ> | 32 |
| none | `4 copy:rot90 / 4` | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6Im5vbmUiLCJ0aWVycyI6IjQgY29weTpyb3Q5MCAvIDQifSwicCI6MX0> | 64 |

39. **Same sprite.** The first two links show the same sheet: tiers with no
    groups change nothing.
40. **Blocks.** On the `4 / 4 dihedral` link, each sprite is a 4×4 grid of
    4×4 blocks, and every block is symmetric under all eight moves. Under
    Tier 2 the panel says "→ blocks D4 · all eight".
41. **More than asked for.** On the `4 / 4 mirror-x` link (C4 sprite), Tier
    2 says "→ blocks D2 · both axis mirrors": turning a left/right mirror by
    90° makes a top/bottom mirror too. Look closely: every block has both mirrors.
42. **Copies are not symmetry.** On the `4 copy:rot90 / 4` link the blocks
    repeat in a four-fold pattern, but each copy is the same way up, so the
    whole sprite is not symmetric ("Sprite: C1 · none").
43. **Picker.** Across lists only the splits of the width (16: 16, 2·8, 4·4,
    8·2, 2·2·4, …). Pick 2·2·4: three tiers appear, Down follows to 2·2·4,
    and the groups already chosen stay on their tiers.
44. **Off, not lost.** Open the `4 / 4 mirror-x` link again and set Height
    to 12. Across reads "4 / 4 mirror-x (off)" and an amber
    note says "Tiers off: 4·4 = 16, sprite is 16×12." The sheet is the
    plain sheet. Set Height back to 16: the tiers come back on as they were.
45. **Rectangle.** Still at 16×12, pick Across 4·4: Down becomes 3·4, the
    split of 12 closest to 4·4, and the mirror stays on Tier 2. Tier 1 says
    C4 · pinwheel does not fit a 16×12 block (C2 · rotate 180°), as in step 5.
46. **Old fold.** Set Fold to "Old app, exact (v1)": Across is disabled and
    the amber note says "Tiers off: the old fold (v1) has no tiers." Set it
    back to v2 and the tiers come back.
47. **Link and timeline.** "Copy link" with tiers set, paste in a new tab:
    the same sheet and the same Tiers panel. In the timeline, the tier
    change is labelled "Tiers off → 4 / 4 mirror-x" (or similar).

## Tier fields (M5b)

A tier field changes what the motif (the base field) sees in each block
(newdesign.md §5.2). It is the Field select at the bottom of the Tiers
section. Each link below opens a D4 16×16 sheet with `4 / 4` tiers and
the same seeds and palette, so only the field differs. `tierfields.test.js`
checks that these links decode to these recipes.

| Tiers | Field | Link |
|---|---|---|
| `4 / 4` | none | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCJ9LCJwIjoxfQ> |
| `4 / 4` | wreath | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCIsInRpZXJGaWVsZCI6IndyZWF0aCJ9LCJwIjoxfQ> |
| `4 / 4` | digit-swap | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCIsInRpZXJGaWVsZCI6ImRpZ2l0LXN3YXAifSwicCI6MX0> |
| `4 / 4` | prefix-hash | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCIsInRpZXJGaWVsZCI6InByZWZpeC1oYXNoIn0sInAiOjF9> |
| `4 / 4` | phasecell | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCIsInRpZXJGaWVsZCI6InBoYXNlY2VsbCJ9LCJwIjoxfQ> |
| `4 / 4` | cross | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCIsInRpZXJGaWVsZCI6ImNyb3NzIn0sInAiOjF9> |
| `4 / 4` | carry | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiI0IC8gNCIsInRpZXJGaWVsZCI6ImNhcnJ5In0sInAiOjF9> |
| `16` | wreath | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6ImRpaGVkcmFsIiwidGllcnMiOiIxNiIsInRpZXJGaWVsZCI6IndyZWF0aCJ9LCJwIjoxfQ> |

48. **Same colours.** Open the "none" link and then each field link. The
    shapes change, but each sprite keeps its colours. Click a sprite: the
    inspector's Recipe line is the same as with "none", plus
    "· tier field wreath" (or whichever field) at the end.
49. **Still symmetric.** Every sprite on every field link is D4-symmetric:
    the inspector's Symmetries line reads "8 of 8 (guaranteed 8)".
50. **Picker.** On the "none" link, choose Field → Wreath: the sheet
    changes, the hint under the select describes the field, and the
    timeline entry is labelled "Tier field none → wreath".
51. **One tier.** The `16` link has a single tier, and the wreath still
    acts: the whole motif is read turned or mirrored before the symmetry
    copies it. Compared with the `4 / 4` "none" link (the same sprites,
    since tiers without groups change nothing), most sprites differ (35 of
    48); the rest drew a move their motif already looks the same under
    (the identity, or a symmetry of the motif itself).
52. **Off, not lost.** On the wreath link, set Across to Off. The Field
    select stays, with an amber note: "Tier field off: it needs tiers that
    are on." The sheet is the plain sheet. Set Across back to 4·4 and the
    field comes back. With Source set to Random noise the note says
    "Tier field off: random noise has no field."
53. **Link.** "Copy link" with a field set, paste in a new tab: the same
    sheet, with the same Field selected.

## Tier view (M5c)

The **Blocks** button (top right of the sheet, or **G**) draws where each
tiered sprite's blocks meet. Outer tiers' edges are stronger, inner ones
fainter. It is a view setting: it is not in the link or the timeline. The
inspector lists each tier's groups and its free cells. `tierview.test.js`
checks that these links decode to these recipes and free cells.

| | Symmetry | Size | Tiers | Free cells | Link |
|---|---|---|---|---|---|
| A | rot90 | 16×16 | `4 / 4 mirror-x` | 16 | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6InJvdDkwIiwidGllcnMiOiI0IC8gNCBtaXJyb3IteCJ9LCJwIjoxfQ> |
| B | none | 16×16 | `4 copy:dihedral / 4 copy:dihedral` | 9 | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6Im5vbmUiLCJ0aWVycyI6IjQgY29weTpkaWhlZHJhbCAvIDQgY29weTpkaWhlZHJhbCJ9LCJwIjoxfQ> |
| C | dihedral | 32×32 | `2 / 4 mirror-x / 4 rot90` | 10 | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJ3IjozMiwiaCI6MzIsInN5bW1ldHJ5IjoiZGloZWRyYWwiLCJ0aWVycyI6IjIgLyA0IG1pcnJvci14IC8gNCByb3Q5MCJ9LCJwIjoxfQ> |
| D | mirror-x | 24×16 | `3x2 / 8 mirror-y` | 96 | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJ3IjoyNCwic3ltbWV0cnkiOiJtaXJyb3IteCIsInRpZXJzIjoiM3gyIC8gOCBtaXJyb3IteSJ9LCJwIjoxfQ> |
| E | mirror-x | 12×12 | — | — | <http://localhost:8000/#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJ3IjoxMiwiaCI6MTJ9LCJvIjp7IjkiOnsiZ2VuIjp7InciOjE2LCJoIjoxNiwidGllcnMiOiI0IC8gNCBtaXJyb3IteCJ9fX0sInAiOjF9> |

54. **Toggle.** Open link A and press **Blocks** (or **G**). The button
    lights up, and each sprite gets a magenta cross-hatch every 4 pixels
    (3 lines across, 3 down). The lines never cross the gaps between
    sprites. Press it again and they go. The timeline gets no new entry, and
    the address bar does not change.
55. **Lines up.** With the grid on, zoom in with **+** and out with **−**,
    scroll to zoom, and drag to pan. Each line stays on the boundary
    between two rows or columns of sprite pixels and never cuts through
    one. Now open link A with `?gl=0` before the `#`
    (<http://localhost:8000/?gl=0#r=eyJmIjoic3ByaXRlc25vdy8xIiwiZyI6eyJzeW1tZXRyeSI6InJvdDkwIiwidGllcnMiOiI0IC8gNCBtaXJyb3IteCJ9LCJwIjoxfQ>):
    the status line ends "· 2D" instead of "· WebGL2", and the grid looks
    the same.
56. **Inspector.** Still on link A, click a sprite. The inspector shows:
    - Tiers: `4 / 4 mirror-x`
    - Tier 1: "4×4 blocks of 4×4 · blocks C4 · pinwheel · copies C2 ·
      rotate 180° · 64 free cells"
    - Tier 2: "4×4 cells · blocks D2 · both axis mirrors · copies D2 · both
      axis mirrors · 16 free cells"
    - Free cells: "16 of 256 (64 without tiers)"
57. **Tiers add symmetry.** Open link B and click a sprite. Symmetry says
    "C1 · none", but a "With tiers" row says "D4 · all eight (the tiers
    add symmetry)", and Symmetries reads "8 of 8 (guaranteed 8)". Tier 1
    has 48 free cells, Tier 2 has 9.
58. **Three tiers.** Open link C and turn the grid on. Each 32×32 sprite has
    one strong cross through its middle, between the "2×2 blocks of
    16×16" the inspector lists for Tier 1, and fainter lines every 4
    pixels, between Tier 2's "4×4 blocks of 4×4". The inspector's free
    cells go 136, 36, 10 from Tier 1 to Tier 3.
59. **Rectangle.** Open link D: 24×16 sprites with two strong lines down
    (at 8 and 16) and one across (at 8), and no fainter ones, since the
    inner tier is single cells.
60. **Only tiered sprites.** Open link E and turn the grid on: of the 12×12
    sprites, only cell 10 (row 2, column 2), locked as a 16×16
    tiered sprite that spills over its neighbours, has lines. Click it: the
    inspector shows its tiers.
61. **Off.** On link A with the grid on, set Height to 12. The lines go,
    and the inspector's Tiers row is amber: "4 / 4 mirror-x (off: 4·4 = 16,
    sprite is 16×12)". Turn the grid off and on again: the status line says
    "block grid on, but no sprite on the sheet has tiers on". Set Height
    back to 16 and the lines come back.
