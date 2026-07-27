/**
 * ÇERÇEVELEME TESTİ — "görüş açımı kapayan çok şey var" şikâyetinin ölçüsü.
 *
 * Sahne yerleşimini artık VERİDEN okuyor (src/scenery.ts) ve kamera matematiğiyle
 * ölçüyor: hangi dekor istasyonun önüne geçiyor, hangisi parseli kapatıyor, hangisi
 * yolun içine düşüyor. Gözle bakmaya gerek kalmadan regresyon yakalar.
 *
 * Çalıştır: npm run test:framing
 */
import {
  SCENE_PLANS, CAM_DIRS, camBasis, screenBox, STATION_BOX, RULES, footprint,
} from '../../src/scenery.ts'

let pass = 0, fail = 0
const check = (n, c, d = '') => {
  c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`))
}

const BASES = CAM_DIRS.map(camBasis)
const STATION = BASES.map(b => screenBox(STATION_BOX.cx, STATION_BOX.cy, STATION_BOX.w, STATION_BOX.d, STATION_BOX.h, b))

/** iki ekran kutusunun kesişim alanı / istasyon alanı */
function coverRatio(box, st) {
  const w = Math.min(box.x1, st.x1) - Math.max(box.x0, st.x0)
  const h = Math.min(box.y1, st.y1) - Math.max(box.y0, st.y0)
  if (w <= 0 || h <= 0) return 0
  return (w * h) / ((st.x1 - st.x0) * (st.y1 - st.y0))
}

console.log('== K1) Yol/kanal koridoru boş ==')
for (const [loc, plan] of Object.entries(SCENE_PLANS)) {
  const [a, b] = RULES.roadCorridor
  const bad = plan.filter(p => {
    const [w] = footprint(p.model, p.h)
    return p.x + w / 2 > a && p.x - w / 2 < b
  })
  check(`${loc}: koridorda (x ${a}..${b}) dekor yok`, bad.length === 0,
    bad.map(p => `${p.model}@${p.x}`).join(' '))
}

console.log('\n== K2) Karşı yaka ALÇAK (kameraya yakın taraf) ==')
for (const [loc, plan] of Object.entries(SCENE_PLANS)) {
  const bad = plan.filter(p =>
    p.x > RULES.farSideX && Math.abs(p.y) <= RULES.farSideYBand && p.h > RULES.farSideMaxH)
  check(`${loc}: x>${RULES.farSideX} & |y|≤${RULES.farSideYBand} bandında h≤${RULES.farSideMaxH}`,
    bad.length === 0, bad.map(p => `${p.model} h=${p.h}@(${p.x},${p.y})`).join(' '))
}

console.log('\n== K3) İstasyonun sırtı boğulmuyor ==')
for (const [loc, plan] of Object.entries(SCENE_PLANS)) {
  const bad = plan.filter(p =>
    p.x > RULES.westFreeX && p.x < -6.5 && p.h > RULES.backyardMaxH)
  check(`${loc}: x ${RULES.westFreeX}..-6.5 bandında h≤${RULES.backyardMaxH}`,
    bad.length === 0, bad.map(p => `${p.model} h=${p.h}@(${p.x},${p.y})`).join(' '))
}

console.log('\n== K4) Parsel bandındaki her şey silinebilir dekor ==')
for (const [loc, plan] of Object.entries(SCENE_PLANS)) {
  if (loc === 'marina') continue // marinada parsel satışı yok (ada dekoru kalıcı)
  const [px0, px1] = RULES.parcelX, [py0, py1] = RULES.parcelY
  const bad = plan.filter(p =>
    p.x >= px0 && p.x <= px1 && p.y >= py0 && p.y <= py1 && !p.parcel)
  check(`${loc}: parsel bandındaki modeller parcel:true`, bad.length === 0,
    bad.map(p => `${p.model}@(${p.x},${p.y})`).join(' '))
  // ters yön: parsel dışına parcel:true konulmuş mu (yanlış etiket → sonsuza dek durur)
  const mis = plan.filter(p => p.parcel &&
    (p.x < px0 || p.x > px1 || p.y < py0 || p.y > py1))
  check(`${loc}: parsel dışında yanlış parcel:true yok`, mis.length === 0,
    mis.map(p => `${p.model}@(${p.x},${p.y})`).join(' '))
}

console.log('\n== K5) Ekran-uzayı örtme: istasyonun önünü kimse kapatmıyor ==')
for (const [loc, plan] of Object.entries(SCENE_PLANS)) {
  const worst = []
  plan.forEach(p => {
    const [w, d] = footprint(p.model, p.h)
    let mx = 0, ang = 0
    BASES.forEach((b, i) => {
      const box = screenBox(p.x, p.y, w, d, p.h, b)
      if (box.depth <= STATION[i].depth) return       // arkada → örtemez
      const c = coverRatio(box, STATION[i])
      const lim = i === RULES.flatAngle ? RULES.maxCoverFlat : RULES.maxCover
      const over = c / lim                            // eşiğe göre normalize et
      if (over > mx) { mx = over; ang = i; }
    })
    if (mx > 0.08) worst.push({ p, mx, ang })
  })
  worst.sort((a, b) => b.mx - a.mx)
  const over = worst.filter(w => w.mx > 1)
  check(`${loc}: hiçbir dekor açı eşiğini (%${RULES.maxCover * 100} / yatıkta %${RULES.maxCoverFlat * 100}) aşmıyor`,
    over.length === 0,
    over.slice(0, 4).map(o => `${o.p.model}@(${o.p.x},${o.p.y}) eşiğin ${o.mx.toFixed(2)}× katı, açı${o.ang}`).join(' '))
  if (worst.length) {
    const t = worst[0]
    console.log(`      ↳ eşiğe en yakın: ${t.p.model}@(${t.p.x},${t.p.y}) ${t.mx.toFixed(2)}× açı${t.ang}`)
  }
}

console.log('\n== K6) Çerçeve boş kalmıyor (şube başına yeterli kütle) ==')
for (const [loc, plan] of Object.entries(SCENE_PLANS)) {
  check(`${loc}: en az 8 çevre öğesi var`, plan.length >= 8, `${plan.length} öğe`)
  const outside = plan.filter(p => !p.parcel).length
  check(`${loc}: parsel dışında en az 2 kalıcı kütle var (arsa dolsa da çerçeve durur)`,
    outside >= 2, `${outside} kalıcı`)
}

console.log('\n== K7) Şubeler birbirinin kopyası değil ==')
const keys = Object.keys(SCENE_PLANS)
for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) {
  const a = SCENE_PLANS[keys[i]], b = SCENE_PLANS[keys[j]]
  const sa = new Set(a.map(p => `${p.model}|${p.x}|${p.y}`))
  const same = b.filter(p => sa.has(`${p.model}|${p.x}|${p.y}`)).length
  check(`${keys[i]} ↔ ${keys[j]}: ortak yerleşim yok`, same === 0, `${same} aynı`)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
