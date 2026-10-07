/* M0: load the reference app's generator into Node, unmodified.

   Approach: read reference/symmetrical_sprite_generator.html, take the
   generator section of its <script> (from the utils header through
   `toGen`), and evaluate it in a fresh function scope that returns
   { mulberry32, FIELDS, MASKS, seedDims, fold, paletteFor, generateSprite, toGen }.
   tools/measurements/foldcheck.js already does this for seedDims and fold.
   Slice the text by its section markers, never by line numbers.

   The reference is never edited. If a slice needs a DOM stub (it should
   not: the generator section is pure), add the stub here, not there. */

export async function loadReference(){
  throw new Error('not implemented: loadReference (M0)');
}
