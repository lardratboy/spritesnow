/* M5b: tier fields (newdesign.md §5.2). The two promises: turning a tier
   field on leaves the sprite's colours and params exactly as they were
   (its constants are hashed from the seed, not drawn from the RNG), and
   tiered symmetry still holds under every field. Then each field's shape,
   one tier included, and the recipe plumbing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tierFixtureList, TIER_FIELD_IDS, PALETTE_SEED, SEEDS } from './fixtures.js';
import { SUBGROUPS, groupById, aut, applyElement } from '../src/core/groups2d.js';
import { tieredOrbitTable, tierGenerators, tierLayout } from '../src/core/tiers.js';
import { TIER_FIELDS, tierFieldState, makeTierField } from '../src/core/tierfields.js';
import { mulberry32 } from '../src/core/rng.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { parseTiers, printTiers, splitsOf, withSplit } from '../src/recipe/tiers.js';
import { normalize, DEFAULT_RECIPE } from '../src/recipe/schema.js';
import { encode, decode } from '../src/recipe/permalink.js';
import { createTimeline, commit } from '../src/workshop/timeline.js';
import { saveSession, readSession } from '../src/workshop/session.js';

const sprite = (seed, gen) => generateSprite(seed, gen, paletteFor(PALETTE_SEED, gen.bpc));
const flat = s => { const out = new Uint8Array(s.w * s.h); s.grid.forEach((r, y) => out.set(r, y * s.w)); return out; };
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const tiersOf = text => parseTiers(text).tiers;

/* ------------------------------------------------------------- the list */

test('six tier fields plus none, the six of §5.2', () => {
  assert.deepEqual(TIER_FIELDS.map(f => f.id), ['none', ...TIER_FIELD_IDS]);
  assert.deepEqual([...TIER_FIELD_IDS].sort(), ['carry', 'cross', 'digit-swap', 'phasecell', 'prefix-hash', 'wreath']);
});

test('tierFieldState: on only with tiers on and a field to act on; otherwise it says why', () => {
  const gen = { ...DEFAULT_RECIPE.gen, tiers: '4 / 4', tierField: 'wreath' };
  assert.deepEqual(tierFieldState(gen), { on: true, id: 'wreath', reason: null });
  assert.deepEqual(tierFieldState({ ...gen, tierField: 'none' }), { on: false, id: 'none', reason: null });
  assert.deepEqual(tierFieldState({ ...gen, tierField: undefined }), { on: false, id: 'none', reason: null });
  assert.equal(tierFieldState({ ...gen, tiers: '' }).reason, 'it needs tiers that are on');
  assert.equal(tierFieldState({ ...gen, h: 12 }).reason, 'it needs tiers that are on');
  assert.equal(tierFieldState({ ...gen, symmetry: 'rot180', fold: 1 }).reason, 'it needs tiers that are on');
  assert.equal(tierFieldState({ ...gen, source: 'noise' }).reason, 'random noise has no field');
  assert.equal(tierFieldState({ ...gen, source: 'custom' }).on, true);
});

/* ------------------------------------------ colours and params unchanged */

/* recipeText spells out every drawn param: the field and modulus (vary),
   stride, offsets, the conic's coefficients, the mask (mix). */
test('turning a tier field on leaves the colours and every drawn param unchanged', () => {
  let changed = 0, n = 0;
  for (const f of tierFixtureList().filter(f => f.gen.tierField)){
    const on = sprite(f.seed, f.gen), off = sprite(f.seed, { ...f.gen, tierField: 'none' });
    assert.equal(on.tierField, f.gen.tierField, f.name);
    assert.equal(off.tierField, '', f.name);
    assert.deepEqual(on.colors, off.colors, f.name);
    assert.equal(on.recipeText, `${off.recipeText} · tier field ${f.gen.tierField}`, f.name);
    n++;
    if (!same(flat(on), flat(off))) changed++;
  }
  assert.equal(n, 720);
  assert.ok(changed > 0.9 * n, `a tier field changed only ${changed} of ${n} sprites`);
});

test('a field that is off changes nothing: no tiers, tiers that do not fit, fold 1, noise', () => {
  for (const tierField of TIER_FIELD_IDS) for (const seed of SEEDS){
    const cases = [
      { ...DEFAULT_RECIPE.gen, tiers: '' },
      { ...DEFAULT_RECIPE.gen, tiers: '4 / 4', h: 12 },
      { ...DEFAULT_RECIPE.gen, tiers: '4 / 4', symmetry: 'quadrant', fold: 1 },
      { ...DEFAULT_RECIPE.gen, tiers: '4 / 4', source: 'noise' },
    ];
    for (const gen of cases){
      const on = sprite(seed, { ...gen, tierField }), off = sprite(seed, gen);
      assert.deepEqual(on, off, `${tierField} ${gen.tiers} ${gen.h} ${gen.fold} ${gen.source}`);
    }
  }
});

/* ------------------------------------------------------------- symmetry */

/* As tiers.test.js's property test, with every tier field on each case. */
test('every generator keeps the sprite and aut >= the guaranteed group, under every tier field', () => {
  const rnd = mulberry32(0x7f1e);
  const pick = arr => arr[(rnd() * arr.length) | 0];
  const ids = [null, ...SUBGROUPS.map(g => g.id)];
  const SOURCES = [
    { source:'field', formula:'mix', vary:true },
    { source:'field', formula:'conic', vary:false, mask:'disc', outline:true, maskScale:0.9 },
    { source:'field', formula:'skew', vary:false, mask:'blob', outline:true },
    { source:'custom', expr:'(u*u + v*v) * (Math.abs(u)^Math.abs(v)) + x - y + P.a' },
  ];
  const cases = [];
  for (let n = 4; n <= 36; n++) for (const s of splitsOf(n, n))
    if (s.across.length <= 3 && s.across.every((r, i) => r === s.down[i])) cases.push([n, n, s]);
  for (const [w, h] of [[16, 12], [12, 8], [24, 18], [7, 7]]) for (const s of splitsOf(w, h))
    if (s.across.length <= 3) cases.push([w, h, s]);
  let checks = 0;
  for (const [w, h, split] of cases) for (const tierField of TIER_FIELD_IDS){
    const tiers = withSplit(null, split.across, split.down).map((t, i) => ({ ...t, block: i ? pick(ids) : null, copy: pick(ids) }));
    const symmetry = pick(SUBGROUPS).id;
    const gen = { ...DEFAULT_RECIPE.gen, ...pick(SOURCES), w, h, symmetry, fold: 2, tiers: printTiers(tiers), tierField };
    const label = `${symmetry} ${w}x${h} ${gen.tiers} ${tierField}`;
    const s = sprite(pick(SEEDS), gen);
    assert.equal(s.tierField, tierField, label);
    const cells = flat(s);
    for (const g of tierGenerators(symmetry, w, h, tiers)){
      for (let c = 0; c < w * h; c++)
        if (cells[c] !== cells[g.perm[c]]) assert.fail(`${label}: tier ${g.tier} ${g.kind} ${g.e} moves cell ${c}`);
      checks++;
    }
    const t = tieredOrbitTable(symmetry, w, h, tiers);
    assert.ok(aut(s.grid, w, h) >= groupById(t.group).order, `${label}: aut < |${t.group}|`);
  }
  assert.ok(checks > 2000, `only ${checks} generator checks`);
});

/* ------------------------------------------------- what each field does */

const cellsOf = (w, h) => Array.from({ length: w * h }, (_, c) => [c % w, (c / w) | 0]);
/** The innermost block a cell is in, as one number. */
const innerBlock = (L, x, y) => { const t = L[L.length - 1]; return ((y / t.bh) | 0) * 1000 + ((x / t.bw) | 0); };

test('digit-swap reverses significance (x = a·r1 + b reads b·r0 + a), and one tier transposes', () => {
  const tf = makeTierField('digit-swap', 1, tiersOf('4x2 / 2x8'));          // 8 × 16
  for (const [x, y] of cellsOf(8, 16)){
    const [a, b] = [(x / 2) | 0, x % 2], [c, d] = [(y / 8) | 0, y % 8];
    assert.deepEqual(tf.map(x, y), [b * 4 + a, d * 2 + c]);
  }
  const three = makeTierField('digit-swap', 1, tiersOf('2 / 3 / 4'));        // 24: x = 12a + 4b + c
  assert.deepEqual(three.map(1*12 + 2*4 + 3, 0), [3*6 + 2*2 + 1, 0]);
  const one = makeTierField('digit-swap', 1, tiersOf('16'));
  assert.deepEqual(one.map(3, 11), [11, 3]);
});

test('wreath turns or mirrors whole blocks: a bijection that keeps every innermost block whole', () => {
  for (const text of ['4 / 4', '2 / 2 / 4', '3 / 5', '4x4 / 4x3', '4x2 / 2x4', '16', '16x12']){
    const L = tierLayout(tiersOf(text));
    const w = L[0].bw, h = L[0].bh;
    for (const seed of SEEDS){
      const tf = makeTierField('wreath', seed, tiersOf(text));
      const hit = new Set(), blockMap = new Map(), shapes = new Map();
      const inner = L[L.length - 1];
      for (const [x, y] of cellsOf(w, h)){
        const [X, Y] = tf.map(x, y);
        const b = innerBlock(L, x, y);
        shapes.set(b, (shapes.get(b) || '') + `${X % inner.bw},${Y % inner.bh};`);
        assert.ok(X >= 0 && X < w && Y >= 0 && Y < h, `${text}: (${x},${y}) -> (${X},${Y})`);
        hit.add(Y * w + X);
        const from = innerBlock(L, x, y), to = innerBlock(L, X, Y);
        if (blockMap.has(from)) assert.equal(blockMap.get(from), to, `${text}: block ${from} split`);
        blockMap.set(from, to);
      }
      assert.equal(hit.size, w * h, `${text}: not a bijection`);
      // blocks are turned by their own address, so they are not all turned alike
      if (L.length > 1) assert.ok(new Set(shapes.values()).size > 1, `${text} seed ${seed}: every block turned alike`);
    }
  }
  // one tier: the whole motif under one D4 element, which fits the sprite
  for (const [text, w, h] of [['16', 16, 16], ['16x12', 16, 12]]){
    const seen = new Set();
    for (let seed = 0; seed < 64; seed++){
      const tf = makeTierField('wreath', seed, tiersOf(text));
      const e = [...Array(8).keys()].find(e => (w === h || !(e & 4)) &&
        cellsOf(w, h).every(([x, y]) => same(tf.map(x, y), applyElement(e, x, y, w, h))));
      assert.notEqual(e, undefined, `${text} seed ${seed}: not one element`);
      seen.add(e);
    }
    assert.equal(seen.size, w === h ? 8 : 4, `${text}: elements used`);
  }
});

test('prefix-hash and phasecell are constant on each innermost block, and vary between them', () => {
  const p = { M: 17, ox: 0, oy: 0, a: 1, b: 0, c: 1, d: 0, e: 0 };
  for (const text of ['4 / 4', '2 / 2 / 4', '4x4 / 4x3', '16']){
    const L = tierLayout(tiersOf(text)), w = L[0].bw, h = L[0].bh;
    for (const seed of SEEDS){
      const ph = makeTierField('prefix-hash', seed, tiersOf(text)), pc = makeTierField('phasecell', seed, tiersOf(text));
      const byBlock = new Map();
      for (const [x, y] of cellsOf(w, h)){
        const v = JSON.stringify([ph.params(x, y, p), pc.add(x, y, 17)]), b = innerBlock(L, x, y);
        if (byBlock.has(b)) assert.equal(byBlock.get(b), v, `${text}: block ${b} not constant`);
        byBlock.set(b, v);
      }
      const variants = new Set(byBlock.values()).size;
      if (L.length === 1) assert.equal(variants, 1, `${text}: one tier, one block`);
      else assert.ok(variants > byBlock.size / 2, `${text}: only ${variants} variants of ${byBlock.size} blocks`);
    }
  }
});

test('carry: on square tiers, the carries of x + y (Kummer), each tier with a seeded mirror', () => {
  // with M = 2 every weight is 1, so add() counts the tiers that carry
  const L = tierLayout(tiersOf('2 / 2 / 2 / 2'));
  const kummer = (x, y) => { let c = 0, n = 0; for (let i = 0; i < 4; i++){ c = ((x >> i & 1) + (y >> i & 1) + c) >> 1; n += c; } return n; };
  const fired = (m, x, y) => L.reduce((n, { bw: B }, i) => {
    const lx = m >> i & 1 ? B - 1 - x % B : x % B;
    return n + (lx + y % B >= B ? 1 : 0);
  }, 0);
  for (const [x, y] of cellsOf(16, 16)) assert.equal(fired(0, x, y), kummer(x, y), `(${x},${y})`);
  const mirrors = new Set();
  for (let seed = 0; seed < 64; seed++){
    const tf = makeTierField('carry', seed, tiersOf('2 / 2 / 2 / 2'));
    const m = [...Array(16).keys()].find(m => cellsOf(16, 16).every(([x, y]) => tf.add(x, y, 2) === fired(m, x, y)));
    assert.notEqual(m, undefined, `seed ${seed}: not a mirrored carry count`);
    mirrors.add(m);
  }
  assert.ok(mirrors.has(0) && mirrors.size > 8, `mirrors used: ${[...mirrors]}`);
  // a rectangle tier carries past its block's anti-diagonal
  const one = makeTierField('carry', 3, tiersOf('16x12'));
  const anti = cellsOf(16, 12).filter(([x, y]) => one.add(x, y, 2)).length;
  assert.ok(anti > 70 && anti < 120, `${anti} of 192 cells carry`);
});

test('cross: one tier pairs with itself, so it is a weighted circle about the sprite centre', () => {
  for (const seed of SEEDS){
    const tf = makeTierField('cross', seed, tiersOf('16x12'));
    const k = tf.add(0, 0) / (15*15 + 11*11);
    assert.ok([1, 2, 3].includes(k), `weight ${k}`);
    for (const [x, y] of cellsOf(16, 12)){
      const X = 2*x - 15, Y = 2*y - 11;
      assert.equal(tf.add(x, y), k * (X*X + Y*Y));
    }
  }
});

test('with a single tier every field still acts, and no two act alike', () => {
  for (const [w, h, symmetry] of [[16, 16, 'rot90'], [16, 12, 'mirror-x'], [7, 7, 'none']]){
    const base = { ...DEFAULT_RECIPE.gen, formula: 'skew', vary: false, w, h, symmetry, tiers: w === h ? `${w}` : `${w}x${h}` };
    const grids = new Map([['none', SEEDS.map(s => flat(sprite(s, base)))]]);
    for (const tierField of TIER_FIELD_IDS){
      const g = SEEDS.map(s => flat(sprite(s, { ...base, tierField })));
      for (const [other, h2] of grids)
        assert.ok(g.some((x, i) => !same(x, h2[i])), `${w}x${h}: ${tierField} acts like ${other}`);
      grids.set(tierField, g);
    }
  }
});

/* --------------------------------------------------------------- recipe */

test('gen.tierField: defaults to none, rejects unknown values, and survives links, sessions and the timeline', () => {
  assert.equal(normalize({}).gen.tierField, 'none');
  assert.equal(normalize({ gen: { tierField: 'spiral' } }).gen.tierField, 'none');
  const r = normalize({ gen: { symmetry: 'rot90', tiers: '4 / 4 mirror-x', tierField: 'wreath' }, paletteSeed: 7 });
  assert.equal(r.gen.tierField, 'wreath');
  assert.deepEqual(decode(encode(r)), r);
  const off = normalize({ ...r, gen: { ...r.gen, tiers: '' } });             // kept, but off
  assert.equal(off.gen.tierField, 'wreath');
  assert.deepEqual(decode(encode(off)), off);
  const tl = createTimeline();
  commit(tl, r, { kind: 'start', now: 1 });
  const carry = normalize({ ...r, gen: { ...r.gen, tierField: 'carry' } });
  commit(tl, carry, { kind: 'set:gen.tierField', now: 2 });
  assert.equal(tl.entries[1].label, 'Tier field wreath → carry');
  const back = readSession(JSON.stringify(saveSession(tl, [])));
  assert.deepEqual(back.tl.entries.map(e => e.recipe), [r, carry]);
  // links made before M5b have no tierField, and still decode to the same recipe
  const old = { ...r, gen: { ...r.gen } };
  delete old.gen.tierField;
  assert.deepEqual(normalize(old), normalize({ ...r, gen: { ...r.gen, tierField: 'none' } }));
});

test('test/smoke.md: the M5b links open a D4 4 / 4 sheet with the field they state', () => {
  const md = readFileSync(new URL('./smoke.md', import.meta.url), 'utf8');
  const section = md.slice(md.indexOf('## Tier fields (M5b)'));
  const rows = [...section.matchAll(/^\| `([^`]+)` \| (\S+) \| <http:\/\/localhost:8000\/(#r=[\w-]+)> \|$/gm)];
  assert.equal(rows.length, 8);
  for (const [, tiers, field, hash] of rows){
    const r = decode(hash);
    assert.equal(r.gen.symmetry, 'dihedral', hash);
    assert.equal(r.gen.tiers, tiers, hash);
    assert.equal(r.gen.tierField, field, hash);
    assert.equal(r.paletteSeed, 1, hash);
    assert.equal(tierFieldState(r.gen).on, field !== 'none', hash);
  }
});
