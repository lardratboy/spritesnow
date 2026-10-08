/* The theme toggle: dark by default even when the OS prefers light; the
   ☀/☾ button and T switch it without a rebuild or a new
   permalink; the choice survives a reload; and the sheet view redraws its
   selection outline in the new accent colour.

   Headless Chrome, driven over the DevTools protocol; skipped when no
   Chrome is found. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveStatic, launchChrome } from './harness.js';

const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (SPRITESNOW_CHROME=/path/to/chrome to point at one, =0 to skip)';

const DARK_BG = 'rgb(13, 17, 23)', LIGHT_BG = 'rgb(246, 248, 250)';

let server, browser, session;
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
  // the OS asks for light: the app must still start dark
  await session.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function load(){
  await session.send('Page.navigate', { url: `${server.origin}/?gl=0` });
  await session.waitFor(`window.spritesnow && document.getElementById('status').textContent.includes('built')`,
                        { timeout: 20000, label: 'the sheet to render' });
}
const state = () => session.evaluate(`({
  theme: document.documentElement.dataset.theme ?? null,
  bg: getComputedStyle(document.body).backgroundColor,
  button: document.getElementById('theme').textContent,
  saved: localStorage.getItem('spritesnow.theme'),
  hash: location.hash,
  builds: spritesnow.stats().builds,
})`);
const frames = () => session.evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
/* How many pixels of the 2D overlay are the current --accent colour. */
const accentPixels = () => session.evaluate(`(() => {
  const c = document.querySelector('#stage canvas:last-of-type'), g = c.getContext('2d');
  const probe = document.createElement('canvas').getContext('2d');
  probe.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  probe.fillRect(0, 0, 1, 1);
  const [r0, g0, b0] = probe.getImageData(0, 0, 1, 1).data;
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] === r0 && d[i+1] === g0 && d[i+2] === b0 && d[i+3] === 255) n++;
  return n;
})()`);

test('dark by default, toggled by the button and T, remembered across reloads', { skip }, async () => {
  await load();
  await session.evaluate(`localStorage.removeItem('spritesnow.theme'), true`);
  await load();
  const start = await state();
  assert.equal(start.theme, null);
  assert.equal(start.bg, DARK_BG, 'dark although the OS prefers light');
  assert.equal(start.button, '☀');

  await session.evaluate(`spritesnow.view.setSelection(0), true`);
  await frames();
  const darkAccent = await accentPixels();
  assert.ok(darkAccent > 0, 'the selection outline is drawn in the dark accent');

  const before = await state();      // the hash is written after 'built' shows, so not `start`
  await session.evaluate(`document.getElementById('theme').click(), true`);
  await frames();
  const light = await state();
  assert.deepEqual([light.theme, light.bg, light.button, light.saved], ['light', LIGHT_BG, '☾', 'light']);
  assert.equal(light.hash, before.hash, 'the theme is not in the permalink');
  assert.equal(light.builds, before.builds, 'the theme rebuilds nothing');
  assert.ok(await accentPixels() > 0, 'the outline is redrawn in the light accent');

  await load();
  assert.equal((await state()).bg, LIGHT_BG, 'light survives a reload');

  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 't', text: 't' });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 't' });
  const back = await state();
  assert.deepEqual([back.theme, back.bg, back.button, back.saved], [null, DARK_BG, '☀', 'dark']);

  await load();
  assert.equal((await state()).bg, DARK_BG, 'dark survives a reload');
  assert.deepEqual(errors, []);
});
