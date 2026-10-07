/* Recipe <-> URL hash. The permalink IS the recipe: opening it rebuilds the
   same sheet, the way block-showroom's `#i,j,height,gen` does. */

const todo = name => { throw new Error(`not implemented: permalink.${name} (M2)`); };

export function encode(recipe){ return todo('encode'); }
export function decode(hash){ return todo('decode'); }
