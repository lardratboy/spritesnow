/* Measures the reference fold() against the true orbits of the group each
   mode names. Produces the numbers in docs/from3Dto2D.md §3.
   Run: node tools/measurements/foldcheck.js */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../reference/symmetrical_sprite_generator.html', import.meta.url), 'utf8');
const start = html.indexOf('function seedDims(');
const end = html.indexOf('\n/* ====', start);
const { seedDims, fold } = new Function(html.slice(start, end) + '\nreturn { seedDims, fold };')();

// D4 on a w x h grid, by name
const T = {
  id:(x,y,w,h)=>[x,y],           mx:(x,y,w,h)=>[w-1-x,y],   my:(x,y,w,h)=>[x,h-1-y], r2:(x,y,w,h)=>[w-1-x,h-1-y],
  r1:(x,y,w,h)=>[h-1-y,x],       r3:(x,y,w,h)=>[y,w-1-x],   d:(x,y,w,h)=>[y,x],      a:(x,y,w,h)=>[h-1-y,w-1-x],
};
// the group each legacy mode means
const G = { none:['id'], horizontal:['id','mx'], vertical:['id','my'], quadrant:['id','mx','my','r2'],
  rot180:['id','r2'], rot90:['id','r1','r2','r3'], diagonal:['id','mx','my','r2','r1','r3','d','a'] };

const fits = (k,w,h) => { for (let y=0;y<h;y++) for (let x=0;x<w;x++){ const [a,b]=T[k](x,y,w,h); if(a<0||b<0||a>=w||b>=h) return false; } return true; };

function check(mode, w, h){
  const els = G[mode].filter(k => fits(k,w,h));
  let broken = 0, outside = 0, lexAgree = 0, consistent = 0;
  const orbitKeys = new Set();
  for (let y=0;y<h;y++) for (let x=0;x<w;x++){
    const orb = [...new Set(els.map(k=>T[k](x,y,w,h).join(',')))].map(s=>s.split(',').map(Number));
    orbitKeys.add(orb.map(p=>p.join(',')).sort()[0]);
    const reps = new Set(orb.map(([a,b])=>fold(a,b,w,h,mode).join(',')));
    if (reps.size > 1){ broken++; continue; }
    consistent++;
    const rep = [...reps][0];
    if (!orb.some(p=>p.join(',')===rep)) outside++;
    let best = orb[0]; for (const q of orb) if (q[1]<best[1] || (q[1]===best[1] && q[0]<best[0])) best = q;
    if (best.join(',') === rep) lexAgree++;
  }
  return { fit: `${els.length}/${G[mode].length}`, orbits: orbitKeys.size, broken, outside, lexAgree, consistent };
}

console.log('Per mode at sample sizes: fitting elements, true orbits, cells breaking symmetry,');
console.log('representatives outside their own orbit, and row-then-column lex-min agreement.');
for (const mode of Object.keys(G)){
  console.log(`== ${mode}`);
  for (const [w,h] of [[8,8],[9,9],[16,16],[15,15],[31,31],[33,33],[16,12],[15,11]]){
    const r = check(mode,w,h);
    console.log(`  ${w}x${h}: group ${r.fit}, orbits ${r.orbits}, broken ${r.broken}, outside-orbit ${r.outside}, lex==fold ${r.lexAgree}/${r.consistent}`);
  }
}

console.log('\nAll grids 2x2..40x40, by mode and grid kind (only kinds with a defect are listed):');
const by = {};
for (const mode of Object.keys(G)) for (let w=2; w<=40; w++) for (let h=2; h<=40; h++){
  const r = check(mode,w,h);
  const kind = `${mode} ${w===h?'square':'non-square'} ${(w%2||h%2)?'odd':'even'}`;
  const k = by[kind] ||= { grids:0, withBroken:0, withOutside:0 };
  k.grids++; if (r.broken) k.withBroken++; if (r.outside) k.withOutside++;
}
for (const [k,v] of Object.entries(by)) if (v.withBroken || v.withOutside) console.log(`  ${k}: ${JSON.stringify(v)}`);
