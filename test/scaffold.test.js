/* Passes on the empty scaffold: the module graph loads in Node and the
   declared data is consistent. Keep it; it catches broken imports early. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUBGROUPS, ELEMENT_COUNT } from '../src/core/groups2d.js';
import { LEGACY_SYMMETRY } from '../src/recipe/import-v4.js';
import { DEFAULT_RECIPE, FORMAT } from '../src/recipe/schema.js';
import * as fields from '../src/core/fields.js';
import * as masks from '../src/core/masks.js';
import * as palette from '../src/core/palette.js';
import * as rng from '../src/core/rng.js';
import * as generate from '../src/core/generate.js';

test('core modules load and export their planned names', () => {
  for (const [mod, names] of [
    [rng, ['mulberry32','hash32']],
    [fields, ['FIELDS','FIELD_BY_ID','popcount','digitSum','pascalMod']],
    [masks, ['MASKS','MASK_BY_ID','blobMask']],
    [palette, ['paletteFor','rgbHex','hexRgb','lum','darken']],
    [generate, ['generateSprite']],
  ]) for (const n of names) assert.ok(n in mod, `missing export ${n}`);
});

test('10 subgroups with unique ids and codes inside D4', () => {
  assert.equal(ELEMENT_COUNT, 8);
  assert.equal(SUBGROUPS.length, 10);
  assert.equal(new Set(SUBGROUPS.map(g => g.id)).size, 10);
  for (const g of SUBGROUPS) for (const e of g.gens) assert.ok(e >= 0 && e < 8);
});

test('every legacy mode maps to the subgroup that declares it', () => {
  for (const [mode, id] of Object.entries(LEGACY_SYMMETRY))
    assert.equal(SUBGROUPS.find(g => g.id === id).legacy, mode);
});

test('default recipe uses a declared group and the current format', () => {
  assert.equal(DEFAULT_RECIPE.format, FORMAT);
  assert.ok(SUBGROUPS.some(g => g.id === DEFAULT_RECIPE.gen.symmetry));
});
