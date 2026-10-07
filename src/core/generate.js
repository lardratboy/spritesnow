/* generateSprite: the pure core. Recipe in, sprite out.
   Ported from reference `generateSprite` (and the custom-expression part of
   `toGen`). The RNG is consumed in exactly the reference's order, because
   every draw shifts every later one: per-cell field/mask choice, params,
   colours, blob mask, then noise.

   The one structural change: the final symmetric copy goes through
   groups2d.orbitTable() (a cell -> seed-cell lookup) instead of the old
   fold() switch. With fold:1 the lookup IS the old fold, so output is byte
   identical to the reference; core.test.js holds every golden to that.
   With fold:2 the lookup is the group engine's: symmetric by construction,
   and identical to the reference wherever the old fold was correct.
   With gen.tiers on (fold:2 only), the lookup is the tiered one
   (core/tiers.js): fewer, larger orbits over the same seed region, so the
   RNG is consumed exactly as without tiers.
   gen.tierField (core/tierfields.js) changes what the base field sees at a
   cell, with constants hashed from the seed: the RNG stream, and so the
   colours and params, are the same with it on or off.

   generateFrames (M6a, newdesign.md §5.3) builds an animation from the same
   pieces: one seed rectangle per frame, then a copy through the space-time
   table (core/spacetime.js). Colours, params and the blob mask are drawn
   once, as for a still; the noise source then draws frame 0 (exactly the
   still's draws), then frames 1 to T−1, whatever the motion, so changing
   the motion never shifts the noise. generateSprite is unchanged, and an
   animation of one frame is the still. */
import { mulberry32 } from './rng.js';
import { FIELDS, FIELD_BY_ID } from './fields.js';
import { MASKS, MASK_BY_ID, blobMask } from './masks.js';
import { lum, darken } from './palette.js';
import { SUBGROUPS, orbitTable } from './groups2d.js';
import { tierState, cachedTieredTable, printTiers } from './tiers.js';
import { tierFieldState, makeTierField } from './tierfields.js';
import { animState, motionState, cachedSpaceTimeTable, makeDrive, printMotion } from './spacetime.js';

/** Moduli the per-cell "vary" option picks from. Order is part of every recipe. */
export const ODDS = [3,5,7,9,11,13,15,17,19,21,23,25,27,29,31,33,37,41,47,53];

/* Custom expressions compile once per source string. As in the reference, an
   expression that throws on a probe call is rejected (null), and generation
   then falls back to the recipe's named field. */
const exprCache = new Map();
export function compileExpr(expr){
  if (exprCache.has(expr)) return exprCache.get(expr);
  let fn = null;
  try {
    fn = new Function('x','y','u','v','w','h','P','return ('+expr+');');
    fn(0,0,1,1,8,8,{M:7,a:1,b:1,c:1,d:0,e:0});
  } catch (err) { fn = null; }
  if (exprCache.size > 64) exprCache.clear();
  exprCache.set(expr, fn);
  return fn;
}

/**
 * @param {number} seed  per-sprite uint32 seed
 * @param {object} gen   generator settings (recipe/schema.js DEFAULT_RECIPE.gen)
 * @param {string[]} palette  from palette.paletteFor()
 * @returns {{ grid:Uint8Array[], colors:string[], w:number, h:number,
 *             symmetry:string, effectiveSymmetry:string, fold:number,
 *             tiers:string, tierField:string, recipeText:string }}
 * effectiveSymmetry differs from symmetry when a non-square grid cannot
 * hold the whole group (newdesign.md D3); the UI must show it.
 * tiers is the canonical tier text when tiers are on, else ''; tierField
 * is the tier field's id when it is on, else ''.
 */
export function generateSprite(seed, gen, palette){
  const s = setup(seed, gen, palette);
  const seedGrid = seedFrame(s, null);
  const { w, h, table } = s;
  let grid = Array.from({length:h},()=>new Uint8Array(w));
  for(let y=0;y<h;y++) for(let x=0;x<w;x++){
    const r = table.rep[y*w + x];
    if(r >= 0) grid[y][x] = seedGrid[(r / s.sw) | 0][r % s.sw];
  }
  // The outline reads neighbours, which a block or copy action does not
  // keep, so with tiers an empty cell is outlined if any cell of its orbit
  // is. Without tiers every element keeps neighbours and this changes nothing.
  if (s.outlined) [grid] = outlineFrames([grid], s, s.tiered.on ? (t, c) => table.rep[c] : null, s.sw * s.sh);
  return { grid, colors: s.paint, w, h, symmetry: gen.symmetry, effectiveSymmetry: table.effective.id, fold: gen.fold,
           tiers: s.tierText, tierField: s.tf ? s.tf.id : '', recipeText: s.recipeText };
}

/**
 * An animation (newdesign.md §5.3): gen.frames frames, related by gen.motion,
 * with time entering the field through gen.drive.
 * @param {{ count?:number }} opts  build only frames 0 .. count−1 (they never
 *   depend on later frames, except through the outline when tiers are on,
 *   in which case every frame is built and the rest dropped)
 * @returns generateSprite's sprite, with grid = frame 0, plus
 *   { frames:Uint8Array[][], T:number, motion:string, drive:string, fit:number|null }
 *   T       the animation's frame count (1 when not animated; see animState)
 *   motion  the canonical motion text when it is on, else ''
 *   drive   'phase' | 'spin' | 'drift' when it acts (not for noise), else ''
 *   fit     with a motion on and every frame built: the fraction of cells the
 *           motion overrides, against the same drive with no motion; else null
 */
export function generateFrames(seed, gen, palette, { count } = {}){
  const anim = animState(gen);
  if (!anim.on){
    const still = generateSprite(seed, gen, palette);
    return { ...still, frames: [still.grid], T: 1, motion: '', drive: '', fit: null };
  }
  const T = anim.T, s = setup(seed, gen, palette), { w, h, sw, sh } = s;
  const ms = motionState(gen);
  const st = cachedSpaceTimeTable(gen.symmetry, w, h, s.tiered.on ? s.tiered.tiers : null, T, ms.on ? ms.motion : []);
  const want = count === undefined ? T : Math.max(1, Math.min(T, count | 0));
  const n = s.outlined && s.tiered.on ? T : want;
  const driven = gen.source !== 'noise';
  const drive = driven ? makeDrive(gen.drive, gen.driveAmount, w, h, T, s.p) : null;

  const seeds = [];
  for (let t = 0; t < n; t++) seeds.push(seedFrame(s, t && drive ? drive(t) : null));
  const S = sw * sh, F = w * h;
  const read = r => { const t = (r / S) | 0, k = r - t*S; return seeds[t][(k / sw) | 0][k % sw]; };
  let frames = [];
  for (let t = 0; t < n; t++){
    const grid = Array.from({length:h},()=>new Uint8Array(w));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y][x] = read(st.rep[t*F + y*w + x]);
    frames.push(grid);
  }
  // fit: the cells where the motion's copy differs from each frame's own seeds
  let fit = null;
  if (ms.on && n === T){
    let differ = 0;
    for (let t = 0; t < T; t++) for (let c = 0; c < F; c++)
      if (frames[t][(c / w) | 0][c % w] !== read(t*S + st.base.rep[c])) differ++;
    fit = differ / (T * F);
  }
  // The outline is drawn per frame. Motion elements keep neighbours; tiers
  // do not, so with tiers on an empty cell is outlined when any cell of its
  // space-time orbit is.
  if (s.outlined) frames = outlineFrames(frames, s, s.tiered.on ? (t, c) => st.rep[t*F + c] : null, T * S);
  frames = frames.slice(0, want);

  const motion = ms.on ? printMotion(ms.motion) : '';
  const tail = ` · frames ${T}` + (motion ? ` · motion ${motion}` : '') +
               (driven ? ` · drive ${gen.drive} ${gen.driveAmount}` : '');
  return { grid: frames[0], colors: s.paint, w, h, symmetry: gen.symmetry, effectiveSymmetry: s.table.effective.id,
           fold: gen.fold, tiers: s.tierText, tierField: s.tf ? s.tf.id : '', recipeText: s.recipeText + tail,
           frames, T, motion, drive: driven ? gen.drive : '', fit };
}

/* ------------------------------------------------------------- the pieces */

/** Everything drawn once per sprite, in the reference's RNG order: field
 *  and mask choice, params, colours, the blob mask. The returned rnd then
 *  continues with the noise. */
function setup(seed, gen, palette){
  const rnd = mulberry32(seed);
  const { w, h, symmetry, fold, ncol, source, formula:formulaId,
          modulus, vary, stride, mask:maskId, maskScale, maskInvert,
          outline, sortLum, expr, coverage, ca:useCA } = gen;
  const customFn = source === 'custom' ? compileExpr(expr) : null;
  const sym = SUBGROUPS.find(s => s.id === symmetry);
  const symLabel = sym && sym.legacy ? sym.legacy : symmetry;   // the reference's recipe text

  const tiered = tierState(gen);
  const table = tiered.on ? cachedTieredTable(symmetry, w, h, tiered.tiers) : orbitTable(symmetry, w, h, fold);
  const sw = table.sw, sh = table.sh;
  const tfState = tierFieldState(gen, tiered);
  const tf = tfState.on ? makeTierField(tfState.id, seed, tiered.tiers) : null;
  const pick = arr => arr[(rnd()*arr.length)|0];

  let fid = formulaId, M = modulus, st = stride, mid = maskId;
  if(source==='field' && vary){ fid = pick(FIELDS).id; M = pick(ODDS); st = 1 + ((rnd()*3)|0); }
  else if(source==='field' && fid==='mix') fid = pick(FIELDS).id;
  if(mid==='mix') mid = pick(MASKS.filter(m=>m.id!=='none')).id;

  const p = {
    M,
    ox: ((rnd()*17)|0) - 8,
    oy: ((rnd()*17)|0) - 8,
    a: ((rnd()*7)|0)-3 || 1, b: ((rnd()*7)|0)-3,
    c: ((rnd()*7)|0)-3 || 1, d: ((rnd()*11)|0)-5, e: ((rnd()*11)|0)-5,
  };

  const pool = [...palette];
  const colors = [];
  for(let i=0, n=Math.min(ncol,pool.length); i<n; i++)
    colors.push(pool.splice((rnd()*pool.length)|0,1)[0]);
  if(sortLum) colors.sort((a,b)=>lum(a)-lum(b));
  const nc = colors.length;

  /* mask */
  const maskFn = MASK_BY_ID[mid] ? MASK_BY_ID[mid].m : null;
  const blob = mid==='blob' ? blobMask(rnd, sw, sh) : null;
  const cxf=(w-1)/2, cyf=(h-1)/2;
  function inMask(sx,sy){
    if(mid==='none') return true;
    let ok;
    if(mid==='blob') ok = !!(blob[sy] && blob[sy][sx]);
    else ok = maskFn((sx-cxf)/(w/2), (sy-cyf)/(h/2), maskScale);
    return maskInvert ? !ok : ok;
  }

  const paint = [...colors];
  const outlined = !!(outline && nc>0);
  if(outlined) paint.push(darken(colors[0],0.32));

  const recipeText = source==='noise'
    ? `noise · cov ${coverage.toFixed(2)}${useCA?' · CA':''} · mask ${mid} · ${symLabel}`
    : `${source==='custom'?'custom':fid} % ${M} · stride ${st} · off(${p.ox},${p.oy})` +
      (fid==='conic' ? ` · [${p.a},${p.b},${p.c},${p.d},${p.e}]` : '') +
      ` · mask ${mid}${maskInvert?'⁻¹':''} · ${symLabel}`;
  const tierText = tiered.on ? printTiers(tiered.tiers) : '';

  return {
    rnd, gen, w, h, table, sw, sh, tiered, tf, M, st, p, nc, customFn, inMask, paint, outlined, tierText,
    field: FIELD_BY_ID[fid] || FIELD_BY_ID.circle,
    cx: Math.floor((w-1)/2), cy: Math.floor((h-1)/2),
    recipeText: (tierText ? `${recipeText} · tiers ${tierText}` : recipeText) + (tf ? ` · tier field ${tf.id}` : ''),
  };
}

const mod = (a, n) => ((a % n) + n) % n;

/** One frame's seed rectangle, in row-major order (noise draws from s.rnd).
 *  @param {null | { shift?, turn?, p? }} drive  what the drive changes in
 *    this frame (spacetime.makeDrive); null for the still, and for frame 0 */
function seedFrame(s, drive){
  const { rnd, gen, w, h, sw, sh, tf, M, st, nc, inMask, field, cx, cy } = s;
  const { coverage, ca:useCA, source, phase, colorMode } = gen;
  const seedGrid = Array.from({length:sh},()=>new Uint8Array(sw));

  if(source==='noise'){
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++)
      seedGrid[y][x] = rnd()<coverage ? 1 + ((rnd()*nc)|0) : 0;
    if(useCA){
      const out = Array.from({length:sh},()=>new Uint8Array(sw));
      for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){
        let n=0; const tally={};
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){
          if(!dx&&!dy) continue;
          const ax=x+dx, ay=y+dy;
          if(ax<0||ax>=sw||ay<0||ay>=sh) continue;
          const c=seedGrid[ay][ax];
          if(c>0){ n++; tally[c]=(tally[c]||0)+1; }
        }
        if(seedGrid[y][x]===0){
          if(n>=3){ let best=1,bc=0; for(const k in tally) if(tally[k]>bc){bc=tally[k];best=+k;} out[y][x]=best; }
        } else out[y][x] = n>=2 ? seedGrid[y][x] : 0;
      }
      for(let y=0;y<sh;y++) seedGrid[y].set(out[y]);
    }
  } else {
    const fn = (source==='custom' && s.customFn) ? s.customFn : null;
    const p = drive && drive.p ? drive.p : s.p;
    const turn = drive && drive.turn, shift = drive && drive.shift;
    for(let y=0;y<sh;y++) for(let x=0;x<sw;x++){
      // the spin drive turns the cell first; a tier field then reads it
      // wrapped into the sprite, with the wrap added back to its result
      let qx = x, qy = y, kx = 0, ky = 0;
      if(turn){
        [qx, qy] = turn(x, y);
        if(tf){ const wx = mod(qx, w), wy = mod(qy, h); kx = qx - wx; ky = qy - wy; qx = wx; qy = wy; }
      }
      let fx = qx, fy = qy, fp = p;
      if(tf){
        if(tf.map) [fx, fy] = tf.map(qx, qy);
        if(tf.params) fp = tf.params(qx, qy, p);
        fx += kx; fy += ky;
      }
      const u = (fx-cx)*st + fp.ox, v = (fy-cy)*st + fp.oy;
      let n;
      try { n = fn ? fn(fx,fy,u,v,w,h,fp) : field.f(u,v,fp); }
      catch(e){ n = u*u+v*v; }
      if(!Number.isFinite(n)) n = 0;
      n = Math.round(n);
      if(tf && tf.add) n += tf.add(qx, qy, M);
      const vm = ((n % M) + M) % M;
      const t = shift ? (vm/M + phase + shift) % 1 : (vm/M + phase) % 1;
      if(t >= coverage){ seedGrid[y][x]=0; continue; }
      seedGrid[y][x] = colorMode==='solid' ? 1
                     : colorMode==='cycle' ? 1 + (vm % nc)
                     : 1 + Math.min(nc-1, ((t/coverage)*nc)|0);
    }
  }

  for(let y=0;y<sh;y++) for(let x=0;x<sw;x++) if(!inMask(x,y)) seedGrid[y][x]=0;
  return seedGrid;
}

/** Outline every frame: an empty cell next to a filled one (4-neighbours)
 *  takes the outline colour. With keyOf(t, cell) (an orbit key below
 *  nKeys), an empty cell is also outlined when any cell of its orbit is. */
function outlineFrames(grids, s, keyOf, nKeys){
  const { w, h } = s, oi = s.paint.length;
  const outs = grids.map(grid => {
    const out = grid.map(r=>Uint8Array.from(r));
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){
      if(grid[y][x]) continue;
      if((x>0&&grid[y][x-1])||(x<w-1&&grid[y][x+1])||(y>0&&grid[y-1][x])||(y<h-1&&grid[y+1][x])) out[y][x]=oi;
    }
    return out;
  });
  if(keyOf){
    const lit = new Uint8Array(nKeys);
    outs.forEach((out, t) => { for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(out[y][x]===oi) lit[keyOf(t, y*w+x)] = 1; });
    outs.forEach((out, t) => {
      for(let y=0;y<h;y++) for(let x=0;x<w;x++) if(!grids[t][y][x] && lit[keyOf(t, y*w+x)]) out[y][x]=oi;
    });
  }
  return outs;
}
