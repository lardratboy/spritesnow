/* gen.motion and the animation settings (newdesign.md §5.3, M6a), for the
   recipe and the UI. Pure.
   The grammar itself (parseMotion, printMotion, motionState) is in
   src/core/spacetime.js, because generation reads gen.motion and the core
   does not import from this layer. This module adds what the controls and
   the inspector need on top: the presets, and the readout. */
import { parseMotion, printMotion, canonicalMotion, motionState, animState, animationTable,
         driveMatches, suggestDrive } from '../core/spacetime.js';
import { groupById } from '../core/groups2d.js';

export { parseMotion, printMotion, canonicalMotion, motionState, animState, driveMatches, suggestDrive };

/** The §5.3 table's motions, by name. The values are canonical text. */
export const MOTION_PRESETS = [
  { motion: '',              name: 'None',                    hint: 'Every frame is free: only the drive links them.' },
  { motion: 'id +1/2',       name: 'Loop ×2',                 hint: 'The first half plays twice.' },
  { motion: 'id ~',          name: 'Ping-pong',               hint: 'Plays to the middle frame, then back again.' },
  { motion: 'rot90 +1/4',    name: 'Spin',                    hint: 'Each quarter of the loop is the previous quarter turned 90° clockwise.' },
  { motion: 'rot90 +1/2',    name: 'Quarter turn, half loop', hint: 'The second half is the first turned 90°, so every frame is also turned-180° symmetric.' },
  { motion: 'rot180 +1/2',   name: 'Flip',                    hint: 'The second half is the first turned 180°.' },
  { motion: 'mirror-x +1/2', name: 'Glide',                   hint: 'The second half mirrors the first, like a walk cycle\'s left and right steps.' },
  { motion: 'mirror-x ~',    name: 'Sway',                    hint: 'The back half mirrors the front half, played backwards.' },
];

/** Element pickers for a custom motion: [name, label]. */
export const ELEMENT_CHOICES = [
  ['id', 'id · no change'], ['mirror-x', 'mirror left/right'], ['mirror-y', 'mirror top/bottom'],
  ['mirror-diag', 'mirror on diagonal'], ['mirror-anti', 'mirror on anti-diagonal'],
  ['rot90', 'turn 90° clockwise'], ['rot180', 'turn 180°'], ['rot270', 'turn 90° anticlockwise'],
];
/** Time pickers for a custom motion: [text, label]. */
export const TIME_CHOICES = [
  ['+1/2', '+½ loop'], ['+1/3', '+⅓ loop'], ['+2/3', '+⅔ loop'], ['+1/4', '+¼ loop'], ['+3/4', '+¾ loop'],
  ['+1/6', '+⅙ loop'], ['+5/6', '+⅚ loop'], ['+1/8', '+⅛ loop'], ['+3/8', '+⅜ loop'], ['+5/8', '+⅝ loop'],
  ['+7/8', '+⅞ loop'], ['~', 'reverse: t → −t'], ['~1', 'reverse: t → 1 − t'],
];

/** Frames with the same group, as runs: '0, 8 Cs · mirror …; 1–7, 9–15 C1 · none'.
 *  @param {string[]} groups  one subgroup id per frame */
export function frameGroupText(groups){
  const ids = [...new Set(groups)];
  if (ids.length === 1) return `every frame ${groupById(ids[0]).name}`;
  return ids.map(id => {
    const runs = [];
    groups.forEach((g, t) => {
      if (g !== id) return;
      const last = runs[runs.length - 1];
      if (last && last[1] === t - 1) last[1] = t; else runs.push([t, t]);
    });
    return `${runs.map(([a, b]) => a === b ? `${a}` : `${a}–${b}`).join(', ')}: ${groupById(id).name}`;
  }).join(' · ');
}

/** What a gen's animation does, for the inspector and the controls.
 *  @returns {null | { on:false, frames, reason }
 *                 | { on:true, T, motion:{text, on, reason}|null, drive, amount, driven,
 *                     orbits, still, freeFrames, frameFree:boolean[], frameGroups:string[],
 *                     stillGroup, addsSymmetry:boolean, matches:boolean, suggestion:{drive, amount}|null }}
 *    null for a still (frames 1). motion is null when gen.motion is empty.
 *    orbits  free cells over all frames; still  T × one frame's free cells
 *    driven  false for noise, which has no field: every frame draws fresh noise
 *    addsSymmetry  some frame's group is larger than one frame's own (stillGroup)
 *    matches  the drive turns or shifts with the motion (driveMatches). The
 *            motion then only corrects rounding, unless it adds symmetry,
 *            which no drive supplies */
export function animationReadout(gen){
  const anim = animState(gen);
  if ((gen.frames || 1) <= 1) return null;
  if (!anim.on) return { on: false, frames: gen.frames, reason: anim.reason };
  const text = String(gen.motion || '').trim(), ms = motionState(gen);
  const table = animationTable(gen);
  const driven = gen.source !== 'noise';
  return {
    on: true, T: anim.T, drive: gen.drive, amount: gen.driveAmount, driven,
    motion: text ? { text: ms.on ? printMotion(ms.motion) : text, on: ms.on, reason: ms.reason } : null,
    orbits: table.orbitCount, still: anim.T * table.stillOrbits, freeFrames: table.freeFrames,
    frameGroups: table.frameGroups, frameFree: table.frameFree,
    stillGroup: table.stillGroup, addsSymmetry: table.addsSymmetry,
    matches: ms.on && driven && driveMatches(ms.motion, gen.drive, gen.driveAmount),
    suggestion: ms.on && driven ? suggestDrive(ms.motion) : null,
  };
}
