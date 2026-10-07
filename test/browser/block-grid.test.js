/* M5c: the block grid lines up with the blocks. At whole-number zooms from
   1 to 16, with pans that are not multiples of anything, the pixels the
   grid changes are exactly those of its lines: from each block edge at
   sheet x, the device column x0 + x·zoom (2 px across the edge from zoom 8,
   else 1 px past it). The expected pixels are worked out here from the
   recipe alone, not from the view's code. The WebGL2 view and the 2D path
   (?gl=0) must change the same pixels.
   Also: the Blocks button and G toggle the grid without a rebuild, a
   timeline entry or a new permalink.

   Headless Chrome with software WebGL (SwiftShader), driven over the
   DevTools protocol; skipped when no Chrome is found. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveStatic, launchChrome } from './harness.js';
import { decodePNG } from './png.js';
import { normalize, cellSettings } from '../../src/recipe/schema.js';
import { encode } from '../../src/recipe/permalink.js';
import { tierState } from '../../src/core/tiers.js';
import { toggleLock } from '../../src/workshop/cells.js';

const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (SPRITESNOW_CHROME=/path/to/chrome to point at one, =0 to skip)';

const plain = normalize({ paletteSeed: 5, gen: { w: 12, h: 12 }, sheet: { cols: 6, rows: 4, spacing: 1, scale: 2 } });
const RECIPES = {
  // two tiers, the §5.2 example
  twoTiers: normalize({ paletteSeed: 1, gen: { symmetry: 'rot90', tiers: '4 / 4 mirror-x' } }),
  // three tiers (two depths of edges), spacing 3, scale 3
  threeTiers: normalize({ paletteSeed: 2, gen: { w: 32, h: 32, symmetry: 'dihedral', tiers: '2 / 4 mirror-x / 4 rot90' },
                          sheet: { cols: 5, rows: 3, spacing: 3, scale: 3 } }),
  // a rectangle with rectangular tiers
  rectangle: normalize({ paletteSeed: 3, gen: { w: 24, h: 16, tiers: '3x2 / 8 mirror-y' }, sheet: { cols: 6, rows: 5 } }),
  // a plain sheet with one locked tiered sprite, larger than its cell
  locked: normalize({ ...toggleLock(normalize({ ...plain, gen: { ...plain.gen, w: 16, h: 16, tiers: '2 / 2 / 4' } }), 8),
                      gen: plain.gen }),
};

/* The views: x, y in CSS (= device) px, and the zoom in device px per
   sheet px; view.s = zoom / scale. */
const VIEWS = [
  { x: 13, y: -7, zoom: 1 }, { x: 5, y: 3, zoom: 2 }, { x: -17, y: 11, zoom: 3 },
  { x: 21, y: -30, zoom: 4 }, { x: -123, y: -77, zoom: 7 },
  { x: -50, y: 9, zoom: 8 }, { x: -1234, y: -321, zoom: 16 },
];

let server, browser, session, loads = 0;
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
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function load(hash, gl){
  await session.send('Page.navigate', { url: `${server.origin}/?gl=${gl ? 1 : 0}&load=${++loads}${hash}` });
  await session.waitFor(`window.spritesnow && document.getElementById('status').textContent.includes('built')`,
                        { timeout: 20000, label: 'the sheet to render' });
  return session.evaluate(`spritesnow.view.renderer`);
}
const frames = () => session.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
async function shot(grid, view){
  // the toolbar floats over the stage, and would hide part of the grid
  await session.evaluate(`(document.getElementById('toolbar').style.visibility = 'hidden',
    spritesnow.view.setLocked([]), spritesnow.view.setSelection(-1),
    spritesnow.view.setView(${JSON.stringify(view)}), spritesnow.view.setBlockGrid(${grid}), true)`);
  await frames();
  const clip = await session.evaluate(`(() => { const b = document.querySelector('#stage canvas').getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height, scale: 1 }; })()`);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip });
  return decodePNG(Buffer.from(data, 'base64'));
}
/* The pixels that differ between two shots, as a bitmap. */
function changed(a, b){
  const out = new Uint8Array(a.width * a.height);
  for (let i = 0, k = 0; i < out.length; i++, k += a.bpp)
    out[i] = a.data[k] !== b.data[k] || a.data[k+1] !== b.data[k+1] || a.data[k+2] !== b.data[k+2] ? 1 : 0;
  return out;
}

/* Where the grid should be, in device px, from the recipe alone: each
   cell's sprite is centred in its cell (rounded down), and tier i >= 1's
   blocks meet on the multiples of its block size that are not multiples
   of tier i-1's. */
function expected(recipe, view, W, H){
  const out = new Uint8Array(W * H);
  const Z = view.zoom, lw = Z >= 8 ? 2 : 1, half = lw >> 1;
  const { cols, spacing } = recipe.sheet, cellW = recipe.gen.w, cellH = recipe.gen.h;
  const fill = (x0, y0, x1, y1) => {
    for (let y = Math.max(0, y0); y < Math.min(H, y1); y++)
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) out[y * W + x] = 1;
  };
  recipe.seeds.forEach((_, i) => {
    const g = cellSettings(recipe, i).gen, st = tierState(g);
    if (!st.on) return;
    const X = (i % cols) * (cellW + spacing) + Math.floor((cellW - g.w) / 2);
    const Y = Math.floor(i / cols) * (cellH + spacing) + Math.floor((cellH - g.h) / 2);
    const sx = v => view.x + (X + v) * Z, sy = v => view.y + (Y + v) * Z;
    let bw = g.w, bh = g.h;
    for (const t of st.tiers.slice(0, -1)){
      const ow = bw, oh = bh;
      bw /= t.rx; bh /= t.ry;
      for (let x = bw; x < g.w; x += bw) if (x % ow) fill(sx(x) - half, sy(0), sx(x) - half + lw, sy(g.h));
      for (let y = bh; y < g.h; y += bh) if (y % oh) fill(sx(0), sy(y) - half, sx(g.w), sy(y) - half + lw);
    }
  });
  return out;
}

for (const name of Object.keys(RECIPES)){
  test(`the block grid lines up with the blocks, in WebGL2 and in 2D: ${name}`, { skip }, async () => {
    const recipe = RECIPES[name], hash = encode(recipe), scale = recipe.sheet.scale;
    const masks = {};
    let seen = 0;
    for (const gl of [false, true]){
      assert.equal(await load(hash, gl), gl ? 'WebGL2' : '2D');
      masks[gl] = [];
      for (const v of VIEWS){
        const view = { x: v.x, y: v.y, s: v.zoom / scale };
        const off = await shot(false, view), on = await shot(true, view);
        const got = changed(off, on), want = expected(recipe, v, off.width, off.height);
        let stray = 0, hit = 0, total = 0;
        for (let i = 0; i < got.length; i++){
          if (got[i] && !want[i]) stray++;
          if (want[i]){ total++; hit += got[i]; }
        }
        const what = `${name}, ${gl ? 'WebGL2' : '2D'}, zoom ${v.zoom} at (${v.x}, ${v.y})`;
        seen += total;
        assert.equal(stray, 0, `${what}: ${stray} pixels changed off the expected lines`);
        // a sprite pixel already the grid's colour does not change
        assert.ok(hit >= total * 0.99, `${what}: ${hit} of ${total} line pixels changed`);
        masks[gl].push(got);
      }
    }
    assert.ok(seen > 0, `${name}: some edges are on screen`);
    VIEWS.forEach((v, i) => {
      const a = masks[false][i], b = masks[true][i];
      let diff = 0;
      for (let k = 0; k < a.length; k++) diff += a[k] !== b[k];
      assert.equal(diff, 0, `${name}, zoom ${v.zoom}: WebGL2 and 2D change different pixels (${diff})`);
    });
  });
}

test('Blocks and G toggle the grid with no rebuild, timeline entry or new permalink', { skip }, async () => {
  const hash = encode(RECIPES.twoTiers);
  assert.equal(await load(hash, true), 'WebGL2');
  await session.waitFor(`location.hash.length > 3`, { label: 'the permalink' });
  const before = await session.evaluate(`({ ...spritesnow.stats(), hash: location.hash,
    frames: document.querySelectorAll('#timeline .frame').length })`);
  assert.equal(await session.evaluate(`spritesnow.view.blockGrid`), false, 'off on load');
  assert.ok(await session.evaluate(`spritesnow.view.blockEdgeCount()`) > 0);
  await session.evaluate(`(document.getElementById('blocks').click(), true)`);
  assert.equal(await session.evaluate(`spritesnow.view.blockGrid`), true);
  assert.equal(await session.evaluate(`document.getElementById('blocks').getAttribute('aria-pressed')`), 'true');
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'g', text: 'g' });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'g' });
  assert.equal(await session.evaluate(`spritesnow.view.blockGrid`), false, 'G turns it off');
  assert.equal(await session.evaluate(`document.getElementById('blocks').getAttribute('aria-pressed')`), 'false');
  await new Promise(r => setTimeout(r, 400));     // past the permalink's 250 ms pause
  const after = await session.evaluate(`({ ...spritesnow.stats(), hash: location.hash,
    frames: document.querySelectorAll('#timeline .frame').length })`);
  assert.equal(after.builds, before.builds, 'no rebuild');
  assert.equal(after.full, before.full, 'no upload');
  assert.equal(after.hash, before.hash, 'the same permalink');
  assert.equal(after.frames, before.frames, 'no timeline entry');

  // a sheet with no tiers on says so when the grid is turned on
  await load(encode(normalize({ paletteSeed: 1 })), true);
  assert.equal(await session.evaluate(`spritesnow.view.blockEdgeCount()`), 0);
  await session.evaluate(`(document.getElementById('blocks').click(), true)`);
  assert.match(await session.evaluate(`document.getElementById('status').textContent`),
               /block grid on, but no sprite on the sheet has tiers on/);
});

test('the inspector lists each tier with its groups and free cells', { skip }, async () => {
  await load(encode(RECIPES.twoTiers), true);
  await session.evaluate(`(spritesnow.view.fit(), true)`);
  const text = await session.evaluate(`(() => {
    const b = document.getElementById('stage').getBoundingClientRect(), v = spritesnow.view.getView(), z = v.s * 4;
    const at = { clientX: b.left + v.x + 8 * z, clientY: b.top + v.y + 8 * z, button: 0, bubbles: true, pointerId: 1 };
    const stage = document.getElementById('stage');
    stage.dispatchEvent(new PointerEvent('pointerdown', at));
    stage.dispatchEvent(new PointerEvent('pointerup', at));
    return [...document.querySelectorAll('#inspector dt')].map(dt => dt.textContent + ': ' + dt.nextElementSibling.textContent);
  })()`);
  const row = k => text.find(t => t.startsWith(k + ': '));
  assert.equal(row('Tiers'), 'Tiers: 4 / 4 mirror-x');
  assert.equal(row('Tier 1'), 'Tier 1: 4×4 blocks of 4×4 · blocks C4 · pinwheel · copies C2 · rotate 180° · 64 free cells');
  assert.equal(row('Tier 2'), 'Tier 2: 4×4 cells · blocks D2 · both axis mirrors · copies D2 · both axis mirrors · 16 free cells');
  assert.equal(row('Free cells'), 'Free cells: 16 of 256 (64 without tiers)');
  assert.match(row('Symmetries'), /\(guaranteed 4\)/);
});

/* A sheet too big to fit at 1x (here 32×32 sprites at scale 4) fits at a
   whole number of screen px per sheet px, so its pixels stay sharp and the
   grid is drawn. Before M5c it was fitted at view.s = 0.05 whatever its size. */
test('a sheet too big for 1x fits at a whole-number zoom, and the grid shows', { skip }, async () => {
  const recipe = normalize({ paletteSeed: 1, gen: { w: 32, h: 32, tiers: '2 / 4 / 4' } });
  await load(encode(recipe), true);
  const { s, z, fits } = await session.evaluate(`(() => {
    const v = spritesnow.view.getView(), st = document.getElementById('stage');
    const img = { w: 8 * 34 * 4 * v.s, h: 6 * 34 * 4 * v.s };
    return { s: v.s, z: v.s * 4, fits: img.w <= st.clientWidth && img.h <= st.clientHeight };
  })()`);
  assert.ok(s < 1, `the sheet does not fit at 1x (s = ${s})`);
  assert.ok(Number.isInteger(z) && z >= 1, `zoom ${z} screen px per sheet px`);
  assert.ok(fits, 'the whole sheet is in view');
  const view = await session.evaluate(`spritesnow.view.getView()`);
  const off = await shot(false, view), on = await shot(true, view);
  assert.ok(changed(off, on).some(Boolean), 'the grid is drawn at the fitted zoom');
});

test('no errors or warnings in the console', { skip }, () => {
  assert.deepEqual(errors, []);
});
