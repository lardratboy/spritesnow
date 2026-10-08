/* The address-bar toggle: off by default, so a session leaves one URL in
   the browser's history rather than one per change. Off, an opened link
   still loads, and its hash is cleared once the sheet changes; the URL
   button and U turn it on, and then the hash follows the recipe and the
   sheet survives a reload; the choice itself survives a reload.

   Headless Chrome, driven over the DevTools protocol; skipped when no
   Chrome is found. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { findChrome, serveStatic, launchChrome } from './harness.js';
import { encode } from '../../src/recipe/permalink.js';
import { normalize } from '../../src/recipe/schema.js';

const chrome = findChrome();
const skip = chrome ? false : 'no Chrome found (SPRITESNOW_CHROME=/path/to/chrome to point at one, =0 to skip)';

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
});
after(async () => {
  await browser?.close();
  await server?.close();
});

async function load(hash = ''){
  await session.send('Page.navigate', { url: `${server.origin}/?gl=0${hash}` });
  await session.waitFor(`window.spritesnow && document.getElementById('status').textContent.includes('built')`,
                        { timeout: 20000, label: 'the sheet to render' });
}
const state = () => session.evaluate(`({
  hash: location.hash, search: location.search,
  pressed: document.getElementById('url').getAttribute('aria-pressed'),
  saved: localStorage.getItem('spritesnow.url'),
})`);
const settle = () => new Promise(r => setTimeout(r, 400));     // past the hash's 250 ms pause
async function key(k){
  await session.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k });
  await session.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k });
}

test('the address bar follows the recipe only when the URL setting is on', { skip }, async () => {
  const link = encode(normalize({ paletteSeed: 11 }));
  await load(link);
  await settle();
  const opened = await state();
  assert.deepEqual([opened.pressed, opened.saved], ['false', null], 'off by default');
  assert.equal(opened.hash, link, 'an opened link stays while the sheet matches it');

  await key('r');
  await settle();
  const changed = await state();
  assert.equal(changed.hash, '', 'cleared once the sheet changes');
  assert.equal(changed.search, '?gl=0', 'the query is kept');
  await key('r');
  await settle();
  assert.equal((await state()).hash, '', 'and not written again');

  await session.evaluate(`(document.getElementById('url').click(), true)`);
  const on = await state();
  assert.deepEqual([on.pressed, on.saved], ['true', 'on']);
  assert.ok(on.hash.length > 3, 'written at once when turned on');
  await key('r');
  await settle();
  const followed = await state();
  assert.ok(followed.hash.length > 3 && followed.hash !== on.hash, 'follows a change');

  await load(followed.hash);
  await settle();
  const reloaded = await state();
  assert.deepEqual([reloaded.pressed, reloaded.hash], ['true', followed.hash], 'on, and the same sheet, after a reload');

  await key('u');
  const off = await state();
  assert.deepEqual([off.pressed, off.saved, off.hash], ['false', 'off', ''], 'U turns it off and clears the hash');
  await load();
  assert.equal((await state()).pressed, 'false', 'off survives a reload');
  assert.deepEqual(errors, []);
});
