/**
 * TANKER ↔ TRAFİK ARALIK TESTİ (3 Eyl 2026)
 *
 * KÖKEN: yeni trafik algoritması (aralık kuralı, 2 Eyl) yalnız Car↔Car çalışıyordu.
 * Tanker ayrı sınıf: araçlar tankeri sabit 0.35'le "yavaşla ama durma" diye geçiyor
 * (hareket eden tankerin üstüne biniyordu), tanker ise araç görünce 7 sn TAM duruyor,
 * sonra tam gazla öndekinin üstünden geçiyordu (ikili: dur / ez).
 *
 * BU TEST NEYİ KANITLAR (gerçek Tanker.update + aralikOlcegi ile, sahte sahne):
 *  1) aralikOlcegi: sep dışında 1, sep-0.4 ve altında taban, arada monoton.
 *  2) Tanker, önünde AYNI YÖNDE 0.5 hızla giden araç varken DURMAZ (hizOrani ≥ 0.3)
 *     ve aracın üstüne BİNMEZ: 20 sn boyunca aralık hiçbir karede sep-0.4'ün altına inmez.
 *  3) Tanker, önünde DURAN araç varken tam durur (hizOrani 0) — eski davranış korunur —
 *     ve 7 sn sonra zorlama kapısı açılır (kilitlenmezlik sigortası).
 *  4) Yola katılım: hız fonksiyonu 0 dönerse tanker ilerlemez.
 *
 * Kullanım: npx tsx tools/tests/tanker-trafik-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }

const THREE = await import('three')
const { Tanker, aralikOlcegi } = await import('../../src/cars.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

console.log('1) aralikOlcegi')
check('sep dışında tam hız', aralikOlcegi(6, 4, 0.3) === 1)
check('sep-0.4 ve altında taban', aralikOlcegi(3.6, 4, 0.3) === 0.3 && aralikOlcegi(1, 4, 0.3) === 0.3)
check('arada monoton', aralikOlcegi(3.8, 4, 0.3) > 0.3 && aralikOlcegi(3.8, 4, 0.3) < 1)

// Sahte sahne: tanker kara istasyonunda LANE_NEAR'dan kuzeye gider (ilk rota bacağı).
const scene = new THREE.Scene()
const mk = () => new Tanker(scene, null, 'benzin', 0, new THREE.Vector3(0, 0, 0), () => 0, () => 0)

console.log('2) hareket eden aracın arkasında takip')
{
  const t = mk()
  const p0 = t.group.position.clone()
  // öndeki araç: tankerin 4.5 birim önünde, aynı yönde (kuzey), 0.5 hız (=4 birim/sn)
  const car = { pos: new THREE.Vector3(p0.x, p0.y + 4.5, 0), hiz: 0.5 }
  const sep = (t.len + 2.2) / 2 + 0.4
  let minAralik = Infinity, minHiz = Infinity, durdu = 0, olculen = 0
  const dt = 1 / 30 // mobil alt sınır (30 fps): bir karede en fazla 0.27 birim yol
  for (let i = 0; i < 150; i++) {
    car.pos.y += 8 * car.hiz * dt
    t.update(dt, (pos, dir) => {
      const rel = new THREE.Vector3().subVectors(car.pos, pos); rel.z = 0
      const f = rel.dot(dir)
      if (f < 0.5 || f > sep * 1.6) return 1
      return aralikOlcegi(f, sep, Math.min(0.3, car.hiz))
    })
    const hd = t.headingDir()
    if (hd && hd.y > 0.9) { // yalnız kuzeye giden ilk bacak: araç gerçekten önde
      olculen++
      minAralik = Math.min(minAralik, car.pos.y - t.group.position.y)
      minHiz = Math.min(minHiz, t.hizOrani)
      if (t.hizOrani === 0) durdu++
    }
  }
  check('ölçüm boş değil (≥ 60 kare takip)', olculen >= 60, `${olculen} kare`)
  check('tanker hiç durmadı', durdu === 0, `${durdu} kare durdu`)
  // tolerans: tek karelik yaklaşma payı (kapanma hızı 4 birim/sn × dt)
  check('aralık öndekinin gövdesine girmedi', minAralik >= sep - 0.4 - 4 * dt, `min ${minAralik.toFixed(2)} (sınır ${(sep - 0.4).toFixed(2)})`)
  check('takipte hız taban ≥ 0.3', minHiz >= 0.3 - 1e-9, `min hız ${minHiz.toFixed(2)}`)
}

console.log('3) duran araç önünde tam dur + 7 sn zorlama kapısı')
{
  const t = mk()
  const y0 = t.group.position.y
  let kareDur = 0, zorladi = false
  for (let i = 0; i < 100; i++) {
    t.update(0.1, () => 0)
    if (t.hizOrani === 0) kareDur++
    if (t.group.position.y > y0 + 0.01) zorladi = true
  }
  check('ilk 7 sn hiç ilerlemedi', kareDur >= 69, `${kareDur} kare durdu`)
  check('7 sn sonra zorlama kapısı açıldı', zorladi)
}

console.log('4) yola katılım boşluğu: 0 → ilerleme yok')
{
  const t = mk()
  const y0 = t.group.position.y
  for (let i = 0; i < 30; i++) t.update(0.1, () => 0)
  check('3 sn boyunca yerinde', Math.abs(t.group.position.y - y0) < 1e-9)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
