/* M5c: the tier view. blockEdges gives the sheet view's block grid (where
   a tiered sprite's blocks meet, placed as the raster places the sprite),
   and tierReadout what the inspector says about each tier. What the page
   draws from the edges is checked in headless Chrome
   (test/browser/block-grid.test.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blockEdges, buildSheet, createSpriteCache } from '../src/workshop/sheet.js';
import { tierReadout, splitsOf } from '../src/recipe/tiers.js';
import { normalize, cellSettings } from '../src/recipe/schema.js';
import { decode } from '../src/recipe/permalink.js';
import { toggleLock } from '../src/workshop/cells.js';
import { orbitTable, groupById } from '../src/core/groups2d.js';
import { tieredOrbitTable, parseTiers } from '../src/core/tiers.js';

const splitText = ({ across, down }) =>
  across.map((rx, i) => rx === down[i] ? `${rx}` : `${rx}x${down[i]}`).join(' / ');
const one = (w, h, tiers) => ({ w, h, tiers });
const layout1 = (w, h) => ({ cols: 1, cellW: w, cellH: h, spacing: 0 });

/* The edges of one sprite, found from its cells alone: between columns
   x - 1 and x, the outermost tier whose block address changes. */
function edgesByDigits(w, h, text){
  const tiers = parseTiers(text).tiers;
  const blockW = [], blockH = [];
  let bw = w, bh = h;
  for (const t of tiers){ blockW.push(bw); blockH.push(bh); bw /= t.rx; bh /= t.ry; }
  const depthAt = (a, sizes) => {
    for (let i = 1; i < sizes.length; i++) if (Math.floor((a - 1) / sizes[i]) !== Math.floor(a / sizes[i])) return i;
    return 0;
  };
  const out = new Set();
  for (let x = 1; x < w; x++){ const d = depthAt(x, blockW); if (d) out.add(`v${x}:${d}`); }
  for (let y = 1; y < h; y++){ const d = depthAt(y, blockH); if (d) out.add(`h${y}:${d}`); }
  return out;
}
const asSet = edges => new Set(edges.map(e => `${e.vertical ? 'v' + e.x : 'h' + e.y}:${e.depth}`));

test('blockEdges: 4 / 4 on 16×16 meets every 4 cells, and leaves out the border', () => {
  const e = blockEdges([one(16, 16, '4 / 4')], layout1(16, 16));
  assert.deepEqual(e.filter(x => x.vertical).map(x => x.x), [4, 8, 12]);
  assert.deepEqual(e.filter(x => !x.vertical).map(x => x.y), [4, 8, 12]);
  assert.ok(e.every(x => x.depth === 1 && x.len === 16));
  // one tier has no inner blocks; no tiers, none at all
  assert.deepEqual(blockEdges([one(16, 16, '16'), one(16, 16, '')], layout1(16, 16)), []);
});

test('blockEdges: each edge once, at its outermost tier, for every split of several sizes', () => {
  let n = 0;
  for (const [w, h] of [[16, 16], [12, 12], [24, 16], [16, 12], [8, 18], [30, 30]])
    for (const split of splitsOf(w, h)){
      const text = splitText(split), e = blockEdges([one(w, h, text)], layout1(w, h));
      assert.equal(asSet(e).size, e.length, `${w}×${h} ${text}: no edge twice`);
      assert.deepEqual(asSet(e), edgesByDigits(w, h, text), `${w}×${h} ${text}`);
      for (const x of e) assert.equal(x.len, x.vertical ? h : w);
      n++;
    }
  assert.ok(n > 100, `${n} splits`);
});

test('blockEdges places each sprite as the raster does: cells, spacing, and a larger locked sprite', () => {
  // a 12×12 sheet with spacing 2; cell 10 is locked as a tiered 16×16 sprite
  const plain = normalize({ paletteSeed: 1, gen: { w: 12, h: 12 }, sheet: { cols: 5, rows: 3, spacing: 2 } });
  const recipe = normalize({ ...toggleLock(normalize({ ...plain, gen: { ...plain.gen, w: 16, h: 16, tiers: '4 / 4 mirror-x' } }), 9),
                             gen: plain.gen });
  assert.equal(cellSettings(recipe, 9).gen.tiers, '4 / 4 mirror-x');
  const sheet = buildSheet(recipe, createSpriteCache());
  const e = blockEdges(sheet.sprites, sheet.layout);
  // only cell 10 (col 4, row 1) has edges; its 16×16 sprite is centred in a
  // 12×12 cell, 2 px up and left: x = 4·14 − 2 = 54, y = 14 − 2 = 12
  assert.equal(e.length, 6);
  assert.deepEqual(e.filter(x => x.vertical).map(x => [x.x, x.y]), [[58, 12], [62, 12], [66, 12]]);
  assert.deepEqual(e.filter(x => !x.vertical).map(x => [x.x, x.y]), [[54, 16], [54, 20], [54, 24]]);
  // the raster's sprite box matches: cell 10's pixels lie inside it
  const W = sheet.image.width, d = sheet.image.data;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  const s = sheet.sprites[9];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (s.grid[y][x]){
    const k = ((12 + y) * W + 54 + x) * 4;
    assert.equal(d[k + 3], 255, `pixel ${x},${y} of cell 10 is drawn at (54, 12) + (${x}, ${y})`);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  assert.ok(maxX > minX && maxY > minY, 'the sprite has pixels');
});

test('blockEdges: a sheet without tiers has none; tiers that are off draw none', () => {
  const plain = buildSheet(normalize({ paletteSeed: 3 }), createSpriteCache());
  assert.deepEqual(blockEdges(plain.sprites, plain.layout), []);
  const off = buildSheet(normalize({ paletteSeed: 3, gen: { tiers: '4 / 4', h: 12 } }), createSpriteCache());
  assert.deepEqual(blockEdges(off.sprites, off.layout), []);
});

/* --------------------------------------------------------------- readout */

const gen = g => normalize({ gen: g }).gen;

test('tierReadout: free cells per tier, outer to inner, against the §5.2 table', () => {
  const cases = [
    // symmetry, tiers, free cells after each tier, guaranteed group
    ['rot90', '4 / 4 mirror-x', [64, 16], 'rot90'],
    ['none', '4 copy:dihedral / 4 copy:dihedral', [48, 9], 'dihedral'],
    ['none', '4 / 4 dihedral', [256, 48], 'none'],
    ['mirror-x', '4 / 4 rot90', [128, 32], 'mirror-x'],
    ['none', '4 copy:rot90 / 4', [64, 64], 'none'],
    ['dihedral', '4 / 4', [36, 36], 'dihedral'],
  ];
  for (const [symmetry, tiers, orbits, group] of cases){
    const r = tierReadout(gen({ symmetry, tiers }));
    assert.equal(r.on, true);
    assert.equal(r.text, tiers);
    assert.deepEqual(r.tiers.map(t => t.orbits), orbits, `${symmetry} ${tiers}`);
    assert.equal(r.orbits, orbits.at(-1));
    assert.equal(r.plain, orbitTable(symmetry, 16, 16, 2).orbitCount);
    assert.equal(r.group, group, `${symmetry} ${tiers}: ${groupById(r.group).name}`);
  }
});

test('tierReadout: free cells never rise from tier to tier, and the last is the tiered table', () => {
  const groups = ['none', 'mirror-x', 'mirror-y', 'rot180', 'rot90', 'quadrant', 'dihedral'];
  let k = 0;
  for (const [w, h] of [[16, 16], [24, 16], [12, 12]])
    for (const split of splitsOf(w, h)){
      if (split.across.length < 2) continue;
      const tiers = parseTiers(splitText(split)).tiers
        .map((t, i) => ({ ...t, block: i && t.rx === t.ry ? groups[k++ % 7] : null, copy: groups[(k * 3) % 7] }));
      const text = tiers.map(t => [t.rx === t.ry ? t.rx : `${t.rx}x${t.ry}`, t.block !== 'none' && t.block,
                                   t.copy !== 'none' && `copy:${t.copy}`].filter(Boolean).join(' ')).join(' / ');
      const symmetry = groups[k % 7];
      const r = tierReadout(gen({ w, h, symmetry, tiers: text }));
      assert.equal(r.on, true, text);
      const counts = r.tiers.map(t => t.orbits);
      for (let i = 1; i < counts.length; i++) assert.ok(counts[i] <= counts[i - 1], `${w}×${h} ${symmetry} ${text}: ${counts}`);
      assert.equal(r.orbits, tieredOrbitTable(symmetry, w, h, parseTiers(text).tiers).orbitCount);
      assert.ok(r.plain >= r.orbits);
    }
});

test('tierReadout: no tiers is null; tiers that are off say why', () => {
  assert.equal(tierReadout(gen({})), null);
  assert.deepEqual(tierReadout(gen({ tiers: '4 / 4', h: 12 })),
                   { on: false, text: '4 / 4', reason: '4·4 = 16, sprite is 16×12' });
  assert.equal(tierReadout(gen({ tiers: '4 / 4', fold: 1 })).reason, 'the old fold (v1) has no tiers');
});

test('test/smoke.md: the M5c links open the recipes and free cells they state', () => {
  const md = readFileSync(new URL('./smoke.md', import.meta.url), 'utf8');
  const section = md.slice(md.indexOf('## Tier view (M5c)'));
  const rows = [...section.matchAll(/^\| (\w) \| (\S+) \| (\d+)×(\d+) \| (?:—|`([^`]+)`) \| (\d+|—) \| <http:\/\/localhost:8000\/(#r=[\w-]+)> \|$/gm)];
  assert.equal(rows.length, 5);
  for (const [, , symmetry, w, h, tiers = '', free, hash] of rows){
    const r = decode(hash);
    assert.equal(r.paletteSeed, 1, hash);
    assert.deepEqual([r.gen.symmetry, r.gen.w, r.gen.h, r.gen.tiers], [symmetry, +w, +h, tiers], hash);
    const t = tierReadout(r.gen);
    assert.equal(t ? String(t.orbits) : '—', free, hash);
  }
  // E: a plain sheet whose cell 10 is locked as a tiered 16×16 sprite
  const e = decode(rows.find(m => m[1] === 'E')[7]);
  assert.deepEqual([cellSettings(e, 9).gen.w, cellSettings(e, 9).gen.tiers], [16, '4 / 4 mirror-x']);
  assert.deepEqual(Object.keys(e.overrides), ['9']);
});
