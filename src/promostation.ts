/**
 * Tanıtım sahneleri için OYUNDAKİYLE AYNI istasyon çizimi.
 * Oyunun gerçek primitifleri (pompa dispenseri, beton lot, küre tanklar, tabela) +
 * Kenney binaları (market/ofis/tuvalet). Kanopi YOK (oyunda da yok).
 *  - lite=false: tam detay (Kenney modelleri) — film şeridi (az sayıda canlı).
 *  - lite=true : prosedürel binalar, daha az mesh — 700+ istasyon (kuşbakışı) için.
 */
import * as THREE from 'three'
import { loadStatics, fitModel, StaticLib } from './models'

export interface StCfg {
  pumps: number; ev: number; market: number; toilet: number
  wash: boolean; oil: boolean; coffee: boolean; restaurant: boolean; truckpark: boolean
  solar: number; smr: boolean; battery: number; tank: number; sign: number; day?: number; money?: number
}

// ---- oyunun world.ts helper'ları (birebir) ----
const lam = (c: number) => new THREE.MeshLambertMaterial({ color: c })
function box(w: number, d: number, h: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D) {
  const m = new THREE.Mesh(GEO.box, lam(color)); m.scale.set(w, d, h); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m
}
function cyl(r: number, len: number, color: number, x: number, y: number, z: number, axis: 'x' | 'y' | 'z', parent: THREE.Object3D) {
  const m = new THREE.Mesh(GEO.cyl, lam(color))
  if (axis === 'x') m.rotation.z = Math.PI / 2
  if (axis === 'z') m.rotation.x = Math.PI / 2
  m.scale.set(r, r, len); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m
}
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
  sph: new THREE.SphereGeometry(1, 16, 12),
}

// oyunun pompa dispenseri (buildPumpMesh birebir)
function pumpMesh(): THREE.Group {
  const g = new THREE.Group()
  box(0.8, 1.15, 0.1, 0x8f979e, 0, 0, 0.05, g)
  box(0.6, 0.95, 1.3, 0xe04848, 0, 0, 0.75, g)
  box(0.64, 0.99, 0.1, 0xc23b3b, 0, 0, 1.45, g)
  box(0.62, 0.97, 0.16, 0xf0f0ec, 0, 0, 0.5, g)
  box(0.05, 0.66, 0.46, 0x1c2530, 0.3, 0, 1.12, g)
  box(0.03, 0.54, 0.34, 0xa8dcf0, 0.33, 0, 1.12, g) // ekran
  for (const [sy, c] of [[0.52, 0x2fa05a], [-0.52, 0xe8862e]] as const) {
    box(0.34, 0.08, 0.5, 0x2b2f33, 0, sy, 1.0, g)
    box(0.12, 0.1, 0.3, c, 0.12, sy, 1.05, g)
    cyl(0.03, 0.35, 0x23272b, -0.1, sy, 0.8, 'z', g)
  }
  return g
}
// tam pompa (pad + gold trim + dubalar + dispenser) — addPump birebir
function fullPump(x: number, y: number, g: THREE.Group) {
  const p = new THREE.Group()
  box(1.7, 3.4, 0.2, 0xc7ccd1, 0, 0, 0.1, p)
  box(1.75, 3.45, 0.05, 0xe0b13e, 0, 0, 0.02, p)
  cyl(0.09, 0.55, 0xe0b13e, 0, -1.5, 0.45, 'z', p)
  cyl(0.09, 0.55, 0xe0b13e, 0, 1.5, 0.45, 'z', p)
  const pm = pumpMesh(); pm.position.z = 0.2; p.add(pm)
  p.position.set(x, y, 0); g.add(p)
}
// tabela (setSign'ın sade hali) — seviyeye göre yükseklik
function sign(level: number, x: number, y: number, g: THREE.Group) {
  const H = [2.4, 3.2, 4.2, 5.4][Math.min(3, level)]
  const pw = [1.5, 1.9, 2.4, 3.0][Math.min(3, level)], ph = [1.6, 2.0, 2.4, 2.8][Math.min(3, level)]
  box(level >= 2 ? 0.9 : 0.5, 0.24, H, 0x39424e, x, y, H / 2, g)
  box(pw + 0.1, 0.2, ph + 0.1, level >= 3 ? 0xd64545 : 0xf0f0ec, x, y, H + ph / 2, g)
  if (level >= 3) box(pw + 0.3, 0.22, 0.18, 0xe0b13e, x, y, H + ph + 0.15, g)
}
// küre tanklar (buildTankCluster stili) — seviye→boyut
function tanks(level: number, x: number, y: number, g: THREE.Group) {
  const R = 0.4 + level * 0.04
  for (const [i, c] of [[0, 0x27a05a], [1, 0xe8862e], [2, 0x2f6fed]] as const) {
    const sph = new THREE.Mesh(GEO.sph, new THREE.MeshLambertMaterial({ color: c })); sph.castShadow = true
    sph.scale.setScalar(R); sph.position.set(x, y + i * (R * 2 + 0.35), R + 0.45); g.add(sph)
    // kısa ayaklar
    for (const [lx, ly] of [[0.5, 0.5], [-0.5, 0.5], [0.5, -0.5], [-0.5, -0.5]] as const)
      cyl(0.06, 0.45, 0x7f878e, x + lx * R * 0.5, y + i * (R * 2 + 0.35) + ly * R * 0.5, 0.22, 'z', g)
  }
}
// EV şarj ünitesi (addEvCharger sadeleştirilmiş)
function evCharger(x: number, y: number, g: THREE.Group) {
  box(1.0, 1.6, 0.14, 0xc7ccd1, x, y, 0.07, g)
  box(0.35, 0.55, 1.5, 0xf0f0ec, x, y, 0.85, g)
  box(0.37, 0.57, 0.22, 0x35c7d6, x, y, 1.35, g)
}
// prosedürel bina (lite mod / model yoksa): renkli gövde + çatı
function procBuilding(w: number, d: number, h: number, col: number, roof: number, x: number, y: number, g: THREE.Group) {
  box(w, d, h, col, x, y, h / 2, g); box(w + 0.3, d + 0.3, 0.22, roof, x, y, h + 0.1, g)
}

let statics: StaticLib | null = null
export async function initStation() { statics = await loadStatics().catch(() => null) }

/** OYUNDAKİYLE AYNI istasyon grubu (config'e göre) */
export function buildStation(s: StCfg, lite = false): THREE.Group {
  const g = new THREE.Group()
  // beton lot (oyun: 11.5×20 plane) — promoda kompakt tutalım
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(9, 11), lam(0xc4c9cf)); lot.position.z = 0.02; g.add(lot)
  box(9.1, 0.18, 0.14, 0xd8dbde, 0, -5.5, 0.07, g); box(9.1, 0.18, 0.14, 0xd8dbde, 0, 5.5, 0.07, g) // bordür
  // pompalar (sol sütun, oyundaki gibi bir sıra, y boyunca)
  const np = Math.max(1, Math.min(7, s.pumps))
  const py0 = -((np - 1) * 1.9) / 2
  for (let i = 0; i < np; i++) fullPump(-2.4, py0 + i * 1.9, g)
  // EV şarj (pompaların sağında)
  for (let e = 0; e < Math.min(4, s.ev); e++) evCharger(0.2, py0 + e * 1.7, g)
  // ofis / kiosk (sağ arka) — Kenney modeli varsa
  if (!lite && statics?.office) { const o = fitModel(statics.office, 3.2); o.position.set(2.8, 3.4, 0); g.add(o) }
  else procBuilding(2.0, 2.0, 2.2, 0x4a5560, 0xd64545, 2.8, 3.4, g)
  // market — Kenney modeli
  if (s.market > 0) {
    if (!lite && statics && (s.market >= 2 ? statics.market2 : statics.market1)) {
      const mk = fitModel((s.market >= 2 ? statics.market2 : statics.market1)!, s.market >= 2 ? 3.6 : 2.8); mk.position.set(3.0, -0.4, 0); g.add(mk)
    } else procBuilding(2.2, 2.4, 1.8 + s.market * 0.4, 0xe4c07a, 0xd64545, 3.0, -0.4, g)
  }
  // tuvalet — Kenney modeli
  if (s.toilet > 0) {
    if (!lite && statics?.toilet) { const tt = fitModel(statics.toilet, 2.2); tt.position.set(3.2, -3.4, 0); g.add(tt) }
    else procBuilding(1.4, 1.4, 1.2, 0xdfe3e8, 0xd64545, 3.2, -3.4, g)
  }
  // diğer tesisler (prosedürel — oyun renkleri)
  const spots: [number, number][] = [[-4.4, 3.6], [-4.4, -3.6], [4.4, 1.6], [4.4, -1.6], [-4.4, 0]]; let si = 0
  const fac = (col: number, roof: number, h = 1.4, w = 1.8) => { const [x, y] = spots[si++ % spots.length]; procBuilding(w, w, h, col, roof, x, y, g) }
  if (s.wash) fac(0x59b6d6, 0x2f6fed)
  if (s.oil) fac(0x7a5230, 0x39424e)
  if (s.coffee) fac(0x9a6b3f, 0xd64545, 1.1, 1.4)
  if (s.restaurant) fac(0xc0693a, 0xd64545, 1.6, 2.0)
  if (s.truckpark) { const [x, y] = spots[si++ % spots.length]; box(2.6, 3.2, 0.14, 0x6b7078, x, y, 0.07, g) }
  if (s.smr) { const [x, y] = spots[si++ % spots.length]; box(1.8, 1.8, 1.4, 0xcfd4d9, x, y, 0.7, g); const dome = new THREE.Mesh(GEO.sph, lam(0xdfe3e8)); dome.scale.set(1.0, 1.0, 0.6); dome.position.set(x, y, 1.4); g.add(dome) }
  if (s.battery > 0) { const [x, y] = spots[si++ % spots.length]; box(1.2, 0.8, 1.0, 0x2fa8bc, x, y, 0.5, g) }
  // güneş panelleri
  for (let sp = 0; sp < Math.min(6, s.solar); sp++) { const pn = box(1.0, 0.08, 1.1, 0x2a3a66, -4.0 + (sp % 3) * 1.1, 4.6 + Math.floor(sp / 3) * 1.1, 0.7, g); pn.rotation.x = -0.5 }
  // yakıt tankları (küre) — sağ kenar
  tanks(s.tank, 3.6, -1.4, g)
  // tabela
  sign(s.sign, -4.0, -4.6, g)
  return g
}

/** Aracın estate önünde durduğu nokta (ön-orta EV parseli, yola bakar) */
export const ESTATE_CAR_STOP = new THREE.Vector3(0, -14.5, 0)

/**
 * Büyük "6 parsel claimlenmiş" istasyon — TPS promo için. Oyunun gerçek primitifleri:
 * 3 sütun × 2 satır beton parsel (bordürlü), üzerinde benzin pompaları, EV şarj,
 * küre tanklar, ofis/market (Kenney), tuvalet, nükleer (SMR kubbe), batarya, solar,
 * kafe/restoran ve BENELOIL tabelası. Ön (−Y) yola bakar, araç ön-ortadan girer.
 */
export function buildEstate(): THREE.Group {
  const g = new THREE.Group()
  const XS = [-11, 0, 11], FY = -6.2, BY = 6.2, PW = 10.6, PD = 11.6
  // 6 beton parsel + bordür çerçevesi
  for (const cx of XS) for (const cy of [FY, BY]) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(PW, PD), lam(0xc4c9cf))
    pad.position.set(cx, cy, 0.02); pad.receiveShadow = true; g.add(pad)
    box(PW + 0.2, 0.18, 0.16, 0xd8dbde, cx, cy - PD / 2, 0.08, g)
    box(PW + 0.2, 0.18, 0.16, 0xd8dbde, cx, cy + PD / 2, 0.08, g)
    box(0.18, PD + 0.2, 0.16, 0xd8dbde, cx - PW / 2, cy, 0.08, g)
    box(0.18, PD + 0.2, 0.16, 0xd8dbde, cx + PW / 2, cy, 0.08, g)
  }
  // ÖN-SOL: 3 benzin pompası
  for (let i = 0; i < 3; i++) fullPump(-11, FY - 3.8 + i * 3.8, g)
  // ÖN-ORTA: 4 EV şarj (kahraman — araç buraya gelir)
  for (let i = 0; i < 4; i++) evCharger(0, FY - 4.2 + i * 2.7, g)
  // ÖN-SAĞ: küre tanklar + tuvalet + oto yıkama
  tanks(3, 8.8, FY - 3.2, g)
  if (statics?.toilet) { const tt = fitModel(statics.toilet, 2.4); tt.position.set(13, FY + 4, 0); g.add(tt) }
  else procBuilding(1.8, 1.8, 1.4, 0xdfe3e8, 0xd64545, 13, FY + 4, g)
  procBuilding(2.4, 2.8, 1.9, 0x59b6d6, 0x2f6fed, 12.8, FY - 2.8, g) // oto yıkama (mavi)
  // ARKA-SOL: ofis (Kenney)
  if (statics?.office) { const o = fitModel(statics.office, 4.4); o.position.set(-11, BY, 0); g.add(o) }
  else procBuilding(3, 3, 3, 0x4a5560, 0xd64545, -11, BY, g)
  // ARKA-ORTA: market (Kenney) + kafe + restoran
  if (statics?.market2) { const mk = fitModel(statics.market2, 4.6); mk.position.set(-1.8, BY + 0.5, 0); g.add(mk) }
  else procBuilding(3, 3, 2.6, 0xe4c07a, 0xd64545, -1.8, BY + 0.5, g)
  procBuilding(1.6, 1.6, 1.1, 0x9a6b3f, 0xd64545, 2.6, BY - 3.6, g) // kafe
  procBuilding(2.0, 2.0, 1.5, 0xc0693a, 0xd64545, 2.9, BY + 3.2, g) // restoran
  // ARKA-SAĞ: nükleer (SMR kubbe) + batarya + solar
  box(2.4, 2.4, 1.7, 0xcfd4d9, 11, BY + 2, 0.85, g)
  const dome = new THREE.Mesh(GEO.sph, lam(0xdfe3e8)); dome.scale.set(1.4, 1.4, 0.85); dome.position.set(11, BY + 2, 1.7); dome.castShadow = true; g.add(dome)
  box(1.4, 1.0, 1.1, 0x2fa8bc, 8, BY - 2.2, 0.55, g)   // batarya paketi
  box(1.4, 1.0, 1.1, 0x2fa8bc, 9.7, BY - 2.2, 0.55, g)
  for (let s = 0; s < 6; s++) { const pn = box(1.1, 0.08, 1.2, 0x2a3a66, 8.4 + (s % 3) * 1.3, BY - 4.4 + Math.floor(s / 3) * 1.3, 0.75, g); pn.rotation.x = -0.5 }
  // BENELOIL tabelası — ön-sol köşe, yola bakar
  sign(3, -16.8, FY - 4.5, g)
  // giriş apronu (araç yoldan estate'e girer)
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 9), lam(0xc4c9cf)); apron.position.set(0, FY - 8.5, 0.02); apron.receiveShadow = true; g.add(apron)
  return g
}
