/* The sheet on screen: pan, zoom, click to select a cell.
   Two canvases. Underneath, WebGL2 draws the sprites from their index atlas
   and palettes (ui/gl-sheet.js, M4b); pan and zoom only change uniforms.
   On top, a 2D canvas draws the selection and lock outlines. Without
   WebGL2, or for a sheet too big for the GPU's textures, the 2D canvas also
   draws the sheet image, as in M4a: the sheet at scale 1, smoothing off.
   Either way every sprite pixel stays a crisp block at any zoom, and at a
   whole-number zoom the two paths show the same pixels.
   The view multiplies its zoom by the recipe's scale, so nothing grows with
   scale² (newdesign.md §5.1). view.s is the zoom relative to the exported
   sheet, as before M4a. Outlines are drawn on the screen only, and never
   into exported pixels.
   The block grid (M5c) is drawn on the same 2D canvas, in device pixels:
   an edge at sheet x lands on the first device pixel whose centre shows
   sheet x or more, the rule both the shader and drawImage use, so it lines
   up with the sprite pixels on either path.
   Animation (M6b): setFrame(t) shows time t. The GPU picks every
   sprite's frame from the atlas; the 2D path is handed the sheet image
   for that frame. */
import { createGLSheet } from './gl-sheet.js';
import { blockEdges } from '../workshop/sheet.js';

/**
 * @param {HTMLElement} root
 * @param {{ onSelect:(index:number, mods:{shift:boolean, mod:boolean, alt:boolean}) => void, gl?:boolean }} handlers
 *        mod is ⌘ on a Mac, Ctrl elsewhere (either is accepted); alt is Option on a Mac.
 *        gl: false forces the 2D path.
 */
/* Edge opacity by tier, outer to inner; deeper tiers use the last. */
const GRID_ALPHA = [0.8, 0.5, 0.35];

export function mountSheetView(root, { onSelect, gl = true }){
  const glCanvas = document.createElement('canvas');
  let gpu = gl ? createGLSheet(glCanvas) : null;
  if (gpu){
    root.append(glCanvas);
    // a lost context (driver reset, too many tabs) falls back for good
    glCanvas.addEventListener('webglcontextlost', () => { gpu = null; onGPU = false; glCanvas.remove(); draw(); });
  }
  const canvas = document.createElement('canvas');
  root.append(canvas);
  const ctx = canvas.getContext('2d');
  let image = null, layout = null, scale = 1, selected = -1, locked = [], onGPU = false, frame = 0;
  let built = null, grid = false, edges = null;      // edges: blockEdges of the build, made when first drawn
  let view = { x: 0, y: 0, s: 1 }, sizeKey = '';

  const dpr = () => window.devicePixelRatio || 1;
  const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

  const zoom = () => view.s * scale;     // screen px per image px
  function draw(){
    const r = dpr(), z = zoom();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (gpu) gpu.draw(image && onGPU ? { x: r*view.x, y: r*view.y, zoom: r*z } : null);
    if (!image) return;
    ctx.setTransform(r*z, 0, 0, r*z, r*view.x, r*view.y);
    if (!onGPU){
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(image, 0, 0);
    }
    if (!layout) return;
    if (grid) drawGrid(r*view.x, r*view.y, r*z);
    const n = layout.cols * layout.rows;
    const box = (i, pad) => {
      const c = i % layout.cols, rw = (i / layout.cols) | 0;
      return [c*layout.outerW + layout.offX - pad, rw*layout.outerH + layout.offY - pad,
              layout.spriteW + 2*pad, layout.spriteH + 2*pad];
    };
    // locked cells: a solid outline and a corner tab
    ctx.strokeStyle = ctx.fillStyle = token('--bad', '#ef4444');
    ctx.lineWidth = 2.5 / z;
    for (const i of locked){
      if (i >= n) continue;
      const [x, y, w, h] = box(i, 2 / z);
      ctx.strokeRect(x, y, w, h);
      const t = Math.min(12 / z, w / 3);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + t, y); ctx.lineTo(x, y + t); ctx.closePath(); ctx.fill();
    }
    if (selected >= 0 && selected < n){
      ctx.strokeStyle = token('--accent', '#4f8cff');
      ctx.lineWidth = 2 / z;
      ctx.setLineDash([5 / z, 3 / z]);
      ctx.strokeRect(...box(selected, 5 / z));
      ctx.setLineDash([]);
    }
  }
  /* Tier block edges, deepest first so outer edges sit on top. Each depth
     is one path, so crossings within it are not blended twice. Lines are
     2 device px across the edge from a zoom of 8 device px per sheet px,
     else 1 px on the far side, so they cover little of the sprite. Below 1 device px per sheet px edges would
     merge, so none are drawn. */
  function drawGrid(x0, y0, Z){
    if (Z < 1 || !built) return;
    edges ??= blockEdges(built.sprites, built.layout);
    if (!edges.length) return;
    const at = (o, v) => Math.ceil(o + v * Z - 0.5);
    const lw = Z >= 8 ? 2 : 1, half = lw >> 1, W = canvas.width, H = canvas.height;
    const depths = new Map();
    for (const e of edges){
      const ex = at(x0, e.x), ey = at(y0, e.y);
      if (e.vertical){
        const y1 = at(y0, e.y + e.len);
        if (ex - half + lw <= 0 || ex - half >= W || y1 <= 0 || ey >= H) continue;
        add(depths, e.depth, ex - half, ey, lw, y1 - ey);
      } else {
        const x1 = at(x0, e.x + e.len);
        if (ey - half + lw <= 0 || ey - half >= H || x1 <= 0 || ex >= W) continue;
        add(depths, e.depth, ex, ey - half, x1 - ex, lw);
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = token('--grid', '#ff4fd8');
    for (const d of [...depths.keys()].sort((a, b) => b - a)){
      ctx.globalAlpha = GRID_ALPHA[Math.min(d, GRID_ALPHA.length) - 1];
      ctx.fill(depths.get(d));
    }
    ctx.restore();
  }
  function add(depths, d, x, y, w, h){
    if (!depths.has(d)) depths.set(d, new Path2D());
    depths.get(d).rect(x, y, w, h);
  }

  /* Whole device pixels, with a CSS size to match: a 567 px canvas
     stretched over a stage 566.625 px tall is resampled when composited. */
  function resize(){
    const r = dpr(), b = root.getBoundingClientRect();
    const w = Math.max(1, Math.floor(b.width * r)), h = Math.max(1, Math.floor(b.height * r));
    for (const c of [canvas, glCanvas]){ c.style.width = `${w / r}px`; c.style.height = `${h / r}px`; }
    canvas.width = w; canvas.height = h;
    gpu?.resize(w, h);
    draw();
  }
  /* The zoom that fits the whole sheet, so a sheet bigger than 20× the
     stage can still be fitted and zoomed out to. */
  const fitZoom = () => Math.min((root.clientWidth - 32) / (image.width * scale),
                                 (root.clientHeight - 32) / (image.height * scale));
  /** Fit the sheet in view, at a whole-number zoom when it fits at 1x or
   *  more, else at a whole number of screen px per sheet px when that fits,
   *  and on whole device pixels, so sprite pixels have sharp edges. */
  function fit(){
    if (!image) return;
    const s = fitZoom(), r = dpr();
    view.s = s >= 1 ? Math.floor(s) : s * scale >= 1 ? Math.floor(s * scale) / scale : Math.max(s, 1e-3);
    view.x = Math.round((root.clientWidth - image.width * zoom()) / 2 * r) / r;
    view.y = Math.round((root.clientHeight - image.height * zoom()) / 2 * r) / r;
    draw();
  }
  function zoomAt(factor, cx = root.clientWidth / 2, cy = root.clientHeight / 2){
    const lo = image ? Math.max(Math.min(0.05, fitZoom()), 1e-3) : 0.05;
    const s = Math.min(64, Math.max(lo, view.s * factor));
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
    const sx = (e.clientX - b.left - view.x) / zoom(), sy = (e.clientY - b.top - view.y) / zoom();
    const c = Math.floor(sx / layout.outerW), rw = Math.floor(sy / layout.outerH);
    // a click on a cell selects it; a click anywhere else clears the selection
    onSelect(c >= 0 && c < layout.cols && rw >= 0 && rw < layout.rows ? rw * layout.cols + c : -1,
             { shift: e.shiftKey, mod: e.metaKey || e.ctrlKey, alt: e.altKey });
  });
  // Ctrl-click on a Mac opens the context menu; on the sheet it locks instead
  root.addEventListener('contextmenu', e => { if (e.ctrlKey) e.preventDefault(); });

  return {
    /** @param {{sprites:object[], layout:{cols, rows, cellW, cellH, spacing}}} sheet  a build
     *         from workshop/sheet.js; the GPU path draws its sprites
     *  @param {HTMLCanvasElement} img  the same sheet at scale 1, for the 2D path
     *  @param {number} sheetScale  the recipe's scale: the view's zoom is multiplied by it */
    setSheet(sheet, img, sheetScale = 1){
      const { cols, rows, cellW, cellH, spacing } = sheet.layout;
      image = img; scale = sheetScale; built = sheet; edges = null;
      layout = { cols, rows, outerW: cellW + spacing, outerH: cellH + spacing,
                 offX: 0, offY: 0, spriteW: cellW, spriteH: cellH };
      onGPU = !!gpu && gpu.setSheet(sheet.sprites, sheet.layout);
      glCanvas.style.visibility = onGPU ? '' : 'hidden';
      const key = `${img.width}x${img.height}@${scale}`;
      if (key !== sizeKey){ sizeKey = key; fit(); } else draw();
    },
    /** 'WebGL2', or '2D' when WebGL2 is off, unavailable or the sheet is
     *  too big for the GPU's textures */
    get renderer(){ return onGPU ? 'WebGL2' : '2D'; },
    /** Show time t (M6b). @param {HTMLCanvasElement} [img]  the sheet at
     *  time t, scale 1, for the 2D path (it is not used on the GPU) */
    setFrame(t, img){
      frame = t;
      gpu?.setFrame(t);
      if (img) image = img;
      draw();
    },
    get frame(){ return frame; },
    /** The view for tests and the console: x, y in CSS px, s the zoom
     *  relative to the exported sheet. */
    getView: () => ({ ...view }),
    setView(v){ Object.assign(view, v); draw(); },
    stats: () => ({ renderer: onGPU ? 'WebGL2' : '2D', ...gpu?.stats }),
    setSelection(i){ selected = i; draw(); },
    /** Show or hide the tier block grid (M5c). A view setting, not part of
     *  the recipe. */
    setBlockGrid(on){ grid = !!on; draw(); },
    get blockGrid(){ return grid; },
    /** How many block edges the sheet has (0 when no sprite has tiers on). */
    blockEdgeCount(){ return built ? (edges ??= blockEdges(built.sprites, built.layout)).length : 0; },
    /** @param {number[]} indices  the locked cells */
    setLocked(indices){ locked = indices; draw(); },
    /** Draw again with the current CSS colours (after a theme change). */
    redraw: () => draw(),
    fit,
    zoom: f => zoomAt(f),
  };
}
