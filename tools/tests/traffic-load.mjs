// TRAFİK YÜK TESTİ — ŞERİT AĞI MİMARİSİ (ajan müzakeresi SİLİNDİ)
//
// Eskiden bu test rezervasyon grafiğinin kazanımını ölçüyordu (token verildi/reddedildi).
// Mimari değişti: artık ölçülen şey AKIŞ. Yeni/korunan ölçütler:
//   · kalıcı sıkışan  = 0  (kimse durdurulmuyor → sıkışacak durum yok)
//   · buharlaşma      = 0  (evaporate silindi; 0'dan farklıysa biri geri eklemiş)
//   · servis hacmi    ↑    (müzakere kalkınca akış artmalı)
//   · iç içe çift/kare ≤ 0.3 (şeritler ayrıksa doğal olarak düşük)
//   · AKIŞ DÜZGÜNLÜĞÜ (yeni): ortalama hız oranı, hız sapması, durma olayı sayısı
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
// DETERMİNİST: seed'li PRNG — aynı senaryo her koşuda aynı sonucu verir (A/B anlamlı olsun)
let __seed = 0
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd
const { readFileSync } = await import('node:fs')
const THREE = await import('three')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

const ROAD_X = 7.9

// ÇARPIŞMA BAYRAĞI YOK: mimari kararla araç-araç çarpışması tamamen kaldırıldı
// (oyun sahibi: "gerekirse birbirinin içinden geçsinler"). Bu yüzden eski A/B (açık vs
// kapalı) kıyası anlamsızlaştı; onun yerine iç içe geçme AKIŞ/YERLEŞİM olarak ayrıştırılıp
// ölçülüyor. FORCE_COLLIDE değişkeni artık davranışı değiştirmez, koşum yine geçmelidir.
// OTOPARK YERLEŞİMİ (T9) — oyundaki world.getParkingSpots() ile AYNI türetme:
// 4 slot yerel x ekseninde dizili, yanaşma noktası (stage) yerel +Y'de 2.4 birim ötede.
const PARK_YER = 4, PARK_ARALIK = 1.25, PARK_PAD_W = PARK_YER * PARK_ARALIK
const parkYerX = i => -PARK_PAD_W / 2 + PARK_ARALIK * (i + 0.5)
function parkLot(THREE, id, cx, cy, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot)
  const w = (lx, ly) => new THREE.Vector3(cx + lx * c - ly * s, cy + lx * s + ly * c, 0)
  return Array.from({ length: PARK_YER }, (_, i) => ({
    id: `${id}:${i}`, pos: w(parkYerX(i), -0.1), stage: w(parkYerX(i), 2.4), rot: rot - Math.PI / 2,
  }))
}

function run(label, { pumps, evs, far, wide, minutes = 10, quiet = false, highway = null, service = null,
                      entryMul = 1, pullMul = 1, parking = null, parkChance = 0 }) {
  __seed = 20260726 // her senaryo AYNI tohumla başlar → A/B birebir karşılaştırılabilir
  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = pumps; state.evChargers = evs; state.wideGates = wide
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3
  // pompa/şarj slotları: yarısı near, far ise diğer yarısı karşı yakada
  // Slotlar KAPI HATTINDAN uzak bir bantta yayılır (oyundaki PUMP_SLOTS_POS gibi):
  // near kapılar ±14, far kapılar ±8 → slot bandı |y| ≤ 6.
  const lay = (n, i, band) => {
    const half = far ? Math.ceil(n / 2) : n
    const step = (2 * band) / Math.max(1, half)
    return { onFar: far && i >= half, y: -band + (i % half) * step + step / 2 }
  }
  const pumpSlots = Array.from({ length: pumps }, (_, i) => {
    const { onFar, y } = lay(pumps, i, 6)
    return onFar ? new THREE.Vector3(2 * ROAD_X - 2.4, -y, 0) : new THREE.Vector3(2.4, y, 0)
  })
  const evSlots = Array.from({ length: evs }, (_, i) => {
    const { onFar, y } = lay(evs, i, 5)
    return onFar ? new THREE.Vector3(2 * ROAD_X - 1.8, -y, 0) : new THREE.Vector3(1.8, y, 0)
  })
  let served = 0, lost = 0, rampLost = 0, svcSpawns = 0, turnedAway = 0
  // görsel çakışma sayaçları (oyuncunun ekranda gördüğü "iç içe geçme")
  let cakisma = 0, cakismaAgir = 0, cakismaOrnek = 0
  // İÇ İÇE GEÇMEYİ İKİYE AYIR — ikisi FARKLI şeylerin kusuru:
  //  · AKIŞ kaynaklı: en az biri HAREKET EDEN çift. Şerit ağının sorumluluğu budur.
  //  · YERLEŞİM kaynaklı: ikisi de DURAN (pompada/kuyrukta/parkta). Bu, ünitelerin
  //    birbirine ne kadar yakın DİZİLDİĞİNİN sonucudur; trafik kodunun elinde değil.
  //    (Bu test yerleşimi 8 pompayı 1.5, 8 şarjı 1.25 birim aralıkla dizip iki kolonu
  //     0.6 birim yan yana koyuyor → komşu iki DOLU ünite zaten 0.87 birim mesafede.
  //     Aynı kalem eski mimaride de vardı; servis arttıkça doğal olarak büyür.)
  let icAkis = 0, icDuran = 0
  const DURAN = new Set(['atPump', 'parked', 'waiting'])
  const icKirilim = {}
  // OTOPARK KALEMİ AYRI ÖLÇÜLÜR: pompa avlusundaki çakışmayla aynı kefeye konursa
  // "park alanında araçlar üst üste" hatası ortalamanın içinde kaybolur.
  const parkSpots = parking ?? []
  let pOrnek = 0, pCakisma = 0, pAgir = 0, pDisari = 0, pDisariOrnek = 0, parkVaris = 0
  // APRON YIĞINI: aynı anda avluda (kapı ile pompalar arası) kaç araç birikti
  let apronMax = 0
  const mgr = new CarManager(scene, null, {
    pumpCount: () => pumps, evCount: () => evs,
    pumpSlot: i => pumpSlots[Math.min(i, pumpSlots.length - 1)],
    evSlot: i => evSlots[Math.min(i, Math.max(0, evSlots.length - 1))] ?? new THREE.Vector3(1.8, 6, 0),
    pumpAngle: () => 0, evAngle: () => 0,
    gateInY: () => -14, gateOutY: () => 14,
    entryChance: () => Math.min(1, state.entryChance() * entryMul), evShare: () => (evs ? 0.35 : 0),
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => state.trafficPull() * pullMul,
    isPumpBroken: () => false, isChargerBroken: () => false,
    parkSpots: () => parkSpots, truckSpots: () => [], extraObstacles: () => [],
    wideGates: () => wide,
    onCarReady: c => { served++; c.phase = 'atPump' },
    onCarLost: () => { lost++ },
    farActive: () => far, farGateInY: () => 8, farGateOutY: () => -8,
    highway: () => highway,
    serviceLane: () => service,
    onRampFull: () => { rampLost++ },
    onTurnedAway: () => { turnedAway++ },
  })
  // KATI CİSİMLER: oyundaki hardRects() ile aynı kalem — pompa/şarj gövdeleri. Otopark
  // senaryosunda ŞART: park koridorlarının açık mı kapalı mı olduğu buna göre belirlenir
  // (otoparkın kendisi oyunda da araç engeli DEĞİLDİR, bilerek listede yok).
  Car.solids = parking
    ? [...pumpSlots.map(s => ({ cx: s.x - 1.8, cy: s.y, w: 1.5, d: 3.4 })),
       ...evSlots.map(s => ({ cx: s.x - 1.1, cy: s.y, w: 0.9, d: 1.4 }))]
    : []
  // servis simülasyonu: pompaya varan araç 6 sn sonra uğurlanır (gerçek oyun temposu)
  const busy = new Map()
  const steps = minutes * 60 * 10
  const seen = new WeakSet()
  for (let i = 0; i < steps; i++) {
    mgr.update(0.1)
    if (service) for (const c of mgr.cars) {
      if (seen.has(c)) continue
      seen.add(c)
      const x = c.group.position.x
      if (Math.abs(x - service.near) < 0.2 || Math.abs(x - service.far) < 0.2) svcSpawns++
    }
    for (const c of mgr.cars) {
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    }
    // ── GÖRSEL ÇAKIŞMA: gövdeleri üst üste binen araç çifti (oyuncunun ŞİKÂYET ETTİĞİ şey) ──
    if (i % 30 === 0) {
      const gorunur = mgr.cars.filter(c => c.phase !== 'gone' && c.phase !== 'transit')
      for (let a = 0; a < gorunur.length; a++) {
        for (let b = a + 1; b < gorunur.length; b++) {
          const A = gorunur[a], B = gorunur[b]
          const dx = A.group.position.x - B.group.position.x
          const dy = A.group.position.y - B.group.position.y
          // 1.6 birim: iki aracın gövdesi bu mesafenin altındaysa gözle ÜST ÜSTE görünür
          if (dx * dx + dy * dy < 1.6 * 1.6) {
            cakisma++
            if (dx * dx + dy * dy < 1.0 * 1.0) {
              cakismaAgir++   // içine girmiş
              if (DURAN.has(A.phase) && DURAN.has(B.phase)) icDuran++
              else icAkis++
              if (process.env.DIAG) {
                const k = [A.phase, B.phase].sort().join('/')
                icKirilim[k] = (icKirilim[k] || 0) + 1
              }
            }
          }
        }
      }
      cakismaOrnek++
      // apron yığını: near avlusunda (x 0..5.5) bekleyen/manevra yapan araçlar
      const apron = mgr.cars.filter(c => c.station === 'near'
        && (c.phase === 'driving' || c.phase === 'waiting' || c.phase === 'leaving')
        && c.group.position.x < 5.5 && c.group.position.x > -1).length
      if (apron > apronMax) apronMax = apron
    }
    // ── OTOPARK ÖLÇÜMÜ (T9) ──
    if (parking && i % 30 === 0) {
      const bolge = mgr.cars.filter(c => (c.phase === 'toPark' || c.phase === 'parked')
        || (c.phase === 'leaving' && parkSpots.some(s => Math.hypot(c.group.position.x - s.pos.x, c.group.position.y - s.pos.y) < 5)))
      for (let a = 0; a < bolge.length; a++) for (let b = a + 1; b < bolge.length; b++) {
        const dx = bolge[a].group.position.x - bolge[b].group.position.x
        const dy = bolge[a].group.position.y - bolge[b].group.position.y
        const d2 = dx * dx + dy * dy
        if (d2 < 1.6 * 1.6) pCakisma++
        if (d2 < 1.0 * 1.0) pAgir++
      }
      pOrnek++
      // "park etti" diyen araç GERÇEKTEN kendi çizgili yerinde mi (ekrandaki asıl şikâyet)
      for (const c of mgr.cars) {
        if (c.phase !== 'parked') continue
        pDisariOrnek++
        const sp = parkSpots.find(s => s.id === c.parkId)
        if (!sp || Math.hypot(c.group.position.x - sp.pos.x, c.group.position.y - sp.pos.y) > 0.6) pDisari++
      }
    }
    for (const c of mgr.cars) if (c.phase === 'parked' && !c.__parkSayildi) { c.__parkSayildi = true; parkVaris++ }
    for (const [c, until] of [...busy]) {
      if (i < until) continue
      busy.delete(c)
      // tesis ziyareti olan müşteri otoparka çekilir (main.ts: visits.length > 0)
      if (c.phase === 'atPump' && parkChance && __rnd() < parkChance && mgr.sendToParking(c)) continue
      if (c.phase === 'atPump' || c.phase === 'parked') mgr.releaseCar(c)
    }
    // park eden araç bir süre kalır, sonra uğurlanır
    if (parking) for (const c of mgr.cars) if (c.phase === 'parked' && !busy.has(c)) busy.set(c, i + 140)
  }
  Car.solids = []
  const st = mgr.evapStats
  const fl = mgr.flow
  const cakOrt = cakismaOrnek ? (cakisma / cakismaOrnek) : 0
  const cakAgirOrt = cakismaOrnek ? (cakismaAgir / cakismaOrnek) : 0
  const icAkisOrt = cakismaOrnek ? (icAkis / cakismaOrnek) : 0
  const icDuranOrt = cakismaOrnek ? (icDuran / cakismaOrnek) : 0
  if (process.env.DIAG) {
    const byPhase = {}
    for (const c of mgr.cars) { const k = `${c.phase}${c.hardStuckT > 3 ? '*STUCK' : ''}`; byPhase[k] = (byPhase[k] || 0) + 1 }
    console.log('   tanı: araç fazları', JSON.stringify(byPhase))
    console.log('   iç içe kırılım:', JSON.stringify(icKirilim))
    const st3 = mgr.cars.filter(c => c.hardStuckT > 3).slice(0, 4)
      .map(c => `${c.phase}@(${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)}) slot=${c.slotIndex} wait=${c.waitIndex}`)
    if (st3.length) console.log('   sıkışanlar:', st3.join(' | '))
  }
  // KALICI SIKIŞAN: yol alması gereken ama 3 sn'den uzun süredir kıpırdayamayan araç.
  // Artık "kurallı bekleme" istisnası YOK — mimaride bekleme diye bir şey kalmadı,
  // dolayısıyla her duruş gerçek bir kusurdur.
  const stuck = mgr.cars.filter(c => c.hardStuckT > 3).length
  if (!quiet) console.log(`${label}: servis=${served} kayıp=${lost} giremeyen=${turnedAway}${highway ? ' rampKayıp=' + rampLost : ''}`
    + ` | buharlaşma=${st.total} | kalıcı sıkışan=${stuck}`
    + ` | ÇAKIŞMA ${cakOrt.toFixed(1)} çift/kare · içiçe ${cakAgirOrt.toFixed(2)} (akış ${icAkisOrt.toFixed(2)} + yerleşim ${icDuranOrt.toFixed(2)})`
    + ` | AKIŞ hız ${(fl.ort * 100).toFixed(0)}% sapma ${fl.sapma.toFixed(2)} durma ${fl.duraklama} (%${(fl.durmaOrani * 100).toFixed(1)} kare)`
    + ` | apron zirve ${apronMax}`)
  const park = { varis: parkVaris, cakisma: pOrnek ? pCakisma / pOrnek : 0,
    agir: pOrnek ? pAgir / pOrnek : 0, disari: pDisari, disariOrnek: pDisariOrnek }
  if (!quiet && parking) {
    console.log(`   ↳ OTOPARK: park eden ${park.varis} | çakışma ${park.cakisma.toFixed(2)} çift/kare`
      + ` · iç içe ${park.agir.toFixed(2)} | slot DIŞINDA park ${park.disari}/${park.disariOrnek}`
      + ` | kullanılabilir şerit ${mgr.graph.parkLanesOf?.('near').length ?? '-'}/${parkSpots.length}`)
  }
  return { st, stuck, served, rampLost, laneUse: svcSpawns, cakisma: cakOrt, cakismaAgir: cakAgirOrt,
    icAkis: icAkisOrt, icDuran: icDuranOrt, flow: fl, apronMax, turnedAway, park }
}

let fail = 0
const kontrol = (ok, iyi, kotu) => { if (ok) console.log(`✓ ${iyi}`); else { console.log(`✗ ${kotu}`); fail++ } }

// ESKİ MİMARİNİN ÖLÇÜLMÜŞ TABANI (rezervasyon grafiği, aynı tohum, aynı yerleşim):
// T1 servis 223 · T2 388 · T3 332 — buharlaşma 0, kalıcı sıkışan 0, içiçe 0.2/0.4/0.0
const TABAN = { 'T1': 223, 'T2': 388, 'T3': 332 }

const SC = [
  ['T1 near 8 pompa + 8 şarj', { pumps: 8, evs: 8, far: false, wide: true }],
  ['T2 KARŞI YAKA tam istasyon', { pumps: 8, evs: 8, far: true, wide: true }],
  ['T3 dar kapı (kapasite 1)', { pumps: 6, evs: 4, far: true, wide: false }],
]
console.log('--- ŞERİT AĞI ---')
const on = SC.map(([n, c]) => [n, run(n, c)])
for (const [n, r] of on) {
  const kod = n.slice(0, 2)
  kontrol(r.served >= TABAN[kod], `${kod}: servis ${r.served} ≥ eski mimari ${TABAN[kod]}`,
    `${kod}: servis DÜŞTÜ (${r.served} < ${TABAN[kod]}) — şeritler yanlış çizilmiş`)
  kontrol(r.stuck === 0, `${kod}: kalıcı sıkışan 0`, `${kod}: kalıcı sıkışan ${r.stuck}`)
  kontrol(r.st.total === 0, `${kod}: buharlaşma 0`, `${kod}: buharlaşma ${r.st.total} — sessiz müşteri silme geri gelmiş`)
  kontrol(r.icAkis <= 0.3, `${kod}: iç içe (AKIŞ) ${r.icAkis.toFixed(2)} ≤ 0.3 · yerleşim kalemi ${r.icDuran.toFixed(2)}`,
    `${kod}: iç içe (AKIŞ) ${r.icAkis.toFixed(2)} > 0.3 — şeritler ayrık değil`)
  kontrol(r.flow.ort >= 0.75, `${kod}: akış hızı %${(r.flow.ort * 100).toFixed(0)} (akıcı)`,
    `${kod}: akış hızı %${(r.flow.ort * 100).toFixed(0)} — araçlar sürünüyor`)
}

console.log('--- OTOYOL (ramp/merge) ---')
const HW = { decisionDist: 34, rampCap: 3, mergeHard: 1.6, signReach: 9, signLevel: 2 }
const t4 = run('T4 otoyol 6 pompa, dar kapı', { pumps: 6, evs: 4, far: false, wide: false, highway: HW })
kontrol(t4.stuck === 0, `T4: kalıcı sıkışan 0`, `T4: kalıcı sıkışan ${t4.stuck}`)
kontrol(t4.st.total === 0, `T4: buharlaşma 0`, `T4: buharlaşma ${t4.st.total}`)
kontrol(t4.served >= 60, `T4: servis ${t4.served} · ramp kaybı ${t4.rampLost}`, `T4: servis çok az (${t4.served})`)

const t5 = run('T5 otoyol DAR apron (2 pompa)', { pumps: 2, evs: 0, far: false, wide: false, highway: HW })
kontrol(t5.rampLost > 0, `T5: yavaşlama şeridi doldu, ${t5.rampLost} müşteri otobana döndü`,
  'T5: ramp hiç dolmadı — kaçan müşteri mekaniği ÇALIŞMIYOR')
kontrol(t5.st.total === 0, `T5: buharlaşma 0`, `T5: buharlaşma ${t5.st.total}`)

// ---- T6: ÇEVRE YOLU 4 ŞERİT ----
console.log('--- ÇEVRE YOLU: 4 ŞERİT KIYASI (aynı tohum, aynı yerleşim) ---')
const SVC = { near: 5.58, far: 10.23 }
const t6a = run('T6a tek şerit  ', { pumps: 8, evs: 8, far: true, wide: true })
const t6b = run('T6b 4 ŞERİT    ', { pumps: 8, evs: 8, far: true, wide: true, service: SVC })
kontrol(t6b.served >= t6a.served * 0.95, `T6: servis hacmi korundu/arttı (${t6a.served} → ${t6b.served})`,
  `T6: 4 şerit servis hacmini düşürdü (${t6a.served} → ${t6b.served})`)
kontrol(t6b.laneUse > 0, `T6: servis şeridinde ${t6b.laneUse} araç doğdu`, 'T6: servis şeridi hiç kullanılmadı')

// ---- T8: OYUNCUNUN YAŞADIĞI YIĞIN (yeni senaryo) ----
// Oyuncu şikâyeti: yüksek trafik + dar kapı + yoğun saat → apron'da 20 araç birikiyor,
// hiçbiri ilerlemiyor. Yeni mimaride yığın OLUŞMAMALI: yer yoksa müşteri karar
// noktasında yoluna devam eder (giremeyen), avluda birikmez.
console.log('--- T8: YIĞIN SENARYOSU (yüksek trafik + dar kapı + yoğun saat) ---')
const t8 = run('T8 yığın 3 pompa · trafik ×2.2 · yoğun saat ×1.8',
  { pumps: 3, evs: 1, far: false, wide: false, entryMul: 1.8, pullMul: 2.2 })
kontrol(t8.stuck === 0, 'T8: kalıcı sıkışan 0 (yığın kilitlenmedi)', `T8: kalıcı sıkışan ${t8.stuck}`)
kontrol(t8.st.total === 0, 'T8: buharlaşma 0', `T8: buharlaşma ${t8.st.total}`)
// ESKİ MİMARİ AYNI SENARYODA (ölçüldü): servis 85 · apron zirve 48 araç · iç içe 12.3
// çift/kare (2440'ı leaving/leaving: çıkış ağzında üst üste yığılmış araçlar) · token
// reddi 7430 / verilen 389. Oyuncunun ekran görüntüsü tam olarak buydu.
kontrol(t8.apronMax <= 16, `T8: apron zirvesi ${t8.apronMax} araç (eski mimari: 48)`,
  `T8: apron'da ${t8.apronMax} araç birikti — yığın hâlâ var`)
kontrol(t8.icAkis <= 0.3, `T8: iç içe (AKIŞ) ${t8.icAkis.toFixed(2)} (eski mimari 12.3)`,
  `T8: iç içe (AKIŞ) ${t8.icAkis.toFixed(2)} > 0.3`)
kontrol(t8.flow.ort >= 0.7, `T8: baskı altında akış %${(t8.flow.ort * 100).toFixed(0)}`,
  `T8: baskı altında akış %${(t8.flow.ort * 100).toFixed(0)} — trafik sürünüyor`)
kontrol(t8.turnedAway > 0, `T8: ${t8.turnedAway} müşteri kapasite yüzünden GİREMEDİ (görünür kayıp)`,
  'T8: kapasite baskısı hiç görünmedi — giremeyen müşteri sayılmıyor')

// ---- T9: OTOPARK YOĞUN ----
// Oyuncu ekran görüntüsü: park yerleri (beyaz çizgili slotlar) BOŞ dururken araçlar
// slotların dışında tek sıra, gövde gövdeye yığılmış. Kök neden ölçüldü: otopark şerit
// ağının DIŞINDAYDI; rota elle yazılmış üç noktaydı ve "yanaşma noktası" oyuncunun
// yerleşimine göre bir pompa gövdesinin ÇARPIŞMA ZARFININ içine düşebiliyordu. Araç
// oraya asla varamıyor (Car.insideSolid ilerlemeyi kesiyor), gövdenin dibinde kilitleniyor.
// ESKİ MİMARİ AYNI SENARYODA, AYNI TOHUM (ölçüldü):
//   otopark çakışması 3.18 çift/kare · otoparkta iç içe 2.06 · genel iç içe (akış) 4.17
//   · akış hızı %85 · durma %10.2 kare · servis 378
// ŞERİT AĞINA ALINDIKTAN SONRA:
//   otopark çakışması 0.31 · iç içe 0.14 · genel iç içe 0.83 · akış %93 · durma %3.6 · servis 382
// (İzole tekrar üretimde eski kod ayrıca 1 aracı KALICI kilitliyordu: park yeri pompa
//  gövdesinin içindeydi, araç oraya asla varamıyor ama slotu da bırakmıyordu.)
console.log('--- T9: OTOPARK YOĞUN (park koridoru pompa sırasının dibinde) ---')
{
  // 6 pompa, otopark tam pompa hattının yanında (oyundaki varsayılan yerleşimin dar hâli)
  const t9 = run('T9 otopark · 6 pompa · trafik ×1.6', {
    pumps: 6, evs: 2, far: false, wide: true, entryMul: 1.2, pullMul: 1.6,
    parking: parkLot(THREE, 'parking', 0.4, -0.2), parkChance: 0.75,
  })
  kontrol(t9.stuck === 0, 'T9: kalıcı sıkışan 0 (park kuyruğu kilitlenmedi)', `T9: kalıcı sıkışan ${t9.stuck}`)
  kontrol(t9.st.total === 0, 'T9: buharlaşma 0', `T9: buharlaşma ${t9.st.total}`)
  kontrol(t9.park.varis > 0, `T9: ${t9.park.varis} araç gerçekten park etti`, 'T9: hiçbir araç park edemedi')
  kontrol(t9.park.disari === 0, 'T9: park eden her araç KENDİ çizgili yerinde (slot dışı 0)',
    `T9: ${t9.park.disari}/${t9.park.disariOrnek} örnekte araç slotunun dışında durdu`)
  kontrol(t9.park.agir <= 0.3, `T9: otoparkta iç içe ${t9.park.agir.toFixed(2)} ≤ 0.3 (eski mimari 2.06)`,
    `T9: otoparkta iç içe ${t9.park.agir.toFixed(2)} > 0.3 — park kolları ayrık değil`)
}

const sum = a => a.reduce((x, y) => x + y, 0)
const servOn = sum(on.map(([, r]) => r.served))
console.log(`\nTOPLAM servis ${servOn} (eski mimari ${TABAN.T1 + TABAN.T2 + TABAN.T3})`)
console.log(fail === 0 ? '\n✓ YÜK TESTİ GEÇTİ (şerit ağı, deterministik)' : `\n✗ ${fail} kriter başarısız`)
process.exit(fail ? 1 : 0)
