/* Regenerate test/golden.json from the REFERENCE app.
   For every fixture in test/fixtures.js, build the sprite with the
   reference generateSprite and store spriteDigest() under the fixture's name.
   The reference file's own hash is stored too, so a changed reference is
   caught by the tests rather than silently re-baselined.
   Run only when a change to output is intended, and say so in the commit. */
import { writeFileSync } from 'node:fs';
import { loadReference, referenceSource } from '../test/load-reference.js';
import { fixtureList, spriteDigest, fnv, PALETTE_SEED } from '../test/fixtures.js';

const ref = await loadReference();
const sprites = {};
for (const f of fixtureList())
  sprites[f.name] = spriteDigest(ref.generateSprite(f.seed, ref.toGen(f.cfg, PALETTE_SEED)));

const golden = {
  reference: fnv(new TextEncoder().encode(referenceSource())),
  count: Object.keys(sprites).length,
  sprites,
};

const url = new URL('../test/golden.json', import.meta.url);
// One fixture per line: diffs stay readable when a golden changes.
const lines = Object.entries(sprites).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
writeFileSync(url,
  `{\n  "reference": ${JSON.stringify(golden.reference)},\n  "count": ${golden.count},\n` +
  `  "sprites": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`wrote ${golden.count} goldens to test/golden.json (reference ${golden.reference})`);
