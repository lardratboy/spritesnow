/* Regenerate test/golden-tiers.json from the PORT (newdesign.md §5.2).
   Tiered sprites have no oracle: the old app had no tiers. So these
   goldens pin the port's own output from M5a on, for every fixture in
   test/fixtures.js tierFixtureList() (tier fields from M5b). `npm run golden` never touches them.
   Run only when a change to tiered output is intended, and say so in the
   commit. */
import { writeFileSync } from 'node:fs';
import { tierFixtureList, spriteDigest, PALETTE_SEED } from '../test/fixtures.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';

const sprites = {};
for (const f of tierFixtureList()){
  const s = generateSprite(f.seed, f.gen, paletteFor(PALETTE_SEED, f.gen.bpc));
  if (!s.tiers) throw new Error(`${f.name}: tiers are off`);
  if (f.gen.tierField && s.tierField !== f.gen.tierField) throw new Error(`${f.name}: the tier field is off`);
  sprites[f.name] = spriteDigest(s);
}

const url = new URL('../test/golden-tiers.json', import.meta.url);
const lines = Object.entries(sprites).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
writeFileSync(url, `{\n  "count": ${lines.length},\n  "sprites": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`wrote ${lines.length} tiered goldens to test/golden-tiers.json`);
