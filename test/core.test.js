/* M0–M1: the port against the reference, byte for byte.
   M0 pins the oracle: the reference loads, is unchanged, and reproduces
   every golden. M1 then holds the port to the same goldens. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadReference, referenceSource, REFERENCE_EXPORTS } from './load-reference.js';
import { fixtureList, spriteDigest, fnv, PALETTE_SEED } from './fixtures.js';

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

test.todo('M1: mulberry32, FIELDS, MASKS and paletteFor match the reference');
test.todo('M1: generateSprite with fold:1 matches the golden for every fixture');
test.todo('M1: generateSprite with fold:2 matches the golden wherever the old fold was exact');
test.todo('M1: generateSprite is deterministic across calls');
