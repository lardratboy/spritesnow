# spritesnow

A 2D procedural sprite generator. The core is a pure function, **recipe in,
sprite out, same bytes every time**, and symmetry comes from an explicit
group engine (the 10 subgroups of the square's symmetry group D4).

Status: **v1 (M0–M2 done); M3 (workshop) in progress: M3a timeline done.** The plan and milestone status are in
[docs/newdesign.md](docs/newdesign.md). Browser checks are listed in [test/smoke.md](test/smoke.md).

## Run it

    npm run serve

then open <http://localhost:8000/>. The app uses ES modules, so it must be
served over HTTP. Opening `index.html` straight from Finder will not work.

## Test it

    npm test

Runs the Node tests in `test/`. Requires Node 18+ (developed on Node 22).
No `npm install`: there are no dependencies.

    npm run measure

Re-runs the measurements behind `docs/from3Dto2D.md` §3–§5. `groups.js`
needs `block-showroom` as a sibling folder.

## Layout

| Folder | What lives there |
|---|---|
| `src/core/` | Pure generation code: no DOM, runs in Node and workers |
| `src/recipe/` | Recipe schema, permalink, importer for old sessions |
| `src/raster/` | Integer-scale rasteriser and PNG export |
| `src/workshop/` | Pure workshop logic: the timeline and the pruner's frame hash |
| `src/ui/` | Browser UI |
| `reference/` | The old 2D app, **read-only**. It is the test oracle |
| `test/` | Node tests and golden hashes |
| `tools/` | Golden generator and measurement scripts |
| `docs/` | Design doc and background discussion |
