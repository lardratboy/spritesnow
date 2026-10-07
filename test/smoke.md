# Browser smoke test (M2, M3a)

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
8. **Old session.** Click "↑ Old session" and choose a `sprite_session.json`
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
17. **Old session timeline.** "↑ Old session" now adds the old session's
    whole timeline after your entries (bookmarks become keyframes), and
    shows the entry it was saved at.

