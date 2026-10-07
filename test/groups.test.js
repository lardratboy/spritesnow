/* M1: the symmetry engine. These turn the measurements in
   tools/measurements/ (docs/from3Dto2D.md §3–§4) into assertions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReference } from './load-reference.js';
import { LEGACY_MODES, SEEDS, PALETTE_SEED, legacyExact } from './fixtures.js';
import { seedDims, legacyFold, orbitTable, SUBGROUPS, ELEMENT_COUNT, applyElement, compose,
         inverse, isReflection, closure, groupById, effectiveGroup, aut } from '../src/core/groups2d.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { DEFAULT_RECIPE } from '../src/recipe/schema.js';

const ref = await loadReference();

/* ------------------------------------------------------------ M1a: fold:1 */

test('seedDims and legacyFold match the reference on every grid 2x2..40x40, defects included', () => {
  for (const mode of LEGACY_MODES) for (let w = 2; w <= 40; w++) for (let h = 2; h <= 40; h++){
    assert.deepEqual(seedDims(w, h, mode), Array.from(ref.seedDims(w, h, mode)), `seedDims ${mode} ${w}x${h}`);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const a = legacyFold(x, y, w, h, mode), b = ref.fold(x, y, w, h, mode);
      if (a[0] !== b[0] || a[1] !== b[1]) assert.fail(`legacyFold ${mode} ${w}x${h} (${x},${y})`);
    }
  }
});

test('orbitTable fold:1 points every cell inside the seed region', () => {
  for (const g of SUBGROUPS.filter(g => g.legacy)) for (const [w, h] of [[16,16],[15,15],[16,12],[9,10]]){
    const t = orbitTable(g.id, w, h, 1);
    assert.equal(t.rep.length, w * h);
    for (const r of t.rep) assert.ok(r >= 0 && r < t.sw * t.sh, `${g.id} ${w}x${h}`);
  }
});

test('orbitTable fold:1 refuses groups the old app could not make', () => {
  for (const g of SUBGROUPS.filter(g => !g.legacy))
    assert.throws(() => orbitTable(g.id, 16, 16, 1), /fold:1/);
});

/* ---------------------------------------------------- M1b: the group engine */

/* An independent model of D4: the 2x2 matrix of each code, built from the
   documented reading (swap first, then flips), never from groups2d. */
const matOf = e => {
  const P = (e & 4) ? [[0,1],[1,0]] : [[1,0],[0,1]];
  const S = [(e & 1) ? -1 : 1, (e & 2) ? -1 : 1];
  const z = n => n || 0;                                  // no -0: deepEqual tells them apart
  return [[z(S[0]*P[0][0]), z(S[0]*P[0][1])], [z(S[1]*P[1][0]), z(S[1]*P[1][1])]];
};
const matMul = (A, B) => [[A[0][0]*B[0][0]+A[0][1]*B[1][0], A[0][0]*B[0][1]+A[0][1]*B[1][1]],
                          [A[1][0]*B[0][0]+A[1][1]*B[1][0], A[1][0]*B[0][1]+A[1][1]*B[1][1]]].map(r => r.map(n => n || 0));
const det = M => M[0][0]*M[1][1] - M[0][1]*M[1][0];
const RANGE = []; for (let w = 2; w <= 40; w++) for (let h = 2; h <= 40; h++) RANGE.push([w, h]);

test('element codes: compose, inverse and isReflection agree with the matrices', () => {
  assert.equal(ELEMENT_COUNT, 8);
  for (let a = 0; a < 8; a++){
    assert.deepEqual(matOf(compose(a, inverse(a))), matOf(0), `inverse(${a})`);
    assert.equal(isReflection(a), det(matOf(a)) < 0, `isReflection(${a})`);
    for (let b = 0; b < 8; b++)
      assert.deepEqual(matOf(compose(a, b)), matMul(matOf(a), matOf(b)), `compose(${a},${b})`);
  }
  // applyElement is the matrix acting on centred coordinates, and maps a square grid onto itself
  for (const n of [5, 6]) for (let e = 0; e < 8; e++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++){
    const M = matOf(e), u = 2*x - (n-1), v = 2*y - (n-1);
    const [ax, ay] = applyElement(e, x, y, n, n);
    assert.deepEqual([2*ax - (n-1), 2*ay - (n-1)], [M[0][0]*u + M[0][1]*v, M[1][0]*u + M[1][1]*v].map(n => n || 0));
  }
});

test('closure of each SUBGROUPS entry has the expected order (1,2,2,2,2,2,4,4,4,8)', () => {
  assert.deepEqual(SUBGROUPS.map(g => groupById(g.id).order), [1,2,2,2,2,2,4,4,4,8]);
  assert.deepEqual(SUBGROUPS.filter(g => groupById(g.id).chiral).map(g => g.id), ['none','rot180','rot90']);
});

test('D4 has 10 subgroups in 8 conjugacy classes, and SUBGROUPS lists all 10', () => {
  const subs = new Map();
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++){ const H = closure([a, b]); subs.set(H.join(','), H); }
  assert.equal(subs.size, 10);
  assert.deepEqual(new Set(SUBGROUPS.map(g => groupById(g.id).els.join(','))), new Set(subs.keys()));
  const classes = new Set([...subs.values()].map(H => {
    let best = null;
    for (let g = 0; g < 8; g++){
      const k = H.map(h => compose(compose(g, h), inverse(g))).sort((a, b) => a - b).join(',');
      if (best === null || k < best) best = k;
    }
    return best;
  }));
  assert.equal(classes.size, 8);
});

test('orbit counts at 16x16 and 8x8 match from3Dto2D.md §4', () => {
  const want = { none:[256,64], 'mirror-x':[128,32], 'mirror-y':[128,32], 'mirror-diag':[136,36],
    'mirror-anti':[136,36], rot180:[128,32], rot90:[64,16], quadrant:[64,16], diagonals:[72,20], dihedral:[36,10] };
  for (const [id, [a, b]] of Object.entries(want)){
    assert.equal(orbitTable(id, 16, 16, 2).orbitCount, a, `${id} 16x16`);
    assert.equal(orbitTable(id, 8, 8, 2).orbitCount, b, `${id} 8x8`);
  }
});

test('every orbit has exactly one representative, every group, every grid 2x2..40x40', () => {
  for (const g of SUBGROUPS) for (const [w, h] of RANGE){
    const t = orbitTable(g.id, w, h, 2), eff = t.effective;
    const reps = new Set();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const r = t.rep[y*w + x];
      if (!(r >= 0 && r < t.sw * t.sh)) assert.fail(`${g.id} ${w}x${h} (${x},${y}): rep outside seed region`);
      reps.add(r);
      // the representative is in this cell's orbit, and orbitIndex names the element
      const [ox, oy] = applyElement(t.orbitIndex[y*w + x], r % t.sw, (r / t.sw) | 0, w, h);
      if (ox !== x || oy !== y) assert.fail(`${g.id} ${w}x${h} (${x},${y}): orbitIndex does not reach the cell`);
      // every orbit member shares it
      for (const e of eff.els){
        const [ax, ay] = applyElement(e, x, y, w, h);
        if (t.rep[ay*w + ax] !== r) assert.fail(`${g.id} ${w}x${h} (${x},${y}): orbit split`);
      }
    }
    assert.equal(reps.size, t.orbitCount, `${g.id} ${w}x${h} orbitCount`);
  }
});

test('aut(sprite) >= |G| for every group at every size (fold:2)', () => {
  const SOURCES = [
    { source:'field', formula:'mix', vary:true },
    { source:'noise', ca:true },
    { source:'field', formula:'skew', vary:false, mask:'blob', outline:true },
  ];
  const pal = paletteFor(PALETTE_SEED, 3);
  for (const g of SUBGROUPS) for (const [w, h] of RANGE){
    const gen = { ...DEFAULT_RECIPE.gen, ...SOURCES[(w + h) % 3], w, h, symmetry: g.id, fold: 2 };
    const s = generateSprite(SEEDS[(w * h) % SEEDS.length], gen, pal);
    const want = effectiveGroup(g.id, w, h).order;
    const got = aut(s.grid, w, h);
    if (got < want) assert.fail(`${g.id} ${w}x${h}: aut ${got} < |G| ${want}`);
    assert.equal(s.effectiveSymmetry, effectiveGroup(g.id, w, h).id);
  }
});

test('effectiveGroup: rectangles keep only what fits (rot90 -> rot180, reduced:true)', () => {
  const want = { none:'none', 'mirror-x':'mirror-x', 'mirror-y':'mirror-y', 'mirror-diag':'none',
    'mirror-anti':'none', rot180:'rot180', rot90:'rot180', quadrant:'quadrant', diagonals:'rot180', dihedral:'quadrant' };
  for (const g of SUBGROUPS){
    for (const [w, h] of [[16,12],[15,11],[9,10]]){
      const e = effectiveGroup(g.id, w, h);
      assert.equal(e.id, want[g.id], `${g.id} ${w}x${h}`);
      assert.equal(e.reduced, want[g.id] !== g.id);
    }
    const sq = effectiveGroup(g.id, 15, 15);
    assert.equal(sq.id, g.id); assert.equal(sq.reduced, false);
  }
});

test('fold:2 picks the legacy representative wherever the old fold was exact', () => {
  let exactGrids = 0;
  for (const g of SUBGROUPS.filter(g => g.legacy)) for (const [w, h] of RANGE){
    const t2 = orbitTable(g.id, w, h, 2), eff = t2.effective;
    if (eff.reduced) continue;
    if (legacyExact(g.id, w, h)){
      exactGrids++;
      assert.deepEqual([t2.sw, t2.sh], seedDims(w, h, g.legacy), `${g.id} ${w}x${h} seed region`);
      assert.deepEqual(t2.rep, orbitTable(g.id, w, h, 1).rep, `${g.id} ${w}x${h}`);
      continue;
    }
    // a broken grid: orbits the old fold handled exactly still keep its choice
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const orbit = eff.els.map(e => applyElement(e, x, y, w, h));
      const fold = orbit.map(([a, b]) => legacyFold(a, b, w, h, g.legacy).join(','));
      const [fx, fy] = legacyFold(x, y, w, h, g.legacy);
      const exact = new Set(fold).size === 1 && orbit.some(([a, b]) => a === fx && b === fy);
      if (exact && t2.rep[y*w + x] !== fy*t2.sw + fx) assert.fail(`${g.id} ${w}x${h} (${x},${y})`);
    }
  }
  // none, mirror-x, mirror-y and quadrant are exact everywhere: 4 x 1521 grids, plus the even cases
  assert.ok(exactGrids > 4 * RANGE.length, `only ${exactGrids} exact grids`);
});
