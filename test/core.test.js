/* M0–M1: the port against the reference, byte for byte.
   M0 pins the oracle: the reference loads, is unchanged, and reproduces
   every golden. M1 then holds the port to the same goldens. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadReference, referenceSource, REFERENCE_EXPORTS } from './load-reference.js';
import { fixtureList, spriteDigest, fnv, PALETTE_SEED, SEEDS, legacyExact } from './fixtures.js';
import { mulberry32 } from '../src/core/rng.js';
import { FIELDS, popcount, digitSum, pascalMod } from '../src/core/fields.js';
import { MASKS } from '../src/core/masks.js';
import { paletteFor } from '../src/core/palette.js';
import { generateSprite, ODDS } from '../src/core/generate.js';
import { genFromLegacyCfg } from '../src/recipe/import-v4.js';

const golden = JSON.parse(readFileSync(new URL('./golden.json', import.meta.url), 'utf8'));
const ref = await loadReference();
const fixtures = fixtureList();

test('M0: loadReference() returns the reference generator', () => {
  for (const name of REFERENCE_EXPORTS) assert.ok(ref[name] !== undefined, `reference lacks ${name}`);
  assert.equal(ref.FIELDS.length, 20);
  assert.equal(ref.MASKS.length, 11);
});

test('M0: the reference file is unchanged since the goldens were made', () => {
  assert.equal(fnv(new TextEncoder().encode(referenceSource())), golden.reference,
    'reference/ changed: it must never be edited');
});

test('M0: there is exactly one golden per fixture', () => {
  const names = fixtures.map(f => f.name);
  assert.equal(new Set(names).size, names.length, 'duplicate fixture names');
  assert.deepEqual(Object.keys(golden.sprites).sort(), names.slice().sort(),
    'fixtures and golden.json disagree: run `npm run golden` only if the fixture change is intended');
});

test('M0: the reference reproduces every golden', () => {
  for (const f of fixtures){
    const got = spriteDigest(ref.generateSprite(f.seed, ref.toGen(f.cfg, PALETTE_SEED)));
    assert.deepEqual(got, golden.sprites[f.name], f.name);
  }
});

/* ------------------------------------------------------------------ M1 */

/** The port's sprite for a fixture, built from the same cfg the golden used. */
const portSprite = f =>
  generateSprite(f.seed, genFromLegacyCfg(f.cfg), paletteFor(PALETTE_SEED, f.cfg.bpc));

test('M1: mulberry32, helpers, FIELDS, MASKS, ODDS and paletteFor match the reference', () => {
  for (const seed of [...SEEDS, 0, 0xffffffff]){
    const a = mulberry32(seed), b = ref.mulberry32(seed);
    for (let i = 0; i < 64; i++) assert.equal(a(), b(), `mulberry32(${seed}) draw ${i}`);
  }
  for (let n = -300; n <= 300; n += 7){
    assert.equal(popcount(n), ref.popcount(n));
    assert.equal(digitSum(n), ref.digitSum(n));
    for (const m of [3, 7, 17]) assert.equal(pascalMod(Math.abs(n), Math.abs(n) % 9, m), ref.pascalMod(Math.abs(n), Math.abs(n) % 9, m));
  }
  assert.deepEqual(ODDS, Array.from(ref.ODDS));
  assert.deepEqual(FIELDS.map(f => [f.id, f.name]), Array.from(ref.FIELDS, f => [f.id, f.name]));
  const P = { M:17, a:2, b:-3, c:1, d:4, e:-5 };
  for (let i = 0; i < FIELDS.length; i++)
    for (let u = -20; u <= 20; u += 3) for (let v = -20; v <= 20; v += 3)
      assert.equal(FIELDS[i].f(u, v, P), ref.FIELDS[i].f(u, v, P), `${FIELDS[i].id}(${u},${v})`);
  assert.deepEqual(MASKS.map(m => [m.id, m.name]), Array.from(ref.MASKS, m => [m.id, m.name]));
  for (let i = 0; i < MASKS.length; i++){
    if (!MASKS[i].m) continue;                       // blob is generated, not a formula
    for (const r of [0.4, 1, 1.45])
      for (let nx = -1.2; nx <= 1.2; nx += 0.1) for (let ny = -1.2; ny <= 1.2; ny += 0.1)
        assert.equal(MASKS[i].m(nx, ny, r), ref.MASKS[i].m(nx, ny, r), `${MASKS[i].id}(${nx},${ny},${r})`);
  }
  for (const seed of [...SEEDS, PALETTE_SEED]) for (const bpc of [1, 2, 3, 4, 8])
    assert.deepEqual(paletteFor(seed, bpc), Array.from(ref.paletteFor(seed, bpc)), `paletteFor(${seed}, ${bpc})`);
});

test('M1: generateSprite with fold:1 matches the golden for every fixture', () => {
  for (const f of fixtures) assert.deepEqual(spriteDigest(portSprite(f)), golden.sprites[f.name], f.name);
});

test('M1: generateSprite with fold:1 writes the reference recipe text', () => {
  for (const f of fixtures){
    const want = ref.generateSprite(f.seed, ref.toGen(f.cfg, PALETTE_SEED)).recipe;
    assert.equal(portSprite(f).recipeText, want, f.name);
  }
});

test('M1: generateSprite is deterministic across calls', () => {
  for (const f of fixtures.filter((_, i) => i % 50 === 0))
    assert.deepEqual(spriteDigest(portSprite(f)), spriteDigest(portSprite(f)), f.name);
});

test('M1b: generateSprite with fold:2 matches the golden wherever the old fold was exact', () => {
  let checked = 0;
  for (const f of fixtures){
    const gen = { ...genFromLegacyCfg(f.cfg), fold: 2 };
    if (!legacyExact(gen.symmetry, gen.w, gen.h)) continue;
    checked++;
    const s = generateSprite(f.seed, gen, paletteFor(PALETTE_SEED, f.cfg.bpc));
    assert.deepEqual(spriteDigest(s), golden.sprites[f.name], f.name);
  }
  // none, horizontal, vertical, quadrant at all 8 sizes; rot180 at the 4 even heights;
  // rot90 at the 2 even squares; diagonal at the 5 squares: 43 grids x 7 sources x 4 seeds
  assert.equal(checked, 43 * 7 * 4);
});
