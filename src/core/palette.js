/* Deterministic palettes. Pure.
   Port target: reference `paletteFor`, `rgbHex`, `hexRgb`, `lum`, `darken`.
   The palette is a pure function of (paletteSeed, bits per channel). */

const todo = name => { throw new Error(`not implemented: palette.${name} (M1)`); };

/** @returns {string[]} '#rrggbb' colours */
export function paletteFor(seed, bpc){ return todo('paletteFor'); }
export function rgbHex(r, g, b){ return todo('rgbHex'); }
export function hexRgb(hex){ return todo('hexRgb'); }
export function lum(hex){ return todo('lum'); }
export function darken(hex, k){ return todo('darken'); }
