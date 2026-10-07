/* gen.tiers, the recipe's tier list (newdesign.md §5.2), as text:
     ''                      off
     '4 / 4 mirror-x'        4×4 blocks, each mirrored left/right
     '4 copy:rot90 / 4'      4×4 blocks in a four-fold pattern of copies
   The grammar itself (parseTiers, printTiers, tierState) is in
   src/core/tiers.js, because generation reads gen.tiers and the core does
   not import from this layer. This module adds what the recipe and the UI
   need on top: canonical text and the splits of a size. Pure. */
import { parseTiers, printTiers, tierState } from '../core/tiers.js';

export { parseTiers, printTiers, tierState };

/** The canonical form of tier text, or the text unchanged (trimmed) if it
 *  cannot be read: an unreadable list stays in the recipe, switched off,
 *  so the UI can say why. */
export function canonicalTiers(text){
  const s = String(text ?? '').trim();
  const { tiers, error } = parseTiers(s);
  return error ? s : printTiers(tiers);
}

/** The ordered factorizations of n into factors >= 2, by length, then
 *  smallest factors first: 16 -> 16, 2·8, 4·4, 8·2, 2·2·4, 2·4·2, 4·2·2, 2·2·2·2.
 *  @returns {number[][]} */
export function factorizations(n){
  const out = [];
  const walk = (rest, acc) => {
    if (rest === 1){ if (acc.length) out.push(acc); return; }
    for (let d = 2; d <= rest; d++) if (rest % d === 0) walk(rest / d, [...acc, d]);
  };
  walk(n, []);
  return out.sort((a, b) => a.length - b.length || cmp(a, b));
}
const cmp = (a, b) => { for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; };

/** Every split of a w × h sprite into tiers: a factorization across and one
 *  down, of the same length. @returns {{across:number[], down:number[]}[]} */
export function splitsOf(w, h){
  const out = [], downs = factorizations(h);
  for (const across of factorizations(w))
    for (const down of downs) if (down.length === across.length) out.push({ across, down });
  return out;
}

/** A tier list for a split, keeping each tier's groups from `prev` by
 *  position. The outer tier never has a block group. */
export function withSplit(prev, across, down){
  return across.map((rx, i) => ({
    rx, ry: down[i],
    block: i > 0 && prev && prev[i] ? prev[i].block : null,
    copy: prev && prev[i] ? prev[i].copy : null,
  }));
}
