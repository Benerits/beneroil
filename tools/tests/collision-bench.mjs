// ÇARPIŞMA TARAMASI KIYASI (trafik raporu 3.3) — mobil ısınma iddiasının kanıtı.
// Çalıştır: npm run bench:collision
// Modeller: ESKİ = O(n²) + kare başına THREE.Vector3 ayırma · YENİ = uniform grid + skaler.
// GERÇEK karşılaştırma: eski kod (O(n²) + kare başına Vector3 ayırma) vs yeni kod (grid + skaler)
class V3 { constructor(){this.x=0;this.y=0;this.z=0}
  subVectors(a,b){this.x=a.x-b.x;this.y=a.y-b.y;this.z=a.z-b.z;return this}
  dot(o){return this.x*o.x+this.y*o.y+this.z*o.z}
  addScaledVector(o,s){this.x+=o.x*s;this.y+=o.y*s;this.z+=o.z*s;return this}
  length(){return Math.hypot(this.x,this.y,this.z)} }
const CELL=4.0
const mk=n=>Array.from({length:n},(_,i)=>{const a=i*2.399963,r=Math.sqrt(i)*3.2
  return {pos:{x:Math.cos(a)*r,y:Math.sin(a)*r,z:0}, dir:{x:1,y:0,z:0}}})

function eski(cars){ let hits=0
  for(const c of cars){ for(const o of cars){ if(o===c) continue
    const rel=new V3().subVectors(o.pos,c.pos); rel.z=0        // ← kare başına ayırma
    const f=rel.dot(c.dir); if(f<0.4||f>3.6) continue
    if(rel.addScaledVector(c.dir,-f).length()<1.25) hits++ } }
  return hits }

function yeni(cars){ let hits=0
  const g=new Map()
  for(const c of cars){const k=(Math.floor(c.pos.x/CELL)+256)*512+(Math.floor(c.pos.y/CELL)+256)
    let l=g.get(k); if(!l){l=[];g.set(k,l)} l.push(c)}
  for(const c of cars){const gx=Math.floor(c.pos.x/CELL),gy=Math.floor(c.pos.y/CELL)
    for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++){const l=g.get((gx+i+256)*512+(gy+j+256)); if(!l)continue
      for(const o of l){ if(o===c) continue
        const dx=o.pos.x-c.pos.x, dy=o.pos.y-c.pos.y, f=dx*c.dir.x+dy*c.dir.y
        if(f<0.4||f>3.6) continue
        const lx=dx-c.dir.x*f, ly=dy-c.dir.y*f
        if(lx*lx+ly*ly<1.5625) hits++ } } }
  return hits }

console.log('n    | eski (ms/1000 kare) | yeni (ms/1000 kare) | hızlanma | ayırma/kare eski→yeni')
for(const n of [16,25,40,80]){
  const cars=mk(n); const F=1000
  eski(cars); yeni(cars)                       // ısınma
  let t=performance.now(); for(let i=0;i<F;i++) eski(cars); const tA=performance.now()-t
  t=performance.now(); for(let i=0;i<F;i++) yeni(cars); const tB=performance.now()-t
  console.log(`${String(n).padEnd(5)}| ${tA.toFixed(1).padStart(19)} | ${tB.toFixed(1).padStart(19)} | ${(tA/tB).toFixed(1).padStart(7)}× | ${n*(n-1)} → 0`)
}
