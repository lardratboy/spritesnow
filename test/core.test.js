/* M0–M1: the port against the reference, byte for byte. */
import { test } from 'node:test';

test.todo('M0: loadReference() returns the reference generator');
test.todo('M0: npm run golden writes a golden entry for every fixture');
test.todo('M1: mulberry32, FIELDS, MASKS and paletteFor match the reference');
test.todo('M1: generateSprite with fold:1 matches the golden for every fixture');
test.todo('M1: generateSprite with fold:2 matches the golden wherever the old fold was exact');
test.todo('M1: generateSprite is deterministic across calls');
