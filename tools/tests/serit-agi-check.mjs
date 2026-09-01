/**
 * ŞERİT AĞI YERLEŞİM DAYANIKLILIĞI TESTİ
 *
 * ŞİKÂYETİN KÖKÜ (ölçülmüş boşluk): şerit ağı yalnız OTOPARK koridorlarını katı cisme
 * karşı doğruluyordu. Kuyruk slotları, gelen/giden omurga ve ünite kolları HİÇ
 * sınanmıyordu. Yerleştirme doğrulaması (main.ts fixedObstacles) ise şeritleri SABİT
 * yazılı bir bantla (cx 2.8 / w 1.5) koruyordu; oysa hesaplanan omurga o bandın dışına
 * çıkabiliyor (yakın yakada xIn 1.6..3.7). Sonuç: oyuncu KURALLARA UYGUN bir bina koyup
 * kendi trafiğini kilitleyebiliyordu — araçlar gövdenin dibinde birikiyor, pompa boş.
 *
 * Bu test GERÇEK LaneNetwork ve GERÇEK CarManager ile ölçer (sahte yardımcı yok):
 *   a) kuyruk slotunun üstüne bina → o slot DÜŞER, ötekiler yerinde, kapasite n−1
 *   b) gelen omurganın üstüne bina → kolon derinlik bandında KAYAR, LANE_SEP korunur
 *   c) bir pompanın kolunu kutulayan bina → pompa ERİŞİLEMEZ, CarManager oraya ARAÇ
 *      GÖNDERMEZ (2 dakikalık başsız koşu: öteki pompada servis var, o pompa hiç dolmaz)
 *   d) 180° dönmüş pompa (yuva gövdenin arkasında) → kol gövdenin UCUNDAN dolanır,
 *      hiçbir bacak gövde dikdörtgenini KESMEZ (slab testi)
 *   e) laneRezervleri() hesaplanan HER kuyruk slotunu ve HER İKİ omurgayı kapsar
 *
 * Çalıştır:  npx tsx tools/tests/serit-agi-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
let __seed = 20260902
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd

const THREE = await import('three')
const { LaneNetwork, LANE_SEP, IN_DEPTH_MIN, IN_DEPTH_MAX, uniteKolu } = await import('../../src/traffic-graph.ts')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')
const { PUMP_SLOTS_POS, LANE_NEAR, APRON_IN_Y, APRON_OUT_Y } = await import('../../src/world.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

// ── ortak yardımcılar (oyunun kendi kalıpları; test için yeni geometri UYDURULMAZ) ──
const PAD = 0.45 // Car.insideSolid payı ile birebir
/** katı cisim testi — LaneNetwork.rebuild'in beklediği blocked(x,y) imzası */
const kapali = rects => (x, y) => rects.some(o =>
  Math.abs(x - o.cx) < o.w / 2 + PAD && Math.abs(y - o.cy) < o.d / 2 + PAD)
const bosYap = rects => { const k = kapali(rects); return (x, y) => !k(x, y) }
/** main.ts unitRect ile birebir (90°/270°'de en-boy takas) */
const govde = (bx, by, ang, w, d) => {
  const swap = Math.abs(Math.sin(ang)) > 0.5
  return { cx: bx, cy: by, w: swap ? d : w, d: swap ? w : d }
}
/** yakın yaka istasyon geometrisi (cars.ts geom('near') ile aynı değerler) */
const nearGeom = (units, over = {}) => ({
  station: 'near', gateX: 4.2, lane: LANE_NEAR, gateInY: -14, gateOutY: 14,
  sideSign: -1, dirY: 1, wide: false, units, parks: [], ...over,
})
const yakin = (a, b, e = 1e-6) => Math.abs(a - b) < e

// pompa-0: varsayılan kasaba yuvası (1.8,−2.2), gövde yuvanın 1.8 batısında
const P0 = { x: PUMP_SLOTS_POS[0].x, y: PUMP_SLOTS_POS[0].y }
const P0BODY = govde(P0.x - 1.8, P0.y, 0, 1.5, 3.4)
const unitP0 = { id: 'pump-0', x: P0.x, y: P0.y, rect: P0BODY }

// ───────────────────────────────── a) KUYRUK SLOTU ELEMESİ
console.log('\n== a) Kuyruk slotunun üstüne bina → o slot düşer, kapasite n−1 ==')
{
  const temiz = new LaneNetwork()
  temiz.rebuild([nearGeom([unitP0])], kapali([P0BODY]))
  const L0 = temiz.get('near')
  const r0 = temiz.laneRapor('near')
  check(`temiz yerleşimde kuyruk DOLU ölçülüyor (ana ${r0.kuyruk} + banket ${r0.banket})`,
    L0.queue.length >= 4 && r0.kuyruk >= 1 && r0.banket >= 1, JSON.stringify(r0))
  check('temiz yerleşimde hiçbir slot düşmedi', r0.dususen === 0, String(r0.dususen))

  // BANKET slotunun üstüne bina koy (omurgayı HİÇ kesmez → kayma yok, tek değişken slot)
  const hedef = L0.queue[L0.spillStart]
  const bina = { cx: hedef.x, cy: hedef.y, w: 2.0, d: 2.0 }
  const kirli = new LaneNetwork()
  kirli.rebuild([nearGeom([unitP0])], kapali([P0BODY, bina]))
  const L1 = kirli.get('near'), r1 = kirli.laneRapor('near')
  check(`kapasite tam olarak 1 azaldı (${L0.queue.length} → ${L1.queue.length})`,
    L1.queue.length === L0.queue.length - 1, `${L0.queue.length} → ${L1.queue.length}`)
  check('düşen slot sayacı 1', r1.dususen === 1, String(r1.dususen))
  check('kapalı slot listede YOK',
    !L1.queue.some(q => yakin(q.x, hedef.x) && yakin(q.y, hedef.y)))
  check('omurga kaymadı (banket omurgayı kesmez)', yakin(L1.xIn, L0.xIn) && yakin(L1.xOut, L0.xOut),
    `${L0.xIn}/${L0.xOut} → ${L1.xIn}/${L1.xOut}`)
  const kalanlar = L0.queue.filter(q => !(yakin(q.x, hedef.x) && yakin(q.y, hedef.y)))
  check('geri kalan slotların HEPSİ birebir yerinde',
    kalanlar.length === L1.queue.length
    && kalanlar.every((q, i) => yakin(q.x, L1.queue[i].x) && yakin(q.y, L1.queue[i].y)))

  // ANA HAT slotu: derinlik bandını boydan boya kesen bina (kolon kaçamaz, slot düşer)
  const anaHedef = L0.queue[L0.spillStart - 1]
  const duvar = { cx: 2.6, cy: anaHedef.y, w: 4.4, d: 1.2 }
  const k2 = new LaneNetwork()
  k2.rebuild([nearGeom([unitP0])], kapali([P0BODY, duvar]))
  const L2 = k2.get('near'), r2 = k2.laneRapor('near')
  check(`ana hat slotu da eleniyor (ana ${r0.kuyruk} → ${r2.kuyruk})`, r2.kuyruk === r0.kuyruk - 1,
    `${r0.kuyruk} → ${r2.kuyruk}`)
  check('ana hat slotu düşünce BANKET telafi etmiyor (kapasite gerçekten azalır)',
    L2.queue.length === L0.queue.length - 1, `${L0.queue.length} → ${L2.queue.length}`)
}

// ───────────────────────────────── b) OMURGA KAYMASI
console.log('\n== b) Gelen omurganın üstüne bina → kolon kayar, LANE_SEP korunur ==')
{
  const temiz = new LaneNetwork()
  temiz.rebuild([nearGeom([unitP0])], kapali([P0BODY]))
  const L0 = temiz.get('near')
  // omurga kolonunun üstüne, kapı ile pompa arasına dar bir bina
  const bina = { cx: L0.xIn, cy: -8, w: 1.2, d: 3.0 }
  const net = new LaneNetwork()
  net.rebuild([nearGeom([unitP0])], kapali([P0BODY, bina]))
  const L = net.get('near'), r = net.laneRapor('near')
  check(`gelen omurga KAYDI (${L0.xIn.toFixed(2)} → ${L.xIn.toFixed(2)})`, !yakin(L.xIn, L0.xIn),
    `${L0.xIn} → ${L.xIn}`)
  check("kayma 0.25'lik adımlarla ve derinlik bandının içinde",
    (() => {
      const d = 4.2 - L.xIn
      return d >= IN_DEPTH_MIN - 1e-9 && d <= IN_DEPTH_MAX + 1e-9
        && Math.abs(Math.round(d * 4) - d * 4) < 1e-6
    })(), `derinlik ${(4.2 - L.xIn).toFixed(3)}`)
  check(`LANE_SEP korunuyor (|xIn−xOut| = ${Math.abs(L.xIn - L.xOut).toFixed(3)} ≥ ${LANE_SEP})`,
    Math.abs(L.xIn - L.xOut) >= LANE_SEP - 1e-9)
  check('omurga tıkalı BAYRAĞI kalkmadı (temiz kolon bulundu)', r.omurgaTikali === false)
  // yeni kolon GERÇEKTEN temiz: kapıdan en uzak üniteye kadar nokta nokta tara
  const bos = bosYap([P0BODY, bina])
  const tara = (x, y0, y1) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y += 0.25) if (!bos(x, y)) return false
    return true
  }
  check('yeni GELEN omurga baştan sona temiz', tara(L.xIn, L.gateInY, P0.y))
  check('yeni GİDEN omurga baştan sona temiz', tara(L.xOut, P0.y, L.gateOutY))
  check('kuyruk slotları yeni kolona taşındı',
    L.queue.slice(0, L.spillStart).every(q => yakin(q.x, L.xIn)) && L.spillStart >= 1,
    `spillStart=${L.spillStart}`)
}

// ───────────────────────────────── c) KOLU KAPALI POMPA
console.log('\n== c) Bir pompanın kolunu kutulayan bina → pompa erişilemez, araç GÖNDERİLMEZ ==')
const P1 = { x: 1.8, y: 6 }
const P1BODY = govde(P1.x - 1.8, P1.y, 0, 1.5, 3.4)
const unitP1 = { id: 'pump-1', x: P1.x, y: P1.y, rect: P1BODY }
// pompa-1'in kolunu kapatan duvar: yuva ile omurga arasında, gövdenin iki ucunu da aşan
const DUVAR = { cx: 2.2, cy: 6, w: 0.6, d: 12 }
{
  const net = new LaneNetwork()
  net.rebuild([nearGeom([unitP0, unitP1])], kapali([P0BODY, P1BODY, DUVAR]))
  const r = net.laneRapor('near')
  check('pompa-1 ERİŞİLEMEZ işaretlendi', r.erisilemez.includes('pump-1'), JSON.stringify(r.erisilemez))
  check('pompa-0 erişilebilir kaldı (yanlış alarm yok)', !r.erisilemez.includes('pump-0'))
  check('sorgu API de aynı cevabı veriyor',
    net.unitErisilebilir('near', 'pump', 0) === true && net.unitErisilebilir('near', 'pump', 1) === false)
  check('omurga yine de temiz bir kolona oturdu (tıkalı bayrağı yok)', r.omurgaTikali === false,
    `xIn=${r.xIn}`)
}

// ---- 2 dakikalık BAŞSIZ KOŞU: gerçek CarManager, gerçek Car.solids ----
{
  __seed = 20260902
  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = 2; state.evChargers = 0
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3
  const slots = [new THREE.Vector3(P0.x, P0.y, 0), new THREE.Vector3(P1.x, P1.y, 0)]
  const rects = [P0BODY, P1BODY, DUVAR]
  let served = 0, lost = 0
  const servedBy = [0, 0]
  const mgr = new CarManager(scene, null, {
    pumpCount: () => 2, evCount: () => 0,
    pumpSlot: i => slots[i], evSlot: () => new THREE.Vector3(1.8, 20, 0),
    pumpAngle: () => 0, evAngle: () => 0,
    unitRect: (kind, i) => (kind === 'pump' ? rects[i] : null),
    gateInY: () => -14, gateOutY: () => 14,
    entryChance: () => 0.9, evShare: () => 0,
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => 1.6,
    isPumpBroken: () => false, isChargerBroken: () => false,
    parkSpots: () => [], truckSpots: () => [], extraObstacles: () => [],
    wideGates: () => false,
    onCarReady: c => { served++; servedBy[c.slotIndex] = (servedBy[c.slotIndex] ?? 0) + 1; c.phase = 'atPump' },
    onCarLost: () => { lost++ },
  })
  Car.solids = rects
  Car.katiIcindeSlot = 0
  let kapaliDoldu = 0, gozlem = 0
  const busy = new Map()
  for (let i = 0; i < 1200; i++) {
    mgr.update(0.1)
    for (const c of mgr.cars) if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    // ERİŞİLEMEZ POMPAYA ARAÇ ATANDI MI — her karede bak (tek kare bile kaçmasın)
    for (const c of mgr.cars) {
      if (c.phase === 'gone' || c.phase === 'transit') continue
      gozlem++
      if (c.slotIndex === 1) kapaliDoldu++
    }
    for (const [c, until] of [...busy]) {
      if (i < until) continue
      busy.delete(c)
      if (c.phase === 'atPump') mgr.releaseCar(c)
    }
  }
  Car.solids = []
  console.log(`     [ölçüm] servis ${served} (pompa-0: ${servedBy[0]} · pompa-1: ${servedBy[1]}) · kayıp ${lost} · araç-kare örneklemi ${gozlem}`)
  check(`ölçüm DOLU kümede yapıldı (${gozlem} araç-kare)`, gozlem > 500, String(gozlem))
  check(`AÇIK pompada servis akıyor (pompa-0: ${servedBy[0]})`, servedBy[0] > 0, String(servedBy[0]))
  check('KAPALI pompaya hiçbir karede araç atanmadı', kapaliDoldu === 0, `${kapaliDoldu} araç-kare`)
  check('kapalı pompada servis edilen müşteri YOK', !servedBy[1], String(servedBy[1]))
  check('slot katı cismin içinde bulunma sayacı 0 (savunma katmanı hiç tetiklenmedi)',
    Car.katiIcindeSlot === 0, String(Car.katiIcindeSlot))
}

// ───────────────────────────────── d) 180° DÖNMÜŞ POMPA: GÖVDENİN UCUNDAN DOLANMA
console.log('\n== d) 180° dönmüş pompa (yuva gövdenin arkasında) → kol gövdeyi KESMEZ ==')
{
  const base = { x: 0, y: -2.2 }
  const ang = Math.PI                       // rot=2 → world.addPump dir = π
  const body = govde(base.x, base.y, ang, 1.5, 3.4)
  const slot = { x: base.x + Math.cos(ang) * 1.8, y: base.y + Math.sin(ang) * 1.8 }
  check(`yuva gövdenin ARKASINDA (slot.x ${slot.x.toFixed(2)} < gövde ${body.cx.toFixed(2)})`, slot.x < body.cx)
  const unit = { id: 'pump-0', x: slot.x, y: slot.y, rect: body }
  const net = new LaneNetwork()
  net.rebuild([nearGeom([unit])], kapali([body]))
  const L = net.get('near'), r = net.laneRapor('near')
  check('pompa ERİŞİLEBİLİR (dolanma sayesinde)', !r.erisilemez.length, JSON.stringify(r.erisilemez))
  const kol = L.kollar.get('pump-0')
  check('kol gövdenin ucundan DOLANIYOR (düz değil)', kol.dolanma === true)
  check('giriş kolu omurgada başlıyor, slotta bitiyor',
    yakin(kol.giris[0].x, L.xIn) && yakin(kol.giris[kol.giris.length - 1].x, slot.x)
    && yakin(kol.giris[kol.giris.length - 1].y, slot.y))
  check('çıkış kolu slotta başlıyor, giden omurgada bitiyor',
    yakin(kol.cikis[0].x, slot.x) && yakin(kol.cikis[kol.cikis.length - 1].x, L.xOut))
  // SLAB TESTİ: hiçbir bacak gövde dikdörtgenini kesmiyor
  const kesiyor = (a, b, r2) => {
    const dx = b.x - a.x, dy = b.y - a.y
    let t0 = 0, t1 = 1
    for (const [p, q] of [[-dx, a.x - (r2.cx - r2.w / 2)], [dx, (r2.cx + r2.w / 2) - a.x],
                          [-dy, a.y - (r2.cy - r2.d / 2)], [dy, (r2.cy + r2.d / 2) - a.y]]) {
      if (p === 0) { if (q < 0) return false; continue }
      const t = q / p
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
      else { if (t < t0) return false; if (t < t1) t1 = t }
    }
    return t0 <= t1
  }
  const bacaklar = []
  for (const yol of [kol.giris, kol.cikis]) for (let i = 1; i < yol.length; i++) bacaklar.push([yol[i - 1], yol[i]])
  check(`ölçülen bacak sayısı dolu (${bacaklar.length})`, bacaklar.length >= 4, String(bacaklar.length))
  check('HİÇBİR bacak gövde dikdörtgenini kesmiyor (slab testi)',
    !bacaklar.some(([a, b]) => kesiyor(a, b, body)),
    bacaklar.filter(([a, b]) => kesiyor(a, b, body)).map(([a, b]) => `(${a.x},${a.y})→(${b.x},${b.y})`).join(' | '))
  // DÜZ KOL KONTROL GRUBU: aynı gövde 0°'de düz kolla çalışır (dolanma gereksiz yere açılmasın)
  const duzSlot = { x: base.x + 1.8, y: base.y }
  const duz = uniteKolu(duzSlot, body, L.xIn, L.xOut, bosYap([body]))
  check('0° pompada kol DÜZ kalıyor (dolanma yok, eski davranış birebir)',
    duz.acik === true && duz.dolanma === false && duz.giris.length === 2)
  // aynı hesap SAF yardımcıdan da (main.ts yerleştirme kapısı bunu kullanır)
  const saf = uniteKolu(slot, body, L.xIn, L.xOut, bosYap([body]))
  check('saf uniteKolu() yardımcısı da AÇIK diyor (yerleştirme kapısı ile aynı sonuç)', saf.acik === true)
  const bogulmus = uniteKolu(slot, body, L.xIn, L.xOut,
    bosYap([body, { cx: slot.x, cy: slot.y, w: 1.0, d: 1.0 }]))
  check('yuvanın üstü kapalıysa saf yardımcı KAPALI diyor', bogulmus.acik === false)
}

// ───────────────────────────────── e) YERLEŞTİRME REZERVLERİ
console.log('\n== e) laneRezervleri() hesaplanan şeritlerin HEPSİNİ kapsıyor ==')
{
  // varsayılan KASABA yerleşimi: tek pompa varsayılan yuvasında, kapılar apron y'lerinde
  const net = new LaneNetwork()
  net.rebuild([nearGeom([unitP0], { gateInY: APRON_IN_Y, gateOutY: APRON_OUT_Y })], kapali([P0BODY]))
  const L = net.get('near')
  const rez = net.laneRezervleri()
  const icinde = (x, y) => rez.some(o => Math.abs(x - o.cx) <= o.w / 2 + 1e-9 && Math.abs(y - o.cy) <= o.d / 2 + 1e-9)
  check(`rezerv listesi dolu (${rez.length} dikdörtgen)`, rez.length >= 5, String(rez.length))
  check(`HER kuyruk slotu rezervin içinde (${L.queue.length} slot)`,
    L.queue.length > 0 && L.queue.every(q => icinde(q.x, q.y)),
    L.queue.filter(q => !icinde(q.x, q.y)).map(q => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' | '))
  // omurgalar: kapıdan en uzak üniteye kadar nokta nokta
  const omurgaKapali = (x, y0, y1) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1) + 1e-9; y += 0.5) if (!icinde(x, y)) return false
    return true
  }
  check('GELEN omurga baştan sona rezervli', omurgaKapali(L.xIn, L.gateInY, P0.y))
  check('GİDEN omurga baştan sona rezervli', omurgaKapali(L.xOut, P0.y, L.gateOutY))
  const kol = L.kollar.get('pump-0')
  const kolNoktalari = [...kol.giris, ...kol.cikis]
  check(`ünite KOLU da rezervli (${kolNoktalari.length} nokta)`,
    kolNoktalari.every(p => icinde(p.x, p.y)))
  check('rezervler ait olduğu üniteyi etiketliyor (taşırken kendi kolu engellemesin)',
    rez.some(o => o.unite === 'pump-0'))
  // eski SABİT bandın kaçırdığı hâl: omurga bandın dışına çıkınca rezerv de onunla gider
  const uzak = { id: 'pump-0', x: -3.4, y: -2.2, rect: govde(-5.2, -2.2, 0, 1.5, 3.4) }
  const net2 = new LaneNetwork()
  net2.rebuild([nearGeom([uzak])], kapali([uzak.rect]))
  const L2 = net2.get('near'), rez2 = net2.laneRezervleri()
  const icinde2 = (x, y) => rez2.some(o => Math.abs(x - o.cx) <= o.w / 2 + 1e-9 && Math.abs(y - o.cy) <= o.d / 2 + 1e-9)
  check(`derin pompada omurga sabit bandın (2.05..3.55) DIŞINA çıkıyor (xIn=${L2.xIn.toFixed(2)})`,
    L2.xIn < 2.05 || L2.xIn > 3.55, String(L2.xIn))
  check('rezerv omurgayla birlikte kaydı (sabit bant olsa kaçırırdı)', icinde2(L2.xIn, L2.gateInY))
}

console.log(`\n${fail ? '❌' : '✅'} şerit ağı yerleşim dayanıklılığı: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
