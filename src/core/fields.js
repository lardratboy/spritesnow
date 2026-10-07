/* The 20 modulo fields, plus their helpers. Pure.
   Port target: reference `FIELDS`, `popcount`, `digitSum`, `pascalMod`.
   A field maps centred, strided, offset coordinates (u, v) and per-sprite
   params p to a number. generate.js reduces it mod M. */

const todo = name => { throw new Error(`not implemented: fields.${name} (M1)`); };

/** @type {{id:string, name:string, f:(u:number, v:number, p:object) => number}[]} */
export const FIELDS = [];
export const FIELD_BY_ID = {};

export function popcount(n){ return todo('popcount'); }
export function digitSum(n){ return todo('digitSum'); }
/** C(n, k) mod m, via a cached Pascal triangle per modulus. */
export function pascalMod(n, k, m){ return todo('pascalMod'); }
