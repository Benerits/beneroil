// TRAFİK FUZZ — "İSTASYON NASIL KURULURSA KURULSUN ARAÇ SIKIŞMAZ" İSPAT KOŞUMU
//
// NEDEN VAR: traffic-load.mjs motoru ölçüyor ama TEK BİR yerleşimde — pompalar tek
// kolonda, kapılar ∓14'te sabit, oyuncu binası YOK, ünite dönmüyor. Oyuncunun gerçek
// istasyonu ise 100+ yapı, döndürülmüş pompa, taşınmış kapı ve iki yaka demek. Şikâyet
// ("araçlar sıkışıyor") tam da o yerleşimlerden geliyor, laboratuvardan değil.
//
// Bu koşum RASTGELE YERLEŞİM üretir (oyunun kendi yerleştirme kurallarıyla), gerçek
// trafik motorunu (CarManager) başsız çalıştırır ve HER YERLEŞİM İÇİN sıkışma imzasını
// çıkarır. Amaç yeşil almak değil — MEVCUT kodun kusur kataloğunu delille yazmak, sonra
// düzeltmeler indiğinde aynı koşumu kabul kapısı olarak kullanmak.
//
// KULLANIM: npx tsx tools/tests/trafik-fuzz.mjs --n 40 --sure 300 --seed 1 --raporla
//
// ÖLÇÜTLER (yerleşim başına):
//   SIKIŞAN  hareket fazındaki araç, blokT == 0 iken ≥30 sn boyunca <0.12 birim/sn yol aldı
//            (blokT > 0 = konveyör kuralının BİLEREK durdurduğu araç; o bir kusur değil)
//   YIĞIN    ≥3 araç birbirine 1.0 birim mesafede ≥5 sn takıldı
//   İÇİÇE    çift mesafesi <2.15 (gövde 2.66'nın altı) ≥2 sn sürdü — faz çiftine göre
//   ZOMBİ    SIKIŞAN araç bir kaynağı (kuyruk slotu / pompa slotu / park yeri / tır yeri)
//            tutuyor → o kaynak kimseye açılmıyor, sıkışma YAYILIYOR
//
// ÇIKIŞ KODU: SIKIŞAN veya ZOMBİ varsa (ya da bir yerleşim ≥50 araç doğurmadıysa) ≠ 0.
// "Boş kümeden yeşil" YASAK: her yerleşimde doğan araç sayısı ölçülür ve raporlanır.

// ---- Başsız kabuk (traffic-load.mjs ile aynı; three.js + i18n + platform tarafı DOM ister) ----
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }

const { readFileSync, writeFileSync, existsSync, mkdirSync } = await import('node:fs')
const { tmpdir } = await import('node:os')
const path = await import('node:path')
const THREE = await import('three')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE, PARCEL_COLS, PARCEL_ROWS } = await import('../../src/state.ts')
// GERÇEK SABİTLER İTHAL EDİLİYOR (kopyalanmıyor): world.ts başsız yükleniyor, yani
// otopark aralığı / ünite ofseti / kapı x'i gibi ölçüler oyunla AYRIŞAMAZ.
const {
  ROAD_X, FAR_GATE_X, PARK_YER, parkYerX, PUMP_SLOT_OFF, EV_SLOT_OFF,
  TANK_POS, PUMP_SLOTS_POS, EV_SLOTS_POS, SLOT_MIN_ARA, APRON_IN_Y, APRON_OUT_Y,
} = await import('../../src/world.ts')

// ---- argümanlar ----
const ARG = process.argv.slice(2)
const argN = (bayrak, vars) => { const i = ARG.indexOf(bayrak); return i >= 0 && ARG[i + 1] ? Number(ARG[i + 1]) : vars }
const N = argN('--n', 40)
const SURE = argN('--sure', 300)          // simülasyon SANİYESİ (dt 0.1 → SURE*10 adım)
const SEED0 = argN('--seed', 1)
const RAPORLA = ARG.includes('--raporla')
const AYRINTI = ARG.includes('--ayrinti')

// ---- iki BAĞIMSIZ PRNG ----
// Yerleşim üreteci ile motorun tükettiği Math.random AYRI olmalı: aynı akıştan besleselerdi
// motorun kaç kez zar attığı yerleşimi kaydırır, tohum → yerleşim eşlemesi bozulurdu.
const mkRnd = s => { let x = s >>> 0 || 1; return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff } }

// ═══════════════════ 1) OYUNUN YERLEŞTİRME KURALLARININ KOPYASI ═══════════════════
// main.ts modül olarak ithal EDİLEMEZ (tepe seviyede sahne/DOM/renderer kurar). Bu yüzden
// aşağıdaki üç tablo/fonksiyon main.ts'ten BİREBİR kopyalanmıştır; ayrışırlarsa fuzz gerçek
// oyunun kuramayacağı yerleşimleri test eder (yanlış alarm) ya da kurabildiğini kaçırır.
//   · PLACEABLE     — main.ts:3280
//   · unitRect      — main.ts:4250
//   · hardRects     — main.ts:4255   (araç engelleri = Car.solids)
//   · fixedObstacles— main.ts:3345   (yerleştirme rezervleri)
//   · isValidPlacement / overlaps / landOk — main.ts:4592
//   · unitBodyPos   — main.ts:4656
// YAKLAŞIKLAMA (bilerek): fuzz TÜM parselleri sahiplenilmiş + betonlanmış varsayar
// (landOk yalnız "bir parselin içinde mi" der). Gerekçe: en KARMAŞIK istasyonu test
// ediyoruz; arsa kısıtı yalnız yerleşimi küçültürdü, sıkışmayı gizlerdi.
const PLACEABLE = {
  market: { w: 6, d: 7 }, market2: { w: 6, d: 7 },
  toilet: { w: 3, d: 4 }, toilet2: { w: 3, d: 4 },
  wash: { w: 4.5, d: 5 }, wash2: { w: 4.5, d: 5 },
  oil: { w: 4, d: 4 }, oil2: { w: 4, d: 4 },
  coffee: { w: 3.2, d: 3.2 }, coffee2: { w: 3.2, d: 3.2 },
  restaurant: { w: 5.5, d: 6 }, restaurant2: { w: 5.5, d: 6 },
  battery: { w: 3, d: 2 },
  solar: { w: 5, d: 7, grass: true },
  wind: { w: 4, d: 4, grass: true },
  dieselgen: { w: 2, d: 2 },
  smr: { w: 6, d: 5 },
  truckpark: { w: 8, d: 6 }, truckpark2: { w: 8, d: 6 },
  hotel: { w: 7, d: 10 },
  airwater: { w: 1.6, d: 2 },
  lamp: { w: 1.2, d: 1.2, grass: true },
  selfwash: { w: 5.5, d: 7 },
  parking: { w: 5.2, d: 3.2 },
  office: { w: 5, d: 5.5 },
  sign: { w: 1.8, d: 1.8, grass: true },
}
const FAR_ONLY = new Set(['market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2'])
const PUMP_FP = { w: 4.4, d: 4.0 }   // main.ts footprintOf
const EV_FP = { w: 4.0, d: 2.6 }
const TANK_FP = { w: 2.0, d: 2.0 }

const overlaps = (a, b) => Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.d + b.d) / 2
/** rot (0..3) uygulanmış footprint — main.ts confirmPlacement'taki `odd` takası */
const fpRot = (f, rot) => (rot % 2 === 1 ? { w: f.d, d: f.w } : { w: f.w, d: f.d })
/** main.ts unitRect: 90°/270°'de en-boy takas (gövde dikdörtgeni) */
const unitRect = (base, ang, w, d) => {
  const swap = Math.abs(Math.sin(ang)) > 0.5
  return { cx: base.x, cy: base.y, w: swap ? d : w, d: swap ? w : d }
}
/** main.ts unitBodyPos: footprint MERKEZİ → GÖVDE konumu (ofset açıyla + karşı-yaka flip'iyle döner) */
function unitBodyPos(kind, cx, cy, rot) {
  const off = kind === 'pump' ? 0.9 : 0.5
  const ang = rot * Math.PI / 2 + (cx > ROAD_X ? Math.PI : 0)
  const yuv = v => Math.round(v * 1e6) / 1e6
  return { x: yuv(cx - Math.cos(ang) * off), y: yuv(cy - Math.sin(ang) * off) }
}
/** world.addPump / addEvCharger: gövdeden araç yuvasını ve açısını türetir */
function uniteTuret(kind, cx, cy, rot) {
  const base = unitBodyPos(kind, cx, cy, rot)
  const far = base.x > ROAD_X
  const dir = rot * Math.PI / 2 + (far ? Math.PI : 0)
  const off = kind === 'pump' ? PUMP_SLOT_OFF : EV_SLOT_OFF
  return { base, ang: dir, slot: { x: base.x + Math.cos(dir) * off, y: base.y + Math.sin(dir) * off } }
}
/** world.varsayilanYuva — konumu olmayan ünitenin tablo yuvası (taşan indeks güneye açılır) */
function varsayilanYuva(tablo, i) {
  const v = tablo[i]
  if (v) return { x: v.x, y: v.y }
  const son = tablo[tablo.length - 1]
  return { x: son.x, y: son.y - SLOT_MIN_ARA * (i - tablo.length + 1) }
}

const parcelAt = (x, y) => {
  for (let c = 0; c < PARCEL_COLS.length; c++) for (let r = 0; r < PARCEL_ROWS.length; r++) {
    const [x0, x1] = PARCEL_COLS[c], [y0, y1] = PARCEL_ROWS[r]
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1) return [c, r]
  }
  return null
}
const landOk = (x, y) => !!parcelAt(x, y)  // tüm parseller sahipli+betonlu varsayımı (yukarıda gerekçesi)

/** main.ts fixedObstacles — yerleştirme rezervleri (araç koridorları `lane:true`) */
function fixedObstacles(L, skipId = '') {
  const r = [{ cx: 4.3, cy: 0, w: 2.0, d: 48, lane: true }]
  if (skipId !== 'sign' && L.sign) r.push({ cx: L.sign.cx, cy: L.sign.cy, w: 2.4, d: 3.4 })
  if (L.farOn) r.push({ cx: 11.6, cy: 0, w: 3.0, d: 48, lane: true })
  r.push({ cx: 4.2 - 1.4, cy: 0, w: 1.5, d: 44, lane: true })
  if (L.farOn) r.push({ cx: FAR_GATE_X + 1.4, cy: 0, w: 1.5, d: 44, lane: true })
  if (skipId !== 'tank' && L.tank) r.push({ cx: L.tank.cx, cy: L.tank.cy, w: 2.0, d: 2.0 })
  if (skipId !== 'office' && L.office) r.push({ cx: L.office.cx, cy: L.office.cy, w: 4.6, d: 5.0 })
  for (const u of L.pumps) {
    if (skipId === u.id) continue
    r.push(unitRect({ x: (u.base.x + u.slot.x) / 2, y: (u.base.y + u.slot.y) / 2 }, u.ang, 4.4, 4.0))
  }
  for (const u of L.evs) {
    if (skipId === u.id) continue
    r.push(unitRect({ x: (u.base.x + u.slot.x) / 2, y: (u.base.y + u.slot.y) / 2 }, u.ang, 4.0, 2.6))
  }
  return r
}

/** main.ts isValidPlacement */
function isValidPlacement(L, p, skipId, grassOk) {
  if (skipId.endsWith('2') && FAR_ONLY.has(skipId) && p.cx <= ROAD_X) return false
  for (const sx of [-1, 0, 1]) for (const sy of [-1, 0, 1]) {
    if (!landOk(p.cx + sx * (p.w / 2 - 0.2), p.cy + sy * (p.d / 2 - 0.2), grassOk)) return false
  }
  for (const o of fixedObstacles(L, skipId)) if (overlaps(p, o)) return false
  for (const o of L.yapilar) if (o.id !== skipId && overlaps(p, o)) return false
  return true
}

/** main.ts hardRects — ARAÇ ENGELLERİ (Car.solids). Kimlik alanı fuzz'a özel:
 *  sıkışma imzasında "en yakın yapı" bunu okur; motor yalnız cx/cy/w/d kullanır. */
function hardRects(L) {
  const r = []
  for (const u of L.pumps) r.push({ id: u.id, rot: u.rot, ...unitRect(u.base, u.ang, 1.5, 3.4) })
  for (const u of L.evs) r.push({ id: u.id, rot: u.rot, ...unitRect(u.base, u.ang, 0.9, 1.4) })
  if (L.tank) r.push({ id: 'tank', rot: 0, cx: L.tank.cx, cy: L.tank.cy, w: 2.2, d: 2.2 })
  if (L.office) r.push({ id: 'office', rot: 0, cx: L.office.cx, cy: L.office.cy, w: 4.2, d: 4.6 })
  for (const p of L.yapilar) {
    const b = p.id.split('#')[0]
    if (b === 'parking' || b === 'gatein' || b === 'gateout') continue
    if (b.startsWith('pump-') || b.startsWith('charger-') || b === 'tank' || p.id === 'truckpark') continue
    if (b === 'sign') continue
    r.push({ id: p.id, rot: p.rot, cx: p.cx, cy: p.cy, w: p.w, d: p.d })
  }
  // ÇEKİŞMELİ AİLE: oyunun yerleştirme kuralının YASAKLADIĞI engeller (omurga/kuyruk/kol).
  // Ayrı listede tutulur ki raporda "oyuncu bunu kurabilir mi" sorusu karışmasın.
  for (const p of (L.zorlama ?? [])) r.push({ id: p.id, rot: p.rot ?? 0, cx: p.cx, cy: p.cy, w: p.w, d: p.d })
  return r
}

/** world.getParkingSpots — otopark grubunun matrisinden park + yanaşma noktaları.
 *  Grup açısı: rot*90° + karşı yaka 180° flip (world.register/rotateBuilding farFlip). */
function parkSpotsOf(L) {
  const out = []
  for (const p of L.yapilar) {
    if (p.id.split('#')[0] !== 'parking') continue
    const rz = p.rot * Math.PI / 2 + (p.cx > ROAD_X ? Math.PI : 0)
    const c = Math.cos(rz), s = Math.sin(rz)
    const w = (lx, ly) => new THREE.Vector3(p.cx + lx * c - ly * s, p.cy + lx * s + ly * c, 0)
    for (let i = 0; i < PARK_YER; i++) {
      const lx = parkYerX(i)
      out.push({ id: `${p.id}:${i}`, pos: w(lx, -0.1), stage: w(lx, 2.4), rot: rz - Math.PI / 2 })
    }
  }
  return out
}
/** world.getTruckSpots — yalnız 'truckpark' ve 'truckpark2' (nüsha '#' YOK, oyunla birebir) */
function truckSpotsOf(L) {
  const out = []
  for (const p of L.yapilar) {
    if (p.id !== 'truckpark' && p.id !== 'truckpark2') continue
    const rz = p.rot * Math.PI / 2 + (p.cx > ROAD_X ? Math.PI : 0)
    const c = Math.cos(rz), s = Math.sin(rz)
    const w = (lx, ly) => new THREE.Vector3(p.cx + lx * c - ly * s, p.cy + lx * s + ly * c, 0)
    for (const ly of [-1.4, 0, 1.4]) out.push({ id: p.id, spot: w(0, ly), stage: w(5.4, ly) })
  }
  return out
}

/** traffic-graph.rebuild'in gelen omurga x'i — çekişmeli yerleşim tam ORAYA bina diker */
function xInOf(L, st = 'near') {
  const gateX = st === 'far' ? FAR_GATE_X : 4.2
  const sideSign = st === 'far' ? 1 : -1
  let dUnit = Infinity
  for (const u of [...L.pumps, ...L.evs]) {
    if ((u.slot.x > ROAD_X) !== (st === 'far')) continue
    const d = sideSign < 0 ? (gateX - u.slot.x) : (u.slot.x - gateX)
    if (d > 0.4 && d < dUnit) dUnit = d
  }
  if (!isFinite(dUnit)) dUnit = 1.75 + 1.05
  const dIn = Math.min(2.6, Math.max(0.5, dUnit - 1.05))
  return gateX + sideSign * dIn
}

// ═══════════════════ 2) YERLEŞİM ÜRETECİ ═══════════════════
const BINA_HAVUZU = [
  'market', 'toilet', 'wash', 'oil', 'coffee', 'restaurant', 'hotel', 'battery',
  'solar', 'wind', 'dieselgen', 'smr', 'truckpark', 'airwater', 'lamp', 'selfwash', 'parking',
  'market2', 'toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'truckpark2',
]

function rastgeleYerlesim(seed) {
  const R = mkRnd(seed * 7919 + 13)
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1))
  const sec = arr => arr[Math.floor(R() * arr.length)]
  const cekismeli = seed % 4 === 0   // her 4 tohumdan biri ÇEKİŞMELİ aile

  const L = {
    seed, aile: cekismeli ? 'çekişmeli' : 'rastgele',
    pumps: [], evs: [], yapilar: [], zorlama: [],
    tank: null, office: null, sign: null, farOn: false,
    wide: R() < 0.5, isik: R() < 0.25 ? { periyot: ri(30, 70), y: ri(-20, 20) } : null,
  }
  const nP = ri(2, 14), nE = ri(0, 12)
  const farIstek = R() < 0.45
  L.farOn = farIstek

  // parsel içinde rastgele TAM SAYI nokta (oyundaki 1 birimlik ızgara: Math.round(x/y))
  const parselNokta = (yakinMi) => {
    const cols = yakinMi ? [0, 1, 2] : [3, 4, 5]
    const c = sec(cols), r = ri(0, 2)
    const [x0, x1] = PARCEL_COLS[c], [y0, y1] = PARCEL_ROWS[r]
    return { cx: ri(Math.ceil(x0), Math.floor(x1)), cy: ri(Math.ceil(y0), Math.floor(y1)) }
  }

  const koy = (id, fp, grassOk, yakinMi, deneme = 40) => {
    for (let k = 0; k < deneme; k++) {
      const rot = ri(0, 3)
      const { cx, cy } = parselNokta(yakinMi)
      const e = { cx, cy, ...fpRot(fp, rot) }
      if (!isValidPlacement(L, e, id, grassOk)) continue
      return { id, cx, cy, rot, ...e }
    }
    return null
  }

  // ---- pompalar ----
  for (let i = 0; i < nP; i++) {
    const yakin = !farIstek || R() > 0.35
    const p = koy(`pump-${i}`, PUMP_FP, false, yakin)
    if (!p) continue
    const t = uniteTuret('pump', p.cx, p.cy, p.rot)
    L.pumps.push({ id: p.id, cx: p.cx, cy: p.cy, rot: p.rot, ...t })
  }
  // ---- şarj üniteleri ----
  for (let i = 0; i < nE; i++) {
    const yakin = !farIstek || R() > 0.35
    const p = koy(`charger-${i}`, EV_FP, false, yakin)
    if (!p) continue
    const t = uniteTuret('charger', p.cx, p.cy, p.rot)
    L.evs.push({ id: p.id, cx: p.cx, cy: p.cy, rot: p.rot, ...t })
  }
  // en az bir NEAR ünite şart: yoksa yakın istasyona hiç müşteri girmez (boş küme riski)
  if (!L.pumps.some(u => u.slot.x <= ROAD_X)) {
    const t = uniteTuret('pump', -1, -2, 0)
    L.pumps.push({ id: `pump-${L.pumps.length}`, cx: -1, cy: -2, rot: 0, ...t })
  }
  L.farOn = [...L.pumps, ...L.evs].some(u => u.slot.x > ROAD_X)

  // ---- tank + ofis (oyunda her zaman var) ----
  const tk = koy('tank', TANK_FP, false, true) ?? { cx: TANK_POS.x + 0.45, cy: TANK_POS.y + 0.45, rot: 0 }
  L.tank = { cx: tk.cx, cy: tk.cy }
  const of = koy('office', PLACEABLE.office, false, true)
  if (of) { L.office = { cx: of.cx, cy: of.cy }; L.yapilar.push(of) }

  // ---- kapılar (main.ts repositionPlacing: x sabit, y tam sayı, aralık ≥6) ----
  L.gateIn = ri(-24, 24)
  do { L.gateOut = ri(-24, 24) } while (Math.abs(L.gateOut - L.gateIn) < 6)
  if (L.farOn) {
    L.gateIn2 = ri(-22, 22)
    do { L.gateOut2 = ri(-22, 22) } while (Math.abs(L.gateOut2 - L.gateIn2) < 6)
  } else { L.gateIn2 = APRON_OUT_Y; L.gateOut2 = APRON_IN_Y }

  // ---- tabela (dekoratif; hardRects onu engel saymaz ama rezerv üretir) ----
  if (R() < 0.7) L.sign = { cx: Math.max(-11, Math.min(6.5, ri(-11, 6))), cy: ri(-26, 26) }

  // ---- 0..25 rastgele bina ----
  const nB = ri(0, 25)
  const sayac = {}
  for (let i = 0; i < nB; i++) {
    const base = sec(BINA_HAVUZU)
    if (FAR_ONLY.has(base) && !L.farOn) continue
    const k = (sayac[base] = (sayac[base] ?? -1) + 1)
    const id = k === 0 ? base : `${base}#${k}`
    const fp = PLACEABLE[base]
    const b = koy(id, fp, !!fp.grass, !FAR_ONLY.has(base) && R() > 0.3)
    if (b) L.yapilar.push(b)
  }

  if (cekismeli) cekismeliEkle(L, R, ri)
  return L
}

/**
 * ÇEKİŞMELİ AİLE — oyunun yerleştirme kuralının YASAKLADIĞI engeller.
 *
 * NEDEN yasak olanı da test ediyoruz: motorun sağlamlığı "kural bunu engelliyor"a
 * dayanmamalı. Kural tek bir regresyonla delinirse (geçmişte tabela rezervinde tam bu
 * oldu, #1032/#352) trafik KİLİTLENMEMELİ, en fazla YAVAŞLAMALI. Raporda ayrı aile
 * olarak gösterilir: buradaki kusur "oyuncu bunu bugün kuramaz" notuyla okunur.
 */
function cekismeliEkle(L, R, ri) {
  const xin = xInOf(L, 'near')
  const near = L.pumps.filter(u => u.slot.x <= ROAD_X)
  // (a) GELEN OMURGA KOLONUNA bina (xIn bandı ~1.6..3.7)
  L.zorlama.push({ id: 'zorla-omurga', cx: Math.round(xin), cy: L.gateIn + (L.gateIn < 0 ? 6 : -6), w: 6, d: 7 })
  // (b) KUYRUK SLOTUNA bina (kuyruk kapıdan içeri QUEUE_BASE 3.4 + k*3.5 adımla dizilir)
  const dirY = 1
  L.zorlama.push({ id: 'zorla-kuyruk', cx: xin, cy: L.gateIn + dirY * (3.4 + 3.5 * ri(0, 3)), w: 3, d: 4 })
  // (c) BİR POMPA KOLUNU KUTULA: yuvanın iki yanına + omurgayla arasına engel
  if (near.length) {
    const u = near[Math.floor(R() * near.length)]
    L.zorlama.push({ id: `zorla-kol-${u.id}-a`, cx: u.slot.x, cy: u.slot.y + 1.6, w: 1.6, d: 2 })
    L.zorlama.push({ id: `zorla-kol-${u.id}-b`, cx: u.slot.x, cy: u.slot.y - 1.6, w: 1.6, d: 2 })
    L.zorlama.push({ id: `zorla-kol-${u.id}-c`, cx: (u.slot.x + xin) / 2, cy: u.slot.y, w: 1.2, d: 1.2 })
  }
  // (d) 180° DÖNDÜRÜLMÜŞ POMPALAR: yuva ünitenin ters tarafına düşer, kol yönü tersine döner
  for (const u of near) {
    if (R() > 0.5) continue
    const t = uniteTuret('pump', u.cx, u.cy, 2)
    u.rot = 2; u.base = t.base; u.ang = t.ang; u.slot = t.slot
  }
  // (e) KOŞU ORTASINDA YERLEŞİM DEĞİŞİKLİĞİ: yarıda bir bina daha dikilir + rota tazelenir
  L.ortaOlay = { cx: Math.round(xin), cy: L.gateIn + (L.gateIn < 0 ? 12 : -12), w: 6, d: 7, id: 'zorla-orta' }
}

/** Telemetri anlık görüntüsündeki `yapi` listesinden GERÇEK yerleşim kurar. */
function gercekYerlesim(dosya) {
  const d = JSON.parse(readFileSync(dosya, 'utf8'))
  const ad = path.basename(dosya, '.json')
  const L = {
    seed: ad, aile: 'gerçek', pumps: [], evs: [], yapilar: [], zorlama: [],
    tank: null, office: null, sign: null, farOn: false, wide: true, isik: null,
    gateIn: APRON_IN_Y, gateOut: APRON_OUT_Y, gateIn2: APRON_OUT_Y, gateOut2: APRON_IN_Y,
  }
  const harita = new Map(d.yapi.map(([id, x, y, r]) => [id, { cx: x, cy: y, rot: r }]))
  for (let i = 0; i < (d.pumps ?? 0); i++) {
    const y = harita.get(`pump-${i}`)
    if (y) { const t = uniteTuret('pump', y.cx, y.cy, y.rot); L.pumps.push({ id: `pump-${i}`, cx: y.cx, cy: y.cy, rot: y.rot, ...t }) }
    else { // konumu yok → world varsayılan tablosu (yuva tablodan, gövde yuva−1.8)
      const dv = varsayilanYuva(PUMP_SLOTS_POS, i)
      L.pumps.push({ id: `pump-${i}`, cx: dv.x - PUMP_SLOT_OFF + 0.9, cy: dv.y, rot: 0,
        base: { x: dv.x - PUMP_SLOT_OFF, y: dv.y }, ang: 0, slot: { x: dv.x, y: dv.y } })
    }
  }
  for (let i = 0; i < (d.ev ?? 0); i++) {
    const y = harita.get(`charger-${i}`)
    if (y) { const t = uniteTuret('charger', y.cx, y.cy, y.rot); L.evs.push({ id: `charger-${i}`, cx: y.cx, cy: y.cy, rot: y.rot, ...t }) }
    else {
      const dv = varsayilanYuva(EV_SLOTS_POS, i)
      L.evs.push({ id: `charger-${i}`, cx: dv.x - EV_SLOT_OFF + 0.5, cy: dv.y, rot: 0,
        base: { x: dv.x - EV_SLOT_OFF, y: dv.y }, ang: 0, slot: { x: dv.x, y: dv.y } })
    }
  }
  for (const [id, x, y, r] of d.yapi) {
    const base = id.split('#')[0]
    if (base.startsWith('pump-') || base.startsWith('charger-')) continue
    if (base === 'gatein') { L.gateIn = y; continue }
    if (base === 'gateout') { L.gateOut = y; continue }
    if (base === 'gatein2') { L.gateIn2 = y; L.farOn = true; continue }
    if (base === 'gateout2') { L.gateOut2 = y; L.farOn = true; continue }
    if (base === 'tank') { L.tank = { cx: x, cy: y }; continue }
    if (base === 'sign') { L.sign = { cx: x, cy: y }; continue }
    if (base === 'office') L.office = { cx: x, cy: y }
    const fp = PLACEABLE[base]
    if (!fp) continue
    L.yapilar.push({ id, cx: x, cy: y, rot: r, ...fpRot(fp, r) })
  }
  if (!L.tank) L.tank = { cx: TANK_POS.x + 0.45, cy: TANK_POS.y + 0.45 }
  L.farOn = L.farOn || [...L.pumps, ...L.evs].some(u => u.slot.x > ROAD_X)
  // ÖZ DENETİM: türettiğim yuva, oyunun kaydettiği yuvayla birebir mi? Ayrışırsa fuzz
  // GERÇEK OLMAYAN bir istasyonu test ediyor demektir — sessizce geçmesin.
  const sapma = []
  const kiyas = (list, gercek) => list.forEach((u, i) => {
    const g = gercek?.[i]; if (!g) return
    if (Math.abs(u.slot.x - g[0]) > 0.02 || Math.abs(u.slot.y - g[1]) > 0.02)
      sapma.push(`${u.id} türetilen(${u.slot.x.toFixed(1)},${u.slot.y.toFixed(1)}) ≠ kayıt(${g[0]},${g[1]})`)
  })
  kiyas(L.pumps, d.slots?.pump); kiyas(L.evs, d.slots?.ev)
  L.sapma = sapma
  return L
}

// ═══════════════════ 3) KOŞUM + SIKIŞMA DEDEKTÖRLERİ ═══════════════════
const HAREKET = new Set(['driving', 'toPark', 'leaving'])
const SIKIS_ESIK = 0.12, SIKIS_SN = 30
const YIGIN_MES = 1.0, YIGIN_SN = 5, YIGIN_ADET = 3
const ICICE_MES = 2.15, ICICE_SN = 2

function kosuYerlesim(L, sure) {
  // Motor tarafı DETERMİNİST: her yerleşim kendi tohumundan başlar (aynı seed → aynı film)
  const seedNum = typeof L.seed === 'number' ? L.seed : [...String(L.seed)].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)
  let s = (seedNum * 2654435761) & 0x7fffffff
  Math.random = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }

  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = L.pumps.length; state.evChargers = L.evs.length; state.wideGates = L.wide
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3

  const katilar = hardRects(L)
  Car.solids = katilar
  const reaktif0 = Car.reaktifKacis

  const parkSpots = parkSpotsOf(L)
  const truckSpots = truckSpotsOf(L)
  const pumpV = L.pumps.map(u => new THREE.Vector3(u.slot.x, u.slot.y, 0))
  const evV = L.evs.map(u => new THREE.Vector3(u.slot.x, u.slot.y, 0))

  let served = 0, lost = 0, turnedAway = 0, evTurnedAway = 0, rampLost = 0, truckParked = 0
  let simT = 0
  const mgr = new CarManager(scene, null, {
    pumpCount: () => L.pumps.length, evCount: () => L.evs.length,
    pumpSlot: i => pumpV[Math.min(i, pumpV.length - 1)] ?? new THREE.Vector3(1.8, 0, 0),
    evSlot: i => evV[Math.min(i, Math.max(0, evV.length - 1))] ?? new THREE.Vector3(1.8, 6, 0),
    pumpAngle: i => L.pumps[i]?.ang ?? 0, evAngle: i => L.evs[i]?.ang ?? 0,
    gateInY: () => L.gateIn, gateOutY: () => L.gateOut,
    farActive: () => L.farOn, farGateInY: () => L.gateIn2, farGateOutY: () => L.gateOut2,
    // AĞIR TRAFİK: sıkışma ancak baskı altında görünür (traffic-load T8 kalibrasyonu)
    entryChance: () => Math.min(1, state.entryChance() * 1.8),
    evShare: () => (L.evs.length ? 0.35 : 0),
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => state.trafficPull() * 2.2,
    isPumpBroken: () => false, isChargerBroken: () => false,
    parkSpots: () => parkSpots, truckSpots: () => truckSpots, extraObstacles: () => [],
    wideGates: () => L.wide,
    // TRAFİK IŞIĞI (traffic-load'da hiç yoktu): kırmızıda geçiş trafiği yavaşlar,
    // kapı ağzında doğal kuyruk birikir — gerçek metropol koşulu.
    trafficLight: () => (L.isik ? { red: (simT % L.isik.periyot) < L.isik.periyot * 0.4, y: L.isik.y } : null),
    onCarReady: c => { served++; c.phase = 'atPump' },
    onCarLost: () => { lost++ },
    onTurnedAway: () => { turnedAway++ },
    onEvTurnedAway: () => { evTurnedAway++ },
    onRampFull: () => { rampLost++ },
    onTruckParked: () => { truckParked++ },
  })

  // ---- ölçüm durumu ----
  let fid = 0, dogan = 0
  const izleme = new Map()      // fid → { sikisT, sonX, sonY, faz, bildirildi }
  const yiginSay = new Map()    // küme anahtarı → ardışık örnek
  const iciceSay = new Map()    // çift anahtarı → ardışık örnek
  const olaylar = []            // { tur, t, faz, x, y, yakin, rot, kaynak }
  const bildirilenYigin = new Set(), bildirilenIcice = new Set()
  const busy = new Map()

  /** olayın imzası: en yakın KATI CİSİM (oyuncunun koyduğu şey) + o ünitenin açısı.
   *  KATALOG TİPE göre gruplanır (pump-7 değil "pompa"): imza sayısı yerleşim sayısıyla
   *  değil, KUSUR TÜRÜYLE artmalı. Nüsha kimliği örnekte kalır (tekrar üretim için). */
  const tip = id => id.startsWith('pump-') ? 'pompa' : id.startsWith('charger-') ? 'şarj'
    : id.startsWith('zorla-') ? id : id.split('#')[0]
  const enYakin = (x, y) => {
    let iyi = null, dm = Infinity
    for (const r of katilar) {
      const dx = Math.max(0, Math.abs(x - r.cx) - r.w / 2), dy = Math.max(0, Math.abs(y - r.cy) - r.d / 2)
      const d = Math.hypot(dx, dy)
      if (d < dm) { dm = d; iyi = r }
    }
    return iyi ? { id: tip(iyi.id), nusha: iyi.id, rot: iyi.rot ?? 0, mes: dm } : { id: 'yok', nusha: 'yok', rot: 0, mes: Infinity }
  }

  const adim = Math.round(sure * 10)
  const ortaAdim = L.ortaOlay ? Math.floor(adim / 2) : -1
  for (let i = 0; i < adim; i++) {
    simT = i * 0.1
    mgr.update(0.1)

    // KOŞU ORTASINDA YERLEŞİM DEĞİŞİKLİĞİ (çekişmeli aile): bina dikilir, rota tazelenir.
    // traffic-load bunu HİÇ test etmiyordu; oyuncu ise oynarken sürekli bina koyuyor.
    if (i === ortaAdim) {
      katilar.push({ id: L.ortaOlay.id, rot: 0, ...L.ortaOlay })
      Car.solids = katilar   // setter yerleşim sürümünü artırır (önbellek boşalır)
      mgr.rerouteForGates?.()
    }

    for (const c of mgr.cars) {
      if (c.__fid === undefined) { c.__fid = ++fid; dogan++ }
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    }

    // ---- 1 sn'lik örnekleme ----
    if (i % 10 === 0) {
      const t = i / 10
      const canli = mgr.cars.filter(c => c.phase !== 'gone')
      // (a) SIKIŞAN
      for (const c of canli) {
        const p = c.group.position
        let z = izleme.get(c.__fid)
        if (!z) { z = { sikisT: 0, sonX: p.x, sonY: p.y, bildirildi: false }; izleme.set(c.__fid, z) }
        const yol = Math.hypot(p.x - z.sonX, p.y - z.sonY)
        z.sonX = p.x; z.sonY = p.y
        // blokT > 0 → konveyör kuralı BİLEREK durdurdu; kusur değil, sayaç sıfırlanır
        if (HAREKET.has(c.phase) && yol < SIKIS_ESIK && (c.blokT ?? 0) === 0) z.sikisT++
        else z.sikisT = 0
        if (z.sikisT >= SIKIS_SN && !z.bildirildi) {
          z.bildirildi = true
          const yk = enYakin(p.x, p.y)
          const kaynak = []
          if (c.waitIndex >= 0) kaynak.push('kuyruk')
          if (c.slotIndex >= 0) kaynak.push('pompa/şarj')
          if (c.parkId) kaynak.push('park')
          if (c.truckSlot >= 0) kaynak.push('tır')
          olaylar.push({ tur: kaynak.length ? 'ZOMBI' : 'SIKISAN', t, faz: c.phase,
            x: +p.x.toFixed(1), y: +p.y.toFixed(1), yakin: yk.id, nusha: yk.nusha, rot: yk.rot,
            mes: +yk.mes.toFixed(2), kaynak: kaynak.join('+') || '-', hardStuckT: +(c.hardStuckT ?? 0).toFixed(1),
            blokT: +(c.blokT ?? 0).toFixed(1), hiz: +yol.toFixed(3), yol: c.path?.length ?? 0,
            slotIndex: c.slotIndex, waitIndex: c.waitIndex, parkId: c.parkId ?? null, truckSlot: c.truckSlot })
        }
      }
      // (b) YIĞIN — birlik-bul ile küme
      const ebeveyn = new Map(canli.map(c => [c.__fid, c.__fid]))
      const bul = a => { while (ebeveyn.get(a) !== a) { ebeveyn.set(a, ebeveyn.get(ebeveyn.get(a))); a = ebeveyn.get(a) } return a }
      // (c) İÇİÇE — aynı çift taramasında ölçülür (O(n²) tek geçiş)
      const buCift = new Set()
      for (let a = 0; a < canli.length; a++) for (let b = a + 1; b < canli.length; b++) {
        const A = canli[a], B = canli[b]
        if (A.phase === 'transit' && B.phase === 'transit') continue // yol trafiği: istasyon kusuru değil
        const d = Math.hypot(A.group.position.x - B.group.position.x, A.group.position.y - B.group.position.y)
        if (d < YIGIN_MES) { const ra = bul(A.__fid), rb = bul(B.__fid); if (ra !== rb) ebeveyn.set(ra, rb) }
        if (d < ICICE_MES) {
          const k = A.__fid < B.__fid ? `${A.__fid}|${B.__fid}` : `${B.__fid}|${A.__fid}`
          buCift.add(k)
          const n = (iciceSay.get(k) ?? 0) + 1
          iciceSay.set(k, n)
          if (n === ICICE_SN && !bildirilenIcice.has(k)) {
            bildirilenIcice.add(k)
            const yk = enYakin((A.group.position.x + B.group.position.x) / 2, (A.group.position.y + B.group.position.y) / 2)
            const cift = [A.phase, B.phase].sort().join('/')
            olaylar.push({ tur: 'ICICE', t, faz: cift, x: +A.group.position.x.toFixed(1), y: +A.group.position.y.toFixed(1),
              yakin: yk.id, nusha: yk.nusha, rot: yk.rot, mes: +yk.mes.toFixed(2), d: +d.toFixed(2) })
          }
        }
      }
      for (const k of iciceSay.keys()) if (!buCift.has(k)) iciceSay.delete(k)
      const kume = new Map()
      for (const c of canli) { const r = bul(c.__fid); if (!kume.has(r)) kume.set(r, []); kume.get(r).push(c) }
      const buYigin = new Set()
      for (const [, uyeler] of kume) {
        if (uyeler.length < YIGIN_ADET) continue
        // anahtar = kümenin EN KÜÇÜK 3 kimliği: bir araç ayrılsa da küme kimliği kalır
        const k = uyeler.map(c => c.__fid).sort((a, b) => a - b).slice(0, 3).join('|')
        buYigin.add(k)
        const n = (yiginSay.get(k) ?? 0) + 1
        yiginSay.set(k, n)
        if (n === YIGIN_SN && !bildirilenYigin.has(k)) {
          bildirilenYigin.add(k)
          const cx = uyeler.reduce((a, c) => a + c.group.position.x, 0) / uyeler.length
          const cy = uyeler.reduce((a, c) => a + c.group.position.y, 0) / uyeler.length
          const yk = enYakin(cx, cy)
          const fazlar = [...new Set(uyeler.map(c => c.phase))].sort().join('/')
          olaylar.push({ tur: 'YIGIN', t, faz: fazlar, adet: uyeler.length,
            x: +cx.toFixed(1), y: +cy.toFixed(1), yakin: yk.id, nusha: yk.nusha, rot: yk.rot, mes: +yk.mes.toFixed(2) })
        }
      }
      for (const k of yiginSay.keys()) if (!buYigin.has(k)) yiginSay.delete(k)
    }

    // ---- servis simülasyonu (traffic-load ile aynı tempo) ----
    for (const [c, until] of [...busy]) {
      if (i < until) continue
      busy.delete(c)
      if (c.phase === 'atPump' && parkSpots.length && Math.random() < 0.5 && mgr.sendToParking(c)) continue
      if (c.phase === 'atPump' || c.phase === 'parked') mgr.releaseCar(c)
    }
    if (parkSpots.length) for (const c of mgr.cars) if (c.phase === 'parked' && !busy.has(c)) busy.set(c, i + 140)
  }
  Car.solids = []

  const say = t => olaylar.filter(o => o.tur === t).length
  return {
    seed: L.seed, aile: L.aile, dogan, served, lost, turnedAway, evTurnedAway, truckParked, rampLost,
    pompa: L.pumps.length, sarj: L.evs.length, yapi: L.yapilar.length,
    park: parkSpots.length, tir: truckSpots.length, kapi: [L.gateIn, L.gateOut],
    genisKapi: L.wide, far: L.farOn, isik: !!L.isik,
    sikisan: say('SIKISAN'), zombi: say('ZOMBI'), yigin: say('YIGIN'), icice: say('ICICE'),
    reaktifKacis: Car.reaktifKacis - reaktif0, muaf: mgr.blokStats.muaf,
    blokDurusSn: +mgr.blokStats.durusSn.toFixed(0),
    akis: +mgr.flow.ort.toFixed(3), durmaOrani: +mgr.flow.durmaOrani.toFixed(3),
    buharlasma: mgr.evapStats?.total ?? 0,
    sapma: L.sapma ?? [], olaylar,
  }
}

// ═══════════════════ 4) KOŞ + RAPORLA ═══════════════════
const pad = (v, n) => String(v).padStart(n)
const padr = (v, n) => String(v).padEnd(n)
const TELEMETRI_DIZIN = process.env.FUZZ_TELEMETRI
  ?? '/private/tmp/claude-502/-Users-benerits-Desktop-benerits-beneroil/9297bd4c-6569-4729-806b-9f0640d6fc10/scratchpad'
const gercekDosyalar = ['olay-4403.json', 'olay-4543.json', 'olay-4549.json']
  .map(f => path.join(TELEMETRI_DIZIN, f)).filter(f => existsSync(f))

// --yerlesim <tohum>: TEK yerleşimin geometrisini döker ve çıkar. Düzeltmeyi yazan
// ajan "bu tohumda ne var" sorusunu koşum yapmadan cevaplayabilsin diye var.
const dokIdx = ARG.indexOf('--yerlesim')
if (dokIdx >= 0) {
  const th = ARG[dokIdx + 1]
  const L = /^-?\d+$/.test(th) ? rastgeleYerlesim(Number(th))
    : gercekYerlesim(path.join(TELEMETRI_DIZIN, th.endsWith('.json') ? th : th + '.json'))
  const xin = xInOf(L, 'near'), xinF = L.farOn ? xInOf(L, 'far') : null
  console.log(`YERLEŞİM ${L.seed} · aile ${L.aile} · pompa ${L.pumps.length} · şarj ${L.evs.length}`
    + ` · bina ${L.yapilar.length} · geniş kapı ${L.wide} · karşı yaka ${L.farOn}`)
  console.log(`  kapı: giriş y=${L.gateIn} çıkış y=${L.gateOut}`
    + (L.farOn ? ` | karşı giriş y=${L.gateIn2} çıkış y=${L.gateOut2}` : ''))
  console.log(`  gelen omurga xIn(near)=${xin.toFixed(2)}${xinF != null ? ` xIn(far)=${xinF.toFixed(2)}` : ''}`
    + `  (korunan iç koridor bandı x 2.05..3.55 — omurga bunun DIŞINA düşerse bina dikilebilir)`)
  for (const u of [...L.pumps, ...L.evs])
    console.log(`  ${padr(u.id, 12)} footprint(${u.cx},${u.cy}) rot${u.rot} → gövde(${u.base.x.toFixed(2)},${u.base.y.toFixed(2)})`
      + ` yuva(${u.slot.x.toFixed(2)},${u.slot.y.toFixed(2)}) açı ${(u.ang * 180 / Math.PI).toFixed(0)}°`)
  for (const b of [...L.yapilar, ...L.zorlama])
    console.log(`  ${padr(b.id, 16)} (${b.cx},${b.cy}) ${b.w}×${b.d}`
      + (Math.abs(b.cx - xin) < b.w / 2 + 0.9 ? '   ⟵ GELEN OMURGA KOLONUNUN ÜSTÜNDE' : ''))
  process.exit(0)
}

console.log(`TRAFİK FUZZ — ${N} rastgele + ${gercekDosyalar.length} gerçek yerleşim · ${SURE} sn/koşum · tohum ${SEED0}`)
console.log('(ağır trafik: entryChance ×1.8, trafficPull ×2.2 — sıkışma baskı altında görünür)\n')

const yerlesimler = []
for (let k = 0; k < N; k++) yerlesimler.push(rastgeleYerlesim(SEED0 + k))
for (const f of gercekDosyalar) yerlesimler.push(gercekYerlesim(f))

const t0 = Date.now()
const sonuclar = []
for (const L of yerlesimler) sonuclar.push(kosuYerlesim(L, SURE))
const gecen = ((Date.now() - t0) / 1000).toFixed(1)

// ---- yerleşim tablosu ----
console.log(padr('tohum', 12) + padr('aile', 11) + pad('P', 3) + pad('E', 3) + pad('yapı', 5)
  + pad('park', 5) + pad('tır', 4) + pad('doğan', 6) + pad('servis', 7) + pad('kayıp', 6) + pad('giremz', 7)
  + pad('SIKIŞ', 6) + pad('ZOMBİ', 6) + pad('YIĞIN', 6) + pad('İÇİÇE', 6) + pad('muaf', 5) + pad('akış', 6) + pad('kaçış', 6))
console.log('─'.repeat(126))
for (const r of sonuclar) {
  const kotu = r.sikisan || r.zombi
  const bos = r.dogan < 50
  console.log((kotu ? '✗' : bos ? '!' : ' ') + padr(String(r.seed).slice(0, 10), 11) + padr(r.aile, 11)
    + pad(r.pompa, 3) + pad(r.sarj, 3) + pad(r.yapi, 5) + pad(r.park, 5) + pad(r.tir, 4)
    + pad(r.dogan, 6) + pad(r.served, 7) + pad(r.lost, 6) + pad(r.turnedAway, 7)
    + pad(r.sikisan, 6) + pad(r.zombi, 6) + pad(r.yigin, 6) + pad(r.icice, 6)
    + pad(r.muaf, 5) + pad((r.akis * 100).toFixed(0) + '%', 6) + pad(r.reaktifKacis, 6))
}

// ---- KATALOG: imzaya göre (faz çifti × en yakın yapı tipi × ünite açısı) ----
const katalog = new Map()
for (const r of sonuclar) for (const o of r.olaylar) {
  const anahtar = `${o.tur} │ ${o.faz} │ ${o.yakin} │ rot${o.rot}`
  if (!katalog.has(anahtar)) katalog.set(anahtar, { n: 0, tohumlar: new Set(), ornek: o })
  const e = katalog.get(anahtar)
  e.n++; e.tohumlar.add(r.seed)
}
const sirali = [...katalog.entries()].sort((a, b) => {
  const oncelik = t => (t.startsWith('ZOMBI') ? 0 : t.startsWith('SIKISAN') ? 1 : t.startsWith('YIGIN') ? 2 : 3)
  return oncelik(a[0]) - oncelik(b[0]) || b[1].n - a[1].n
})
console.log('\n═══ SIKIŞMA İMZA KATALOĞU (tür │ faz(lar) │ en yakın yapı │ ünite açısı) ═══')
if (!sirali.length) console.log('  (hiç olay yok)')
// ZOMBİ/SIKIŞAN/YIĞIN imzaları TAM listelenir (kabul kapısının kanıtı). İÇİÇE kalemi
// yüzlerce imza üretir (her yerleşimin kendi bina karışımı) — konsolda ilk 25'i, tamamı
// --raporla JSON'unda. Yoksa asıl kanıt ekranda kaybolur.
let iciceYazilan = 0, iciceGizli = 0
for (const [k, v] of sirali) {
  if (k.startsWith('ICICE') && !AYRINTI && ++iciceYazilan > 25) { iciceGizli++; continue }
  const th = [...v.tohumlar].slice(0, 6).join(',') + (v.tohumlar.size > 6 ? `,+${v.tohumlar.size - 6}` : '')
  console.log(`  ${padr(k, 58)} ×${pad(v.n, 5)}  yerleşim ${pad(v.tohumlar.size, 3)}  tohum: ${th}`)
  if (AYRINTI || !k.startsWith('ICICE')) console.log(`      örnek: t=${v.ornek.t}s @(${v.ornek.x},${v.ornek.y})`
    + ` en yakın ${v.ornek.nusha} (${v.ornek.mes} birim)${v.ornek.kaynak ? ' · TUTULAN KAYNAK: ' + v.ornek.kaynak : ''}`
    + `${v.ornek.yol !== undefined ? ' · rota ' + v.ornek.yol + ' nokta' : ''}`)
}
if (iciceGizli) console.log(`  … + ${iciceGizli} İÇİÇE imzası daha (tamamı --raporla JSON'unda; --ayrinti ile ekrana da basılır)`)

// ---- özet + kabul kapısı ----
const top = a => sonuclar.reduce((s, r) => s + r[a], 0)
const bosLar = sonuclar.filter(r => r.dogan < 50)
const kirikLar = sonuclar.filter(r => r.sikisan || r.zombi)
const sapmaLar = sonuclar.filter(r => r.sapma?.length)
// KISIR YERLEŞİM: araç DOĞUYOR ama kimse servis alamıyor. Sayaçlara "sıkışan" olarak
// düşmez (araçlar kıpırdıyor: giriyor, dolanıyor, gidiyor) ama oyuncu için sonuç aynı —
// istasyon çalışmıyor. Ayrı kalem olarak raporlanır, tek başına kapıyı kapatmaz.
const kisirLar = sonuclar.filter(r => r.dogan >= 50 && r.served === 0)
console.log(`\nTOPLAM: doğan ${top('dogan')} · servis ${top('served')} · SIKIŞAN ${top('sikisan')} · ZOMBİ ${top('zombi')}`
  + ` · YIĞIN ${top('yigin')} · İÇİÇE ${top('icice')} · muaf ${top('muaf')} · reaktif kaçış ${top('reaktifKacis')}`)
console.log(`Koşum süresi ${gecen} sn · sıkışan/zombi üreten yerleşim ${kirikLar.length}/${sonuclar.length}`)
for (const r of sapmaLar) console.log(`! ${r.seed}: yuva türetmesi kayıtla AYRIŞTI → ${r.sapma.join(' | ')}`)
if (bosLar.length) console.log(`✗ BOŞ KÜME: ${bosLar.map(r => `${r.seed}(${r.dogan})`).join(', ')} — <50 araç doğdu, bu yerleşimin yeşili SAYILMAZ`)
if (kisirLar.length) console.log(`! KISIR YERLEŞİM (araç doğdu, servis 0): ${kisirLar.map(r => `${r.seed}(doğan ${r.dogan})`).join(', ')}`)
const muafLar = sonuclar.filter(r => r.muaf > 0)
if (muafLar.length) console.log(`! 30 sn KİLİTLENME KAPISI açıldı: ${muafLar.map(r => `${r.seed}×${r.muaf}`).join(', ')}`
  + ' — konveyör kuralı bu yerleşimlerde kalıcı blok üretti (motor kendi acil valfini kullandı)')

const gecti = !top('sikisan') && !top('zombi') && !bosLar.length && !sapmaLar.length
console.log(gecti ? '\n✓ FUZZ GEÇTİ — hiçbir yerleşimde kalıcı sıkışan/zombi yok'
  : `\n✗ FUZZ DÜŞTÜ — ${top('sikisan')} sıkışan + ${top('zombi')} zombi (${kirikLar.length} yerleşim)`)

if (RAPORLA) {
  const dizin = process.env.FUZZ_RAPOR_DIR ?? (existsSync(TELEMETRI_DIZIN) ? TELEMETRI_DIZIN : tmpdir())
  if (!existsSync(dizin)) mkdirSync(dizin, { recursive: true })
  const dosya = path.join(dizin, `trafik-fuzz-${Date.now()}.json`)
  writeFileSync(dosya, JSON.stringify({
    argv: { n: N, sure: SURE, seed: SEED0 }, gecen: +gecen, gecti,
    ozet: { dogan: top('dogan'), servis: top('served'), sikisan: top('sikisan'), zombi: top('zombi'),
      yigin: top('yigin'), icice: top('icice'), muaf: top('muaf'), kirikYerlesim: kirikLar.length,
      kisir: kisirLar.map(r => r.seed), bos: bosLar.map(r => r.seed) },
    katalog: sirali.map(([k, v]) => ({ imza: k, adet: v.n, yerlesim: v.tohumlar.size, tohumlar: [...v.tohumlar], ornek: v.ornek })),
    yerlesimler: sonuclar,
  }, null, 1))
  console.log(`rapor: ${dosya}`)
}
// process.exit() DEĞİL: stdout bir boruya/dosyaya yazılıyorken exit() bekleyen yazımı
// kesiyor ve raporun sonu (özet + kabul kapısı satırı) kayboluyordu. exitCode doğal
// çıkışta uygulanır, çıktı eksiksiz akar.
process.exitCode = gecti ? 0 : 1
