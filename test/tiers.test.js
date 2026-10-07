/* M5a: tiered sprites (newdesign.md §5.2). The engine is checked against
   the ordinary one (no groups in the tiers means the same sprite, byte for
   byte), against the §5.2 table, and by brute force: every generator keeps
   every sprite, and aut() is at least the guaranteed group's order. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureList, tierFixtureList, spriteDigest, PALETTE_SEED, SEEDS } from './fixtures.js';
import { SUBGROUPS, orbitTable, groupById, aut } from '../src/core/groups2d.js';
import { tieredOrbitTable, tierGenerators } from '../src/core/tiers.js';
import { mulberry32 } from '../src/core/rng.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { parseTiers, printTiers, tierState, canonicalTiers, factorizations, splitsOf, withSplit }
  from '../src/recipe/tiers.js';
import { normalize, DEFAULT_RECIPE } from '../src/recipe/schema.js';
import { genFromLegacyCfg } from '../src/recipe/import-v4.js';
import { encode, decode } from '../src/recipe/permalink.js';
import { createTimeline, commit } from '../src/workshop/timeline.js';
import { saveSession, readSession } from '../src/workshop/session.js';

const goldenTiers = JSON.parse(readFileSync(new URL('./golden-tiers.json', import.meta.url), 'utf8'));
const sprite = (seed, gen) => generateSprite(seed, gen, paletteFor(PALETTE_SEED, gen.bpc));
const splitText = ({ across, down }) =>
  across.map((rx, i) => rx === down[i] ? `${rx}` : `${rx}x${down[i]}`).join(' / ');

/* ------------------------------------------------------------------ text */

test('parseTiers and printTiers round-trip, and canonicalise', () => {
  for (const s of ['4 / 4', '4 copy:rot90 / 4', '4 / 4 mirror-x', '4x2 copy:quadrant / 4x8 rot180 copy:mirror-y',
                   '16', '2 / 2 / 2 / 2 dihedral'])
    assert.equal(printTiers(parseTiers(s).tiers), s);
  assert.deepEqual(parseTiers('4x2 copy:rot90 / 4 none').tiers,
    [{ rx:4, ry:2, block:null, copy:'rot90' }, { rx:4, ry:4, block:null, copy:null }]);
  assert.equal(canonicalTiers('  4/4   copy:none mirror-x '), '4 / 4 mirror-x');
  assert.equal(canonicalTiers('4×4 / 4'), '4 / 4');
  assert.equal(canonicalTiers(''), '');
  assert.deepEqual(parseTiers(''), { tiers: [], error: null });
});

test('parseTiers rejects what it cannot read, and says why', () => {
  const bad = {
    '4 / ': /tier 2 is empty/, 'four / 4': /not a radix/, '1 / 16': /2 to 64/, '4 / 4 spin': /unknown group "spin"/,
    '4 / 4 rot90 mirror-x': /two block groups/, '4 copy:rot90 copy:none / 4': /two copy groups/,
    '4 mirror-x / 4': /outer tier's block group is the Symmetry setting/,
  };
  for (const [s, re] of Object.entries(bad)){
    const p = parseTiers(s);
    assert.equal(p.tiers, null, s);
    assert.match(p.error, re, s);
    assert.equal(canonicalTiers(s), s.trim(), `${s}: kept as written`);
  }
});

test('tierState: on only when the tiers multiply out and fold is 2; otherwise it says why', () => {
  const gen = { ...DEFAULT_RECIPE.gen, tiers: '4 / 4' };
  assert.deepEqual(tierState({ ...gen, tiers: '' }), { on: false, tiers: [], reason: null });
  assert.equal(tierState(gen).on, true);
  assert.equal(tierState({ ...gen, h: 12 }).reason, '4·4 = 16, sprite is 16×12');
  assert.equal(tierState({ ...gen, h: 12, tiers: '4x2 / 4x3' }).reason, '4x2·4x3 = 16×6, sprite is 16×12');
  assert.equal(tierState({ ...gen, h: 12, tiers: '4x4 / 4x3' }).on, true);
  assert.match(tierState({ ...gen, fold: 1 }).reason, /old fold/);
  assert.match(tierState({ ...gen, tiers: '4 / x' }).reason, /not a radix/);
});

test('normalize keeps tiers that stop fitting, and puts them back on when the size returns', () => {
  const r = normalize({ gen: { tiers: '4/4 mirror-x' } });
  assert.equal(r.gen.tiers, '4 / 4 mirror-x');
  const narrow = normalize({ ...r, gen: { ...r.gen, h: 12 } });
  assert.equal(narrow.gen.tiers, '4 / 4 mirror-x');
  assert.equal(tierState(narrow.gen).on, false);
  assert.equal(tierState(normalize({ ...narrow, gen: { ...narrow.gen, h: 16 } }).gen).on, true);
  assert.equal(normalize({}).gen.tiers, '');
});

test('factorizations and splitsOf list every split of a size', () => {
  assert.deepEqual(factorizations(16).map(f => f.join('·')),
    ['16', '2·8', '4·4', '8·2', '2·2·4', '2·4·2', '4·2·2', '2·2·2·2']);
  assert.deepEqual(factorizations(13), [[13]]);
  assert.equal(splitsOf(16, 16).length, 1 + 9 + 9 + 1);
  assert.deepEqual(splitsOf(16, 13), [{ across: [16], down: [13] }]);
  for (const { across, down } of splitsOf(16, 12)){
    assert.equal(across.reduce((a, b) => a * b), 16);
    assert.equal(down.reduce((a, b) => a * b), 12);
  }
  // withSplit keeps groups by position, and never gives the outer tier a block group
  const prev = parseTiers('4 copy:rot90 / 4 mirror-x copy:rot180').tiers;
  assert.equal(printTiers(withSplit(prev, [2, 2, 4], [2, 2, 4])), '2 copy:rot90 / 2 mirror-x copy:rot180 / 4');
});

/* ---------------------------------------------------------------- engine */

test('the §5.2 table: orbit counts and the guaranteed groups', () => {
  const rows = [
    // symmetry, tiers, orbits, sprite group, per tier [block result, copy result]
    ['dihedral', '4 / 4',                             36, 'dihedral', [['dihedral', 'none'], ['none', 'none']]],
    ['none',     '4 copy:dihedral / 4 copy:dihedral',  9, 'dihedral', [['dihedral', 'dihedral'], ['dihedral', 'dihedral']]],
    ['none',     '4 / 4 dihedral',                    48, 'none',     [['none', 'none'], ['dihedral', 'dihedral']]],
    ['rot90',    '4 / 4 mirror-x',                    16, 'rot90',    [['rot90', 'rot180'], ['quadrant', 'quadrant']]],
    ['mirror-x', '4 / 4 rot90',                       32, 'mirror-x', [['mirror-x', 'none'], ['rot90', 'rot90']]],
    ['none',     '4 copy:rot90 / 4',                  64, 'none',     [['none', 'rot90'], ['none', 'none']]],
  ];
  for (const [sym, text, orbits, group, per] of rows){
    const t = tieredOrbitTable(sym, 16, 16, parseTiers(text).tiers);
    assert.equal(t.orbitCount, orbits, `${sym} ${text}`);
    assert.equal(t.group, group, `${sym} ${text}`);
    assert.deepEqual(t.tiers.map(x => [x.block.result, x.copy.result]), per, `${sym} ${text}`);
  }
  // the rectangle rule: a swap needs a square block
  const r = tieredOrbitTable('none', 16, 16, parseTiers('4x2 / 4x8 rot90 copy:mirror-diag').tiers);
  assert.equal(r.tiers[1].block.fit, 'rot180');
  assert.equal(r.tiers[1].copy.fit, 'none');
});

test('the outer block symmetry alone gives exactly the ordinary orbits, every group, every split', () => {
  let n = 0;
  for (const g of SUBGROUPS)
    for (const [w, h] of [[16, 16], [15, 15], [12, 12], [9, 9], [16, 12], [9, 6], [8, 4]])
      for (const split of splitsOf(w, h)){
        const t = tieredOrbitTable(g.id, w, h, parseTiers(splitText(split)).tiers), o = orbitTable(g.id, w, h, 2);
        assert.deepEqual([t.sw, t.sh, t.orbitCount], [o.sw, o.sh, o.orbitCount], `${g.id} ${w}x${h} ${splitText(split)}`);
        assert.deepEqual(t.rep, o.rep, `${g.id} ${w}x${h} ${splitText(split)}`);
        n++;
      }
  assert.ok(n > 500, `only ${n} cases`);
});

test('every fixture, under every split with no groups, is byte-identical to no tiers', () => {
  let n = 0;
  for (const f of fixtureList()){
    const gen = { ...genFromLegacyCfg(f.cfg), fold: 2 };
    const want = spriteDigest(sprite(f.seed, gen));
    for (const split of splitsOf(gen.w, gen.h)){
      const s = sprite(f.seed, { ...gen, tiers: splitText(split) });
      assert.equal(s.tiers, splitText(split));
      assert.deepEqual(spriteDigest(s), want, `${f.name} tiers ${splitText(split)}`);
      n++;
    }
  }
  assert.ok(n > 10000, `only ${n} cases`);
});

test('tiers that are off change nothing: wrong size, or fold 1', () => {
  for (const f of fixtureList().filter((_, i) => i % 9 === 0)){
    const gen = genFromLegacyCfg(f.cfg);
    const plain = spriteDigest(sprite(f.seed, gen));
    const off = sprite(f.seed, { ...gen, tiers: '2 copy:rot90 / 2 dihedral / 2' });   // fold 1, and 8 rarely fits
    assert.equal(off.tiers, '');
    assert.deepEqual(spriteDigest(off), plain, f.name);
  }
});

/* The prototype's checks (newdesign.md §5.2), as a property test: every
   square size from 4 to 36, every split into 2 or 3 square tiers, groups
   drawn from a seeded RNG; plus rectangles. Each sprite must be kept by
   every generator, have aut >= its guaranteed group, and every tier's
   result must contain the group asked for. */
test('every generator keeps the sprite, and aut >= the guaranteed group (all splits, random groups)', () => {
  const rnd = mulberry32(0x5eed);
  const pick = arr => arr[(rnd() * arr.length) | 0];
  const ids = [null, ...SUBGROUPS.map(g => g.id)];
  const SOURCES = [
    { source:'field', formula:'mix', vary:true },
    { source:'noise', ca:true },
    { source:'field', formula:'skew', vary:false, mask:'blob', outline:true },
    { source:'field', formula:'xor', vary:false, mask:'disc', outline:true, maskScale:0.9 },
  ];
  const cases = [];
  for (let n = 4; n <= 36; n++) for (const s of splitsOf(n, n))
    if (s.across.length >= 2 && s.across.length <= 3 && s.across.every((r, i) => r === s.down[i])) cases.push([n, n, s]);
  for (const [w, h] of [[16, 12], [12, 8], [24, 18]]) for (const s of splitsOf(w, h))
    if (s.across.length >= 2 && s.across.length <= 3) cases.push([w, h, s]);
  let checks = 0;
  for (const [w, h, split] of cases) for (let k = 0; k < 2; k++){
    const tiers = withSplit(null, split.across, split.down).map((t, i) => ({ ...t, block: i ? pick(ids) : null, copy: pick(ids) }));
    const symmetry = pick(SUBGROUPS).id;
    const gen = { ...DEFAULT_RECIPE.gen, ...pick(SOURCES), w, h, symmetry, fold: 2, tiers: printTiers(tiers) };
    const label = `${symmetry} ${w}x${h} ${gen.tiers}`;
    const s = sprite(pick(SEEDS), gen);
    assert.equal(s.tiers, gen.tiers, label);
    const flat = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) flat.set(s.grid[y], y * w);
    for (const g of tierGenerators(symmetry, w, h, tiers)){
      for (let c = 0; c < w * h; c++)
        if (flat[c] !== flat[g.perm[c]]) assert.fail(`${label}: tier ${g.tier} ${g.kind} ${g.e} moves cell ${c}`);
      checks++;
    }
    const t = tieredOrbitTable(symmetry, w, h, tiers);
    assert.ok(aut(s.grid, w, h) >= groupById(t.group).order, `${label}: aut < |${t.group}|`);
    for (const x of t.tiers) for (const part of ['block', 'copy'])
      for (const e of groupById(x[part].fit).els)
        assert.ok(groupById(x[part].result).els.includes(e), `${label}: ${part} result lacks ${e}`);
  }
  assert.ok(checks > 1000, `only ${checks} generator checks`);
});

test('a tiered sprite says so in its recipe text', () => {
  const s = sprite(1, { ...DEFAULT_RECIPE.gen, symmetry: 'rot90', tiers: '4 / 4 mirror-x' });
  assert.match(s.recipeText, / · tiers 4 \/ 4 mirror-x$/);
  assert.doesNotMatch(sprite(1, DEFAULT_RECIPE.gen).recipeText, /tiers/);
});

/* --------------------------------------------------------------- goldens */

test('golden-tiers.json: one golden per tiered fixture, and the port reproduces every one', () => {
  const fixtures = tierFixtureList();
  assert.deepEqual(Object.keys(goldenTiers.sprites).sort(), fixtures.map(f => f.name).sort(),
    'fixtures and golden-tiers.json disagree: run `npm run golden:tiers` only if the change is intended');
  for (const f of fixtures)
    assert.deepEqual(spriteDigest(sprite(f.seed, f.gen)), goldenTiers.sprites[f.name], f.name);
});

/* ------------------------------------------------------- links and files */

test('the permalink and session files round-trip with tiers set', () => {
  const r = normalize({ gen: { symmetry: 'rot90', tiers: '4 copy:rot90 / 4 mirror-x' }, paletteSeed: 7 });
  assert.deepEqual(decode(encode(r)), r);
  const odd = normalize({ ...r, gen: { ...r.gen, w: 12 } });                // kept, but off
  assert.deepEqual(decode(encode(odd)), odd);
  const tl = createTimeline();
  commit(tl, r, { kind: 'start', now: 1 });
  commit(tl, odd, { kind: 'set:gen.w', now: 2 });
  const back = readSession(JSON.stringify(saveSession(tl, [])));
  assert.deepEqual(back.tl.entries.map(e => e.recipe), [r, odd]);
  assert.match(tl.entries[1].label, /Width/);
  const third = normalize({ ...odd, gen: { ...odd.gen, tiers: '' } });
  commit(tl, third, { kind: 'set:gen.tiers', now: 3 });
  assert.equal(tl.entries[2].label, 'Tiers 4 copy:rot90 /… → off');
});

test('test/smoke.md: the M5a links open the §5.2 table, with the free cells it states', () => {
  const md = readFileSync(new URL('./smoke.md', import.meta.url), 'utf8');
  const section = md.slice(md.indexOf('## Tiered sprites (M5a)'));
  const rows = [...section.matchAll(/^\| (\S+) \| (?:off|`([^`]+)`) \| <http:\/\/localhost:8000\/(#r=[\w-]+)> \| (\d+) \|$/gm)];
  assert.equal(rows.length, 7);
  const sym = { D4: 'dihedral', C4: 'rot90' };
  for (const [, s, tiers = '', hash, cells] of rows){
    const r = decode(hash);
    assert.equal(r.gen.symmetry, sym[s] || s, hash);
    assert.equal(r.gen.tiers, tiers, hash);
    const st = tierState(r.gen);
    const t = st.on ? tieredOrbitTable(r.gen.symmetry, 16, 16, st.tiers) : orbitTable(r.gen.symmetry, 16, 16, 2);
    assert.equal(t.orbitCount, Number(cells), `${s} ${tiers}`);
  }
});
