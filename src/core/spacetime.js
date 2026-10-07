/* Animated sprites: space-time groups (newdesign.md §5.3, M6a). Pure.
   From docs/from3Dto2D.md P7. An animation is a w×h×T volume whose frames
   are its slices, and a SPACE-TIME element (e, τ) acts on (x, y, t): e is a
   D4 element acting on every frame, τ acts on the frame number. The t axis
   wraps, so every animation loops by construction.

   A MOTION is a list of elements, written as text (gen.motion) so
   permalinks, sessions and timeline labels need no new machinery:
     ''                         off
     'rot90 +1/4'               spin: each quarter of the loop is the
                                previous quarter turned 90°
     'mirror-x +1/2, id ~'      elements separated by ', '
   Each element is a name, then a time action:
     +p/q   a shift, t -> t + p·T/q (mod T); q must divide T
     ~      a reversal, t -> -t (mod T)
     ~c     a reversal, t -> c - t (mod T)
   Names: id, mirror-x, mirror-y, mirror-diag, mirror-anti, rot180, rot90,
   rot270. rot90 is code 5, (U, V) -> (-V, U): with y pointing down, a
   clockwise quarter turn on screen (the turn of C4 · pinwheel's generator).
   rot270 is code 6. The spin drive turns the same way, so 'rot90 +1/4'
   matches spin with amount 1.

   THE TABLE. A motion changes only the orbit table, as tiers do. Each
   frame starts from that frame's ordinary table (or its tiered table when
   tiers are on); each motion element is a permutation of the volume, and
   orbits are joined with union-find. An orbit's representative is in its
   earliest frame, and within that frame it is the first ordinary
   representative in row-major order. So the seed volume is T copies of the
   ordinary seed rectangle, and frame 0's cells always read frame 0's seeds.

   DRIVES say how time enters the field (generate.js applies them). Each is
   the identity at t = 0, and none of them touches the RNG stream:
     phase   the threshold window slides through `amount` cycles per loop
     spin    frame t reads the field at cells turned by amount·t/T turns
             about the sprite's centre, in doubled coordinates, so a quarter
             turn is exact on any square grid
     drift   the offsets (ox, oy) travel round a circle of radius `amount`
   Angles come from turnCS, which uses only + − × ÷ (correctly rounded in
   every engine) and rounds to 1/65536, so frames are the same bytes in
   every browser; Math.cos and Math.sin are not specified that tightly. */
import { applyElement, groupIdOf, isReflection, orbitTable } from './groups2d.js';
import { cachedTieredTable, printTiers, tierState } from './tiers.js';

/* ------------------------------------------------------------- the text */

/** Element names and their D4 codes (groups2d.js). */
export const MOTION_ELEMENTS = Object.freeze({
  'id': 0, 'mirror-x': 1, 'mirror-y': 2, 'rot180': 3,
  'mirror-diag': 4, 'rot90': 5, 'rot270': 6, 'mirror-anti': 7,
});
const NAME_OF = Object.fromEntries(Object.entries(MOTION_ELEMENTS).map(([k, v]) => [v, k]));
export const MAX_ELEMENTS = 4;
export const MAX_FRAMES = 64;
export const DRIVES = ['phase', 'spin', 'drift'];

const gcd = (a, b) => { while (b){ [a, b] = [b, a % b]; } return a; };

/** @returns {{ motion: ({ e:number, name:string, shift:[number, number] } |
 *                       { e:number, name:string, reverse:number })[] | null,
 *              error: string|null }}
 *  shift [p, q] is reduced, 0 < p/q < 1; reverse is c in t -> c − t */
export function parseMotion(text){
  const s = String(text ?? '').trim();
  if (!s) return { motion: [], error: null };
  const fail = error => ({ motion: null, error });
  const parts = s.split(',');
  if (parts.length > MAX_ELEMENTS) return fail(`a motion has at most ${MAX_ELEMENTS} elements`);
  const motion = [];
  for (let i = 0; i < parts.length; i++){
    const n = `element ${i + 1}`;
    const tok = parts[i].trim().split(/\s+/).filter(Boolean);
    if (!tok.length) return fail(`${n} is empty`);
    const name = tok[0];
    if (!(name in MOTION_ELEMENTS)) return fail(`${n}: unknown element "${name}"`);
    if (tok.length < 2) return fail(`${n}: "${name}" needs a time action, such as +1/4 or ~`);
    if (tok.length > 2) return fail(`${n}: "${tok.slice(2).join(' ')}" is extra`);
    const e = MOTION_ELEMENTS[name], time = tok[1];
    let m;
    if ((m = /^\+(\d+)\/(\d+)$/.exec(time))){
      let p = +m[1], q = +m[2];
      if (!(p > 0 && p < q && q <= MAX_FRAMES)) return fail(`${n}: a shift +p/q needs 0 < p < q ≤ ${MAX_FRAMES}`);
      const g = gcd(p, q); p /= g; q /= g;
      motion.push({ e, name, shift: [p, q] });
    } else if ((m = /^~(\d*)$/.exec(time))){
      const c = m[1] === '' ? 0 : +m[1];
      if (c > 255) return fail(`${n}: a reversal ~c needs c ≤ 255`);
      motion.push({ e, name, reverse: c });
    } else return fail(`${n}: "${time}" is not a time action (+p/q shifts, ~ or ~c reverses)`);
  }
  return { motion, error: null };
}

/** The canonical text of a motion (parseMotion's inverse). */
export function printMotion(motion){
  return motion.map(m => `${NAME_OF[m.e]} ${m.shift ? `+${m.shift[0]}/${m.shift[1]}` : `~${m.reverse || ''}`}`).join(', ');
}

/** The canonical form of motion text, or the text unchanged (trimmed) if it
 *  cannot be read: like tiers, it stays in the recipe, switched off. */
export function canonicalMotion(text){
  const s = String(text ?? '').trim();
  const { motion, error } = parseMotion(s);
  return error ? s : printMotion(motion);
}

/** Whether a gen is animated: more than one frame, and the corrected fold.
 *  @returns {{ on:boolean, T:number, reason:string|null }}  T is 1 when off */
export function animState(gen){
  const T = gen.frames || 1;
  if (T <= 1) return { on: false, T: 1, reason: null };
  if (gen.fold !== 2) return { on: false, T: 1, reason: 'the old fold (v1) has no animation' };
  return { on: true, T, reason: null };
}

/** Whether a gen's motion is on, and if not, why not. A motion that does
 *  not fit stays in the recipe and is only off, as tiers are.
 *  @returns {{ on:boolean, motion:object[]|null, reason:string|null }}
 *  reason is null when on, or when gen.motion is empty */
export function motionState(gen){
  const text = gen.motion || '';
  if (!text.trim()) return { on: false, motion: [], reason: null };
  const { motion, error } = parseMotion(text);
  if (error) return { on: false, motion: null, reason: error };
  const anim = animState(gen);
  if (!anim.on) return { on: false, motion, reason: anim.reason || 'a still has no motion: set Frames above 1' };
  const T = anim.T;
  for (const m of motion){
    const label = printMotion([m]);
    if ((m.e & 4) && gen.w !== gen.h) return { on: false, motion, reason: `${label} needs a square sprite, this one is ${gen.w}×${gen.h}` };
    if (m.shift && T % m.shift[1]) return { on: false, motion, reason: `${label} needs a multiple of ${m.shift[1]} frames, not ${T}` };
  }
  return { on: true, motion, reason: null };
}

/* ------------------------------------------------------------ the table */

/** Where element m sends frame t. */
export function timeAct(m, t, T){
  return m.shift ? (t + m.shift[0] * T / m.shift[1]) % T : (((m.reverse - t) % T) + T) % T;
}

/** A motion element as a permutation of the w×h×T volume (cell t·w·h + y·w + x). */
export function motionPerm(m, w, h, T){
  const F = w * h, perm = new Int32Array(F * T), cell = new Int32Array(F);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
    const [ax, ay] = applyElement(m.e, x, y, w, h);
    cell[y*w + x] = ay*w + ax;
  }
  for (let t = 0; t < T; t++){
    const to = timeAct(m, t, T) * F;
    for (let c = 0; c < F; c++) perm[t*F + c] = to + cell[c];
  }
  return perm;
}

/**
 * The orbit table of an animation.
 * @param {string} symmetry   gen.symmetry (each frame's own group)
 * @param {object[]|null} tiers  parseTiers().tiers when tiers are on, else null
 * @param {object[]} motion   parseMotion().motion, already checked by motionState
 * @returns {{ T, F, sw, sh, S, rep:Int32Array, base:object, orbitCount:number,
 *             stillOrbits:number, freeFrames:number, frameFree:boolean[], frameGroups:string[],
 *             stillGroup:string, addsSymmetry:boolean }}
 *   rep[t·F + c]   the cell's representative, as t'·S + its seed cell in frame t'
 *                  (S = sw·sh), where t' is the earliest frame of its orbit
 *   base           the per-frame table (orbitTable at fold 2, or the tiered one)
 *   orbitCount     free cells over all frames; stillOrbits is base's count, so
 *                  T × stillOrbits is the count with no motion
 *   freeFrames     how many frames hold a representative; frameFree[t] says
 *                  whether frame t does (a frame that does not is all copies)
 *   frameGroups[t] the group frame t is guaranteed: every D4 element that
 *                  fits the grid and keeps each of the frame's orbits whole
 *   stillGroup     the same for one frame with no motion (base's orbits);
 *                  addsSymmetry is whether any frame's group is larger
 */
export function spaceTimeTable(symmetry, w, h, tiers, T, motion){
  const base = tiers ? cachedTieredTable(symmetry, w, h, tiers) : orbitTable(symmetry, w, h, 2);
  const { sw, sh } = base, S = sw * sh, F = w * h, N = F * T;
  const parent = new Int32Array(N);
  for (let i = 0; i < N; i++) parent[i] = i;
  const find = i => {
    while (parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const join = (a, b) => {
    a = find(a); b = find(b);
    if (a !== b) parent[a < b ? b : a] = a < b ? a : b;
  };
  // within a frame: each cell joins the cell its representative sits at
  const repCell = new Int32Array(F);
  for (let c = 0; c < F; c++){ const r = base.rep[c]; repCell[c] = ((r / sw) | 0) * w + r % sw; }
  for (let t = 0; t < T; t++) for (let c = 0; c < F; c++) join(t*F + c, t*F + repCell[c]);
  for (const m of motion){
    const perm = motionPerm(m, w, h, T);
    for (let i = 0; i < N; i++) join(i, perm[i]);
  }

  // representative: the earliest frame, then the first ordinary representative
  const best = new Int32Array(N).fill(-1);
  let orbitCount = 0;
  for (let t = 0; t < T; t++) for (let c = 0; c < F; c++){
    const root = find(t*F + c), r = t*S + base.rep[c];
    if (best[root] < 0){ best[root] = r; orbitCount++; }
    else if (r < best[root]) best[root] = r;
  }
  const rep = new Int32Array(N), free = new Uint8Array(T);
  for (let i = 0; i < N; i++){ rep[i] = best[find(i)]; free[(rep[i] / S) | 0] = 1; }

  const moved = [];
  for (let e = 1; e < 8; e++){
    if ((e & 4) && w !== h) continue;
    const to = new Int32Array(F);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
      const [ax, ay] = applyElement(e, x, y, w, h);
      to[y*w + x] = ay*w + ax;
    }
    moved.push([e, to]);
  }
  const groupOf = (r, o) => {
    const els = [0];
    for (const [e, to] of moved){
      let ok = true;
      for (let c = 0; c < F && ok; c++) if (r[o + to[c]] !== r[o + c]) ok = false;
      if (ok) els.push(e);
    }
    return groupIdOf(els);
  };
  const frameGroups = [];
  for (let t = 0; t < T; t++) frameGroups.push(groupOf(rep, t*F));
  const stillGroup = groupOf(base.rep, 0);
  return { T, F, sw, sh, S, rep, base, orbitCount, stillOrbits: base.orbitCount,
           freeFrames: free.reduce((a, b) => a + b, 0), frameFree: [...free].map(Boolean), frameGroups,
           stillGroup, addsSymmetry: frameGroups.some(g => g !== stillGroup) };
}

const tableCache = new Map();
/** spaceTimeTable, memoised on its arguments. */
export function cachedSpaceTimeTable(symmetry, w, h, tiers, T, motion){
  const key = `${symmetry}|${w}|${h}|${tiers ? printTiers(tiers) : ''}|${T}|${printMotion(motion)}`;
  let t = tableCache.get(key);
  if (!t){
    if (tableCache.size >= 16) tableCache.delete(tableCache.keys().next().value);
    t = spaceTimeTable(symmetry, w, h, tiers, T, motion);
    tableCache.set(key, t);
  }
  return t;
}

/** The table a gen's animation uses (its tiers if they are on, its motion
 *  if it is on), or null when the gen is not animated. */
export function animationTable(gen){
  const anim = animState(gen);
  if (!anim.on) return null;
  const tiered = tierState(gen), ms = motionState(gen);
  return cachedSpaceTimeTable(gen.symmetry, gen.w, gen.h, tiered.on ? tiered.tiers : null, anim.T,
                              ms.on ? ms.motion : []);
}

/* ------------------------------------------------------------ the drives */

const Q = 65536;
/** cos and sin of num/den of a turn, as integers rounded to 1/65536.
 *  Exact at every multiple of a quarter turn, and the same in every
 *  engine: the series uses only correctly rounded arithmetic.
 *  @returns {[number, number]} [round(65536·cos), round(65536·sin)] */
export function turnCS(num, den){
  const n = ((num % den) + den) % den;
  const quarter = Math.floor(4 * n / den), r = 4 * n - quarter * den;   // r/den of a quarter turn left
  let c = Q, s = 0;
  if (r){
    const flip = 2 * r > den;
    const a = ((flip ? den - r : r) / den) * (Math.PI / 2), a2 = a * a;   // 0 < a <= π/4
    const sin = a * (1 - a2/6 * (1 - a2/20 * (1 - a2/42 * (1 - a2/72 * (1 - a2/110 * (1 - a2/156))))));
    const cos = 1 - a2/2 * (1 - a2/12 * (1 - a2/30 * (1 - a2/56 * (1 - a2/90 * (1 - a2/132)))));
    c = Math.round((flip ? sin : cos) * Q);
    s = Math.round((flip ? cos : sin) * Q);
  }
  for (let k = 0; k < quarter; k++) [c, s] = [0 - s, c];   // 0 − s, so no −0
  return [c, s];
}

/**
 * A drive, as what it changes in frame t (t >= 1; frame 0 is the still).
 * @param {string} drive  'phase' | 'spin' | 'drift'
 * @param {number} amount gen.driveAmount
 * @param {object} p      the sprite's params (offsets ox, oy)
 * @returns {(t:number) => { shift?:number, turn?:(x, y) => [number, number], p?:object }}
 *   shift  added to the phase before the threshold (a fraction of a cycle)
 *   turn   the cell the field reads instead of (x, y)
 *   p      params with moved offsets
 */
export function makeDrive(drive, amount, w, h, T, p){
  switch (drive){
    case 'phase':
      return t => ({ shift: ((((amount * t) % T) + T) % T) / T });
    case 'spin':
      // frame t reads the cell turned back by amount·t/T turns, so the
      // picture turns forward, the way rot90 (code 5) does
      return t => {
        const [C, S] = turnCS(amount * t, T);
        return { turn(x, y){
          const U = 2*x - (w - 1), V = 2*y - (h - 1);
          return [Math.floor((U*C + V*S + w*Q) / (2*Q)), Math.floor((V*C - U*S + h*Q) / (2*Q))];
        } };
      };
    case 'drift':
      return t => {
        const [C, S] = turnCS(t, T);
        const dx = Math.floor((amount * C + Q/2) / Q) - amount, dy = Math.floor((amount * S + Q/2) / Q);
        return { p: { ...p, ox: p.ox + dx, oy: p.oy + dy } };
      };
  }
  throw new Error(`unknown drive: ${drive}`);
}

/* ------------------------------------------------------- drive suggestion */

const QUARTERS = { 0: 0, 5: 1, 3: 2, 6: 3 };   // rotations, in quarter turns of rot90's sense

/** Whether a drive already has a motion's symmetry, so the motion only
 *  corrects rounding. A shift by p/q of the loop must leave the phase drive
 *  unchanged (and the element must be id), or turn the spin drive by the
 *  element's own turn. Reversals and mirrors match no drive. */
export function driveMatches(motion, drive, amount){
  if (!motion.length || !amount) return false;
  for (const m of motion){
    if (!m.shift || isReflection(m.e)) return false;
    const [p, q] = m.shift, k = QUARTERS[m.e];
    if (drive === 'phase'){ if (k || (amount * p) % q) return false; }
    else if (drive === 'spin'){ if ((((4 * amount * p - k * q) % (4 * q)) + 4 * q) % (4 * q)) return false; }
    else return false;
  }
  return true;
}

/** The drive and amount that match a motion (driveMatches), with the
 *  smallest amount, positive first; the phase drive when the motion has no
 *  turn. null when no drive matches. */
export function suggestDrive(motion){
  for (const drive of ['phase', 'spin'])
    for (let a = 1; a <= 16; a++)
      for (const amount of [a, -a]) if (driveMatches(motion, drive, amount)) return { drive, amount };
  return null;
}
