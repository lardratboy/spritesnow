/* The sheet on screen: pan, zoom, click to select a cell.
   The sheet image is drawn with smoothing off, so every sprite pixel stays
   a crisp block at any zoom. The selection and lock outlines are drawn
   here, on the screen only, and never into exported pixels. */

/**
 * @param {HTMLElement} root
 * @param {{ onSelect:(index:number, mods:{shift:boolean, mod:boolean}) => void }} handlers
 *        mod is ⌘ on a Mac, Ctrl elsewhere (either is accepted)
 */
export function mountSheetView(root, { onSelect }){
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  let image = null, layout = null, selected = -1, locked = [];
  let view = { x: 0, y: 0, s: 1 }, sizeKey = '';

  const dpr = () => window.devicePixelRatio || 1;
  const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  function draw(){
    const r = dpr();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!image) return;
    ctx.setTransform(r*view.s, 0, 0, r*view.s, r*view.x, r*view.y);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(image, 0, 0);
    if (!layout) return;
    const n = layout.cols * layout.rows;
    const box = (i, pad) => {
      const c = i % layout.cols, rw = (i / layout.cols) | 0;
      return [c*layout.outerW + layout.offX - pad, rw*layout.outerH + layout.offY - pad,
              layout.spriteW + 2*pad, layout.spriteH + 2*pad];
    };
    // locked cells: a solid outline and a corner tab
    ctx.strokeStyle = ctx.fillStyle = token('--bad', '#ef4444');
    ctx.lineWidth = 2.5 / view.s;
    for (const i of locked){
      if (i >= n) continue;
      const [x, y, w, h] = box(i, 2 / view.s);
      ctx.strokeRect(x, y, w, h);
      const t = Math.min(12 / view.s, w / 3);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + t, y); ctx.lineTo(x, y + t); ctx.closePath(); ctx.fill();
    }
    if (selected >= 0 && selected < n){
      ctx.strokeStyle = token('--accent', '#4f8cff');
      ctx.lineWidth = 2 / view.s;
      ctx.setLineDash([5 / view.s, 3 / view.s]);
      ctx.strokeRect(...box(selected, 5 / view.s));
      ctx.setLineDash([]);
    }
  }
  function resize(){
    const r = dpr();
    canvas.width = Math.max(1, Math.round(root.clientWidth * r));
    canvas.height = Math.max(1, Math.round(root.clientHeight * r));
    draw();
  }
  /** Fit the sheet in view, at a whole-number zoom when it fits at 1x or more. */
  function fit(){
    if (!image) return;
    const s = Math.min((root.clientWidth - 32) / image.width, (root.clientHeight - 32) / image.height);
    view.s = s >= 1 ? Math.floor(s) : Math.max(0.05, s);
    view.x = (root.clientWidth - image.width * view.s) / 2;
    view.y = (root.clientHeight - image.height * view.s) / 2;
    draw();
  }
  function zoomAt(factor, cx = root.clientWidth / 2, cy = root.clientHeight / 2){
    const s = Math.min(64, Math.max(0.05, view.s * factor));
    view.x = cx - (cx - view.x) * (s / view.s);
    view.y = cy - (cy - view.y) * (s / view.s);
    view.s = s;
    draw();
  }

  new ResizeObserver(resize).observe(root);
  root.addEventListener('wheel', e => {
    e.preventDefault();
    const b = root.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - b.left, e.clientY - b.top);
  }, { passive: false });

  let drag = null;
  root.addEventListener('pointerdown', e => {
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    root.setPointerCapture(e.pointerId);
  });
  root.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    draw();
  });
  root.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    if (!d || d.moved || !image || !layout) return;
    if (e.button !== 0 && !(e.button === 2 && e.ctrlKey)) return;   // some Mac browsers report Ctrl-click as button 2
    const b = root.getBoundingClientRect();
    const sx = (e.clientX - b.left - view.x) / view.s, sy = (e.clientY - b.top - view.y) / view.s;
    const c = Math.floor(sx / layout.outerW), rw = Math.floor(sy / layout.outerH);
    // a click on a cell selects it; a click anywhere else clears the selection
    onSelect(c >= 0 && c < layout.cols && rw >= 0 && rw < layout.rows ? rw * layout.cols + c : -1,
             { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey });
  });
  // Ctrl-click on a Mac opens the context menu; on the sheet it locks instead
  root.addEventListener('contextmenu', e => { if (e.ctrlKey) e.preventDefault(); });

  return {
    /** @param {HTMLCanvasElement} img  the sheet at 1 screen px per image px
     *  @param {{cols, rows, outerW, outerH, offX, offY, spriteW, spriteH}} lay  in image pixels */
    setImage(img, lay){
      image = img; layout = lay;
      const key = `${img.width}x${img.height}`;
      if (key !== sizeKey){ sizeKey = key; fit(); } else draw();
    },
    setSelection(i){ selected = i; draw(); },
    /** @param {number[]} indices  the locked cells */
    setLocked(indices){ locked = indices; draw(); },
    fit,
    zoom: f => zoomAt(f),
  };
}
