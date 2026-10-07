/* M3c: the collection and session files. A kept sprite re-renders exactly,
   forever; a saved session loads back as the same timeline and collection;
   an old session's collection matches the old app sprite for sprite. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keep, autoName, rename, remove, move, restore, normalizeItem, packGrid } from '../src/workshop/collection.js';
import { saveSession, readSession, SESSION_FORMAT } from '../src/workshop/session.js';
import { createTimeline, commit, goTo, setRecording, MAX_ENTRIES } from '../src/workshop/timeline.js';
import { setLock, isLocked } from '../src/workshop/cells.js';
import { normalize, cellSettings } from '../src/recipe/schema.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { rasterizePacked } from '../src/raster/rasterize.js';
import { loadReference } from './load-reference.js';
import { REFERENCE_CFG, spriteDigest } from './fixtures.js';

const ref = await loadReference();
const cellSprite = (r, i) => { const c = cellSettings(r, i); return generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)); };
const itemSprite = it => generateSprite(it.seed, it.gen, paletteFor(it.paletteSeed, it.gen.bpc));
const base = normalize({ paletteSeed: 77, sheet: { cols: 4, rows: 3 }, gen: { vary: false, formula: 'trefoil' } });
const withGen = (r, gen) => normalize({ ...r, gen: { ...r.gen, ...gen } });
const keepCell = (items, r, i, entry = 1) => keep(items, r, i, { recipeText: cellSprite(r, i).recipeText, entry, now: 1000 + i });

/* ---------------------------------------------------------- collection */
test('a kept sprite stores its cell exactly, and still renders the same after the sheet changes', () => {
  const locked = setLock(base, 6, true);
  const changed = withGen(locked, { symmetry: 'rot90', w: 12 });
  let { items, item } = keepCell([], changed, 6, 3);
  ({ items } = keepCell(items, changed, 5, 3));
  assert.deepEqual(spriteDigest(itemSprite(items[0])), spriteDigest(cellSprite(base, 6)), 'the locked cell, with its own settings');
  assert.deepEqual(spriteDigest(itemSprite(items[1])), spriteDigest(cellSprite(changed, 5)));
  assert.equal(item.gen.symmetry, 'mirror-x', 'a locked cell is kept with the settings it was locked with');
  assert.deepEqual(item.cell, [1, 2]);
  assert.equal(item.entry, 3);
  assert.deepEqual(items.map(i => i.id), [1, 2]);
});

test('auto-names follow the old app: formula·modulus, made unique', () => {
  assert.equal(autoName([], 'trefoil % 17 · stride 1 · off(0,0) · mask none · horizontal'), 'trefoil·17');
  const named = n => ({ name: n });
  assert.equal(autoName([named('trefoil·17')], 'trefoil % 17 · stride 1'), 'trefoil·17 (2)');
  assert.equal(autoName([named('trefoil·17'), named('trefoil·17 (2)')], 'trefoil % 17'), 'trefoil·17 (3)');
  assert.equal(autoName([], 'noise · cov 0.45 · CA · mask disc · quadrant'), 'noise');
  let items = [];
  for (const i of [0, 1, 2]) items = keepCell(items, base, i).items;
  assert.deepEqual(items.map(i => i.name), ['trefoil·17', 'trefoil·17 (2)', 'trefoil·17 (3)']);
});

test('rename, remove and drag-to-reorder return new lists', () => {
  let items = [];
  for (const i of [0, 1, 2, 3]) items = keepCell(items, base, i).items;
  const ids = list => list.map(i => i.id).join('');
  assert.equal(rename(items, 2, 'hero')[1].name, 'hero');
  assert.equal(items[1].name, 'trefoil·17 (2)', 'not mutated');
  assert.equal(ids(remove(items, 3)), '124');
  assert.equal(ids(move(items, 0, 3)), '2314', 'insert before the item at slot 3');
  assert.equal(ids(move(items, 3, 0)), '4123');
  assert.equal(ids(move(items, 1, 4)), '1342', 'slot 4 is the end');
  assert.equal(move(items, 1, 1), items, 'dropping on itself does nothing');
  assert.equal(move(items, 1, 2), items, 'nor just below itself');
  assert.equal(ids(remove(items, 1).concat(keepCell(remove(items, 1), base, 9).item)), '2345', 'ids never repeat a live one');
});

test('restore brings back the exact sprite at cell 0, unlocked, and keeps the sheet layout', () => {
  const { item } = keepCell([], withGen(base, { symmetry: 'dihedral', ncol: 6 }), 7);
  const now = setLock(withGen({ ...base, paletteSeed: 5 }, { w: 20 }), 0, true);
  const r = restore(now, item);
  assert.deepEqual(spriteDigest(cellSprite(r, 0)), spriteDigest(itemSprite(item)));
  assert.ok(!isLocked(r, 0));
  assert.equal(r.gen.symmetry, 'dihedral');
  assert.equal(r.paletteSeed, item.paletteSeed);
  assert.deepEqual(r.sheet, now.sheet);
  assert.deepEqual(r.seeds.slice(1), now.seeds.slice(1));
  assert.deepEqual(normalize(r), r, 'still a normal recipe');
});

test('the packed sheet: about square, cells sized to the largest sprite, palette-exact', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(packGrid), [
    { cols: 1, rows: 1 }, { cols: 2, rows: 1 }, { cols: 2, rows: 2 }, { cols: 2, rows: 2 }, { cols: 3, rows: 2 }, { cols: 4, rows: 3 }]);
  const a = generateSprite(1, withGen(base, { w: 9, h: 7 }).gen, paletteFor(1, 3));
  const b = generateSprite(2, withGen(base, { w: 16, h: 12 }).gen, paletteFor(2, 3));
  const img = rasterizePacked([a, b, a], { cols: 2, spacing: 1 }, { scale: 2 });
  assert.equal(img.width, 2 * (16 + 1) * 2);
  assert.equal(img.height, 2 * (12 + 1) * 2);
  const allowed = new Set([...a.colors, ...b.colors]);
  const hex = k => '#' + [0, 1, 2].map(j => img.data[k + j].toString(16).padStart(2, '0')).join('');
  for (let k = 0; k < img.data.length; k += 4) if (img.data[k + 3]) assert.ok(allowed.has(hex(k)));
  assert.throws(() => rasterizePacked([], { cols: 1, spacing: 0 }, { scale: 1 }), /nothing/);
});

/* ------------------------------------------------------------- sessions */
function workshop(){
  const tl = createTimeline();
  let r = base;
  commit(tl, r, { kind: 'start', label: 'session start', now: 0 });
  r = withGen(r, { symmetry: 'rot180' }); commit(tl, r, { kind: 'set:gen.symmetry', now: 1000 });
  r = setLock(r, 2, true);                commit(tl, r, { kind: 'lock', label: 'lock #3', now: 2000 });
  r = { ...r, seeds: r.seeds.map((s, i) => i === 2 ? s : (s ^ 0x55) >>> 0) };
  commit(tl, r, { kind: 'regenerate', label: 'new seeds, 1 locked kept', now: 3000 });
  tl.entries[1].keyframe = true;
  goTo(tl, 1);
  commit(tl, withGen(tl.entries[1].recipe, { ncol: 7 }), { kind: 'set:gen.ncol', now: 4000 });   // a branch
  let items = keepCell([], r, 2, 4).items;
  items = rename(keepCell(items, r, 0, 4).items, 2, 'my "hero"');
  return { tl, items };
}
const roundTrip = (tl, items, live) => readSession(JSON.stringify(saveSession(tl, items, live)));

test('a saved session loads back as the same timeline and collection', () => {
  const { tl, items } = workshop();
  tl.keysOnly = true;
  const file = saveSession(tl, items);
  assert.equal(file.format, SESSION_FORMAT);
  assert.equal(file.seedPool.length, 2, 'seed arrays are pooled: only the regenerate changed them');
  assert.equal(file.live, undefined, 'nothing unrecorded');
  const got = readSession(JSON.stringify(file));
  assert.equal(got.old, false);
  assert.deepEqual(got.notes, []);
  assert.equal(got.tl.entries.length, tl.entries.length);
  got.tl.entries.forEach((e, i) => {
    const want = tl.entries[i];
    for (const k of ['kind', 'label', 'ts', 'keyframe', 'from']) assert.equal(e[k], want[k], `entry ${i} ${k}`);
    assert.deepEqual(e.recipe, want.recipe, `entry ${i} recipe`);
  });
  assert.equal(got.tl.entries[4].from, 1, 'the branch pointer survives');
  for (const k of ['playhead', 'recording', 'keysOnly', 'dirty']) assert.equal(got.tl[k], tl[k], k);
  assert.deepEqual(got.items, items);
  assert.equal(got.items[1].name, 'my "hero"');
  assert.deepEqual(spriteDigest(itemSprite(got.items[0])), spriteDigest(cellSprite(tl.entries[3].recipe, 2)));
});

test('unrecorded edits (REC off) are saved and come back unrecorded', () => {
  const { tl, items } = workshop();
  setRecording(tl, false);
  const live = withGen(tl.entries[tl.playhead].recipe, { coverage: 0.8 });
  commit(tl, live, { kind: 'set:gen.coverage', now: 9000 });
  assert.ok(tl.dirty);
  const got = roundTrip(tl, items, live);
  assert.deepEqual(got.live, live);
  assert.ok(got.tl.dirty);
  assert.equal(got.tl.recording, false);
  assert.equal(got.tl.entries.length, tl.entries.length, 'the unrecorded sheet is not added to the log');
  setRecording(tl, true, live, { now: 9100 });
  assert.equal(roundTrip(tl, items, live).live, null, 'once recorded, there is nothing extra to save');
});

test('reading a session repairs what it can and rejects what it cannot', () => {
  const { tl, items } = workshop();
  const file = JSON.parse(JSON.stringify(saveSession(tl, items)));
  file.entries[3].from = 7;             // points forward: not allowed
  file.entries[2].recipe.gen.w = 999;   // out of range
  file.playhead = 99;
  file.collection[0].gen = { symmetry: 'nope' };
  delete file.collection[1].name;
  const got = readSession(file);
  assert.equal(got.tl.entries[3].from, 2, 'a bad branch pointer falls back to the entry before');
  assert.equal(got.tl.entries[2].recipe.gen.w, 64);
  assert.equal(got.tl.playhead, tl.entries.length - 1);
  assert.equal(got.items[0].gen.symmetry, 'mirror-x');
  assert.equal(got.items[1].name, 'sprite 2');
  assert.throws(() => readSession('{"format":"spritesnow/1"}'), /not a session file/);
  assert.throws(() => readSession({ format: SESSION_FORMAT, entries: [] }), /no timeline entries/);
  assert.throws(() => readSession({ format: SESSION_FORMAT, seedPool: [], entries: [{ recipe: { seeds: 0 } }] }), /has no seeds/);
  assert.throws(() => readSession('not json'));
});

test(`a session longer than ${MAX_ENTRIES} entries is trimmed, keyframes and branches kept`, () => {
  const tl = createTimeline();
  for (let k = 0; k < MAX_ENTRIES; k++) commit(tl, { ...base, paletteSeed: k }, { kind: 'palette', label: 'p' + k, now: k });
  tl.entries[0].keyframe = true;
  const file = saveSession(tl, []);
  file.entries.push({ ...file.entries[5], label: 'extra', from: 5 }, { ...file.entries[6], label: 'extra2', from: 400 });
  const got = readSession(file);
  assert.equal(got.tl.entries.length, MAX_ENTRIES);
  assert.equal(got.tl.entries[0].label, 'p0', 'keyframe kept');
  assert.equal(got.tl.entries[1].label, 'p3', 'the two oldest ordinary entries went');
  assert.equal(got.tl.entries.at(-2).from, 3, 'branch pointer remapped: index 5 is now 3');
  assert.equal(got.tl.entries.at(-1).from, MAX_ENTRIES - 2, 'and one pointing at the other extra entry');
  assert.ok(got.tl.entries.every((e, i) => e.from < i && e.from >= -1));
  assert.match(got.notes[0], /2 oldest entries dropped/);
});

/* An old app session, in the exact shape its "↓ Session" writes, with a
   collection: one item kept from a locked cell, one from an ordinary cell. */
test("an old v4 session loads with its collection, each kept sprite matching the old app's", () => {
  const cfg = { ...REFERENCE_CFG, cols: 2, rows: 1, spacing: 2, scale: 3, seamphase: 'global', matte: 'stage',
                symmetry: 'rot90', sw: 15, sh: 15 };
  const lockCfg = { ...cfg, symmetry: 'diagonal', source: 'noise', _paletteSeed: 0x1234 };
  const cells = { rows: 1, cols: 2, list: [{ seed: 11, locked: true, lockCfg }, { seed: 22, locked: false, lockCfg: null }] };
  const collection = [
    { id: 4, name: 'noise', seed: 11, cfg: lockCfg, frame: 2, from: [0, 0], ts: 5 },
    { id: 9, name: 'kept B', seed: 22, cfg: { ...cfg, _paletteSeed: 0xabc }, frame: 2, from: [0, 1], ts: 6 },
  ];
  const session = { format: 'sprite-gen-timeline', version: 4, playhead: 1, cellPool: [cells], collection, entries: [
    { key: 'regen', label: 'session start', ts: 1, bookmark: false, cfg, paletteSeed: 0xabc, cells: 0 },
    { key: 'lock', label: 'lock [0,0]', ts: 2, bookmark: true, cfg, paletteSeed: 0xabc, cells: 0 },
  ] };
  const got = readSession(JSON.stringify(session));
  assert.equal(got.old, true);
  assert.equal(got.tl.entries.length, 2);
  assert.equal(got.tl.playhead, 1);
  assert.ok(got.tl.entries[1].keyframe);
  assert.deepEqual(got.items.map(i => [i.id, i.name, i.entry, i.cell.join(',')]), [[1, 'noise', 2, '0,0'], [2, 'kept B', 2, '0,1']]);
  got.items.forEach((it, k) => {
    const old = collection[k];
    assert.equal(it.gen.fold, 1, 'kept sprites reproduce the old fold');
    assert.deepEqual(spriteDigest(itemSprite(it)), spriteDigest(ref.generateSprite(old.seed, ref.toGen(old.cfg, old.cfg._paletteSeed))),
                     `item ${k}`);
  });
  // and it saves and loads again in the new format, unchanged
  const again = roundTrip(got.tl, got.items);
  assert.deepEqual(again.items, got.items);
  assert.deepEqual(again.tl.entries.map(e => e.recipe), got.tl.entries.map(e => e.recipe));
});

test('normalizeItem fills a minimal item', () => {
  const it = normalizeItem({ seed: '12', gen: {} }, 3);
  assert.equal(it.id, 3); assert.equal(it.seed, 12); assert.equal(it.name, 'sprite 3');
  assert.deepEqual(it.cell, [0, 0]); assert.equal(it.gen.symmetry, 'mirror-x');
});
