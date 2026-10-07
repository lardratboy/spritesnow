/* M1: the symmetry engine. These turn the measurements in
   tools/measurements/ (docs/from3Dto2D.md §3–§4) into assertions. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadReference } from './load-reference.js';
import { LEGACY_MODES } from './fixtures.js';
import { seedDims, legacyFold, orbitTable, SUBGROUPS } from '../src/core/groups2d.js';

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


test.todo('element codes: compose, inverse and isReflection agree with the matrices');
test.todo('closure of each SUBGROUPS entry has the expected order (1,2,2,2,2,2,4,4,4,8)');
test.todo('D4 has 10 subgroups in 8 conjugacy classes');
test.todo('orbit counts at 16x16 and 8x8 match from3Dto2D.md §4');
test.todo('every orbit has exactly one representative, every group, every grid 2x2..40x40');
test.todo('aut(sprite) >= |G| for every group at every size (fold:2)');
test.todo('effectiveGroup: rot90 on a rectangle reduces to rot180 and reports reduced:true');
test.todo('fold:2 picks the legacy representative wherever the old fold was exact');
