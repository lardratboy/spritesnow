/* M6a: animated sprites (newdesign.md §5.3). The space-time engine is
   checked against the still one (one frame is the still sprite, byte for
   byte, and so is frame 0 whenever the motion adds no symmetry to it),
   against the §5.3 table, and by brute force: every motion element keeps
   every animation, outlines and tiers included, and each frame's aut() is
   at least the order of the group reported for it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtureList, tierFixtureList, frameFixtureList, framesDigest, PALETTE_SEED, SEEDS } from './fixtures.js';
import { SUBGROUPS, groupById, applyElement, aut } from '../src/core/groups2d.js';
import { tierGenerators } from '../src/core/tiers.js';
import { mulberry32 } from '../src/core/rng.js';
import { generateSprite, generateFrames } from '../src/core/generate.js';
import { paletteFor } from '../src/core/palette.js';
import { spaceTimeTable, motionPerm, timeAct, turnCS, makeDrive, animationTable } from '../src/core/spacetime.js';
import { parseMotion, printMotion, canonicalMotion, motionState, animState, driveMatches, suggestDrive,
         MOTION_PRESETS, ELEMENT_CHOICES, TIME_CHOICES, frameGroupText, animationReadout } from '../src/recipe/motion.js';
import { parseTiers, printTiers, splitsOf, withSplit } from '../src/recipe/tiers.js';
import { normalize, DEFAULT_RECIPE } from '../src/recipe/schema.js';
import { genFromLegacyCfg } from '../src/recipe/import-v4.js';
import { encode, decode } from '../src/recipe/permalink.js';
import { createTimeline, commit } from '../src/workshop/timeline.js';
import { saveSession, readSession } from '../src/workshop/session.js';

const goldenFrames = JSON.parse(readFileSync(new URL('./golden-frames.json', import.meta.url), 'utf8'));
const pal = gen => paletteFor(PALETTE_SEED, gen.bpc);
const still = (seed, gen) => generateSprite(seed, gen, pal(gen));
const frames = (seed, gen, opts) => generateFrames(seed, gen, pal(gen), opts);
const anim = (over) => ({ ...DEFAULT_RECIPE.gen, frames: 16, ...over });
const sameGrid = (a, b) => a.length === b.length && a.every((row, y) => row.every((v, x) => v === b[y][x]));
const motion = text => parseMotion(text).motion;

/* ------------------------------------------------------------------ text */

test('parseMotion and printMotion round-trip, and canonicalise', () => {
  for (const s of ['rot90 +1/4', 'mirror-x +1/2', 'id ~', 'mirror-x ~3', 'id ~, mirror-y +1/2',
                   'rot270 +3/4, mirror-diag ~, mirror-anti +1/8, rot180 ~1'])
    assert.equal(printMotion(motion(s)), s);
  assert.deepEqual(motion('rot90 +1/4, id ~2'),
    [{ e: 5, name: 'rot90', shift: [1, 4] }, { e: 0, name: 'id', reverse: 2 }]);
  assert.equal(canonicalMotion('  rot180   +2/4 ,id ~0 '), 'rot180 +1/2, id ~');
  assert.equal(canonicalMotion(''), '');
  assert.deepEqual(parseMotion(''), { motion: [], error: null });
  for (const p of MOTION_PRESETS) assert.equal(canonicalMotion(p.motion), p.motion);
  for (const [e] of ELEMENT_CHOICES) for (const [t] of TIME_CHOICES)
    assert.equal(parseMotion(`${e} ${t}`).error, null, `${e} ${t}`);
});

test('parseMotion rejects what it cannot read, and says why', () => {
  const bad = {
    'spin +1/4': /unknown element "spin"/, 'rot90': /needs a time action/, 'rot90 +1/4 x': /"x" is extra/,
    'rot90 1/4': /not a time action/, 'rot90 +4/4': /0 < p < q/, 'rot90 +0/4': /0 < p < q/, 'rot90 +1/65': /0 < p < q/,
    'id ~256': /c ≤ 255/, 'id ~, ': /element 2 is empty/,
    'id ~, id ~, id ~, id ~, id ~': /at most 4 elements/,
  };
  for (const [s, re] of Object.entries(bad)){
    const p = parseMotion(s);
    assert.equal(p.motion, null, s);
    assert.match(p.error, re, s);
    assert.equal(canonicalMotion(s), s.trim(), `${s}: kept as written`);
  }
});

test('animState and motionState: on only when they fit; otherwise they say why', () => {
  assert.deepEqual(animState(DEFAULT_RECIPE.gen), { on: false, T: 1, reason: null });
  assert.deepEqual(animState(anim({})), { on: true, T: 16, reason: null });
  assert.match(animState(anim({ symmetry: 'quadrant', fold: 1 })).reason, /old fold/);
  assert.deepEqual(motionState(anim({ motion: '' })), { on: false, motion: [], reason: null });
  assert.equal(motionState(anim({ motion: 'rot90 +1/4' })).on, true);
  assert.match(motionState({ ...DEFAULT_RECIPE.gen, motion: 'rot90 +1/4' }).reason, /a still has no motion/);
  assert.match(motionState(anim({ motion: 'rot90 +1/4', symmetry: 'quadrant', fold: 1 })).reason, /old fold/);
  assert.equal(motionState(anim({ motion: 'rot90 +1/4', frames: 6 })).reason, 'rot90 +1/4 needs a multiple of 4 frames, not 6');
  assert.equal(motionState(anim({ motion: 'mirror-diag ~', h: 12 })).reason, 'mirror-diag ~ needs a square sprite, this one is 16×12');
  assert.equal(motionState(anim({ motion: 'mirror-y +1/2', h: 12 })).on, true);
  assert.match(motionState(anim({ motion: 'rot90 +1' })).reason, /not a time action/);
});

test('normalize: the animation keys, with defaults that make a still', () => {
  const d = normalize({}).gen;
  assert.deepEqual([d.frames, d.motion, d.drive, d.driveAmount], [1, '', 'phase', 1]);
  const r = normalize({ gen: { frames: 99, motion: 'rot90 +2/8', drive: 'wobble', driveAmount: -40 } }).gen;
  assert.deepEqual([r.frames, r.motion, r.drive, r.driveAmount], [64, 'rot90 +1/4', 'phase', -16]);
  // a motion that does not fit is kept, and is on again when it fits
  const six = normalize({ gen: { frames: 6, motion: 'rot90 +1/4' } });
  assert.equal(six.gen.motion, 'rot90 +1/4');
  assert.equal(motionState(six.gen).on, false);
  assert.equal(motionState(normalize({ ...six, gen: { ...six.gen, frames: 8 } }).gen).on, true);
});

/* ------------------------------------------------- still sprites unchanged */

test('one frame is the still: generateFrames equals generateSprite on every fixture', () => {
  const gens = [
    ...fixtureList().map(f => ({ seed: f.seed, gen: genFromLegacyCfg(f.cfg) })),
    ...fixtureList().map(f => ({ seed: f.seed, gen: { ...genFromLegacyCfg(f.cfg), fold: 2 } })),
    ...tierFixtureList(),
  ];
  for (const { seed, gen } of gens)
    for (const g of [gen, { ...gen, frames: 1, motion: 'rot90 +1/4', drive: 'spin' }]){
      const a = still(seed, g), b = frames(seed, g);
      assert.deepEqual(b.grid, a.grid);
      assert.deepEqual(b.frames, [a.grid]);
      assert.deepEqual([b.colors, b.recipeText, b.T, b.motion, b.fit], [a.colors, a.recipeText, 1, '', null]);
    }
  // the old fold has no animation: it stays a still
  const old = { ...genFromLegacyCfg(fixtureList()[0].cfg), frames: 8, motion: 'id ~' };
  assert.deepEqual(frames(1, old).frames, [still(1, old).grid]);
  assert.ok(gens.length > 3000);
});

/* ------------------------------------------------------------- the table */

test('the §5.3 table: free cells, free frames and each frame\'s group reproduce', () => {
  const rows = [
    ['none', '',              4096, 16, 'every frame C1 · none'],
    ['none', 'id +1/2',       2048, 8,  'every frame C1 · none'],
    ['none', 'id ~',          2304, 9,  'every frame C1 · none'],
    ['none', 'rot90 +1/4',    1024, 4,  'every frame C1 · none'],
    ['none', 'rot90 +1/2',    1024, 8,  'every frame C2 · rotate 180°'],
    ['none', 'rot180 +1/2',   2048, 8,  'every frame C1 · none'],
    ['none', 'mirror-x +1/2', 2048, 8,  'every frame C1 · none'],
    ['none', 'mirror-x ~',    2048, 9,  '0, 8: Cs · mirror left/right · 1–7, 9–15: C1 · none'],
    ['mirror-x', 'rot90 +1/4', 256, 4,  'every frame D2 · both axis mirrors'],
  ];
  for (const [sym, m, cells, free, groups] of rows){
    const t = spaceTimeTable(sym, 16, 16, null, 16, motion(m));
    assert.deepEqual([t.orbitCount, t.freeFrames, frameGroupText(t.frameGroups)], [cells, free, groups], `${sym} ${m}`);
    assert.equal(t.stillOrbits * 16, sym === 'none' ? 4096 : 2048);
    assert.equal(t.stillGroup, sym);
    assert.equal(t.addsSymmetry, !groups.startsWith(`every frame ${groupById(sym).name}`), `${sym} ${m}`);
  }
  // one frame's own group is the effective group from 4×4 up; on a tiny
  // grid it can be larger (every rot180 2×2 sprite is also diagonals)
  for (const [w, h] of [[2, 2], [3, 3], [4, 4], [8, 8], [9, 9], [16, 12], [9, 10]])
    for (const g of SUBGROUPS){
      const t = spaceTimeTable(g.id, w, h, null, 2, []), eff = t.base.effective;
      if (w >= 4) assert.equal(t.stillGroup, eff.id, `${g.id} ${w}x${h}`);
      else assert.ok(eff.els.every(e => groupById(t.stillGroup).els.includes(e)), `${g.id} ${w}x${h}`);
      assert.equal(t.addsSymmetry, false);
    }
  // with tiers, each frame starts from the tiered table
  const tiers = [{ rx: 4, ry: 4, block: null, copy: null }, { rx: 4, ry: 4, block: 'mirror-x', copy: null }];
  const t = spaceTimeTable('rot90', 16, 16, tiers, 8, motion('id ~'));
  assert.deepEqual([t.stillOrbits, t.orbitCount, t.freeFrames], [16, 16 * 5, 5]);
});

test('timeAct and motionPerm: shifts and reversals wrap the loop', () => {
  assert.deepEqual([0, 1, 5, 7].map(t => timeAct({ shift: [1, 4] }, t, 8)), [2, 3, 7, 1]);
  assert.deepEqual([0, 1, 5, 7].map(t => timeAct({ reverse: 0 }, t, 8)), [0, 7, 3, 1]);
  assert.deepEqual([0, 1, 5, 7].map(t => timeAct({ reverse: 3 }, t, 8)), [3, 2, 6, 4]);
  const p = motionPerm(motion('rot90 +1/4')[0], 4, 4, 4);
  const [ax, ay] = applyElement(5, 1, 0, 4, 4);
  assert.equal(p[0*16 + 0*4 + 1], 1*16 + ay*4 + ax);
  assert.deepEqual([ax, ay], [3, 1], 'rot90 turns clockwise on screen: right of top centre goes to the right edge');
});

/* ----------------------------------------------- symmetry, by brute force */

test('every motion element keeps every animation; frame 0 is the still when the motion adds nothing to it', t => {
  const rnd = mulberry32(0x6a);
  const pick = arr => arr[(rnd() * arr.length) | 0];
  const SOURCES = [
    { source: 'field', formula: 'mix', vary: true },
    { source: 'noise', ca: true },
    { source: 'custom', expr: '(u*u + v*v) * (Math.abs(u)^Math.abs(v))' },
    { source: 'field', formula: 'skew', vary: false, mask: 'blob', outline: true },
    { source: 'field', formula: 'xor', vary: false, mask: 'disc', outline: true, maskScale: 0.9 },
  ];
  const TS = [2, 3, 4, 6, 8, 12, 16, 24];
  const groupIds = [null, ...SUBGROUPS.map(g => g.id)];
  let cases = 0, elementChecks = 0, sameFrame0 = 0, addsNothing = 0;
  for (let i = 0; i < 360; i++){
    const square = rnd() < 0.8, w = 4 + ((rnd() * 29) | 0), h = square ? w : 4 + ((rnd() * 29) | 0);
    const T = pick(TS), symmetry = pick(SUBGROUPS).id;
    const els = [];
    for (let k = (rnd() * 3) | 0; k > 0; k--){
      let e = (rnd() * 8) | 0;
      if (!square) e &= 3;
      const name = Object.entries({ id: 0, 'mirror-x': 1, 'mirror-y': 2, rot180: 3, 'mirror-diag': 4, rot90: 5, rot270: 6, 'mirror-anti': 7 })
        .find(([, v]) => v === e)[0];
      const divisors = [];
      for (let q = 2; q <= T; q++) if (T % q === 0) divisors.push(q);
      if (rnd() < 0.6){ const q = pick(divisors); els.push(`${name} +${1 + ((rnd() * (q - 1)) | 0)}/${q}`); }
      else els.push(`${name} ~${(rnd() * T) | 0}`);
    }
    let tiers = '', tierField = 'none';
    if (rnd() < 0.3){
      const splits = splitsOf(w, h).filter(s => s.across.length >= 2 && s.across.length <= 3);
      if (splits.length){
        const s = pick(splits);
        tiers = printTiers(withSplit(null, s.across, s.down).map((t, j) => ({ ...t, block: j ? pick(groupIds) : null, copy: pick(groupIds) })));
        if (rnd() < 0.5) tierField = pick(['wreath', 'digit-swap', 'prefix-hash', 'phasecell', 'cross', 'carry']);
      }
    }
    const gen = normalize({ gen: { ...pick(SOURCES), w, h, symmetry, frames: T, motion: els.join(', '), tiers, tierField,
                                    drive: pick(['phase', 'spin', 'drift']), driveAmount: ((rnd() * 7) | 0) - 3,
                                    coverage: 0.3 + 0.4 * rnd() } }).gen;
    const label = `${symmetry} ${w}x${h} T${T} "${gen.motion}" ${gen.drive} ${gen.driveAmount} tiers "${tiers}" ${tierField} ${gen.source}`;
    assert.equal(motionState(gen).on, !!els.length, label);
    const seed = pick(SEEDS) + i, s = frames(seed, gen);
    assert.equal(s.frames.length, T, label);
    const F = w * h, flat = new Uint8Array(F * T);
    s.frames.forEach((g, t) => { for (let y = 0; y < h; y++) flat.set(g[y], t*F + y*w); });

    for (const m of motion(gen.motion)){
      const perm = motionPerm(m, w, h, T);
      for (let c = 0; c < F * T; c++) if (flat[c] !== flat[perm[c]]) assert.fail(`${label}: ${printMotion([m])} moves cell ${c}`);
      elementChecks++;
    }
    const table = animationTable(gen);
    s.frames.forEach((g, t) => {
      const group = groupById(table.frameGroups[t]);
      assert.ok(aut(g, w, h) >= group.order, `${label}: frame ${t} aut < |${group.id}|`);
      for (const e of group.els) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){
        const [ax, ay] = applyElement(e, x, y, w, h);
        if (g[y][x] !== g[ay][ax]) assert.fail(`${label}: frame ${t} is not ${group.id}`);
      }
    });
    assert.equal(s.tiers, tiers, label);
    if (tiers) for (const g of tierGenerators(symmetry, w, h, parseTiers(tiers).tiers))
      for (let t = 0; t < T; t++) for (let c = 0; c < F; c++)
        if (flat[t*F + c] !== flat[t*F + g.perm[c]]) assert.fail(`${label}: frame ${t} breaks tier ${g.tier} ${g.kind} ${g.e}`);

    // frame 0 is the still sprite whenever the motion adds no symmetry to it
    let nothing = true;
    for (let c = 0; c < F && nothing; c++) if (table.rep[c] !== table.base.rep[c]) nothing = false;
    if (nothing){
      addsNothing++;
      assert.ok(sameGrid(s.grid, still(seed, gen).grid), `${label}: frame 0 is not the still`);
      sameFrame0++;
    }
    // the leading frames alone are the same frames
    const k = 1 + ((rnd() * T) | 0);
    assert.deepEqual(frames(seed, gen, { count: k }).frames, s.frames.slice(0, k), `${label}: count ${k}`);
    cases++;
  }
  assert.equal(cases, 360);
  assert.ok(elementChecks > 250, `only ${elementChecks} element checks`);
  assert.ok(addsNothing > 150 && sameFrame0 === addsNothing, `${sameFrame0} of ${addsNothing}`);
  t.diagnostic(`${cases} cases, ${elementChecks} motion elements checked, frame 0 is the still in ${sameFrame0} of ${addsNothing}`);
});

/* ---------------------------------------------------------------- drives */

test('turnCS: exact at every quarter turn, within one unit of cos and sin elsewhere', () => {
  assert.deepEqual([turnCS(0, 4), turnCS(1, 4), turnCS(2, 4), turnCS(3, 4), turnCS(-1, 4), turnCS(5, 4)],
    [[65536, 0], [0, 65536], [-65536, 0], [0, -65536], [0, -65536], [0, 65536]]);
  for (let den = 1; den <= 64; den++) for (let num = -den; num <= 2 * den; num++){
    const [c, s] = turnCS(num, den), a = 2 * Math.PI * num / den;
    assert.ok(Math.abs(c - 65536 * Math.cos(a)) <= 1 && Math.abs(s - 65536 * Math.sin(a)) <= 1, `${num}/${den}`);
    if ((4 * num) % den === 0) assert.ok(Number.isInteger(c / 65536) && Number.isInteger(s / 65536), `${num}/${den}`);
  }
});

test('drives: each is the identity at t = 0, and none of them touches the RNG', () => {
  const gen = anim({ symmetry: 'none', formula: 'trefoil', vary: false, frames: 8 });
  for (const drive of ['phase', 'spin', 'drift']) for (const driveAmount of [-2, 1, 3]){
    const s = frames(5, { ...gen, drive, driveAmount });
    assert.deepEqual(s.grid, still(5, gen).grid, `${drive} ${driveAmount}`);
    assert.deepEqual(s.colors, still(5, gen).colors);
  }
  // amount 0: every frame is the still
  for (const drive of ['phase', 'spin', 'drift'])
    for (const g of frames(5, { ...gen, drive, driveAmount: 0 }).frames) assert.deepEqual(g, still(5, gen).grid, drive);
  // the turn and the offsets at t = 0
  const p = { ox: 3, oy: -2 };
  assert.deepEqual(makeDrive('spin', 3, 9, 7, 8, p)(0).turn(4, 6), [4, 6]);
  assert.deepEqual(makeDrive('drift', 3, 9, 7, 8, p)(0).p, p);
});

test('the phase drive slides the threshold: frame t is the still at phase t/T', () => {
  for (const T of [3, 8, 12]){
    const gen = anim({ symmetry: 'mirror-x', frames: T, phase: 0, drive: 'phase', driveAmount: 1 });
    frames(9, gen).frames.forEach((g, t) => assert.deepEqual(g, still(9, { ...gen, phase: t / T }).grid, `T${T} t${t}`));
  }
});

test('the spin drive turns the picture rot90\'s way, exactly at quarter turns', () => {
  for (const n of [5, 8, 9, 16]){
    const gen = anim({ w: n, h: n, symmetry: 'none', frames: 4, drive: 'spin', driveAmount: 1 });
    let against = 0;
    for (const seed of SEEDS){
      const f = frames(seed, gen).frames;
      for (let t = 0; t < 4; t++){
        const next = f[(t + 1) % 4];
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++){
          const [ax, ay] = applyElement(5, x, y, n, n);
          if (next[ay][ax] !== f[t][y][x]) assert.fail(`${n}x${n} seed ${seed}: frame ${t + 1} is not frame ${t} turned`);
        }
      }
      // so the spin motion fits exactly, and the other way round does not
      assert.equal(frames(seed, { ...gen, motion: 'rot90 +1/4' }).fit, 0);
      against += frames(seed, { ...gen, motion: 'rot270 +1/4' }).fit;
    }
    assert.ok(against > 0, `${n}x${n}`);
  }
});

test('the drift drive moves the offsets round a circle of the given radius', () => {
  const d = makeDrive('drift', 2, 16, 16, 8, { ox: 0, oy: 0, M: 17 });
  assert.deepEqual([1, 2, 4, 6].map(t => [d(t).p.ox, d(t).p.oy]), [[-1, 1], [-2, 2], [-4, 0], [-2, -2]]);
});

test('noise boils: every frame draws fresh noise, and the motion never shifts it', () => {
  const gen = anim({ source: 'noise', ca: true, symmetry: 'rot90', frames: 8 });
  const free = frames(3, gen).frames, half = frames(3, { ...gen, motion: 'id +1/2' }).frames;
  assert.deepEqual(free[0], still(3, gen).grid);
  assert.ok(!sameGrid(free[1], free[0]));
  half.forEach((g, t) => assert.deepEqual(g, free[t % 4], `frame ${t}`));
  assert.equal(frames(3, gen).drive, '');
  assert.doesNotMatch(frames(3, gen).recipeText, /drive/);
});

test('fit: the share of cells the motion overrides, against the drive alone', () => {
  const gen = anim({ symmetry: 'none', formula: 'skew', vary: false, frames: 16, motion: 'mirror-x +1/2' });
  const s = frames(1, gen);
  assert.ok(s.fit > 0.1 && s.fit < 0.6, String(s.fit));
  assert.equal(frames(1, { ...gen, motion: '' }).fit, null);
  assert.equal(frames(1, gen, { count: 3 }).fit, null);
});

test('driveMatches and suggestDrive: the drive that already has the motion\'s symmetry', () => {
  const cases = {
    'rot90 +1/4': { drive: 'spin', amount: 1 }, 'rot270 +1/4': { drive: 'spin', amount: -1 },
    'rot180 +1/2': { drive: 'spin', amount: 1 }, 'id +1/2': { drive: 'phase', amount: 2 },
    'id +1/3': { drive: 'phase', amount: 3 }, 'rot90 +3/4': { drive: 'spin', amount: -1 },
    'rot90 +1/2': null, 'mirror-x +1/2': null, 'id ~': null, 'rot180 ~': null, '': null,
  };
  for (const [m, want] of Object.entries(cases)) assert.deepEqual(suggestDrive(motion(m)), want, m);
  assert.ok(driveMatches(motion('rot90 +1/4'), 'spin', 5));
  assert.ok(!driveMatches(motion('rot90 +1/4'), 'spin', 0));
  assert.ok(!driveMatches(motion('rot90 +1/4'), 'drift', 1));
  assert.ok(driveMatches(motion('id +1/2, rot180 +1/2'), 'spin', 2) === false);
});

/* --------------------------------------------------------------- readout */

test('animationReadout and the recipe text say what the animation does', () => {
  assert.equal(animationReadout(DEFAULT_RECIPE.gen), null);
  assert.deepEqual(animationReadout(anim({ symmetry: 'quadrant', fold: 1 })),
    { on: false, frames: 16, reason: 'the old fold (v1) has no animation' });
  const r = animationReadout(anim({ symmetry: 'none', motion: 'rot90 +1/4', drive: 'phase' }));
  assert.deepEqual([r.T, r.orbits, r.still, r.freeFrames, r.motion, r.matches, r.suggestion],
    [16, 1024, 4096, 4, { text: 'rot90 +1/4', on: true, reason: null }, false, { drive: 'spin', amount: 1 }]);
  const spun = animationReadout(anim({ symmetry: 'mirror-x', motion: 'rot90 +1/4', drive: 'spin' }));
  assert.deepEqual([spun.matches, spun.addsSymmetry, spun.stillGroup, spun.frameGroups[0]], [true, true, 'mirror-x', 'quadrant']);
  const off = animationReadout(anim({ motion: 'rot90 +1/4', frames: 6 }));
  assert.deepEqual(off.motion, { text: 'rot90 +1/4', on: false, reason: 'rot90 +1/4 needs a multiple of 4 frames, not 6' });
  assert.equal(off.orbits, 6 * 128);
  assert.equal(animationReadout(anim({ source: 'noise', motion: 'rot90 +1/4' })).driven, false);

  const s = frames(1, anim({ motion: 'rot90 +1/4', drive: 'spin' }));
  assert.match(s.recipeText, / · frames 16 · motion rot90 \+1\/4 · drive spin 1$/);
  assert.match(frames(1, anim({ motion: 'rot90 +1/4', frames: 6 })).recipeText, / · frames 6 · drive phase 1$/);
});

/* --------------------------------------------------------------- goldens */

test('golden-frames.json: one golden per animated fixture, and the port reproduces every one', () => {
  const fixtures = frameFixtureList();
  assert.deepEqual(Object.keys(goldenFrames.sprites).sort(), fixtures.map(f => f.name).sort(),
    'fixtures and golden-frames.json disagree: run `npm run golden:frames` only if the change is intended');
  for (const f of fixtures)
    assert.deepEqual(framesDigest(frames(f.seed, f.gen)), goldenFrames.sprites[f.name], f.name);
});

/* ------------------------------------------------------- links and files */

test('the permalink and session files round-trip with a motion set', () => {
  const r = normalize({ gen: { frames: 16, motion: 'rot90 +1/4', drive: 'spin', driveAmount: -1 }, paletteSeed: 7 });
  assert.deepEqual(decode(encode(r)), r);
  const off = normalize({ ...r, gen: { ...r.gen, frames: 6 } });            // kept, but off
  assert.deepEqual(decode(encode(off)), off);
  const tl = createTimeline();
  commit(tl, r, { kind: 'start', now: 1 });
  commit(tl, off, { kind: 'set:gen.frames', now: 2 });
  const back = readSession(JSON.stringify(saveSession(tl, [])));
  assert.deepEqual(back.tl.entries.map(e => e.recipe), [r, off]);
  assert.equal(tl.entries[1].label, 'Frames 16 → 6');
  commit(tl, normalize({ ...off, gen: { ...off.gen, motion: '' } }), { kind: 'set:gen.motion', now: 3 });
  assert.equal(tl.entries[2].label, 'Motion rot90 +1/4 → off');
  // old links and sessions, from before M6a, open as stills
  assert.equal(decode(encode(normalize({}))).gen.frames, 1);
});

test('test/smoke.md: the M6a links open the §5.3 table, with the free frames and cells it states', () => {
  const md = readFileSync(new URL('./smoke.md', import.meta.url), 'utf8');
  const section = md.slice(md.indexOf('## Animated sprites (M6a)'));
  const rows = [...section.matchAll(/^\| [A-I] \| (?:none|`([^`]+)`) \| (\S+) \| (\w+) (-?\d+) \| (\d+) \| ([\d,]+) \| <http:\/\/localhost:8000\/(#r=[\w-]+)> \|$/gm)];
  assert.equal(rows.length, 9);
  for (const [, m = '', sym, drive, amount, free, cells, hash] of rows){
    const r = decode(hash);
    assert.deepEqual([r.gen.motion, r.gen.symmetry, r.gen.drive, r.gen.driveAmount, r.gen.frames, r.gen.w, r.gen.h],
                     [m, sym, drive, Number(amount), 16, 16, 16], hash);
    const a = animationReadout(r.gen);
    assert.deepEqual([a.freeFrames, a.orbits], [Number(free), Number(cells.replace(',', ''))], `${m} ${sym}`);
  }
});
