/* M2: recipe schema, permalink, old-session import and the rasteriser.
   All pure, so all checked here in Node. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize, validate, cellSettings, resizeSheet, DEFAULT_RECIPE } from '../src/recipe/schema.js';
import { encode, decode } from '../src/recipe/permalink.js';
import { importSession } from '../src/recipe/import-v4.js';
import { rasterizeSheet, rasterizeSolo } from '../src/raster/rasterize.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { loadReference } from './load-reference.js';
import { REFERENCE_CFG, spriteDigest } from './fixtures.js';

const ref = await loadReference();
const sprite = r => i => { const c = cellSettings(r, i); return generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)); };

test('normalize fills every default, sizes seeds to the sheet, and is idempotent', () => {
  const r = normalize({});
  assert.deepEqual(r.gen, { ...DEFAULT_RECIPE.gen });
  assert.deepEqual(r.sheet, { ...DEFAULT_RECIPE.sheet });
  assert.equal(r.seeds.length, 48);
  assert.deepEqual(normalize(r), r);
  assert.deepEqual(validate(r), []);
  assert.deepEqual(normalize({}).seeds, r.seeds, 'derived seeds are deterministic');
});

test('normalize clamps to the old app ranges and repairs bad values', () => {
  const r = normalize({ gen: { w: 99, h: 1, modulus: '23', stride: 2.6, symmetry: 'nope', bpc: 5, phase: -1 },
                        sheet: { scale: 4.25, cols: 0 } });
  assert.equal(r.gen.w, 64); assert.equal(r.gen.h, 2);
  assert.equal(r.gen.modulus, 23); assert.equal(r.gen.stride, 3);
  assert.equal(r.gen.symmetry, 'mirror-x'); assert.equal(r.gen.bpc, 3); assert.equal(r.gen.phase, 0);
  assert.equal(r.sheet.scale, 4); assert.equal(r.sheet.cols, 1);
  assert.ok(validate({ gen: { w: 99 } }).some(p => p.startsWith('gen.w')));
});

test('fold:1 is kept only for groups the old app had', () => {
  assert.equal(normalize({ gen: { symmetry: 'rot90', fold: 1 } }).gen.fold, 1);
  assert.equal(normalize({ gen: { symmetry: 'mirror-diag', fold: 1 } }).gen.fold, 2);
});

test('permalink round-trips, overrides included, and ignores other hashes', () => {
  const base = normalize({ gen: { symmetry: 'diagonals', w: 13, source: 'custom', expr: 'u*v ^ (u+v)' },
                           sheet: { cols: 3, rows: 2, scale: 6 }, paletteSeed: 0xdeadbeef });
  const r = { ...base, overrides: { 4: { gen: { ...base.gen, symmetry: 'rot90', fold: 1 }, paletteSeed: 7 } } };
  assert.deepEqual(decode(encode(r)), normalize(r));
  assert.deepEqual(decode(encode(r).slice(1)), normalize(r), 'works without the leading #');
  assert.equal(decode(''), null);
  assert.equal(decode('#0,0,15.0,0'), null);
  assert.throws(() => decode('#r=not-base64-json'));
});

test('resizeSheet keeps every surviving cell at its row and column', () => {
  const r = normalize({ sheet: { cols: 3, rows: 2 }, seeds: [1,2,3,4,5,6], overrides: { 4: { gen: {}, paletteSeed: 9 } } });
  const big = resizeSheet(r, 4, 3, i => 100 + i);
  assert.deepEqual(big.seeds, [1,2,3,103, 4,5,6,107, 108,109,110,111]);
  assert.ok(big.overrides[5], 'override follows its cell from index 4 to 5');
  const small = resizeSheet(r, 2, 1, () => 0);
  assert.deepEqual(small.seeds, [1,2]);
  assert.deepEqual(small.overrides, {});
});

/* A session in the exact shape the old app's "↓ Session" writes. */
function oldSession(){
  const cfgA = { ...REFERENCE_CFG, cols:3, rows:2, spacing:2, scale:4.25, seamphase:'global', matte:'stage',
                 symmetry:'rot90', sw:15, sh:15, formula:'trefoil', vary:false };
  const cfgB = { ...cfgA, symmetry:'quadrant', source:'noise', scale:3 };
  const lockCfg = { ...REFERENCE_CFG, symmetry:'rot180', sw:9, sh:11, mask:'blob', _paletteSeed: 0x1234 };
  const cells = { rows:2, cols:3, list:[11,22,33,44,55,66].map((seed, i) =>
    ({ seed, locked: i === 4, lockCfg: i === 4 ? lockCfg : null })) };
  return {
    format:'sprite-gen-timeline', version:4, playhead:0, cellPool:[cells], collection:[],
    entries:[
      { key:'regen', label:'session start', ts:1, bookmark:false, cfg:cfgA, paletteSeed:0xabc, cells:0 },
      { key:'cfg:symmetry', label:'Symmetry', ts:2, bookmark:true, cfg:cfgB, paletteSeed:0xabc, cells:0 },
    ],
    cfgs: { cfgA, cfgB, lockCfg }, cells,
  };
}

test('importSession reproduces every cell of an old session exactly, locked cells included', () => {
  const s = oldSession();
  const { recipes, playhead, notes } = importSession(JSON.stringify(s));
  assert.equal(recipes.length, 2);
  assert.equal(playhead, 0);
  assert.ok(notes.some(n => n.includes('4.25')), 'fractional scale is reported');
  assert.equal(recipes[0].sheet.scale, 4);
  assert.equal(recipes[1].sheet.scale, 3);
  for (const [k, cfg] of [[0, s.cfgs.cfgA], [1, s.cfgs.cfgB]]){
    const r = recipes[k], make = sprite(r);
    assert.equal(r.gen.fold, 1, 'imported recipes reproduce the old fold');
    s.cells.list.forEach((cell, i) => {
      const want = cell.locked
        ? ref.generateSprite(cell.seed, ref.toGen(cell.lockCfg, cell.lockCfg._paletteSeed))
        : ref.generateSprite(cell.seed, ref.toGen(cfg, 0xabc));
      assert.deepEqual(spriteDigest(make(i)), spriteDigest(want), `entry ${k} cell ${i}`);
    });
  }
});

test('importSession reads v1 entries and rejects other files', () => {
  const s = oldSession();
  const v1 = { format:'sprite-gen-timeline', playhead:5,
               entries:[{ state:{ cfg:s.cfgs.cfgB, cells:s.cells, paletteSeed:0xabc } }] };
  const { recipes, playhead } = importSession(v1);
  assert.equal(recipes.length, 1); assert.equal(playhead, 0, 'playhead clamps into range');
  assert.throws(() => importSession('{"format":"other"}'), /not a session file/);
  assert.throws(() => importSession('{"format":"sprite-gen-timeline","entries":[]}'), /no timeline entries/);
});

test('rasterizeSheet: integer scale, centred cells, palette-exact pixels', () => {
  const s = { w:2, h:2, colors:['#ff0000', '#00ff00'], grid:[Uint8Array.of(1,0), Uint8Array.of(0,2)] };
  const img = rasterizeSheet([{ sprite:s, col:1, row:0 }], { cols:2, rows:1, cellW:4, cellH:2, spacing:1 }, { scale:3 });
  assert.equal(img.width, 2 * (4 + 1) * 3); assert.equal(img.height, (2 + 1) * 3);
  const px = (x, y) => Array.from(img.data.slice((y*img.width + x)*4, (y*img.width + x)*4 + 4));
  const X = 15 + 1*3;                                  // col 1, centred: floor((4-2)/2) = 1 cell in
  assert.deepEqual(px(X, 0), [255,0,0,255]);
  assert.deepEqual(px(X + 2, 2), [255,0,0,255]);
  assert.deepEqual(px(X + 3, 0), [0,0,0,0], 'empty cells stay transparent');
  assert.deepEqual(px(X + 3, 3), [0,255,0,255]);
  assert.deepEqual(px(0, 0), [0,0,0,0], 'no matte: background transparent');
  const matted = rasterizeSolo(s, { scale:1, matte:'#0b0f14' });
  assert.deepEqual(Array.from(matted.data.slice(4, 8)), [11,15,20,255]);
  assert.throws(() => rasterizeSolo(s, { scale:2.5 }), /integer scale/);
});

test('every colour a rasterised sprite uses is one of its palette colours', () => {
  const r = normalize({ sheet: { cols: 4, rows: 3 }, gen: { outline: true, symmetry: 'dihedral' } });
  const make = sprite(r), items = r.seeds.map((_, i) => ({ sprite: make(i), col: i % 4, row: (i / 4) | 0 }));
  const allowed = new Set(items.flatMap(it => it.sprite.colors));
  const img = rasterizeSheet(items, { cols:4, rows:3, cellW:16, cellH:16, spacing:2 }, { scale:2 });
  const hex = (r, g, b) => '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  for (let k = 0; k < img.data.length; k += 4){
    if (img.data[k+3] === 0) continue;
    assert.ok(allowed.has(hex(img.data[k], img.data[k+1], img.data[k+2])));
  }
});
