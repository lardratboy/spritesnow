# Browser smoke test (M2, M3a, M3b, M3c, M4a)

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
