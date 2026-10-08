/* M4b: what the page actually draws. The WebGL2 view and the 2D path
   (?gl=0) must show the same pixels at a whole-number zoom, for the same
   recipe and the same view. A mistake in a shader does not throw, it just
   draws the wrong thing, so the honest check is to compare screenshots.
   Also: pan and zoom rebuild and upload nothing, and a one-cell reroll
   uploads one cell and still matches the 2D path.

   Headless Chrome with software WebGL (SwiftShader), driven over the
   DevTools protocol; skipped when no Chrome is found. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveStatic, launchChrome } from './harness.js';
import { decodePNG } from './png.js';
import { normalize } from '../../src/recipe/schema.js';
import { encode } from '../../src/recipe/permalink.js';
import { toggleLock } from '../../src/workshop/cells.js';

const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (SPRITESNOW_CHROME=/path/to/chrome to point at one, =0 to skip)';

const RECIPES = {
  default: normalize({ paletteSeed: 11 }),
  // spacing, outlines (an extra colour), 16 colours, and a locked 16×16
  // sprite overlapping its 9×9 neighbours
  overlap: normalize({ ...toggleLock(normalize({ paletteSeed: 7, gen: { ncol: 16, bpc: 8, outline: true },
                                                 sheet: { cols: 7, rows: 5, spacing: 3, scale: 3 } }), 9),
                       gen: { ncol: 16, bpc: 8, outline: true, w: 9, h: 9 } }),
};
const scaleOf = name => RECIPES[name].sheet.scale;

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

/* A fresh page load (the query differs every time, so it is never just a
   hash change). Returns the renderer the page chose. */
async function load(hash, gl){
  await session.send('Page.navigate', { url: `${server.origin}/?gl=${gl ? 1 : 0}&load=${++loads}${hash}` });
  await session.waitFor(`window.spritesnow && document.getElementById('status').textContent.includes('built')`,
                        { timeout: 20000, label: 'the sheet to render' });
  return session.evaluate(`spritesnow.view.renderer`);
}
const frames = () => session.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
/* The sprites only: outlines are hidden. Over the GL canvas they are a
   separate layer, so their antialiased edges blend one level differently
   from outlines drawn into the 2D sheet canvas. */
async function shot(view){
  await session.evaluate(`(spritesnow.view.setLocked([]), spritesnow.view.setSelection(-1), true)`);
  if (view) await session.evaluate(`(spritesnow.view.setView(${JSON.stringify(view)}), true)`);
  await frames();
  // whole pixels: a fractional clip (the stage can be 566.625 px tall) is
  // resampled into the screenshot, which blends rows of sprite pixels
  const clip = await session.evaluate(`(() => { const b = document.querySelector('#stage canvas').getBoundingClientRect();
    return { x: b.left, y: b.top, width: b.width, height: b.height, scale: 1 }; })()`);
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', clip });
  return decodePNG(Buffer.from(data, 'base64'));
}
function compare(a, b, what){
  assert.equal(a.width, b.width, what); assert.equal(a.height, b.height, what);
  let diff = 0;
  for (let k = 0; k < a.data.length; k += a.bpp)
    if (a.data[k] !== b.data[k] || a.data[k+1] !== b.data[k+1] || a.data[k+2] !== b.data[k+2]) diff++;
  assert.equal(diff, 0, `${what}: ${diff} of ${a.width * a.height} pixels differ between WebGL2 and 2D`);
}
const colours = img => {
  const set = new Set();
  for (let k = 0; k < img.data.length; k += img.bpp) set.add((img.data[k] << 16) | (img.data[k+1] << 8) | img.data[k+2]);
  return set.size;
};

/* The views compared: as fitted on load, then two whole-number zooms, one
   far into the middle of the sheet. x, y are CSS px; s * scale is the zoom. */
const VIEWS = name => [
  null,
  { x: 13, y: -7, s: 7 / scaleOf(name) },
  { x: -1234, y: -321, s: 40 / scaleOf(name) },
];

for (const name of Object.keys(RECIPES)){
  test(`WebGL2 and 2D show the same pixels: ${name}`, { skip }, async () => {
    const hash = encode(RECIPES[name]), views = VIEWS(name);
    assert.equal(await load(hash, false), '2D');
    const flat = [];
    for (const v of views) flat.push(await shot(v));
    assert.equal(await load(hash, true), 'WebGL2', 'headless Chrome should have WebGL2 (SwiftShader)');
    for (let i = 0; i < views.length; i++){
      const gl = await shot(views[i]);
      compare(gl, flat[i], `${name}, view ${i}`);
      assert.ok(colours(gl) > 8, `${name}, view ${i}: the sheet should be on screen`);
    }
  });
}

test('pan and zoom rebuild and upload nothing; a reroll uploads one cell', { skip }, async () => {
  assert.equal(await load(encode(RECIPES.default), true), 'WebGL2');
  await frames();
  const before = await session.evaluate(`spritesnow.stats()`);
  const stage = await session.evaluate(`(() => { const b = document.getElementById('stage').getBoundingClientRect();
    return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
  const mouse = (type, x, y, extra = {}) => session.send('Input.dispatchMouseEvent', { type, x, y, ...extra });
  for (const deltaY of [-240, -240, 120]) await mouse('mouseWheel', stage.x, stage.y, { deltaX: 0, deltaY });
  await mouse('mousePressed', stage.x, stage.y, { button: 'left', clickCount: 1 });
  for (let i = 1; i <= 5; i++) await mouse('mouseMoved', stage.x + i * 20, stage.y + i * 9, { button: 'left' });
  await mouse('mouseReleased', stage.x + 100, stage.y + 45, { button: 'left', clickCount: 1 });
  await frames();
  const moved = await session.evaluate(`spritesnow.stats()`);
  assert.equal(moved.builds, before.builds, 'no sheet rebuilt');
  assert.equal(moved.full, before.full, 'no texture uploaded');
  assert.equal(moved.cells, before.cells, 'no cell uploaded');
  assert.ok(moved.draws >= before.draws + 4, `redrawn (${moved.draws - before.draws} draws)`);

  // Shift-click the first cell: one sprite generated, one cell uploaded
  await session.evaluate(`(document.getElementById('url').click(), true)`);   // the address bar follows the recipe
  await session.evaluate(`(spritesnow.view.fit(), true)`);
  await frames();
  const cell = await session.evaluate(`(() => { const b = document.getElementById('stage').getBoundingClientRect(), v = spritesnow.view.getView();
    const z = v.s * ${scaleOf('default')}; return { x: b.left + v.x + 8 * z, y: b.top + v.y + 8 * z }; })()`);
  await mouse('mousePressed', cell.x, cell.y, { button: 'left', clickCount: 1, modifiers: 8 });
  await mouse('mouseReleased', cell.x, cell.y, { button: 'left', clickCount: 1, modifiers: 8 });
  await session.waitFor(`document.getElementById('status').textContent.includes('1 generated')`, { label: 'the reroll' });
  const rerolled = await session.evaluate(`spritesnow.stats()`);
  assert.equal(rerolled.full, before.full, 'no full upload');
  assert.equal(rerolled.cells, before.cells + 1, 'one cell uploaded');
  const gl = await shot();
  // the permalink is written 250 ms after a change; the 2D path must agree
  const hash = await session.waitFor(`location.hash !== ${JSON.stringify(encode(RECIPES.default))} && location.hash`,
                                     { label: 'the new permalink' });
  const view = await session.evaluate(`spritesnow.view.getView()`);
  assert.equal(await load(hash, false), '2D');
  compare(gl, await shot(view), 'after a one-cell reroll');
});

test('no errors or warnings in the console', { skip }, () => {
  assert.deepEqual(errors, []);
});
