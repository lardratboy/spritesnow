# spritesnow

2D procedural sprite generator. The plan is `docs/newdesign.md`; read it
first. Background is in `docs/spritesnow.md` and `docs/from3Dto2D.md`.

## Commands

- `npm run serve`: `python3 -m http.server 8000`; open http://localhost:8000/
  (ES modules, so file:// will not work).
- `npm test`: Node unit tests (`test/*.test.js`). Golden hashes in
  `test/golden.json` are the behavioural contract.
- `npm run golden`: regenerates `test/golden.json` from the **reference**
  app. Only run it when a change to sprite output is *intended*, and say so
  in the commit message.
- `npm run measure`: the measurement scripts behind `docs/from3Dto2D.md`.

No bundler, no `node_modules`.

## Workflow rules

- One milestone step per session. Tick it off in `docs/newdesign.md` §6.

## Git: Claude does all of it

The user has asked Claude to handle every git step without asking. For
each milestone step:

1. Create a lowercase feature branch from an up-to-date `main`, named
   `m<N>/<topic>` (for example `m3/timeline`). Never commit to `main`
   directly.
2. Work until `npm test` is green. Commit with a descriptive message that
   says what changed, how it was verified, and whether goldens changed
   (normally "No golden changes").
3. Fast-forward `main` to the branch (`git merge --ff-only`), then push
   both `main` and the branch to `origin`.
4. Tell the user what was pushed (commit hash, test count).

Still ask first before anything destructive or irreversible: force-push,
rewriting history, or deleting a branch on GitHub.

Branch names must not differ only by case, and must not collide with an
existing branch's folder (`m0` vs `M0`). The user's Mac filesystem is
case-insensitive, and such a clash breaks `git pull`. Never ask the user
to create branches or commits themselves.
- If a golden test fails, the change is wrong: fix the change, do not
  regenerate the goldens.
- The user is new to local development. Explain what a command does before
  running it when it's non-obvious, and give exact browser URLs to check.

## Architecture rules

- `src/core/` imports nothing from the DOM or the browser, and never calls
  `Math.random`. Every random choice comes from the recipe's seed.
- `reference/symmetrical_sprite_generator.html` is the old v4 app, kept
  **unchanged**. Tests load its generator into Node (`test/load-reference.js`)
  and compare the port against it byte for byte. Never edit it.
- Symmetry is decided **once per orbit**, at the orbit's representative.
  - With `fold: 1`, the representative is the one the old `fold()` chooses,
    which reproduces old sprites, defects included.
  - With `fold: 2` (the default for new recipes), the representative is
    chosen per orbit: the legacy choice wherever it was correct for that
    orbit, otherwise the first orbit member inside the seed rectangle by
    row, then column.
  - Generation always evaluates a seed RECTANGLE in row-major order, because
    the RNG is consumed in that order. For every legacy group it is the old
    `seedDims` rectangle; changing it changes every sprite.
- `aut()` counts the symmetries of a finished sprite. Tests require
  `aut >= |G|` for every group at every size.
- On a non-square grid the effective group is `G ∩ Aut(grid)`. The UI shows
  the effective group; never substitute a different one silently.
