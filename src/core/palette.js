/* Deterministic palettes. Pure.
   Ported from reference `paletteFor`, `rgbHex`, `hexRgb`, `lum`, `darken`.
   The palette is a pure function of (paletteSeed, bits per channel), so any
   recipe replays exactly. */
import { mulberry32 } from './rng.js';

export const rgbHex = (r,g,b) => '#'+[r,g,b].map(v=>v.toString(16).padStart(2,'0')).join('');
export const hexRgb = h => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
export const lum = h => { const [r,g,b]=hexRgb(h); return 0.2126*r+0.7152*g+0.0722*b; };
export const darken = (h,k) => { const [r,g,b]=hexRgb(h); return rgbHex((r*k)|0,(g*k)|0,(b*k)|0); };

const palCache = new Map();
/** @returns {string[]} '#rrggbb' colours. Treat the result as read-only: it is cached. */
export function paletteFor(seed, bpc){
  const key = seed+'/'+bpc;
  if(palCache.has(key)) return palCache.get(key);
  const rnd = mulberry32(seed ^ 0x5bf03635);
  const levels = 1<<bpc, step = 255/(levels-1);
  let out = [];
  if(bpc<=3){
    for(let r=0;r<levels;r++) for(let g=0;g<levels;g++) for(let b=0;b<levels;b++)
      out.push(rgbHex(Math.round(r*step),Math.round(g*step),Math.round(b*step)));
    for(let i=out.length-1;i>0;i--){ const j=(rnd()*(i+1))|0; [out[i],out[j]]=[out[j],out[i]]; }
  } else {
    const seen = new Set();
    let guard = 0;
    while(seen.size<256 && guard++<20000){
      seen.add(rgbHex(Math.round(((rnd()*levels)|0)*step),
                      Math.round(((rnd()*levels)|0)*step),
                      Math.round(((rnd()*levels)|0)*step)));
    }
    out = [...seen];
  }
  if(palCache.size>64) palCache.clear();
  palCache.set(key,out);
  return out;
}
