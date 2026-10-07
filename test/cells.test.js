/* M3b: lock and reroll. A locked cell keeps the settings and palette it
   was locked with while the sheet changes around it, exactly as the old
   app's lockCfg did; the reference generator checks that cell for cell. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLocked, setLock, toggleLock, rerollCell, reseedUnlocked, lockedDifferences } from '../src/workshop/cells.js';
import { normalize, cellSettings, resizeSheet } from '../src/recipe/schema.js';
import { encode, decode } from '../src/recipe/permalink.js';
import { genFromLegacyCfg } from '../src/recipe/import-v4.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { loadReference } from './load-reference.js';
import { REFERENCE_CFG, spriteDigest } from './fixtures.js';

const ref = await loadReference();
const digest = (r, i) => {
  const c = cellSettings(r, i);
  return spriteDigest(generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)));
};
const base = normalize({ paletteSeed: 99, sheet: { cols: 4, rows: 3 } });
const change = (r, gen, paletteSeed = r.paletteSeed) => normalize({ ...r, gen: { ...r.gen, ...gen }, paletteSeed });

test('a locked cell keeps its sprite while the settings and palette change around it', () => {
  const locked = setLock(base, 5, true);
  assert.ok(isLocked(locked, 5) && !isLocked(locked, 4));
  assert.ok(!isLocked(base, 5), 'the input recipe is not mutated');
  const after = change(locked, { symmetry: 'rot90', modulus: 31, ncol: 6 }, 1234);
  assert.deepEqual(digest(after, 5), digest(base, 5), 'locked cell unchanged');
  const moved = [0, 1, 2, 3, 4, 6].filter(i => JSON.stringify(digest(after, i)) !== JSON.stringify(digest(base, i)));
  assert.ok(moved.length >= 5, 'unlocked cells follow the sheet');
  assert.deepEqual(lockedDifferences(after, 5), ['Modulus', 'Symmetry', 'Colours', 'Palette']);
  assert.deepEqual(lockedDifferences(after, 4), []);
});

test('unlocking makes the cell follow the sheet again', () => {
  const after = change(setLock(base, 2, true), { symmetry: 'dihedral' });
  const unlocked = toggleLock(after, 2);
  assert.ok(!isLocked(unlocked, 2));
  assert.deepEqual(digest(unlocked, 2), digest(change(base, { symmetry: 'dihedral' }), 2));
  assert.ok(isLocked(toggleLock(unlocked, 2), 2), 'toggle locks again');
});

test('reroll changes only that cell, and unlocks it', () => {
  const locked = setLock(setLock(base, 3, true), 7, true);
  const r = rerollCell(locked, 3, 0xfeedface);
  assert.equal(r.seeds[3], 0xfeedface);
  assert.deepEqual(r.seeds.filter((_, i) => i !== 3), base.seeds.filter((_, i) => i !== 3));
  assert.ok(!isLocked(r, 3), 'rerolled cell is unlocked');
  assert.ok(isLocked(r, 7), 'other locks stay');
  assert.deepEqual(normalize(r), r, 'still a normal recipe');
});

test('regenerate gives new seeds to unlocked cells only', () => {
  const locked = setLock(setLock(base, 0, true), 11, true);
  const r = reseedUnlocked(locked, i => 1000 + i);
  r.seeds.forEach((s, i) => assert.equal(s, i === 0 || i === 11 ? base.seeds[i] : 1000 + i, `cell ${i}`));
});

test('locks survive the permalink and a sheet resize', () => {
  const locked = setLock(change(setLock(base, 6, true), { w: 12 }), 1, true);
  assert.deepEqual(decode(encode(locked)), normalize(locked));
  const big = resizeSheet(locked, 5, 3, i => i);
  assert.ok(isLocked(big, 7) && isLocked(big, 1), 'cell (1,2) moves from index 6 to 7');
  assert.equal(big.overrides[7].gen.w, 16, 'it kept the width it was locked with');
});

test('locking in spritesnow matches locking in the old app, cell for cell', () => {
  // The old app: lock cell 4 under cfgA, then switch the sheet to cfgB.
  const cfgA = { ...REFERENCE_CFG, symmetry: 'rot180', sw: 15, sh: 15, formula: 'trefoil', vary: false };
  const cfgB = { ...cfgA, symmetry: 'quadrant', source: 'noise', ncol: 5 };
  const seeds = [11, 22, 33, 44, 55, 66], palA = 0xabc, palB = 0xdef;
  const want = seeds.map((seed, i) => ref.generateSprite(seed, i === 4 ? ref.toGen(cfgA, palA) : ref.toGen(cfgB, palB)));
  // spritesnow: the same steps on a recipe
  let r = normalize({ gen: genFromLegacyCfg(cfgA), sheet: { cols: 3, rows: 2 }, paletteSeed: palA, seeds });
  r = setLock(r, 4, true);
  r = normalize({ ...r, gen: genFromLegacyCfg(cfgB), paletteSeed: palB });
  seeds.forEach((_, i) => assert.deepEqual(digest(r, i), spriteDigest(want[i]), `cell ${i}`));
});
