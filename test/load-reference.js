/* Load the reference app's generator into Node, unmodified.

   reference/symmetrical_sprite_generator.html is never edited. This takes
   the text of its <script> from the `utils` section marker up to the
   `render` section marker (utils, fields, symmetry folding, palette, sprite
   factory, state) and evaluates it in a fresh vm context. That section is
   pure apart from functions that are declared but never called here
   (defaultState and readUI read the DOM), so no DOM stub is needed.

   Slicing is by section marker, never by line number, so a reference that
   was somehow changed fails loudly here instead of loading the wrong code.
   test/core.test.js also pins the reference file's hash. */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

export const REFERENCE_URL = new URL('../reference/symmetrical_sprite_generator.html', import.meta.url);

const START = '/* ================================================================ utils */';
const END   = '/* =============================================================== render */';

/** The names the reference section defines that the port must match. */
export const REFERENCE_EXPORTS = [
  'mulberry32', 'popcount', 'digitSum', 'pascalMod',
  'FIELDS', 'FIELD_BY_ID', 'MASKS', 'MASK_BY_ID',
  'seedDims', 'fold',
  'rgbHex', 'hexRgb', 'lum', 'darken', 'paletteFor',
  'ODDS', 'generateSprite',
  'CFG_KEYS', 'toGen',
];

export function referenceSource(){
  return readFileSync(REFERENCE_URL, 'utf8');
}

let cached = null;

/** @returns {Promise<Record<string, any>>} the reference generator's functions and tables */
export async function loadReference(){
  if (cached) return cached;
  const html = referenceSource();
  const start = html.indexOf(START), end = html.indexOf(END);
  if (start < 0 || end < 0 || end < start)
    throw new Error('reference section markers not found: has reference/ been edited?');

  const code = '"use strict";\n' + html.slice(start, end) +
    `\n;({ ${REFERENCE_EXPORTS.join(', ')} });`;
  // console is passed through because toGen() warns on a bad custom expression.
  cached = vm.runInNewContext(code, { console }, { filename: 'reference/symmetrical_sprite_generator.html' });
  return cached;
}
