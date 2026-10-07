/* The 20 modulo fields, plus their helpers. Pure.
   Ported from reference `FIELDS`, `popcount`, `digitSum`, `pascalMod`.
   A field maps centred, strided, offset coordinates (u, v) and per-sprite
   params p to a number. generate.js reduces it mod M.
   The ORDER of FIELDS is part of every recipe: generate.js picks fields by
   index from a seeded RNG, so reordering this table changes sprites. */

export function popcount(n){ n = n>>>0; n = n - ((n>>>1)&0x55555555);
  n = (n&0x33333333) + ((n>>>2)&0x33333333);
  return ((n + (n>>>4) & 0x0f0f0f0f) * 0x01010101) >>> 24; }

export function digitSum(n){ n = Math.abs(n|0); let s=0; while(n>0){ s += n%10; n=(n/10)|0; } return s; }

/** C(n, k) mod m, via a cached Pascal triangle per modulus. */
const pascalCache = new Map();
export function pascalMod(n,k,m){
  if(k<0||n<0||k>n) return 0;
  if(n>180) n%=181;
  if(k>n) k=n;
  let tri = pascalCache.get(m);
  if(!tri){ tri=[[1]]; pascalCache.set(m,tri); }
  while(tri.length<=n){
    const prev = tri[tri.length-1], row=[1];
    for(let i=1;i<prev.length;i++) row.push((prev[i-1]+prev[i])%m);
    row.push(1); tri.push(row);
  }
  return tri[n][k];
}

/** @type {{id:string, name:string, f:(u:number, v:number, p:object) => number}[]} */
export const FIELDS = [
  {id:'circle',  name:'Circles   x²+y²',           f:(u,v,p)=> u*u + v*v},
  {id:'product', name:'Product   x·y',             f:(u,v,p)=> u*v},
  {id:'xor',     name:'XOR   |x| ^ |y|',           f:(u,v,p)=> Math.abs(u) ^ Math.abs(v)},
  {id:'and',     name:'AND   |x| & |y|',           f:(u,v,p)=> Math.abs(u) & Math.abs(v)},
  {id:'or',      name:'OR   |x| | |y|',            f:(u,v,p)=> Math.abs(u) | Math.abs(v)},
  {id:'diamond', name:'Diamond   |x|+|y|',         f:(u,v,p)=> Math.abs(u) + Math.abs(v)},
  {id:'cheby',   name:'Square   max(|x|,|y|)',     f:(u,v,p)=> Math.max(Math.abs(u),Math.abs(v))},
  {id:'hyper',   name:'Hyperbola   x²−y²',         f:(u,v,p)=> u*u - v*v},
  {id:'skew',    name:'Skewed   x²+xy+y²',         f:(u,v,p)=> u*u + u*v + v*v},
  {id:'cubic',   name:'Cubic   x³+y³',             f:(u,v,p)=> u*u*u + v*v*v},
  {id:'trefoil', name:'Trefoil   x³−3xy²',         f:(u,v,p)=> u*u*u - 3*u*v*v},
  {id:'quartic', name:'Quartic   x⁴+y⁴',           f:(u,v,p)=> u*u*u*u + v*v*v*v},
  {id:'conic',   name:'Random conic   ax²+bxy+…',  f:(u,v,p)=> p.a*u*u + p.b*u*v + p.c*v*v + p.d*u + p.e*v},
  {id:'popcnt',  name:'Popcount(x·y)',             f:(u,v,p)=> popcount(Math.abs(u*v))},
  {id:'popsum',  name:'Popcount(x²+y²)',           f:(u,v,p)=> popcount(Math.abs(u*u+v*v))},
  {id:'ringxor', name:'(x²+y²)·(x^y+1)',           f:(u,v,p)=> (u*u+v*v) * ((Math.abs(u)^Math.abs(v))+1)},
  {id:'digsum',  name:'Digitsum(x²+y²)',           f:(u,v,p)=> digitSum(u*u+v*v)},
  {id:'pascal',  name:'Binomial C(|x|+|y|,|x|)',   f:(u,v,p)=> pascalMod(Math.abs(u)+Math.abs(v), Math.abs(u), p.M)},
  {id:'shift',   name:'(x<<3) ^ (y·y)',            f:(u,v,p)=> (Math.abs(u)<<3) ^ (v*v)},
  {id:'mixmul',  name:'x·y·(x+y)',                 f:(u,v,p)=> u*v*(u+v)},
];
export const FIELD_BY_ID = Object.fromEntries(FIELDS.map(f=>[f.id,f]));
