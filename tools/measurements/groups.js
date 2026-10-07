/* Enumerates the subgroups of Oh (3D) and D4 (2D), and the 2D symmetry each
   block-showroom group leaves in an axis-aligned slice. Produces the numbers
   in docs/from3Dto2D.md §4–§5.
   Needs block-showroom as a sibling folder of this project.
   Run: node tools/measurements/groups.js */
let createBimoblockCore;
try {
  ({ createBimoblockCore } = await import('../../../block-showroom/src/core/bimoblock-core.js'));
} catch (err) {
  console.error('groups.js needs ../block-showroom next to this project: ' + err.message);
  process.exit(1);
}
const core = createBimoblockCore();
const PERM = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
const mat = e => { const P=PERM[e>>3], s=e&7, M=[[0,0,0],[0,0,0],[0,0,0]]; for(let i=0;i<3;i++) M[i][P[i]]=((s>>i)&1)?-1:1; return M; };
const key = M => M.flat().join(',');
const E = {}; for(let e=0;e<48;e++) E[key(mat(e))]=e;
const mul = (a,b)=>{const A=mat(a),B=mat(b),C=[[0,0,0],[0,0,0],[0,0,0]];for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)C[i][j]+=A[i][k]*B[k][j];return E[key(C)];};
const inv = a => { for(let b=0;b<48;b++) if(mul(a,b)===0) return b; };
function closure(gens){const s=new Set([0]);let g=true;while(g){g=false;for(const a of [...s])for(const x of gens){const c=mul(a,x);if(!s.has(c)){s.add(c);g=true;}}}return [...s].sort((a,b)=>a-b);}
function subgroups(elems){ // all subgroups of group with elems, via ≤3 generators
  const seen=new Map();
  for(const a of elems)for(const b of elems)for(const c of elems){const H=closure([a,b,c]);seen.set(H.join(','),H);}
  return [...seen.values()];
}
function classes(subs, elems){ const cls=new Map();
  for(const H of subs){ let canon=null; for(const g of elems){ const gi=inv(g); const K=H.map(h=>mul(mul(g,h),gi)).sort((a,b)=>a-b).join(','); if(canon===null||K<canon) canon=K; } cls.set(canon,(cls.get(canon)||[]).concat([H])); }
  return cls; }
const all = [...Array(48).keys()];
const subsOh = subgroups(all), clsOh = classes(subsOh, all);
console.log(`Oh: ${subsOh.length} subgroups in ${clsOh.size} conjugacy classes; showroom offers ${core.GROUPS.length}`);
// D4 = elements fixing z axis with z sign +  (perm keeps index 2, sign bit2 = 0)
const D4 = all.filter(e => { const M=mat(e); return M[2][2]===1; });
const subsD4 = subgroups(D4), clsD4 = classes(subsD4, D4);
const name2 = H => { // name a subgroup of D4 by its xy action
  const ms = H.map(mat).map(M=>[[M[0][0],M[0][1]],[M[1][0],M[1][1]]]);
  const det = m=>m[0][0]*m[1][1]-m[0][1]*m[1][0];
  const refl = ms.filter(m=>det(m)<0), rot = ms.filter(m=>det(m)>0);
  const axisRefl = refl.filter(m=>m[0][1]===0).length, diagRefl = refl.length-axisRefl;
  const n = rot.length;
  if(!refl.length) return n===1?'C1':`C${n}`;
  if(n===1) return axisRefl? 'Cs (axis mirror)':'Cs (diagonal mirror)';
  if(n===2) return axisRefl? 'D2 (axis mirrors)':'D2 (diagonal mirrors)';
  return 'D4';
};
console.log(`D4: ${subsD4.length} subgroups in ${clsD4.size} conjugacy classes:`, [...clsD4.values()].map(v=>`${name2(v[0])}×${v.length}`).join(', '));
// slice inheritance: for each showroom group, stabiliser of the plane z=0 (setwise) and z=c (c≠0), restricted to xy
for (const G of core.GROUPS){
  const out=[];
  for (const [ax,label] of [[2,'z'],[1,'y'],[0,'x']]){
    for (const mid of [true,false]){
      const st = G.els.filter(e=>{const M=mat(e); return Math.abs(M[ax][ax])===1 && (mid || M[ax][ax]===1);});
      // conjugate to act on xy: map axis ax -> z by a fixed permutation
      const sw = ax===2?0:E[key(ax===1?[[1,0,0],[0,0,1],[0,1,0]]:[[0,0,1],[0,1,0],[1,0,0]])];
      const conj = [...new Set(st.map(e=>{ const r=mul(mul(sw,e),inv(sw)); const M=mat(r); M[2][2]=1; return E[key(M)]; }))];
      out.push(`${label}${mid?'=mid':'≠mid'}: ${name2(conj)}`);
    }
  }
  console.log(`${G.name.padEnd(14)} |G|=${String(G.order).padStart(2)} chiral=${G.chiral?'y':'n'} cosets=${G.cosets}  slices → ${out.join(' · ')}`);
}
