/* M4a: the scale-1 screen sheet and the sprite cache (workshop/sheet.js).
   Every build, cached or redrawn in place, must equal a fresh build of the
   same recipe byte for byte, and an export must equal the pre-M4a sheet at
   the recipe's scale. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, cellSettings } from '../src/recipe/schema.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { hash32 } from '../src/core/rng.js';
import { rasterizeSheet, redrawCells, sheetSize } from '../src/raster/rasterize.js';
import { canvasFits } from '../src/raster/png.js';
import { averageHash } from '../src/workshop/frame-hash.js';
import { toggleLock, rerollCell, reseedUnlocked } from '../src/workshop/cells.js';
import { createSpriteCache, cachedSprite, buildSheet, sheetAtScale } from '../src/workshop/sheet.js';

/* The pre-M4a build: every sprite generated afresh, rasterised at `scale`. */
function fresh(r, scale = r.sheet.scale){
  const { cols, rows, spacing } = r.sheet;
  const items = r.seeds.map((_, i) => {
    const c = cellSettings(r, i);
    return { sprite: generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)), col: i % cols, row: (i / cols) | 0 };
  });
  return rasterizeSheet(items, { cols, rows, cellW: r.gen.w, cellH: r.gen.h, spacing }, { scale });
}
const same = (a, b, msg) => {
  assert.equal(a.width, b.width, msg); assert.equal(a.height, b.height, msg);
  assert.ok(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer)), msg);
};
const base = normalize({ paletteSeed: 11, sheet: { cols: 5, rows: 4, spacing: 2, scale: 4 } });

test('the screen sheet is the sheet at scale 1, and the cache serves an unchanged sheet', () => {
  const cache = createSpriteCache();
  const a = buildSheet(base, cache);
  assert.equal(a.generated, 20);
  assert.equal(a.dirty, null, 'a first build is a new image');
  same(a.image, fresh(base, 1));
  const b = buildSheet(base, cache, a);
  assert.equal(b.generated, 0, 'nothing regenerated');
  assert.deepEqual(b.dirty, [], 'nothing redrawn');
  same(b.image, fresh(base, 1));
});

test('reroll, lock, palette, settings and regenerate redo only the cells that changed', () => {
  const cache = createSpriteCache();
  let r = base, s = buildSheet(r, cache);
  const step = (next, generated, redrawn, what) => {
    r = next; s = buildSheet(r, cache, s);
    assert.equal(s.generated, generated, `${what}: generated`);
    assert.equal(s.dirty === null ? 'all' : s.dirty.length, redrawn, `${what}: redrawn`);
    same(s.image, fresh(r, 1), what);
  };
  step(rerollCell(r, 7, 12345), 1, 1, 'reroll one cell');
  step(toggleLock(r, 3), 0, 0, 'lock');
  step(normalize({ ...r, paletteSeed: 99 }), 19, 19, 'new palette, one locked');
  step(normalize({ ...r, gen: { ...r.gen, symmetry: 'rot90' } }), 19, 19, 'symmetry');
  step(normalize({ ...r, gen: { ...r.gen, symmetry: base.gen.symmetry } }), 0, 19, 'back again: all cached');
  step(reseedUnlocked(r, i => hash32(5, i)), 19, 19, 'regenerate around the lock');
  step(normalize({ ...r, sheet: { ...r.sheet, scale: 9 } }), 0, 0, 'scale is the view zoom, not a rebuild');
  step(normalize({ ...r, gen: { ...r.gen, w: 12 } }), 19, 'all', 'a new cell size is a new image');
});

test('a locked sprite larger than its cell forces a full redraw, and still matches', () => {
  const cache = createSpriteCache();
  let r = toggleLock(base, 6), s = buildSheet(r, cache);
  r = normalize({ ...r, gen: { ...r.gen, w: 8, h: 8 } });            // cell 6 stays 16×16
  s = buildSheet(r, cache, s);
  assert.equal(s.dirty, null);
  same(s.image, fresh(r, 1), 'overlapping sheet');
  r = rerollCell(r, 0, 777);
  s = buildSheet(r, cache, s);
  assert.equal(s.dirty, null, 'neighbours of an overlapping sprite cannot be redrawn alone');
  same(s.image, fresh(r, 1));
  r = toggleLock(r, 6);                                               // unlocked: it fits again
  s = buildSheet(r, cache, s);
  assert.equal(s.dirty, null, 'the previous sheet still had the overlap');
  r = rerollCell(r, 1, 778);
  s = buildSheet(r, cache, s);
  assert.equal(s.dirty.length, 1);
  same(s.image, fresh(r, 1));
  assert.throws(() => redrawCells(s.image, [{ sprite: { w: 99, h: 1 }, col: 0, row: 0 }], s.layout, { scale: 1 }));
});

test('export rasterises at the recipe scale and equals the pre-M4a sheet', () => {
  const cache = createSpriteCache();
  const r = toggleLock(normalize({ ...base, sheet: { ...base.sheet, scale: 3 } }), 2);
  const s = buildSheet(r, cache);
  same(sheetAtScale(r, s.sprites), fresh(r), 'scale 3');
  same(sheetAtScale(r, s.sprites, 1), s.image, 'scale 1 is the screen image');
  // and the screen image zoomed by the scale shows exactly the exported pixels
  const big = sheetAtScale(r, s.sprites), p = 3, W = s.image.width;
  for (let y = 0; y < big.height; y++) for (let x = 0; x < big.width; x++){
    const k = (y * big.width + x) * 4, j = (((y / p) | 0) * W + ((x / p) | 0)) * 4;
    for (let c = 0; c < 4; c++) if (big.data[k + c] !== s.image.data[j + c]) assert.fail(`pixel ${x},${y}`);
  }
});

test('the pruner hash does not depend on the scale', () => {
  const cache = createSpriteCache();
  const h = scale => averageHash(buildSheet(normalize({ ...base, sheet: { ...base.sheet, scale } }), cache).image);
  assert.deepEqual(h(1), h(4));
  assert.deepEqual(h(4), h(17));
});

test('the cache is least-recently-used and keyed on seed, settings and palette seed', () => {
  const cache = createSpriteCache(3), gen = base.gen;
  const a = cachedSprite(cache, 1, gen, 0);
  assert.equal(cachedSprite(cache, 1, { ...gen }, 0), a, 'an equal gen object hits');
  assert.notEqual(cachedSprite(cache, 1, gen, 1), a, 'another palette seed misses');
  assert.notEqual(cachedSprite(cache, 1, { ...gen, ncol: 2 }, 0), a, 'other settings miss');
  assert.equal(cache.generated, 3);
  cachedSprite(cache, 1, gen, 0);                       // touch a: (1, gen, 1) is now the oldest
  cachedSprite(cache, 2, gen, 0);                       // evicts it
  assert.equal(cache.map.size, 3);
  cachedSprite(cache, 1, gen, 0);
  assert.equal(cache.generated, 4, 'a survived');
  cachedSprite(cache, 1, gen, 1);
  assert.equal(cache.generated, 5, 'the oldest was evicted');
});

test('the 50×50, 32 px sheet: scale 1 on screen; export refuses scale 16 and names the scale that fits', () => {
  const layout = { cols: 50, rows: 50, cellW: 32, cellH: 32, spacing: 2 };
  assert.deepEqual(sheetSize(layout, 1), { width: 1700, height: 1700 });
  const s16 = sheetSize(layout, 16);
  assert.equal(canvasFits(s16.width, s16.height), false, '27200² cannot be a canvas');
  let fits = 16;
  while (fits > 1 && !canvasFits(sheetSize(layout, fits).width, sheetSize(layout, fits).height)) fits--;
  assert.equal(fits, 9, '15300² is under 16384² px');
});
