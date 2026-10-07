/* Regenerate test/golden-frames.json from the PORT (newdesign.md §5.3).
   Animations have no oracle: the old app had none. So these goldens pin
   the port's own output from M6a on, for every fixture in test/fixtures.js
   frameFixtureList(). `npm run golden` and `npm run golden:tiers` never
   touch them. Run only when a change to animated output is intended, and
   say so in the commit. */
import { writeFileSync } from 'node:fs';
import { frameFixtureList, framesDigest, PALETTE_SEED } from '../test/fixtures.js';
import { generateFrames } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';

const sprites = {};
for (const f of frameFixtureList()){
  const s = generateFrames(f.seed, f.gen, paletteFor(PALETTE_SEED, f.gen.bpc));
  if (s.T !== f.gen.frames) throw new Error(`${f.name}: the animation is off`);
  if (f.gen.motion && !s.motion) throw new Error(`${f.name}: the motion is off`);
  if (f.gen.tiers && !s.tiers) throw new Error(`${f.name}: tiers are off`);
  sprites[f.name] = framesDigest(s);
}

const url = new URL('../test/golden-frames.json', import.meta.url);
const lines = Object.entries(sprites).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
writeFileSync(url, `{\n  "count": ${lines.length},\n  "sprites": {\n${lines.join(',\n')}\n  }\n}\n`);
console.log(`wrote ${lines.length} animated goldens to test/golden-frames.json`);
