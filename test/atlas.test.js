/* M4b: the GPU data for the screen sheet (raster/atlas.js). drawAtlas is
   the fragment shader's rule run on the CPU, so a sheet drawn from the
   atlas alone must equal rasterizeSheet at scale 1 byte for byte, after a
   full pack and after every in-place update. The shader itself is checked
   in the browser (test/browser/sheet-view.test.js). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../src/recipe/schema.js';
import { hash32 } from '../src/core/rng.js';
import { rasterizeSheet } from '../src/raster/rasterize.js';
import { packAtlas, updateAtlas, drawAtlas, slotOf } from '../src/raster/atlas.js';
import { toggleLock, rerollCell, reseedUnlocked } from '../src/workshop/cells.js';
import { createSpriteCache, buildSheet, sheetItems } from '../src/workshop/sheet.js';

const same = (a, b, msg) => {
  assert.equal(a.width, b.width, msg); assert.equal(a.height, b.height, msg);
  assert.ok(Buffer.from(a.data.buffer).equals(Buffer.from(b.data.buffer)), msg);
};
const cpu = (r, s) => rasterizeSheet(sheetItems(r, s.sprites), s.layout, { scale: 1 });
const base = normalize({ paletteSeed: 11, sheet: { cols: 5, rows: 4, spacing: 2, scale: 4 } });

test('the atlas draws the same sheet as the rasteriser', () => {
  const cache = createSpriteCache();
  for (const r of [base,
                   normalize({ ...base, gen: { ...base.gen, w: 9, h: 13, outline: true, ncol: 16, bpc: 8 } }),
                   normalize({ ...base, sheet: { ...base.sheet, cols: 1, rows: 1, spacing: 0 } }),
                   normalize({ ...base, gen: { ...base.gen, symmetry: 'rot90', w: 64, h: 64 },
                               sheet: { ...base.sheet, cols: 50, rows: 3 } })]){
    const s = buildSheet(r, cache), atlas = packAtlas(s.sprites, s.layout);
    assert.ok(atlas, 'fits');
    same(drawAtlas(atlas), cpu(r, s), JSON.stringify(r.sheet));
  }
});

test('in-place updates rewrite only changed cells, and still match', () => {
  const cache = createSpriteCache();
  let r = base, s = buildSheet(r, cache), atlas = packAtlas(s.sprites, s.layout);
  const step = (next, expect, what) => {
    r = next; s = buildSheet(r, cache);
    const changed = updateAtlas(atlas, s.sprites, s.layout);
    if (expect === 'repack'){
      assert.equal(changed, null, `${what}: must repack`);
      atlas = packAtlas(s.sprites, s.layout);
    } else assert.equal(changed.length, expect, `${what}: cells rewritten`);
    same(drawAtlas(atlas), cpu(r, s), what);
  };
  step(rerollCell(r, 7, 12345), 1, 'reroll one cell');
  step(toggleLock(r, 3), 0, 'lock');
  step(normalize({ ...r, paletteSeed: 99 }), 19, 'new palette, one locked');
  step(normalize({ ...r, gen: { ...r.gen, ncol: 3 } }), 19, 'fewer colours: old entries are overwritten');
  step(normalize({ ...r, gen: { ...r.gen, outline: true, ncol: 16 } }), 'repack', 'more colours than a row holds');
  step(reseedUnlocked(r, i => hash32(5, i)), 19, 'regenerate around the lock');
  step(normalize({ ...r, sheet: { ...r.sheet, scale: 9 } }), 0, 'scale is a uniform, not new data');
  step(normalize({ ...r, sheet: { ...r.sheet, spacing: 0 } }), 'repack', 'a new layout');
  step(normalize({ ...r, gen: { ...r.gen, w: 8, h: 8 } }), 'repack', 'a new cell size is a new layout');
  step(rerollCell(r, 0, 777), 1, 'next to the 16×16 locked sprite, which overlaps its 8×8 neighbours');
  step(toggleLock(r, 3), 1, 'unlock: the big sprite shrinks into its 16×16 slot');
  step(rerollCell(r, 4, 778), 1, 'and its neighbours are redrawn alone');
  // A sprite larger than its slot needs a repack. A recipe cannot make one
  // without changing the layout, so swap a sprite in by hand.
  const big = s.sprites.slice();
  big[2] = { ...big[2], w: 17, grid: [...big[2].grid, big[2].grid[0]] };
  assert.equal(updateAtlas(atlas, big, s.layout), null, 'a sprite larger than its slot');
});

test('slots and palette rows do not overlap', () => {
  const cache = createSpriteCache();
  const r = normalize({ ...base, gen: { ...base.gen, w: 64, h: 64 }, sheet: { ...base.sheet, cols: 50, rows: 50 } });
  const s = buildSheet(r, cache), atlas = packAtlas(s.sprites, s.layout);
  assert.equal(atlas.width, 4096); assert.equal(atlas.height, 40 * 64);
  const seen = new Set();
  for (let i = 0; i < atlas.count; i++){
    const { ax, ay, px, py } = slotOf(atlas, i);
    assert.ok(ax + atlas.slotW <= atlas.width && ay + atlas.slotH <= atlas.height, `slot ${i} inside`);
    assert.ok(px + atlas.pw <= atlas.palW && py < atlas.palH, `palette ${i} inside`);
    seen.add(`${ax},${ay}`).add(`p${px},${py}`);
  }
  assert.equal(seen.size, 2 * atlas.count);
});

test('a sheet too big for the textures is refused, so the view can use the 2D path', () => {
  const cache = createSpriteCache();
  const r = normalize({ ...base, gen: { ...base.gen, w: 64, h: 64 }, sheet: { ...base.sheet, cols: 50, rows: 50 } });
  const s = buildSheet(r, cache);
  assert.ok(packAtlas(s.sprites, s.layout, 4096), 'fits at 4096');
  assert.equal(packAtlas(s.sprites, s.layout, 2048), null, '2,500 64×64 slots need more than 2048²');
});
