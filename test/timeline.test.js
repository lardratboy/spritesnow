/* M3a: the timeline (mosprites-ng's take) and the pruner's frame hash.
   T1–T6 are NG's in-page timeline self-tests, ported unchanged in intent.
   `from` holds INDICES, so anything that shortens the log can silently
   corrupt the branch graph; these check it cannot. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimeline, commit, goTo, dropEntries, deleteEntry, prunePlan, markKeyframe, setRecording,
         appendEntries, visibleIndices, keyframeCount, diffLabel, MAX_ENTRIES, COALESCE_MS } from '../src/workshop/timeline.js';
import { averageHash, hamming } from '../src/workshop/frame-hash.js';
import { normalize, cellSettings } from '../src/recipe/schema.js';
import { importSession } from '../src/recipe/import-v4.js';
import { generateSprite } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { rasterizeSheet } from '../src/raster/rasterize.js';
import { REFERENCE_CFG } from './fixtures.js';

const base = normalize({ paletteSeed: 42 });
const withGen = (r, k, v) => normalize({ ...r, gen: { ...r.gen, [k]: v } });

/* A synthetic log, as NG's mk(): entry i branched from i-1, hash [i, 0]. */
function mk(n, keys = [], hashes = null, playhead = n - 1){
  const tl = createTimeline();
  tl.entries = Array.from({ length: n }, (_, i) => ({
    kind: 'set:gen.phase', label: 'e' + i, ts: i, recipe: base,
    keyframe: keys.includes(i), from: i - 1, hash: [hashes ? hashes[i] : i, 0],
  }));
  tl.playhead = playhead;
  return tl;
}
const labels = tl => tl.entries.map(e => e.label).join(',');

test('T1 removal remaps branch pointers past dropped ancestors', () => {
  const tl = mk(4, [], null, 3);
  assert.equal(dropEntries(tl, new Set([1, 2])), 2);
  assert.equal(tl.entries.length, 2);
  assert.equal(tl.entries[1].from, 0);
});

test('T2 the playhead survives removal, and the timeline never empties', () => {
  const a = mk(6, [], null, 3);
  dropEntries(a, new Set([2, 3, 4]));
  assert.equal(a.playhead, 1);
  assert.equal(a.entries[a.playhead].label, 'e1', 'falls back to the nearest earlier survivor');
  const b = mk(5, [], null, 4);
  dropEntries(b, new Set([0, 1, 2, 3, 4]));
  assert.equal(b.entries.length, 1);
  assert.equal(b.playhead, 0);
  assert.equal(deleteEntry(b, 0), 0, 'the only entry cannot be deleted');
});

test('T3 every surviving `from` points strictly backwards and in range', () => {
  const tl = mk(20, [], null, 19);
  dropEntries(tl, new Set([3, 4, 5, 11, 12]));
  assert.ok(tl.entries.every((e, i) => e.from < i && e.from >= -1), tl.entries.map(e => e.from).join(','));
});

test('T4 the pruner keeps run heads and never touches a keyframe', () => {
  const runs = mk(8, [], [0, 0, 0, 15, 15, 15, 255, 255], 0);
  assert.deepEqual([...prunePlan(runs, 0)].sort((a, b) => a - b), [1, 2, 4, 5]);
  const keyed = mk(6, [3], [0, 0, 0, 0, 0, 0], 0);
  const d = prunePlan(keyed, 0);
  assert.ok(!d.has(3) && !d.has(0) && !d.has(5));
  assert.deepEqual([...d].sort(), [1, 2, 4]);
  const ph = mk(5, [], [0, 0, 0, 0, 0], 2);
  assert.ok(!prunePlan(ph, 0).has(2), 'the playhead is never pruned');
});

test('T5 the pruner anchors on the last kept frame, so slow drift survives', () => {
  // each step is 2 bits from its predecessor: pairwise comparison at
  // threshold 3 would erase the ramp; anchoring on the last KEPT frame does not
  const tl = mk(6, [], [0, 3, 15, 63, 255, 1023], 0);
  assert.ok(prunePlan(tl, 3).size < 4);
});

test('T6 the evictor targets the oldest disposable frame, not index 0', () => {
  const tl = mk(6, [0, 1], null, 5);
  const victim = tl.entries.findIndex(e => !e.keyframe);
  dropEntries(tl, new Set([victim]));
  assert.equal(victim, 2);
  assert.equal(labels(tl), 'e0,e1,e3,e4,e5');
});

test('commit appends, labels the change, and skips a recipe identical to the playhead', () => {
  const tl = createTimeline();
  const e0 = commit(tl, base, { kind: 'start', label: 'session start', now: 0 });
  assert.equal(e0.from, -1);
  const r1 = withGen(base, 'symmetry', 'rot90');
  const e1 = commit(tl, r1, { kind: 'set:gen.symmetry', now: 5000 });
  assert.equal(e1.label, 'Symmetry mirror-x → rot90');
  assert.equal(e1.from, 0);
  assert.equal(commit(tl, normalize(r1), { kind: 'set:gen.symmetry', now: 9000 }), null, 'no change, no entry');
  assert.equal(tl.entries.length, 2);
  assert.equal(diffLabel(base, withGen(withGen(base, 'phase', 0.5), 'outline', true)), 'Phase 0.00 → 0.50 · Outline off → on');
});

test('a slider drag coalesces into one entry; a pause, another setting or a keyframe starts a new one', () => {
  const tl = createTimeline();
  commit(tl, base, { kind: 'start', now: 0 });
  let r = base;
  for (let k = 1; k <= 10; k++){
    r = withGen(r, 'phase', k / 20);
    commit(tl, r, { kind: 'set:gen.phase', now: 10000 + k * 50 });
  }
  assert.equal(tl.entries.length, 2, 'ten drag steps, one entry');
  assert.equal(tl.entries[1].recipe.gen.phase, 0.5);
  assert.equal(tl.entries[1].label, 'Phase 0.00 → 0.50', 'the label spans the whole drag');
  commit(tl, withGen(r, 'phase', 0.6), { kind: 'set:gen.phase', now: 10500 + COALESCE_MS });
  assert.equal(tl.entries.length, 3, 'after a pause');
  commit(tl, withGen(tl.entries[2].recipe, 'coverage', 0.5), { kind: 'set:gen.coverage', now: 10600 + COALESCE_MS });
  assert.equal(tl.entries.length, 4, 'another setting');
  tl.entries[3].keyframe = true;
  commit(tl, withGen(tl.entries[3].recipe, 'coverage', 0.6), { kind: 'set:gen.coverage', now: 10650 + COALESCE_MS });
  assert.equal(tl.entries.length, 5, 'a keyframe is never overwritten');
  assert.equal(commit(tl, base, { kind: 'regenerate', now: 10660 + COALESCE_MS }).kind, 'regenerate',
               'actions never coalesce');
});

test('editing from the past appends a branch at the end; nothing is truncated', () => {
  const tl = createTimeline();
  let r = base;
  for (let k = 0; k < 4; k++){ r = withGen(r, 'modulus', 20 + k); commit(tl, r, { kind: 'set:gen.modulus', now: k * 1000 }); }
  assert.equal(goTo(tl, 1), tl.entries[1].recipe);
  assert.equal(goTo(tl, 1), null, 'no move, no recipe');
  const b = commit(tl, withGen(tl.entries[1].recipe, 'w', 20), { kind: 'set:gen.w', now: 4100 });
  assert.equal(tl.entries.length, 5);
  assert.equal(b.from, 1, 'branched from the rewound entry');
  assert.equal(b.label, 'Width 16 → 20', 'labelled against its parent, not the last entry');
  assert.equal(tl.playhead, 4);
  // a drag right after rewinding is never folded into the old last entry
  goTo(tl, 0);
  commit(tl, withGen(tl.entries[0].recipe, 'w', 21), { kind: 'set:gen.w', now: 4200 });
  assert.equal(tl.entries.length, 6);
});

test('REC off: the log does not grow, dirty is set, and resuming records the live recipe', () => {
  const tl = createTimeline();
  commit(tl, base, { kind: 'start', now: 0 });
  setRecording(tl, false);
  const live = withGen(base, 'ncol', 7);
  assert.equal(commit(tl, live, { kind: 'set:gen.ncol', now: 1000 }), null);
  assert.equal(tl.entries.length, 1);
  assert.ok(tl.dirty);
  commit(tl, base, { kind: 'set:gen.ncol', now: 1100 });
  assert.ok(!tl.dirty, 'editing back to the playhead clears dirty');
  commit(tl, live, { kind: 'set:gen.ncol', now: 1200 });
  const e = setRecording(tl, true, live, { now: 2000 });
  assert.equal(e.label, 'resumed recording');
  assert.equal(tl.entries.length, 2);
  assert.ok(!tl.dirty);
});

test('◆ punches in unrecorded edits as a keyframe, otherwise toggles the playhead entry', () => {
  const tl = createTimeline();
  commit(tl, base, { kind: 'start', now: 0 });
  setRecording(tl, false);
  const live = withGen(base, 'bpc', 2);
  commit(tl, live, { kind: 'set:gen.bpc', now: 10 });
  const e = markKeyframe(tl, live, { now: 20 });
  assert.ok(e.keyframe);
  assert.equal(tl.entries.length, 2);
  assert.ok(!tl.recording, 'REC stays off');
  assert.equal(markKeyframe(tl, live, { now: 30 }), null);
  assert.ok(!tl.entries[1].keyframe, 'second press toggles the flag off');
  assert.equal(keyframeCount(tl), 0);
});

test('keys-only shows keyframes and the playhead, and hides nothing else from the log', () => {
  const tl = mk(6, [1, 4], null, 2);
  tl.keysOnly = true;
  assert.deepEqual(visibleIndices(tl), [1, 2, 4]);
  assert.equal(tl.entries.length, 6);
  tl.keysOnly = false;
  assert.equal(visibleIndices(tl).length, 6);
});

test(`the log holds at most ${MAX_ENTRIES} entries and keeps keyframes past the cap`, () => {
  const tl = createTimeline();
  let r = base;
  for (let k = 0; k < MAX_ENTRIES + 25; k++){
    r = { ...r, paletteSeed: k + 1 };   // a distinct recipe each time; no settings change, so no coalescing key
    commit(tl, r, { kind: 'palette', label: 'p' + k, now: k });
    if (k === 3) tl.entries[3].keyframe = true;
  }
  assert.equal(tl.entries.length, MAX_ENTRIES);
  assert.equal(tl.entries[0].label, 'p3', 'the keyframe outlived everything older than the newest 399');
  assert.equal(tl.playhead, MAX_ENTRIES - 1);
  assert.ok(tl.entries.every((e, i) => e.from < i && e.from >= -1));
});

/* ---------------------------------------------------------- frame hash */
function sheetImage(r){
  const { cols, rows, spacing, scale } = r.sheet;
  const items = r.seeds.map((_, i) => {
    const c = cellSettings(r, i);
    return { sprite: generateSprite(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)), col: i % cols, row: (i / cols) | 0 };
  });
  return rasterizeSheet(items, { cols, rows, cellW: r.gen.w, cellH: r.gen.h, spacing }, { scale });
}

test('averageHash: equal sheets hash equal; different sheets are far apart; tiny images work', () => {
  const r = normalize({ paletteSeed: 7, sheet: { cols: 4, rows: 3 } });
  const h = averageHash(sheetImage(r));
  assert.deepEqual(averageHash(sheetImage(normalize(r))), h);
  assert.equal(hamming(h, h), 0);
  const other = averageHash(sheetImage(normalize({ ...r, paletteSeed: 8, seeds: [] })));
  assert.ok(hamming(h, other) > 4, `distance ${hamming(h, other)}`);
  const left = { width: 2, height: 1, data: Uint8ClampedArray.of(255,255,255,255, 0,0,0,0) };
  const [lo, hi] = averageHash(left);
  assert.equal(lo, 0x0f0f0f0f, 'left half of every row is bright');
  assert.equal(hi, 0x0f0f0f0f);
});

/* ---------------------------------------------------------- old sessions */
test('an old v4 session loads as a whole timeline, keyframes (bookmarks) included', () => {
  const cells = { rows: 1, cols: 2, list: [{ seed: 1, locked: false, lockCfg: null }, { seed: 2, locked: false, lockCfg: null }] };
  const cfg = { ...REFERENCE_CFG, cols: 2, rows: 1 };
  const session = { format: 'sprite-gen-timeline', version: 4, playhead: 1, cellPool: [cells], collection: [], entries: [
    { key: 'regen', label: 'session start', ts: 1, bookmark: false, cfg, paletteSeed: 5, cells: 0 },
    { key: 'cfg:symmetry', label: 'Symmetry horizontal → rot90', ts: 2, bookmark: true, cfg: { ...cfg, symmetry: 'rot90' }, paletteSeed: 5, cells: 0 },
    { key: 'pal', label: 'shuffle palette', ts: 3, bookmark: false, cfg, paletteSeed: 6, cells: 0 },
  ] };
  const { entries, playhead } = importSession(session);
  const tl = createTimeline();
  commit(tl, base, { kind: 'start', now: 0 });
  appendEntries(tl, entries, playhead);
  assert.equal(tl.entries.length, 4, 'appended after the existing entry, which survives');
  assert.equal(tl.playhead, 2, "on the old session's playhead");
  assert.deepEqual(tl.entries.map(e => e.keyframe), [false, false, true, false]);
  assert.equal(tl.entries[2].label, 'Symmetry horizontal → rot90');
  assert.equal(tl.entries[2].recipe.gen.symmetry, 'rot90');
  assert.deepEqual(tl.entries.map(e => e.from), [-1, -1, 1, 2], 'the import starts a new root');
  assert.throws(() => appendEntries(tl, []), /at least one/);

  // the cap holds on import too, and keeps keyframes
  const big = mk(MAX_ENTRIES - 1, [0]);
  appendEntries(big, entries, 2);
  assert.equal(big.entries.length, MAX_ENTRIES);
  assert.equal(big.entries[0].label, 'e0', 'keyframe kept');
  assert.equal(big.entries[1].label, 'e3', 'the two oldest disposable entries went');
  assert.equal(big.entries[big.playhead].label, 'shuffle palette');
});
