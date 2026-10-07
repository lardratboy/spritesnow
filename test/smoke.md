# Browser smoke test (M2)

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
