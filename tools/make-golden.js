/* M0: regenerate test/golden.json from the REFERENCE app.
   For every (mode, size, seed, source) in test/fixtures.js: build the sprite
   with the reference generateSprite, then store fnv(grid bytes), fnv(colors)
   and the filled-cell count, keyed by a readable fixture name.
   Run only when a change to output is intended, and say so in the commit. */

console.error('not implemented: make-golden (M0)');
process.exit(1);
