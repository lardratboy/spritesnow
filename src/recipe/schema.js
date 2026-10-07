/* The recipe: everything needed to rebuild a sprite sheet exactly.
   Format `spritesnow/1` (newdesign.md D6). A session is a list of recipes.
   The default values are the old 2D app's control defaults, so a fresh
   recipe looks like a fresh session in the reference app.

   Shape:
     { format, gen, sheet, paletteSeed, seeds[], overrides{} }
   seeds      one uint32 per cell, row-major
   overrides  { <cell index>: { gen, paletteSeed } } for cells that carry
              their own settings (locked cells in imported old sessions) */
import { SUBGROUPS, groupById } from '../core/groups2d.js';
import { FIELDS } from '../core/fields.js';
import { MASKS } from '../core/masks.js';
import { hash32 } from '../core/rng.js';
import { canonicalTiers } from './tiers.js';

export const FORMAT = 'spritesnow/1';

export const DEFAULT_RECIPE = Object.freeze({
  format: FORMAT,
  gen: Object.freeze({
    source: 'field',        // 'field' | 'noise' | 'custom'
    formula: 'mix',         // a FIELDS id, or 'mix'
    expr: '(u*u + v*v) * (Math.abs(u)^Math.abs(v))',
    modulus: 17, stride: 1, phase: 0, coverage: 0.45,
    vary: true, ca: true,
    mask: 'none', maskScale: 1, maskInvert: false, outline: false,
    w: 16, h: 16,
    symmetry: 'mirror-x',   // a groups2d SUBGROUPS id (legacy 'horizontal')
    fold: 2,                // 1 = reproduce the old fold, defects included
    tiers: '',              // recipe/tiers.js: '' (off), or e.g. '4 / 4 mirror-x' (fold 2 only)
    bpc: 3, ncol: 4, colorMode: 'bands', sortLum: true,
  }),
  sheet: Object.freeze({ cols: 8, rows: 6, spacing: 2, scale: 4 }),
  paletteSeed: 0,
  seeds: Object.freeze([]),
  overrides: Object.freeze({}),
});

/* Context-free names for every setting, as 'part.key', for labels. */
export const SETTING_LABELS = {
  'gen.source':'Source', 'gen.formula':'Formula', 'gen.expr':'Expression', 'gen.modulus':'Modulus',
  'gen.stride':'Stride', 'gen.phase':'Phase', 'gen.coverage':'Coverage', 'gen.vary':'Vary per cell',
  'gen.ca':'CA smooth', 'gen.mask':'Mask', 'gen.maskScale':'Mask size', 'gen.maskInvert':'Mask invert',
  'gen.outline':'Outline', 'gen.w':'Width', 'gen.h':'Height', 'gen.symmetry':'Symmetry', 'gen.fold':'Fold',
  'gen.tiers':'Tiers',
  'gen.bpc':'Gamut', 'gen.ncol':'Colours', 'gen.colorMode':'Colour mode', 'gen.sortLum':'Sort by luminance',
  'sheet.cols':'Columns', 'sheet.rows':'Rows', 'sheet.spacing':'Spacing', 'sheet.scale':'Scale',
};

/* What each setting may hold. Ranges are the old app's <input> min/max. */
const oneOf = list => ({ kind: 'enum', list });
const num = (lo, hi, int) => ({ kind: 'num', lo, hi, int });
const bool = { kind: 'bool' };
const str = { kind: 'str' };
export const GEN_SPEC = {
  source: oneOf(['field', 'noise', 'custom']),
  formula: oneOf(['mix', ...FIELDS.map(f => f.id)]),
  expr: str,
  modulus: num(2, 512, true), stride: num(1, 8, true), phase: num(0, 1), coverage: num(0.05, 1),
  vary: bool, ca: bool,
  mask: oneOf([...MASKS.map(m => m.id), 'mix']), maskScale: num(0.4, 1.45), maskInvert: bool, outline: bool,
  w: num(2, 64, true), h: num(2, 64, true),
  symmetry: oneOf(SUBGROUPS.map(g => g.id)), fold: oneOf([1, 2]), tiers: str,
  bpc: oneOf([1, 2, 3, 4, 8]), ncol: num(1, 16, true), colorMode: oneOf(['bands', 'cycle', 'solid']), sortLum: bool,
};
export const SHEET_SPEC = {
  cols: num(1, 50, true), rows: num(1, 50, true), spacing: num(0, 16, true),
  scale: num(1, 24, true),   // v1 is integer scale only (newdesign.md §3)
};

function coerce(spec, value, fallback){
  switch (spec.kind){
    case 'enum': return spec.list.includes(value) ? value
                      : spec.list.includes(+value) ? +value : fallback;
    case 'bool': return typeof value === 'boolean' ? value : fallback;
    case 'str':  return typeof value === 'string' ? value : fallback;
    case 'num': {
      let n = Number(value);
      if (value === null || value === undefined || value === '' || !Number.isFinite(n)) return fallback;
      if (spec.int) n = Math.round(n);
      return Math.min(spec.hi, Math.max(spec.lo, n));
    }
  }
}
const coerceAll = (spec, input, defaults) => {
  const out = {};
  for (const k of Object.keys(spec)) out[k] = coerce(spec[k], input ? input[k] : undefined, defaults[k]);
  return out;
};
const u32 = (v, fallback) => Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) >>> 0 : fallback;

/** A generator settings object with every key valid. fold:1 is only kept for
 *  groups the old app had (newdesign.md D2). Tiers are written in their
 *  canonical form; tiers that do not fit (or cannot be read) are kept, and
 *  are only off (tierState says why). */
export function normalizeGen(gen){
  const g = coerceAll(GEN_SPEC, gen, DEFAULT_RECIPE.gen);
  if (g.fold === 1 && !groupById(g.symmetry).legacy) g.fold = 2;
  g.tiers = canonicalTiers(g.tiers);
  return g;
}

/** Fill in defaults, clamp to valid ranges, and size seeds to the sheet.
 *  Missing seeds are derived deterministically from paletteSeed and the cell
 *  index, so a recipe with no seeds still means one exact sheet.
 *  @returns {object} a new, complete recipe */
export function normalize(recipe){
  const r = recipe || {};
  const gen = normalizeGen(r.gen);
  const sheet = coerceAll(SHEET_SPEC, r.sheet, DEFAULT_RECIPE.sheet);
  const paletteSeed = u32(r.paletteSeed, DEFAULT_RECIPE.paletteSeed);
  const n = sheet.cols * sheet.rows;
  const given = Array.isArray(r.seeds) ? r.seeds : [];
  const seeds = Array.from({ length: n }, (_, i) =>
    i < given.length ? u32(given[i], derivedSeed(paletteSeed, i)) : derivedSeed(paletteSeed, i));
  const overrides = {};
  for (const [k, o] of Object.entries(r.overrides || {})){
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n || !o) continue;
    overrides[i] = { gen: normalizeGen(o.gen), paletteSeed: u32(o.paletteSeed, paletteSeed) };
  }
  return { format: FORMAT, gen, sheet, paletteSeed, seeds, overrides };
}
const derivedSeed = (paletteSeed, i) => hash32(paletteSeed ^ 0x9e3779b9, i);

/** @returns {string[]} problems, empty when the recipe is already normal */
export function validate(recipe){
  const problems = [];
  if (!recipe || typeof recipe !== 'object') return ['not an object'];
  if (recipe.format !== FORMAT) problems.push(`format is ${JSON.stringify(recipe.format)}, expected ${FORMAT}`);
  const n = normalize(recipe);
  for (const part of ['gen', 'sheet'])
    for (const k of Object.keys(n[part]))
      if (!recipe[part] || recipe[part][k] !== n[part][k])
        problems.push(`${part}.${k}: ${JSON.stringify(recipe[part] && recipe[part][k])} -> ${JSON.stringify(n[part][k])}`);
  if (!Array.isArray(recipe.seeds) || recipe.seeds.length !== n.seeds.length)
    problems.push(`seeds: expected ${n.seeds.length}`);
  return problems;
}

/** The settings one cell is generated from. @returns {{seed, gen, paletteSeed}} */
export function cellSettings(recipe, i){
  const o = recipe.overrides[i];
  return { seed: recipe.seeds[i], gen: o ? o.gen : recipe.gen, paletteSeed: o ? o.paletteSeed : recipe.paletteSeed };
}

/** One cell as a 1×1 recipe of its own, for "Copy recipe".
 *  @param {{seed, gen, paletteSeed}} cell  as cellSettings() returns it */
export function soloRecipe({ seed, gen, paletteSeed }, sheet){
  return normalize({ gen, sheet: { ...sheet, cols: 1, rows: 1 }, paletteSeed, seeds: [seed] });
}

/** Resize the sheet, keeping each surviving cell at its (row, col), as the
 *  old app's reconcileCells did. New cells get seeds from newSeed(i). */
export function resizeSheet(recipe, cols, rows, newSeed){
  const old = recipe.sheet, seeds = [], overrides = {};
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++){
    const i = r*cols + c;
    if (r < old.rows && c < old.cols){
      const j = r*old.cols + c;
      seeds.push(recipe.seeds[j]);
      if (recipe.overrides[j]) overrides[i] = recipe.overrides[j];
    } else seeds.push(newSeed(i) >>> 0);
  }
  return { ...recipe, sheet: { ...old, cols, rows }, seeds, overrides };
}
