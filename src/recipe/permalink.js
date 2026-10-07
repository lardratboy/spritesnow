/* Recipe <-> URL hash. The permalink IS the recipe: opening it rebuilds the
   same sheet, the way block-showroom's `#i,j,height,gen` does.
   Form: `#r=<base64url of the recipe's JSON>`. Settings equal to the
   defaults are dropped to keep links short; normalize() puts them back. */
import { normalize, DEFAULT_RECIPE } from './schema.js';

const PREFIX = 'r=';

function toBase64Url(text){
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromBase64Url(s){
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}
const changed = (obj, defaults) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== defaults[k]) out[k] = v;
  return out;
};

/** @returns {string} a URL hash, including the leading '#' */
export function encode(recipe){
  const r = normalize(recipe);
  const compact = { f: r.format, g: changed(r.gen, DEFAULT_RECIPE.gen), s: changed(r.sheet, DEFAULT_RECIPE.sheet),
                    p: r.paletteSeed, c: r.seeds };
  if (Object.keys(r.overrides).length) compact.o = r.overrides;
  return '#' + PREFIX + toBase64Url(JSON.stringify(compact));
}

/** @param {string} hash  location.hash, with or without the '#'
 *  @returns {object | null} a normalized recipe, or null if the hash holds none
 *  @throws if the hash claims to be a recipe but cannot be read */
export function decode(hash){
  const h = String(hash || '').replace(/^#/, '');
  if (!h.startsWith(PREFIX)) return null;
  const c = JSON.parse(fromBase64Url(h.slice(PREFIX.length)));
  return normalize({ format: c.f, gen: c.g, sheet: c.s, paletteSeed: c.p, seeds: c.c, overrides: c.o });
}
