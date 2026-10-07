/* M6b: playback and export (newdesign.md §5.3). The atlas holds a slot per
   frame and drawAtlas(atlas, t), the shader's rule, must draw exactly
   sheetFrame(build, t) at every time t, which must be every sprite's own
   frame from a fresh generateFrames. A sheet over the on-screen cap holds
   every k-th frame, each still exact. The pruner's hash covers every frame.
   Every APNG frame equals the matching frame of the strip. The shader
   itself is checked in the browser (test/browser/animation.test.js). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize, cellSettings } from '../src/recipe/schema.js';
import { decode } from '../src/recipe/permalink.js';
import { generateFrames } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { rasterizeSheet, rasterizeSolo, rasterizePacked } from '../src/raster/rasterize.js';
import { packAtlas, updateAtlas, drawAtlas, slotOf } from '../src/raster/atlas.js';
import { encodeAPNG } from '../src/raster/png.js';
import { averageHash, hamming } from '../src/workshop/frame-hash.js';
import { toggleLock, rerollCell } from '../src/workshop/cells.js';
import { createTimeline, commit, prunePlan } from '../src/workshop/timeline.js';
import { createSpriteCache, cachedSprite, buildSheet, framePlan, frameIndex, atFrame, sheetFrame, sheetHash, sheetItems,
         ATLAS_CAP } from '../src/workshop/sheet.js';
import { decodePNG, decodeAPNG } from './browser/png.js';

const same = (a, b, msg) => {
  assert.equal(a.width, b.width, msg); assert.equal(a.height, b.height, msg);
  assert.ok(Buffer.from(a.data.buffer, a.data.byteOffset, a.data.byteLength)
              .equals(Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength)), msg);
};
const full = c => generateFrames(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc));
/* The sheet at time t from scratch: every cell's frame t mod T, from a
   full build of its animation. */
function fresh(r, t, scale = 1){
  const { cols, rows, spacing } = r.sheet;
  const items = r.seeds.map((_, i) => {
    const s = full(cellSettings(r, i));
    return { sprite: atFrame(s, t % s.T), col: i % cols, row: (i / cols) | 0 };
  });
  return rasterizeSheet(items, { cols, rows, cellW: r.gen.w, cellH: r.gen.h, spacing }, { scale });
}
const anim = (over = {}, sheet = {}) => normalize({ paletteSeed: 11, gen: { symmetry: 'none', frames: 8, ...over },
                                                    sheet: { cols: 4, rows: 3, spacing: 2, ...sheet } });

test('sheetFrame and the atlas draw every frame of every sprite, at every time', () => {
  const cache = createSpriteCache();
  const spin = anim({ frames: 12, motion: 'rot90 +1/4', drive: 'spin' });
  // a locked cell with 5 frames on an 8-frame sheet, and a locked still
  const mixed = normalize({ ...toggleLock(toggleLock(anim({ frames: 5, drive: 'drift', driveAmount: 2 }), 1), 6),
                            gen: { ...anim().gen, outline: true } });
  const still4 = normalize({ ...toggleLock(anim({ frames: 1 }), 2), gen: anim({ frames: 4, source: 'noise' }).gen });
  for (const [what, r, times] of [['spin', spin, [0, 1, 3, 4, 7, 11, 12, 25]],
                                   ['mixed loops', mixed, [0, 1, 4, 5, 7, 8, 13, 39, 40]],
                                   ['a locked still on a noise sheet', still4, [0, 1, 2, 3, 6]]]){
    const s = buildSheet(r, cache), atlas = packAtlas(s.sprites, s.layout);
    assert.equal(s.plan.stride, 1, `${what}: under the cap`);
    assert.equal(atlas.frames, s.plan.T, `${what}: a slot per frame`);
    same(drawAtlas(atlas), s.image, `${what}: frame 0 is the build's image`);
    for (const t of times){
      const want = fresh(r, t);
      same(sheetFrame(s, t), want, `${what}: sheetFrame at ${t}`);
      same(drawAtlas(atlas, t), want, `${what}: atlas at ${t}`);
    }
    same(sheetFrame(s, 2, 3), fresh(r, 2, 3), `${what}: at scale 3`);
  }
  assert.equal(framePlan(mixed).loop, 40, 'lcm(8, 5): every sprite is back at frame 0 after 40');
  assert.equal(framePlan(still4).loop, 4);
});

test('in-place atlas updates rewrite every frame of a changed cell', () => {
  const cache = createSpriteCache();
  let r = anim({ motion: 'id ~' }), s = buildSheet(r, cache), atlas = packAtlas(s.sprites, s.layout);
  const step = (next, expect, what) => {
    r = next; s = buildSheet(r, cache, s);
    const changed = updateAtlas(atlas, s.sprites, s.layout);
    if (expect === 'repack'){
      assert.equal(changed, null, `${what}: must repack`);
      atlas = packAtlas(s.sprites, s.layout);
    } else assert.equal(changed.length, expect, `${what}: cells rewritten`);
    for (const t of [0, 3, 6]) same(drawAtlas(atlas, t), fresh(r, t), `${what} at ${t}`);
  };
  step(rerollCell(r, 4, 999), 1, 'reroll one cell');
  step(normalize({ ...r, gen: { ...r.gen, driveAmount: 3 } }), 12, 'a new drive amount');
  step(normalize({ ...r, sheet: { ...r.sheet, fps: 20 } }), 0, 'fps is the player\'s, not new data');
  step(normalize({ ...r, gen: { ...r.gen, frames: 16 } }), 'repack', 'more frames per cell');
  step(normalize({ ...r, gen: { ...r.gen, frames: 1 } }), 'repack', 'back to a still');
  assert.equal(atlas.frames, 1);
  // cells' slots and palette rows never overlap
  s = buildSheet(anim({ frames: 7 }), cache); atlas = packAtlas(s.sprites, s.layout);
  const seen = new Set();
  for (let i = 0; i < atlas.count; i++) for (let j = 0; j < atlas.frames; j++){
    const { ax, ay } = slotOf(atlas, i, j);
    assert.ok(ax + atlas.slotW <= atlas.width && ay + atlas.slotH <= atlas.height, `slot ${i}.${j} inside`);
    seen.add(`${ax},${ay}`);
  }
  assert.equal(seen.size, atlas.count * 7);
});

test('over the on-screen cap, a sheet holds every k-th frame, each one exact', () => {
  // 50×50 sprites of 16×16 at 24 frames: 15.4M cells, so every 4th (3.8M)
  const r = normalize({ paletteSeed: 3, gen: { frames: 24, motion: 'mirror-x +1/2' }, sheet: { cols: 50, rows: 50 } });
  const plan = framePlan(r);
  assert.deepEqual({ ...plan }, { T: 24, loop: 24, stride: 4, frames: 6, cells: 6 * 2500 * 256, full: 24 * 2500 * 256 });
  assert.ok(plan.cells <= ATLAS_CAP && Math.ceil(24 / 3) * 2500 * 256 > ATLAS_CAP, 'the smallest stride that fits');
  // building it generates only the held frames: check a few cells against full builds
  const cache = createSpriteCache(), s = buildSheet(r, cache);
  for (const i of [0, 777, 2499]){
    const sp = s.sprites[i], want = full(cellSettings(r, i));
    assert.deepEqual(sp.times, [0, 4, 8, 12, 16, 20]);
    sp.frames.forEach((g, j) => assert.deepEqual(g, want.frames[4 * j], `cell ${i}, frame ${4 * j}`));
    assert.equal(sp.fit, null, 'no fit without every frame');
    for (const t of [0, 3, 4, 5, 23]) assert.equal(frameIndex(sp, t), Math.floor(t / 4));
  }
  // a still sheet is never thinned, whatever its size
  const big = normalize({ gen: { w: 64, h: 64 }, sheet: { cols: 50, rows: 50 } });
  assert.deepEqual({ ...framePlan(big) }, { T: 1, loop: 1, stride: 1, frames: 1, cells: 2500 * 4096, full: 2500 * 4096 });
  // nor is the default sheet at the most frames
  assert.equal(framePlan(normalize({ gen: { frames: 64 } })).stride, 1);
});

test('the sprite cache keys on the stride, and is capped in cells as well as sprites', () => {
  const cache = createSpriteCache(100, 17 * 256), gen = anim().gen;
  const a = cachedSprite(cache, 1, gen, 0), b = cachedSprite(cache, 1, gen, 0, 2);
  assert.equal(a.frames.length, 8); assert.equal(b.frames.length, 4);
  assert.notEqual(a, b);
  assert.equal(cachedSprite(cache, 1, anim({ frames: 1 }).gen, 0, 5).stride, 1, 'a still ignores the stride');
  assert.equal(cache.cells, 8 * 256 + 4 * 256 + 256);
  cachedSprite(cache, 2, gen, 0);                        // 21 frames of 256 cells > 17: a goes
  assert.equal(cache.map.size, 3);
  assert.equal(cache.cells, 4 * 256 + 256 + 8 * 256);
  cachedSprite(cache, 1, gen, 0, 2);
  assert.equal(cache.generated, 4, 'b survived');
});

test('the pruner hash covers every frame the sheet holds', () => {
  const cache = createSpriteCache();
  const still = buildSheet(anim({ frames: 1 }), cache);
  assert.deepEqual(sheetHash(still), averageHash(still.image), 'a still: the hash of its image, as before');
  // the drive is the identity at frame 0, so these differ only in later frames
  const one = buildSheet(anim({ driveAmount: 1 }), cache), three = buildSheet(anim({ driveAmount: 3 }), cache);
  same(one.image, three.image, 'the same frame 0');
  const h1 = sheetHash(one), h3 = sheetHash(three);
  assert.equal(h1.length, 16, 'two numbers per frame');
  assert.deepEqual(h1.slice(0, 2), h3.slice(0, 2));
  assert.deepEqual(h1.slice(6, 8), averageHash(sheetFrame(one, 3)));
  assert.ok(hamming(h1, h3) > 4, `later frames differ (${hamming(h1, h3)} bits)`);
  assert.equal(hamming(h1, h1), 0);
  assert.equal(hamming(h1, averageHash(one.image)), 64, 'a still and an animation are never alike');
  // so the pruner keeps an edit that changed only later frames
  const tl = createTimeline();
  tl.recording = true;
  const r = anim();
  commit(tl, r, { kind: 'start', now: 0, hash: h1 });
  commit(tl, normalize({ ...r, gen: { ...r.gen, driveAmount: 3 } }), { kind: 'set:gen.driveAmount', now: 1, hash: h3 });
  commit(tl, normalize({ ...r, gen: { ...r.gen, driveAmount: 3 }, sheet: { ...r.sheet, fps: 9 } }), { kind: 'set:sheet.fps', now: 2, hash: h3 });
  commit(tl, r, { kind: 'link', now: 3, hash: h1 });
  assert.deepEqual([...prunePlan(tl, 4)], [2], 'only the fps entry looks like its anchor');
});

test('APNG: every frame equals the matching frame of the strip', async () => {
  const cache = createSpriteCache();
  for (const [gen, scale, fps] of [[anim({ frames: 12, motion: 'rot90 +1/4', drive: 'spin', outline: true }).gen, 3, 8],
                                   [anim({ frames: 5, source: 'noise', w: 9, h: 7 }).gen, 1, 24],
                                   [anim({ frames: 2, mask: 'disc' }).gen, 4, 1]]){
    const s = cachedSprite(cache, 42, gen, 5), { w, h, T } = s;
    const strip = rasterizePacked(s.frames.map((_, j) => atFrame(s, j)), { cols: T, spacing: 0 }, { scale });
    const bytes = await encodeAPNG({ width: w * scale, height: h * scale, count: T, fps,
                                     frame: j => rasterizeSolo(atFrame(s, j), { scale }) });
    const apng = decodeAPNG(Buffer.from(bytes));
    assert.equal(apng.plays, 0, 'loops forever');
    assert.equal(apng.frames.length, T);
    apng.frames.forEach((f, j) => {
      assert.deepEqual([f.x, f.y, f.width, f.height, f.dispose, f.blend], [0, 0, w * scale, h * scale, 0, 0]);
      assert.deepEqual(f.delay, [1, fps]);
      const want = Buffer.alloc(w * scale * h * scale * 4);
      for (let y = 0; y < h * scale; y++)
        Buffer.from(strip.data.buffer).copy(want, y * w * scale * 4, ((y * strip.width) + j * w * scale) * 4,
                                            ((y * strip.width) + (j + 1) * w * scale) * 4);
      assert.ok(f.data.equals(want), `frame ${j} of ${T}`);
    });
    // a viewer without APNG shows the default image: frame 0
    assert.ok(decodePNG(Buffer.from(bytes)).data.equals(apng.frames[0].data));
  }
});

test('APNG of a sheet: frame t is the sheet at time t; one frame is a plain PNG', async () => {
  const cache = createSpriteCache();
  const r = normalize({ ...toggleLock(anim({ frames: 3 }), 0), gen: anim({ frames: 6, motion: 'id +1/2' }).gen });
  const s = buildSheet(r, cache), plan = framePlan(r), scale = 2;
  const size = { width: s.image.width * scale, height: s.image.height * scale };
  const bytes = await encodeAPNG({ ...size, count: plan.loop, fps: 8, frame: t => sheetFrame(s, t, scale) });
  const apng = decodeAPNG(Buffer.from(bytes));
  assert.equal(apng.frames.length, 6);
  apng.frames.forEach((f, t) => same({ ...size, data: f.data }, fresh(r, t, scale), `sheet frame ${t}`));

  const png = await encodeAPNG({ ...size, count: 1, fps: 8, frame: () => s.image.width && sheetFrame(s, 0, scale) });
  assert.throws(() => decodeAPNG(Buffer.from(png)), /no acTL/);
  same(decodePNG(Buffer.from(png)), fresh(r, 0, scale), 'a still PNG');
  await assert.rejects(encodeAPNG({ width: 3, height: 3, count: 2, fps: 8, frame: () => s.image }), /frame 0 is/);
});

test('test/smoke.md: the M6b links open the sheets the steps describe', () => {
  const md = readFileSync(new URL('./smoke.md', import.meta.url), 'utf8');
  const section = md.slice(md.indexOf('## Playback and export (M6b)'));
  const links = Object.fromEntries([...section.matchAll(/^\| ([KL]) \| .* <http:\/\/localhost:8000\/(#r=[\w-]+)> \|$/gm)]
    .map(([, k, hash]) => [k, decode(hash)]));
  assert.deepEqual(Object.keys(links), ['K', 'L']);
  assert.deepEqual({ ...framePlan(links.K) }, { T: 24, loop: 24, stride: 4, frames: 6, cells: 6 * 2500 * 256, full: 24 * 2500 * 256 });
  assert.equal(links.K.gen.motion, 'mirror-x +1/2');
  assert.equal(framePlan(links.L).loop, 40);
  assert.deepEqual(Object.keys(links.L.overrides), ['9'], 'cell 10');
  assert.deepEqual([links.L.overrides[9].gen.frames, links.L.overrides[9].gen.drive, links.L.overrides[9].gen.outline], [5, 'drift', true]);
  // step 78's link is link D (spin) with ?gl=0
  const d = section.match(/\?gl=0(#r=[\w-]+)>/)[1], D = md.slice(md.indexOf('## Animated sprites (M6a)')).match(/^\| D \| .* <http:\/\/localhost:8000\/(#r=[\w-]+)> \|$/m)[1];
  assert.equal(d, D);
});
