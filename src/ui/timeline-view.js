/* The timeline strip under the sheet (mosprites-ng's #timeline): transport
   buttons, REC, ◆ keyframes, the keys-only filter, the pruner, and one
   thumbnail per entry. It only displays the timeline and reports clicks;
   main.js changes it, through the pure functions in workshop/timeline.js. */
import { prunePlan, visibleIndices, keyframeCount } from '../workshop/timeline.js';

const THUMB_W = 96, THUMB_H = 60;

/**
 * @param {HTMLElement} root
 * @param {{ onGoTo:(i:number) => void, onDelete:(i:number) => void, onPlay:() => void,
 *           onRec:() => void, onMark:() => void, onKeysOnly:() => void,
 *           onPrune:(threshold:number) => void }} handlers
 */
export function mountTimelineView(root, h){
  const thumbs = new WeakMap();      // entry -> its thumbnail canvas
  let tl = null, stripSig = '';

  const head = el('div', 'tl-head');
  const first = button('«', 'First entry (Home)', () => h.onGoTo(0));
  const prev = button('‹', 'Back one entry (←)', () => h.onGoTo(tl.playhead - 1));
  const play = button('▶', 'Replay the timeline (Space)', h.onPlay);
  const next = button('›', 'Forward one entry (→)', () => h.onGoTo(tl.playhead + 1));
  const last = button('»', 'Latest entry (End)', () => h.onGoTo(tl.entries.length - 1));
  const rec = button('REC', 'Record every edit. Off: edit freely, and press ◆ to keep the current state as a keyframe', h.onRec, 'rec');
  const mark = button('◇', 'Make this entry a keyframe (B)', h.onMark);
  const keys = button('◆ only', 'Show keyframes only', h.onKeysOnly);
  const prune = button('✂', 'Remove near-duplicate entries', () => setPruneOpen(pruneRow.classList.contains('hidden')));
  const pos = el('span', 'tl-pos');
  const label = el('span', 'tl-label');
  head.append(first, prev, play, next, last, rec, mark, keys, prune, pos, label);

  const pruneRow = el('div', 'tl-prune hidden');
  const thrLabel = el('label', null, 'Similarity ');
  const thr = el('input'); thr.type = 'range'; thr.min = 0; thr.max = 24; thr.step = 1; thr.value = 4;
  thr.title = 'How many of 64 hash bits two entries may differ by and still count as the same picture';
  const thrVal = el('span', 'val');
  thrLabel.append(thr, thrVal);
  const stat = el('span', 'tl-stat');
  const apply = button('Remove', 'Remove the entries counted here', () => h.onPrune(Number(thr.value)), 'danger');
  const close = button('Close', 'Close the pruner', () => setPruneOpen(false));
  pruneRow.append(thrLabel, stat, apply, close);
  thr.addEventListener('input', refreshPrune);

  const strip = el('div', 'tl-strip');
  strip.addEventListener('click', e => {
    const f = e.target.closest('.frame');
    if (!f) return;
    const i = Number(f.dataset.i);
    if (e.target.closest('.del')) h.onDelete(i); else h.onGoTo(i);
  });
  root.append(head, pruneRow, strip);

  function setPruneOpen(open){
    pruneRow.classList.toggle('hidden', !open);
    prune.classList.toggle('on', open);
    prune.setAttribute('aria-pressed', String(open));
    if (open) refreshPrune();
  }
  function refreshPrune(){
    if (!tl || pruneRow.classList.contains('hidden')) return;
    const t = Number(thr.value), n = prunePlan(tl, t).size, k = keyframeCount(tl);
    thrVal.textContent = String(t);
    stat.textContent = `removes ${n} of ${tl.entries.length}, leaving ${tl.entries.length - n}` +
      (k ? ` · ${k} keyframe${k > 1 ? 's' : ''} protected` : '') + (t === 0 ? ' · exact duplicates only' : '');
    apply.disabled = n === 0;
  }

  return {
    /** Draw `source` (the sheet canvas) as the thumbnail of `entry`. */
    thumb(entry, source){
      const c = thumbs.get(entry);
      if (c) return paint(c, source);
      thumbs.set(entry, paint(document.createElement('canvas'), source));
      stripSig = '';   // a new canvas has to be put in the strip
    },
    /** A thumbnail not yet tied to an entry (for imports). */
    makeThumb: source => paint(document.createElement('canvas'), source),
    setThumb(entry, canvas){ thumbs.set(entry, canvas); stripSig = ''; },

    /** Show the timeline's current state. @param {{playing:boolean}} state */
    refresh(timeline, { playing }){
      tl = timeline;
      const vis = visibleIndices(tl);
      // rebuild the strip only when which entries are shown has changed
      const sig = vis.join(',') + '|' + tl.entries.length;
      if (sig !== stripSig){
        strip.textContent = '';
        for (const i of vis){
          const f = el('div', 'frame'); f.dataset.i = i;
          const c = thumbs.get(tl.entries[i]);
          if (c) f.append(c); else f.append(el('div', 'blank'));
          f.append(el('span', 'idx', `#${i + 1}`), el('span', 'star'));
          const del = el('button', 'del', '✕'); del.type = 'button'; del.title = 'Remove this entry';
          f.append(del);
          strip.append(f);
        }
        stripSig = sig;
      }
      for (const f of strip.children){
        const i = Number(f.dataset.i), e = tl.entries[i];
        f.classList.toggle('cur', i === tl.playhead);
        f.classList.toggle('keyd', e.keyframe);
        f.title = `#${i + 1} · ${e.label}` + (e.from >= 0 && e.from !== i - 1 ? `  (branched from #${e.from + 1})` : '');
        f.querySelector('.star').textContent = e.keyframe ? '◆' : '';
      }

      const n = tl.entries.length, k = keyframeCount(tl), e = tl.entries[tl.playhead];
      pos.textContent = `${tl.playhead + 1} / ${n}` + (k ? ` · ${k}◆` : '');
      label.textContent = '';
      if (e){
        if (tl.playhead < n - 1) label.append(el('span', 'past', '◂ rewound'), ' · ');
        label.append(el('b', null, e.label));
        if (tl.playhead < n - 1) label.append(` · edits add #${n + 1}`);
        if (tl.dirty) label.append(' · ', el('span', 'dirty', '● unrecorded'), ', ◆ keeps it');
      }
      label.title = label.textContent;

      play.textContent = playing ? '❚❚' : '▶';
      play.classList.toggle('on', playing);
      rec.classList.toggle('on', tl.recording);
      rec.setAttribute('aria-pressed', String(tl.recording));
      mark.textContent = e && e.keyframe && !tl.dirty ? '◆' : '◇';
      mark.classList.toggle('on', !!(e && e.keyframe && !tl.dirty));
      keys.classList.toggle('on', tl.keysOnly);
      keys.setAttribute('aria-pressed', String(tl.keysOnly));
      first.disabled = prev.disabled = tl.playhead <= 0;
      next.disabled = last.disabled = tl.playhead >= n - 1;
      refreshPrune();

      const cur = strip.querySelector('.frame.cur');
      if (cur){
        // scroll the strip only, never the page (.tl-strip is the frames' offsetParent)
        const a = cur.offsetLeft, b = a + cur.offsetWidth;
        if (a < strip.scrollLeft) strip.scrollLeft = a - 8;
        else if (b > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = b - strip.clientWidth + 8;
      }
    },
  };
}

/* The sheet, letterboxed into a thumbnail at a whole-number zoom when it
   fits, so pixels stay crisp; smaller sheets are smoothed. */
function paint(c, source){
  c.width = THUMB_W; c.height = THUMB_H;
  const g = c.getContext('2d');
  g.clearRect(0, 0, THUMB_W, THUMB_H);
  const fit = Math.min(THUMB_W / source.width, THUMB_H / source.height);
  const k = fit >= 1 ? Math.floor(fit) : fit;
  g.imageSmoothingEnabled = k < 1;
  const w = source.width * k, h = source.height * k;
  g.drawImage(source, Math.floor((THUMB_W - w) / 2), Math.floor((THUMB_H - h) / 2), w, h);
  return c;
}

function el(tag, cls, text){
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function button(text, title, onClick, cls){
  const b = el('button', cls, text);
  b.type = 'button';
  b.title = title;
  b.addEventListener('click', onClick);
  return b;
}
