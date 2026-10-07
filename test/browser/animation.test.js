/* M6b: playback in the page. At several frames, the WebGL2 view (the
   vertex shader picks each sprite's slot from u_frame) and the 2D path
   (handed sheetFrame's image) must show the same pixels, and different
   frames must look different. Playing uploads nothing. A sheet over the
   on-screen cap still matches, and says so. Exports are saved through the
   page's own buttons and decoded here: every APNG frame is the sheet or
   sprite at that time, and Chrome's own decoder (ImageDecoder) reads the
   same frames.

   Headless Chrome with software WebGL (SwiftShader), driven over the
   DevTools protocol; skipped when no Chrome is found. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, serveStatic, launchChrome } from './harness.js';
import { decodePNG, decodeAPNG } from './png.js';
import { normalize, cellSettings } from '../../src/recipe/schema.js';
import { encode } from '../../src/recipe/permalink.js';
import { toggleLock } from '../../src/workshop/cells.js';
import { generateFrames } from '../../src/core/generate.js';
import { paletteFor } from '../../src/core/palette.js';
import { rasterizeSheet, rasterizeSolo } from '../../src/raster/rasterize.js';
import { atFrame } from '../../src/workshop/sheet.js';

const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (SPRITESNOW_CHROME=/path/to/chrome to point at one, =0 to skip)';

const spin = normalize({ paletteSeed: 11, gen: { symmetry: 'none', frames: 12, motion: 'rot90 +1/4', drive: 'spin' },
                         sheet: { cols: 6, rows: 4, spacing: 2, scale: 3 } });
const RECIPES = {
  spin,
  // a locked 5-frame cell with an outline, on an 8-frame sheet
  mixed: normalize({ ...toggleLock(normalize({ paletteSeed: 4, gen: { frames: 5, drive: 'drift', driveAmount: 2, outline: true },
                                               sheet: { cols: 5, rows: 3, spacing: 1, scale: 4 } }), 7),
                     gen: { frames: 8, motion: 'mirror-x ~' } }),
  // over the on-screen cap: 50×50 sprites of 16×16 at 24 frames holds every 4th
  capped: normalize({ paletteSeed: 3, gen: { frames: 24, motion: 'mirror-x +1/2' }, sheet: { cols: 50, rows: 50, scale: 1 } }),
};
const TIMES = { spin: [0, 1, 4, 7, 11], mixed: [0, 3, 5, 6, 13], capped: [0, 5, 13] };

let server, browser, session, loads = 0, downloads;
const errors = [];

before(async () => {
  if (skip) return;
  server = await serveStatic();
  browser = await launchChrome(chrome);
  session = browser.session;
  session.ws.addEventListener('message', ({ data }) => {
    const m = JSON.parse(data);
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || 'exception');
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
      errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
  });
  downloads = mkdtempSync(join(tmpdir(), 'spritesnow-downloads-'));
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads });
});
after(async () => {
  await browser?.close();
  await server?.close();
  if (downloads) rmSync(downloads, { recursive: true, force: true });
});

async function load(hash, gl){
  await session.send('Page.navigate', { url: `${server.origin}/?gl=${gl ? 1 : 0}&load=${++loads}${hash}` });
  await session.waitFor(`window.spritesnow && document.getElementById('status').textContent.includes('built')`,
                        { timeout: 60000, label: 'the sheet to render' });
  await session.evaluate(`(spritesnow.player.pause(), true)`);
  return session.evaluate(`spritesnow.view.renderer`);
}
const frames = () => session.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
async function shot(t, view){
  await session.evaluate(`(spritesnow.view.setLocked([]), spritesnow.view.setSelection(-1), spritesnow.player.show(${t}), true)`);
  if (view) await session.evaluate(`(spritesnow.view.setView(${JSON.stringify(view)}), true)`);
  await frames();
  const clip = await session.evaluate(`(() => { const b = document.querySelector('#stage canvas').getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height, scale: 1 }; })()`);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip });
  return decodePNG(Buffer.from(data, 'base64'));
}
const differing = (a, b) => {
  let diff = 0;
  for (let k = 0; k < a.data.length; k += a.bpp)
    if (a.data[k] !== b.data[k] || a.data[k+1] !== b.data[k+1] || a.data[k+2] !== b.data[k+2]) diff++;
  return diff;
};
function compare(a, b, what){
  assert.equal(a.width, b.width, what); assert.equal(a.height, b.height, what);
  const diff = differing(a, b);
  assert.equal(diff, 0, `${what}: ${diff} of ${a.width * a.height} pixels differ between WebGL2 and 2D`);
}

for (const name of Object.keys(RECIPES)){
  test(`WebGL2 and 2D show the same pixels at every frame: ${name}`, { skip }, async () => {
    const hash = encode(RECIPES[name]), times = TIMES[name];
    // whole-number zooms: as fitted, then close in
    const view = name === 'capped' ? { x: -40, y: -60, s: 3 } : null;
    assert.equal(await load(hash, false), '2D');
    const flat = [];
    for (const t of times) flat.push(await shot(t, view));
    assert.equal(await load(hash, true), 'WebGL2');
    for (let i = 0; i < times.length; i++) compare(await shot(times[i], view), flat[i], `${name} at frame ${times[i]}`);
    for (let i = 1; i < times.length; i++)
      assert.ok(differing(flat[0], flat[i]) > 50, `${name}: frame ${times[i]} should differ from frame 0`);
  });
}

test('the playbar plays at sheet.fps, uploads nothing, and the status line names the cap', { skip }, async () => {
  assert.equal(await load(encode(normalize({ ...spin, sheet: { ...spin.sheet, fps: 20 } })), true), 'WebGL2');
  assert.equal(await session.evaluate(`document.getElementById('playbar').classList.contains('hidden')`), false);
  assert.equal(await session.evaluate(`document.getElementById('play').textContent`), '▶', 'paused by load()');
  await session.evaluate(`(spritesnow.player.show(0), true)`);
  assert.equal(await session.evaluate(`document.getElementById('frame-no').textContent`), '0 / 12');
  const before = await session.evaluate(`spritesnow.stats()`);
  await session.evaluate(`document.getElementById('play').click(), true`);
  const t0 = Date.now();
  await session.waitFor(`spritesnow.player.t >= 6`, { label: 'six frames played', timeout: 5000, interval: 20 });
  const ms = Date.now() - t0;
  assert.ok(ms > 200 && ms < 1500, `6 frames at 20 fps took ${ms} ms`);
  await session.evaluate(`document.getElementById('play').click(), true`);
  const after = await session.evaluate(`spritesnow.stats()`);
  assert.equal(after.builds, before.builds, 'no sheet rebuilt');
  assert.equal(after.full, before.full, 'no texture uploaded');
  assert.equal(after.cells, before.cells, 'no cell uploaded');
  assert.ok(after.draws > before.draws + 5, 'drawn');
  const t = await session.evaluate(`spritesnow.player.t`);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(await session.evaluate(`spritesnow.player.t`), t, 'paused');
  // , and . step; the scrubber shows the time
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: '.', text: '.' });
  assert.equal(await session.evaluate(`spritesnow.player.t`), (t + 1) % 12);
  assert.equal(await session.evaluate(`document.getElementById('scrub').value`), String((t + 1) % 12));

  // a still sheet has no playbar
  await load(encode(normalize({ paletteSeed: 1 })), true);
  assert.equal(await session.evaluate(`document.getElementById('playbar').classList.contains('hidden')`), true);

  await load(encode(RECIPES.capped), true);
  await session.evaluate(`(spritesnow.player.show(0), true)`);
  const status = await session.evaluate(`document.getElementById('status').textContent`);
  assert.match(status, /24 frames at 8 fps/);
  assert.match(status, /showing every 4th frame: all 24 would be 15M sprite cells, over the 4M on-screen cap/);
  assert.equal(await session.evaluate(`document.getElementById('frame-no').textContent`), '0 / 24 · every 4th');
});

/* Wait for one new file in the download folder. */
async function downloaded(prefix){
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline){
    const f = readdirSync(downloads).find(n => n.startsWith(prefix) && !n.endsWith('.crdownload'));
    if (f) return readFileSync(join(downloads, f));
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`no download starting ${prefix}`);
}

test('↓ Sheet APNG: frame t is the sheet at time t, as Node draws it', { skip }, async () => {
  const r = RECIPES.mixed;
  await load(encode(r), true);
  await session.evaluate(`[...document.querySelectorAll('#controls button')].find(b => b.textContent === '↓ Sheet APNG').click(), true`);
  const apng = decodeAPNG(await downloaded('spritesnow-sheet-5x3-40f'));
  assert.equal(apng.frames.length, 40, 'lcm(8, 5)');
  const { cols, rows, spacing, scale, fps } = r.sheet;
  const anims = r.seeds.map((_, i) => { const c = cellSettings(r, i); return generateFrames(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)); });
  for (const t of [0, 1, 5, 8, 39]){
    const want = rasterizeSheet(anims.map((s, i) => ({ sprite: atFrame(s, t % s.T), col: i % cols, row: (i / cols) | 0 })),
                                { cols, rows, cellW: r.gen.w, cellH: r.gen.h, spacing }, { scale });
    assert.ok(apng.frames[t].data.equals(Buffer.from(want.data.buffer)), `frame ${t}`);
    assert.deepEqual(apng.frames[t].delay, [1, fps]);
  }
});

test('the inspector: strip clicks show a frame; ↓ APNG matches ↓ Strip; Chrome decodes the APNG', { skip }, async () => {
  const r = spin;
  await load(encode(r), true);
  // select cell 2 from the page's own handler, then click strip frame 5
  await session.evaluate(`(() => { const b = document.getElementById('stage').getBoundingClientRect(), v = spritesnow.view.getView();
    const z = v.s * ${r.sheet.scale}, x = b.left + v.x + (2 * 18 + 8) * z, y = b.top + v.y + 8 * z;
    const ev = type => new PointerEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, pointerId: 1 });
    const stage = document.getElementById('stage');
    stage.dispatchEvent(ev('pointerdown')); stage.dispatchEvent(ev('pointerup')); return true; })()`);
  await session.waitFor(`document.querySelectorAll('#inspector .strip figure').length === 12`, { label: 'the strip' });
  await session.evaluate(`document.querySelectorAll('#inspector .strip figure')[5].click(), true`);
  assert.equal(await session.evaluate(`spritesnow.player.t`), 5);
  assert.equal(await session.evaluate(`[...document.querySelectorAll('#inspector .strip figure')].findIndex(f => f.classList.contains('now'))`), 5);

  const c = cellSettings(r, 2), s = generateFrames(c.seed, c.gen, paletteFor(c.paletteSeed, c.gen.bpc)), scale = r.sheet.scale;
  const button = text => session.evaluate(`[...document.querySelectorAll('#inspector button')].find(b => b.textContent === '${text}').click(), true`);
  const id = c.seed.toString(16);
  await button('↓ Strip');
  const strip = decodePNG(await downloaded(`spritesnow-${id}-strip`));
  await button('↓ APNG');
  const bytes = await downloaded(`spritesnow-${id}-12f`), apng = decodeAPNG(bytes);
  await button('↓ PNG');
  const one = decodePNG(await downloaded(`spritesnow-${id}-f5`));
  const W = s.w * scale, H = s.h * scale;
  assert.equal(strip.width, W * 12);
  apng.frames.forEach((f, j) => {
    const want = Buffer.alloc(W * H * 4);
    for (let y = 0; y < H; y++) strip.data.copy(want, y * W * 4, (y * strip.width + j * W) * 4, (y * strip.width + (j + 1) * W) * 4);
    assert.ok(f.data.equals(want), `APNG frame ${j} is strip frame ${j}`);
    assert.ok(f.data.equals(Buffer.from(rasterizeSolo(atFrame(s, j), { scale }).data.buffer)), `frame ${j} as Node draws it`);
  });
  assert.ok(one.data.equals(apng.frames[5].data), '↓ PNG is the frame shown');

  // Chrome's own APNG decoder reads 12 frames, each the strip's
  const decoded = await session.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}), ch => ch.charCodeAt(0));
    const dec = new ImageDecoder({ data: bytes, type: 'image/png' });
    await dec.tracks.ready;
    const n = dec.tracks.selectedTrack.frameCount, out = [];
    const cv = new OffscreenCanvas(${W}, ${H}), g = cv.getContext('2d');
    for (let i = 0; i < n; i++){
      const { image } = await dec.decode({ frameIndex: i });
      g.clearRect(0, 0, ${W}, ${H}); g.drawImage(image, 0, 0); image.close();
      out.push(Array.from(g.getImageData(0, 0, ${W}, ${H}).data));
    }
    return { n, repetition: dec.tracks.selectedTrack.repetitionCount, frames: out };
  })()`);
  assert.equal(decoded.n, 12);
  assert.equal(decoded.repetition, null, 'loops forever (ImageDecoder reports Infinity, which JSON carries as null)');
  decoded.frames.forEach((px, j) => {
    // compare opaque pixels exactly; Chrome may premultiply transparent ones
    const f = apng.frames[j].data;
    for (let k = 0; k < px.length; k += 4){
      if (f[k + 3] !== px[k + 3]) assert.fail(`Chrome frame ${j}: alpha differs at ${k / 4}`);
      if (f[k + 3] && (f[k] !== px[k] || f[k + 1] !== px[k + 1] || f[k + 2] !== px[k + 2]))
        assert.fail(`Chrome frame ${j}: colour differs at pixel ${k / 4}`);
    }
  });
});

test('no errors or warnings in the console', { skip }, () => {
  assert.deepEqual(errors, []);
});
