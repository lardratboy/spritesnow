/* The recipe: everything needed to rebuild a sprite sheet exactly.
   Format `spritesnow/1` (newdesign.md D6). A session is a list of recipes.
   The default values are the old 2D app's control defaults, so a fresh
   recipe looks like a fresh session in the reference app. */

const todo = name => { throw new Error(`not implemented: schema.${name} (M2)`); };

export const FORMAT = 'spritesnow/1';

export const DEFAULT_RECIPE = Object.freeze({
  format: FORMAT,
  gen: {
    source: 'field',        // 'field' | 'noise' | 'custom'
    formula: 'mix',         // a FIELDS id, or 'mix'
    expr: '(u*u + v*v) * (Math.abs(u)^Math.abs(v))',
    modulus: 17, stride: 1, phase: 0, coverage: 0.45,
    vary: true, ca: true,
    mask: 'none', maskScale: 1, maskInvert: false, outline: false,
    w: 16, h: 16,
    symmetry: 'mirror-x',   // a groups2d SUBGROUPS id (legacy 'horizontal')
    fold: 2,                // 1 = reproduce the old fold, defects included
    bpc: 3, ncol: 4, colorMode: 'bands', sortLum: true,
  },
  sheet: { cols: 8, rows: 6, spacing: 2, scale: 4 },
  paletteSeed: 0,
  seeds: [],                // one uint32 per cell, row-major
});

/** Fill in defaults and reject malformed input. @returns {object} recipe */
export function normalize(recipe){ return todo('normalize'); }
/** @returns {string[]} problems, empty when valid */
export function validate(recipe){ return todo('validate'); }
