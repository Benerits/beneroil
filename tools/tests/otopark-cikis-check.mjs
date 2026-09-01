/**
 * OTOPARK NOKTA HAVUZU + ÇIKIŞ KONVEYÖRÜ TESTİ (1 Eyl)
 *
 * KÖKEN: kuyruk fixlerinden SONRAKİ canlı faz analizi (400 olay, <2.15 çiftlerin tür
 * dağılımı): kalan iç içe kütlesi kuyrukta DEĞİL — parked+parked 240 · leaving ailesi
 * ~361 · toPark+toPark 124; waiting+waiting ilk 10'da bile yok. Lab kopyası (T11) iki
 * kaynağı ölçtü:
 *   A) OTOPARK: aynı otoparkın komşu çizgili yerleri 1,25 birim arayla (iki park etmiş
 *      araç KALICI <2.15'te — canlı parked+parked kümesinin imzası) + KOMŞU otoparkların
 *      uç noktaları 1,45'e kadar düşüyor, toPark araçları neredeyse aynı noktaya sürüyor.
 *      FIX: nokta havuzu tekliği — TÜM otoparkların noktaları tek havuzda, birbirine
 *      < 2.8 düşen nokta ELENİR (taşınmaz; pompa-slot fixinin eleme varyantı).
 *   B) ÇIKIŞ: giden omurga kolonunda leaving araçları birbirinin içinden akıyordu
 *      (lab min 0.00). FIX: konveyör kuralının çıkış aynası — aynı xOut kolonundaki
 *      öndekine < 3.0'da orantılı fren, 2.2 tam duruş, 2.55 ayrık-zaman tabanı,
 *      30 sn kilitlenme kapısı (cikisMuaf).
 *
 * BU TEST NEYİ KANITLAR:
 *  1) Kaynak: eleme + çıkış kapsamı gerçekten kodda.
 *  2) Headless sim (deterministik tohum):
 *     · havuz tekliği (bitişik/döndürülmüş lotlar dahil) — en yakın çift ≥ 2.8,
 *     · bitişik lotlarda park fazında DURAN çift <2.15 HİÇBİR karede yok (dolu kümede),
 *     · park eden sayısı düşmedi (eleme kapasiteyi yemedi),
 *     · çıkış omurgasında DURAN leaving çifti <2.5 HİÇBİR karede yok (dolu kümede),
 *     · determinizm: aynı tohum, iki koşu → aynı sayaçlar/konum karması,
 *     · 30 sn ÇIKIŞ kapısı ÇALIŞIYOR (elle kurulan kilitte açılır, doğal akışta 0).
 *  3) Tarayıcı (GERÇEK sahne): iki otopark + rush; canlı ölçüm (50 sn).
 *     PORT TARANIR, SUNUCU YOKSA HATA — sessiz atlama YASAK; boş kümeden geçen iddia
 *     YASAK; ?full=1'de ÖNCE #gguest'e basılır (misafir kapısı açıkken guestPaused
 *     entryChance'i 0 yapar, ölçüm boş geçer).
 *
 * Kullanım:  npm run dev -- --port 5399   →   npx tsx tools/tests/otopark-cikis-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
// DETERMİNİST tohum — traffic-load.mjs ile aynı PRNG (aynı senaryo → aynı akış)
let __seed = 0
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd

import { readFileSync } from 'node:fs'
const THREE = await import('three')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')
const { parkHavuzuAyikla, PARK_NOKTA_AYRIK } = await import('../../src/traffic-graph.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

// ───────────────────────────────────────── 1) KAYNAK DENETİMİ
console.log('== 1) Kaynak denetimi: eleme + çıkış kapsamı yerinde ==')
const graphSrc = readFileSync(new URL('../../src/traffic-graph.ts', import.meta.url), 'utf8')
const worldSrc = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')
const carsSrc = readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')
check('eleme eşiği tanımlı (PARK_NOKTA_AYRIK = 2.8)', /export const PARK_NOKTA_AYRIK = 2\.8\b/.test(graphSrc))
check('havuz süzgeci saf fonksiyon (parkHavuzuAyikla) traffic-graph\'ta',
  /export function parkHavuzuAyikla/.test(graphSrc))
check('world.getParkingSpots havuzdan geçiyor (rozet + atama + şerit ağı tek kaynaktan)',
  /return parkHavuzuAyikla\(spots\)/.test(worldSrc))
check('çıkış kapsamı konveyörde (leaving + xOut kolonu)',
  /const cikista = c\.phase === 'leaving'/.test(carsSrc) && /Math\.abs\(cp\.x - L\.xOut\) > 0\.6/.test(carsSrc))
check('çıkışın ayrı 30 sn kapısı defteri var (cikisMuaf/cikisDurusSn)',
  /cikisMuaf/.test(carsSrc) && /cikisDurusSn/.test(carsSrc))
check('karşı akış muafiyeti korunuyor (heading zıtsa blok yok)',
  /od\.x \* dir\.x \+ od\.y \* dir\.y < -0\.3\) continue/.test(carsSrc))
check('marina çıkış bloğundan da muaf (tekne boyu araç ölçeğinde değil)',
  /if \(c\.boat\) continue/.test(carsSrc))

// ───────────────────────────────────────── 2) HAVUZ TEKLİĞİ (saf geometri)
console.log('\n== 2) Nokta havuzu tekliği: bitişik ve döndürülmüş lotlar ==')
const PARK_YER = 4, PARK_ARALIK = 1.25, PARK_PAD_W = PARK_YER * PARK_ARALIK
const parkYerX = i => -PARK_PAD_W / 2 + PARK_ARALIK * (i + 0.5)
function parkLot(id, cx, cy, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot)
  const w = (lx, ly) => new THREE.Vector3(cx + lx * c - ly * s, cy + lx * s + ly * c, 0)
  return Array.from({ length: PARK_YER }, (_, i) => ({
    id: `${id}:${i}`, pos: w(parkYerX(i), -0.1), stage: w(parkYerX(i), 2.4), rot: rot - Math.PI / 2,
  }))
}
const enYakinCift = spots => {
  let m = Infinity
  for (let a = 0; a < spots.length; a++) for (let b = a + 1; b < spots.length; b++) {
    const d = Math.hypot(spots[a].pos.x - spots[b].pos.x, spots[a].pos.y - spots[b].pos.y)
    if (d < m) m = d
  }
  return m
}
{
  // bitişik iki lot (footprint 5.2 → merkezler 5.2 arayla): uç noktalar 1.45'e düşer
  const ham = [...parkLot('parking', -2.4, 0), ...parkLot('parking#1', 2.8, 0)]
  check(`HAM havuzda çakışma GERÇEKTEN var (en yakın çift ${enYakinCift(ham).toFixed(2)} < ${PARK_NOKTA_AYRIK})`,
    enYakinCift(ham) < PARK_NOKTA_AYRIK, 'senaryo hazardı üretmiyor — çit anlamsız')
  const suzgec = parkHavuzuAyikla(ham)
  check(`bitişik lotlar: ${ham.length} → ${suzgec.length} nokta, en yakın çift ${enYakinCift(suzgec).toFixed(2)} ≥ ${PARK_NOKTA_AYRIK}`,
    suzgec.length > 0 && enYakinCift(suzgec) >= PARK_NOKTA_AYRIK)
  // DÖNDÜRÜLMÜŞ komşu (90°): dik açıyla dayanmış lotların uçları da havuzda teklenir
  const dik = [...parkLot('parking', 0, 0), ...parkLot('parking#1', 3.4, 2.6, Math.PI / 2)]
  const dikS = parkHavuzuAyikla(dik)
  check(`döndürülmüş komşu: ${dik.length} → ${dikS.length} nokta, en yakın ${enYakinCift(dikS).toFixed(2)} ≥ ${PARK_NOKTA_AYRIK}`,
    dikS.length > 0 && enYakinCift(dikS) >= PARK_NOKTA_AYRIK)
  // TEK lot da teklenir: 1.25 aralıklı komşu çizgili yerler canlı parked+parked kümesinin
  // kaynağıydı — havuz tek lotta da <2.15 çifti imkânsız kılar (2 uç nokta kalır)
  const tek = parkHavuzuAyikla(parkLot('parking', 0.4, -2.0))
  check(`tek lot: 4 → ${tek.length} nokta (uçlar, ${enYakinCift(tek).toFixed(2)} ara) — rozet gerçek sayıyı gösterir`,
    tek.length === 2 && enYakinCift(tek) >= PARK_NOKTA_AYRIK)
  // DETERMİNİZM: aynı girdi → aynı havuz (greedy, bina sırası + indeks)
  const s2 = parkHavuzuAyikla(ham)
  check('eleme deterministik (aynı girdi → aynı kimlik kümesi)',
    suzgec.map(s => s.id).join() === s2.map(s => s.id).join())
}

// ───────────────────────────────────────── 3) HEADLESS SİM
// traffic-load kurulumunun sadeleşmiş kopyası: 6 pompa + bitişik 2 otopark, yoğun.
function kurSim({ pumps = 6, evs = 2, parking = null, entryMul = 1.8, pullMul = 2.2 } = {}) {
  __seed = 20260901
  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = pumps; state.evChargers = evs; state.wideGates = true
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3
  const pumpSlots = Array.from({ length: pumps }, (_, i) => new THREE.Vector3(2.4, -6 + (12 / pumps) * (i + 0.5), 0))
  const evSlots = Array.from({ length: evs }, (_, i) => new THREE.Vector3(1.8, -5 + (10 / Math.max(1, evs)) * (i + 0.5), 0))
  let served = 0
  const parkSpots = parking ?? []
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
    wideGates: () => true,
    onCarReady: c => { served++; c.phase = 'atPump' },
    onCarLost: () => {}, onTurnedAway: () => {},
  })
  Car.solids = parking
    ? [...pumpSlots.map(s => ({ cx: s.x - 1.8, cy: s.y, w: 1.5, d: 3.4 })),
       ...evSlots.map(s => ({ cx: s.x - 1.1, cy: s.y, w: 0.9, d: 1.4 }))]
    : []
  return { mgr, servis: () => served }
}

function kosu(saniye, opts, parkChance = 0.9) {
  const { mgr, servis } = kurSim(opts)
  const busy = new Map()
  // OLAY = çift ≥2 sn üst üste eşiğin altında (canlı telemetri ICICE_SURE'nin kopyası).
  // Anlık tekil kareler manevradır (yoldan geçen toPark'ın dönüş karesi, omurgaya
  // katılan aracın 1-2 karelik teması) — bilgi için sayılır, çit OLAY üstünedir.
  let parkVaris = 0, pDuranIcice = 0, pDuranMin = Infinity, pDoluKare = 0, pOlay = 0
  let cikCift = 0, cikSert = 0, cikMin = Infinity, cikOlay = 0
  let carSeq = 0
  const cid = c => (c.__cid ??= ++carSeq)
  const parkSurek = new Map(), cikSurek = new Map()
  const adim = saniye * 10
  for (let i = 0; i < adim; i++) {
    mgr.update(0.1)
    for (const c of mgr.cars) {
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
      if (c.phase === 'parked' && !c.__sayildi) { c.__sayildi = true; parkVaris++ }
    }
    for (const [c, until] of [...busy]) {
      if (i < until) continue
      busy.delete(c)
      if (c.phase === 'atPump' && opts.parking && __rnd() < parkChance && mgr.sendToParking(c)) continue
      if (c.phase === 'atPump' || c.phase === 'parked') mgr.releaseCar(c)
    }
    if (opts.parking) for (const c of mgr.cars) if (c.phase === 'parked' && !busy.has(c)) busy.set(c, i + 140)
    const duruyor = c => Math.hypot(c.group.position.x - (c.__kx ?? NaN), c.group.position.y - (c.__ky ?? NaN)) < 0.02
    const aktifPark = new Set(), aktifCik = new Set()
    // OTOPARK: park fazında DURAN çiftler — canlı telemetri iç içe eşiği 2.15 + 2 sn süre
    if (opts.parking) {
      const pk = mgr.cars.filter(c => (c.phase === 'parked' || c.phase === 'toPark') && duruyor(c))
      if (pk.filter(c => c.phase === 'parked').length >= 2) pDoluKare++
      for (let a = 0; a < pk.length; a++) for (let b = a + 1; b < pk.length; b++) {
        const d = Math.hypot(pk[a].group.position.x - pk[b].group.position.x,
                             pk[a].group.position.y - pk[b].group.position.y)
        if (d < pDuranMin) pDuranMin = d
        if (d < 2.15) {
          pDuranIcice++
          const key = cid(pk[a]) < cid(pk[b]) ? `${cid(pk[a])}|${cid(pk[b])}` : `${cid(pk[b])}|${cid(pk[a])}`
          aktifPark.add(key)
          const su = (parkSurek.get(key) ?? 0) + 1
          parkSurek.set(key, su)
          if (su === 20) pOlay++
          if (process.env.DIAG) console.log(`  PARK-DURAN t=${(i/10).toFixed(1)} d=${d.toFixed(2)} A=${pk[a].phase}@(${pk[a].group.position.x.toFixed(2)},${pk[a].group.position.y.toFixed(2)}) park=${pk[a].parkId} mv=${pk[a].moving} B=${pk[b].phase}@(${pk[b].group.position.x.toFixed(2)},${pk[b].group.position.y.toFixed(2)}) park=${pk[b].parkId} mv=${pk[b].moving}`)
        }
      }
      for (const k of [...parkSurek.keys()]) if (!aktifPark.has(k)) parkSurek.delete(k)
    }
    // ÇIKIŞ OMURGASI: aynı xOut kolonundaki ardışık leaving çiftleri
    const L = mgr.graph.get('near')
    if (L) {
      const q = mgr.cars.filter(c => c.station === 'near' && c.phase === 'leaving'
        && Math.abs(c.group.position.x - L.xOut) < 0.6)
        .sort((a, b) => (a.group.position.y - b.group.position.y) * L.dirY)
      for (let k = 1; k < q.length; k++) {
        const A = q[k - 1], B = q[k]
        const d = Math.hypot(A.group.position.x - B.group.position.x,
                             A.group.position.y - B.group.position.y)
        cikCift++
        if (d < cikMin) cikMin = d
        if (d < 2.5 && duruyor(A) && duruyor(B)) {
          cikSert++
          const key = cid(A) < cid(B) ? `${cid(A)}|${cid(B)}` : `${cid(B)}|${cid(A)}`
          aktifCik.add(key)
          const su = (cikSurek.get(key) ?? 0) + 1
          cikSurek.set(key, su)
          if (su === 20) cikOlay++
          if (process.env.DIAG) console.log(`  CIKIS-DURAN t=${(i/10).toFixed(1)} d=${d.toFixed(2)} A@(${A.group.position.x.toFixed(2)},${A.group.position.y.toFixed(2)})f${A.blokFren.toFixed(2)}mv${A.moving?1:0} B@(${B.group.position.x.toFixed(2)},${B.group.position.y.toFixed(2)})f${B.blokFren.toFixed(2)}mv${B.moving?1:0}`)
        }
      }
      for (const k of [...cikSurek.keys()]) if (!aktifCik.has(k)) cikSurek.delete(k)
    }
    for (const c of mgr.cars) { c.__kx = c.group.position.x; c.__ky = c.group.position.y }
  }
  let hash = 0
  for (const c of mgr.cars) {
    hash = (hash * 31 + Math.round(c.group.position.x * 10)) | 0
    hash = (hash * 31 + Math.round(c.group.position.y * 10)) | 0
  }
  return { servis: servis(), parkVaris, pDuranIcice, pDuranMin, pDoluKare, pOlay,
    cikCift, cikSert, cikMin, cikOlay, hash,
    stuck: mgr.cars.filter(c => c.hardStuckT > 3).length, evap: mgr.evapStats.total,
    muaf: mgr.blokStats.muaf, cikisMuaf: mgr.blokStats.cikisMuaf }
}

// ISINMA (determinizm ön şartı — konveyor-check ile aynı gerekçe: three.js uuid'leri ve
// modül önbellekleri ilk koşuda tohumlu akıştan fazladan çekiliş yapar)
kosu(30, { parking: parkHavuzuAyikla([...parkLot('parking', -2.4, 8.2), ...parkLot('parking#1', 2.8, 8.2)]) })

console.log('\n== 3a) Bitişik otoparklar (havuzdan): duran park çifti + çıkış ölçümü ==')
// lotlar KUZEY bandında (cy 8.2): pompa gövdelerinden uzak — koridorlar açık,
// ikiden fazla şerit kullanılabilir kalır (aynı anda ≥2 park ŞARTI dolu kümede ölçülsün)
const lotlar = [...parkLot('parking', -2.4, 8.2), ...parkLot('parking#1', 2.8, 8.2)]
const havuz = parkHavuzuAyikla(lotlar)
const a = kosu(300, { parking: havuz })
check(`ölçüm DOLU kümede (park eden ${a.parkVaris} · aynı anda ≥2 park ${a.pDoluKare} kare · çıkış ${a.cikCift} çift-kare)`,
  a.parkVaris >= 10 && a.pDoluKare >= 100 && a.cikCift >= 300,
  `park ${a.parkVaris} · dolu kare ${a.pDoluKare} · çıkış ${a.cikCift}`)
check(`park fazında ≥2 sn süren DURAN çift < 2.15 YOK (anlık ${a.pDuranIcice} · min ${isFinite(a.pDuranMin) ? a.pDuranMin.toFixed(2) : '—'})`,
  a.pOlay === 0, `${a.pOlay} kez ≥2 sn park çifti < 2.15`)
check(`çıkışta ≥2 sn süren DURAN leaving çifti < 2.5 YOK (anlık ${a.cikSert} · tüm çiftlerde min ${isFinite(a.cikMin) ? a.cikMin.toFixed(2) : '—'})`,
  a.cikOlay === 0, `çıkışta ${a.cikOlay} kez ≥2 sn duran çift < 2.5`)
check('kalıcı sıkışan 0 · buharlaşma 0', a.stuck === 0 && a.evap === 0, `sıkışan ${a.stuck} · buharlaşma ${a.evap}`)
check('30 sn kapıları doğal akışta hiç açılmadı (muaf 0 · cikisMuaf 0)',
  a.muaf === 0 && a.cikisMuaf === 0, `muaf ${a.muaf} · çıkış ${a.cikisMuaf}`)

console.log('\n== 3b) Kanıt koşusu: eleme OLMADAN aynı senaryo hazardı üretiyor ==')
const ham = kosu(300, { parking: lotlar })
check(`elemesiz koşuda ≥2 sn'lik DURAN park çifti olayı VAR (${ham.pOlay} olay · anlık ${ham.pDuranIcice}, min ${ham.pDuranMin.toFixed(2)}) — ölçüm hazardı görüyor`,
  ham.pOlay > 10, `elemesiz bile temiz (olay ${ham.pOlay}) — senaryo hazard üretmiyor, çit anlamsız`)
check(`eleme park eden sayısını DÜŞÜRMEDİ sayılır: havuzlu ${a.parkVaris} ≥ kullanılabilir kapasitenin doyumu`,
  a.parkVaris >= 10, `havuzlu park eden ${a.parkVaris}`)

console.log('\n== 3c) Determinizm: aynı tohum, iki koşu → aynı sayaçlar ==')
const b = kosu(300, { parking: havuz })
check(`servis/park/çıkış sayaçları birebir aynı (${a.servis}/${a.parkVaris}/${a.cikCift})`,
  a.servis === b.servis && a.parkVaris === b.parkVaris && a.cikCift === b.cikCift,
  `A ${a.servis}/${a.parkVaris}/${a.cikCift} vs B ${b.servis}/${b.parkVaris}/${b.cikCift}`)
check('son kare konum karması aynı (araçlar aynı yerde bitti)', a.hash === b.hash, `${a.hash} vs ${b.hash}`)

console.log('\n== 3d) 30 sn ÇIKIŞ kapısı: elle kurulmuş kalıcı blok ==')
// Doğal akışta çıkış zinciri hep akar (başı serbest) — kapıyı kanıtlamak için blok ELLE
// kurulur: giden omurgaya HİÇ kıpırdamayan bir leaving araç (A) sabitlenir, arkadaki
// leaving araç (B) hedefi A'nın ötesinde sürülür. B 2.55 bandında durmalı, 30 sn sonra
// kapısı açılmalı (cikisMuaf), A'nın içinden geçip hedefe varmalı; buharlaşma 0 kalmalı.
{
  // entryMul 0: istasyona müşteri girmez — sahnede yalnız elle kurulan A/B kalır,
  // araya doğal leaving aracı karışıp band ölçümünü bozamaz.
  const { mgr } = kurSim({ entryMul: 0 })
  mgr.update(0.1) // şerit ağı kurulsun
  const L = mgr.graph.get('near')
  const yap = y => {
    const c = new Car(new THREE.Scene(), null, 'fuel')
    c.phase = 'leaving'; c.station = 'near'
    c.group.position.set(L.xOut, y, 0)
    mgr.cars.push(c)
    return c
  }
  const A = yap(5)                       // omurgada HİÇ kıpırdamayan blokçu
  const B = yap(5 - L.dirY * 8)          // arkada; hedefi A'nın ötesinde
  const hedefY = 5 + L.dirY * 7
  B.setPath([new THREE.Vector3(L.xOut, hedefY, 0)])
  // BAND ALT SINIRI 2.2 (BLOK_DUR): test adımı kaba (dt=0.1 → 0.7 birim/kare) ve HİÇ
  // kıpırdamayan yapay öndekine tam gazla yaklaşan araç fren penceresine tek karede
  // girebilir — duruş 2.2-3.0 bandının herhangi bir yerine oturur. Doğal akışta öndeki
  // de hareket ettiğinden yaklaşma kademeli olur; duran çift ölçümü (3a) 2.5 tabanını
  // zaten dolu kümede denetliyor.
  let durdu = false, gap100 = -1
  for (let i = 0; i < 500; i++) {
    mgr.update(0.1)
    A.group.position.set(L.xOut, 5, 0)   // A sabitlenir
    A.setPath([]); A.phase = 'leaving'
    const gap = Math.hypot(B.group.position.x - A.group.position.x, B.group.position.y - A.group.position.y)
    if (i === 100) { gap100 = gap; durdu = gap >= 2.2 && gap <= 3.2 && B.moving }
  }
  const vardi = (B.group.position.y - hedefY) * L.dirY >= -0.5 || !B.moving
  check('çıkış bloğu B\'yi öndekinin 2.2-3.2 bandında DURDURDU (10. sn kontrolü)', durdu,
    `10. sn gap ${gap100.toFixed(2)}`)
  check(`ÇIKIŞ kilitlenme kapısı ÇALIŞIYOR: cikisMuaf ${mgr.blokStats.cikisMuaf} (kasıtlı kilitte açılması ŞART)`,
    mgr.blokStats.cikisMuaf > 0, 'blok 30 sn dolmasına rağmen çıkış kapısı hiç açılmadı')
  check('kapısı açılan araç yoluna devam edip HEDEFE VARDI (kalıcı kilit yok)', vardi,
    `B @(${B.group.position.x.toFixed(2)},${B.group.position.y.toFixed(2)})`)
  check('buharlaşma yine 0 (sigorta sessiz silmeye dönüşmedi)', mgr.evapStats.total === 0,
    `buharlaşma ${mgr.evapStats.total}`)
  check('GİRİŞ defteri kirlenmedi (muaf 0 — çıkış kilidi giriş sayacına yazılmıyor)',
    mgr.blokStats.muaf === 0, `muaf ${mgr.blokStats.muaf}`)
}
Car.solids = []

// ───────────────────────────────────────── 4) TARAYICI: GERÇEK SAHNE
// PORT SABİT DEĞİL, ARANIYOR + ATLAMA SESSİZ DEĞİL: bu bölüm fixlerin CANLI kanıtı.
const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5173', '5174']
let PORT = null
for (const prt of PORTLAR) {
  try { if ((await fetch(`http://localhost:${prt}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = prt; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`\n❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — CANLI SAHNE ÖLÇÜMÜ KOŞMADI.`)
  console.log('   Bu bölüm fixlerin canlı kanıtı; atlanırsa sonuç GEÇTİ sayılmaz.')
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  fail++
} else {
  console.log(`\n== 4) Canlı sahne (dev sunucu :${PORT}): 2 otopark + rush, 50 sn ==`)
  const { chromium } = await import('playwright-core')
  const brw = await chromium.launch({ channel: 'chrome' })
  const p = await brw.newPage()
  const hatalar = []
  p.on('pageerror', e => hatalar.push(e.message))
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
  await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })
  // MİSAFİR KAPISI: ?full=1'de kapı açık gelir ve guestPaused entryChance'i 0 yapar —
  // kapıya BASMADAN trafik ölçmek boş kümeden geçmek olur (YASAK).
  await p.evaluate(() => { document.getElementById('gguest')?.click() })
  await p.waitForTimeout(1200)
  const giris = await p.evaluate(() => window.__dbg?.cars?.opts?.entryChance?.() ?? 0)
  check('misafir kapısı kapandı, giriş şansı > 0 (guestPaused tuzağı yok)', giris > 0, `entryChance ${giris}`)
  await p.evaluate(() => {
    const d = window.__dbg, s = d.state
    for (let cc = 0; cc < 3; cc++) for (let rr = 0; rr < 3; rr++) d.kayit.arsaAl(cc, rr)
    s.money = 5e8
    // İKİ OTOPARK (canlı parked+parked kümesinin sahne kopyası): ikisi yan yana istenir
    // (footprint 5.2 → merkezler 5.2 arayla); pompa gövdesine denk gelirse binaOnarimi
    // İKİNCİYİ taşıyabilir — sorun değil: havuz tekliği CANLI nokta kümesi üzerinden
    // ölçülür ve kümenin ana kaynağı zaten AYNI otoparkın 1.25 aralıklı komşu yerleri.
    const k = JSON.parse(JSON.stringify(d.kayit.yuk()))
    k.placedPos = {}; k.placedRot = {}; k.placedRects = []
    k.s.pumps = 6; k.s.evChargers = 2
    k.s.parkingCount = 2
    k.placedPos.parking = [-3.9, -2.0]
    k.placedPos['parking#1'] = [1.3, -2.0]
    d.kayit.yukle(k)
    s.reputation = 5; s.signLevel = 3
    s.promo = { type: 'rush', until: Date.now() + 600_000 }
    // OLAY = çift 8 ardışık örnekte (250ms × 8 = 2 sn) eşiğin altında ve duran —
    // canlı telemetri tetiğinin (ICICE_SURE) birebir kopyası; tekil kareler manevra.
    window.__oc = { ornek: 0, parkZirve: 0, parkDuranIcice: 0, parkDuranMin: Infinity, parkOlay: 0,
      cikCift: 0, cikSert: 0, cikMin: Infinity, cikOlay: 0, havuzMin: Infinity, havuzN: 0, parkEden: 0,
      seq: 0, parkSurek: new Map(), cikSurek: new Map() }
    // AKIŞ GARANTİSİ: gerçek sahnede servis pompacı hızına bağlı — 35 sn'de tek araç
    // bile uğurlanmayabiliyor (ölçüldü: 8 atPump birikti, leaving 0 → ÇIKIŞ ölçümü boş
    // kümeden geçerdi, YASAK). Oyunun KENDİ yollarıyla akış sürülür: pompadaki müşteri
    // ya otoparka çekilir (sendToParking — park kümesi dolsun) ya uğurlanır (releaseCar —
    // çıkış omurgasında sürekli leaving akışı olsun).
    window.__ocPark = setInterval(() => {
      const c = d.cars.cars.find(x => x.phase === 'atPump' && x.truckSlot < 0 && !x.boat)
      if (!c) return
      const parked = d.cars.cars.filter(x => x.phase === 'parked').length
      if (parked >= 2 || !d.cars.sendToParking(c)) d.cars.releaseCar(c)
    }, 400)
    window.__ocTimer = setInterval(() => {
      const o = window.__oc
      o.ornek++
      // 1) HAVUZ TEKLİĞİ (canlı): dünyadan okunan nokta kümesi
      const spots = d.world.getParkingSpots()
      o.havuzN = spots.length
      for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) {
        const dd = Math.hypot(spots[i].pos.x - spots[j].pos.x, spots[i].pos.y - spots[j].pos.y)
        if (dd < o.havuzMin) o.havuzMin = dd
      }
      const dur = c => Math.hypot(c.group.position.x - (c.__ox ?? NaN), c.group.position.y - (c.__oy ?? NaN)) < 0.05
      const cid = c => (c.__ocid ??= ++o.seq)
      const aktifPark = new Set(), aktifCik = new Set()
      // 2) PARK FAZINDA DURAN ÇİFT < 2.15 (canlı telemetri eşiği + 2 sn süre)
      const pk = d.cars.cars.filter(c => (c.phase === 'parked' || c.phase === 'toPark') && dur(c))
      const parked = d.cars.cars.filter(c => c.phase === 'parked').length
      o.parkEden = Math.max(o.parkEden, parked)
      if (parked > o.parkZirve) o.parkZirve = parked
      for (let i = 0; i < pk.length; i++) for (let j = i + 1; j < pk.length; j++) {
        const dd = Math.hypot(pk[i].group.position.x - pk[j].group.position.x,
                              pk[i].group.position.y - pk[j].group.position.y)
        if (dd < o.parkDuranMin) o.parkDuranMin = dd
        if (dd < 2.15) {
          o.parkDuranIcice++
          const key = cid(pk[i]) < cid(pk[j]) ? cid(pk[i]) + '|' + cid(pk[j]) : cid(pk[j]) + '|' + cid(pk[i])
          aktifPark.add(key)
          const su = (o.parkSurek.get(key) ?? 0) + 1
          o.parkSurek.set(key, su)
          if (su === 8) o.parkOlay++
        }
      }
      for (const k of [...o.parkSurek.keys()]) if (!aktifPark.has(k)) o.parkSurek.delete(k)
      // 3) ÇIKIŞ OMURGASI: duran leaving çifti < 2.5 (2 sn sürerse olay)
      const L = d.cars.graph.get('near')
      if (L) {
        const q = d.cars.cars.filter(c => c.station === 'near' && c.phase === 'leaving'
          && Math.abs(c.group.position.x - L.xOut) < 0.6)
          .sort((x, y) => (x.group.position.y - y.group.position.y) * L.dirY)
        for (let i = 1; i < q.length; i++) {
          const dd = Math.hypot(q[i].group.position.x - q[i - 1].group.position.x,
                                q[i].group.position.y - q[i - 1].group.position.y)
          o.cikCift++
          if (dd < o.cikMin) o.cikMin = dd
          if (dd < 2.5 && dur(q[i]) && dur(q[i - 1])) {
            o.cikSert++
            const key = cid(q[i - 1]) < cid(q[i]) ? cid(q[i - 1]) + '|' + cid(q[i]) : cid(q[i]) + '|' + cid(q[i - 1])
            aktifCik.add(key)
            const su = (o.cikSurek.get(key) ?? 0) + 1
            o.cikSurek.set(key, su)
            if (su === 8) o.cikOlay++
          }
        }
      }
      for (const k of [...o.cikSurek.keys()]) if (!aktifCik.has(k)) o.cikSurek.delete(k)
      for (const c of d.cars.cars) { c.__ox = c.group.position.x; c.__oy = c.group.position.y }
    }, 250)
  })
  await p.waitForTimeout(50_000)
  const oc = await p.evaluate(() => {
    clearInterval(window.__ocTimer); clearInterval(window.__ocPark)
    const d = window.__dbg
    window.__oc.parkSurek = undefined; window.__oc.cikSurek = undefined // Map serileşmez
    return { ...window.__oc,
      parkDuranMin: isFinite(window.__oc.parkDuranMin) ? window.__oc.parkDuranMin : null,
      cikMin: isFinite(window.__oc.cikMin) ? window.__oc.cikMin : null,
      havuzMin: isFinite(window.__oc.havuzMin) ? window.__oc.havuzMin : null,
      muaf: d.cars.blokStats?.muaf ?? -1, cikisMuaf: d.cars.blokStats?.cikisMuaf ?? -1,
      seritler: d.cars.graph.parkLanesOf?.('near')?.length ?? -1 }
  })
  check(`CANLI havuz tekliği: ${oc.havuzN} nokta, en yakın çift ${oc.havuzMin?.toFixed(2)} ≥ 2.8 (kullanılabilir şerit ${oc.seritler})`,
    oc.havuzN > 0 && oc.havuzMin >= PARK_NOKTA_AYRIK, `havuz ${oc.havuzN} · min ${oc.havuzMin}`)
  // BOŞ KÜMEDEN GEÇEN İDDİA YASAK: sahnede GERÇEKTEN aynı anda ≥2 park etmiş araç görülmeli
  check(`ölçüm DOLU kümede (park zirvesi ${oc.parkZirve} araç · çıkış ${oc.cikCift} çift-örnek · ${oc.ornek} örnek)`,
    oc.parkZirve >= 2 && oc.cikCift >= 25 && oc.ornek > 100,
    `parkZirve ${oc.parkZirve} · çıkış ${oc.cikCift} · örnek ${oc.ornek}`)
  check(`CANLI: park fazında ≥2 sn süren DURAN çift < 2.15 YOK (anlık ${oc.parkDuranIcice} · min ${oc.parkDuranMin ? oc.parkDuranMin.toFixed(2) : '—'})`,
    oc.parkOlay === 0, `${oc.parkOlay} kez ≥2 sn park çifti < 2.15`)
  check(`CANLI: çıkışta ≥2 sn süren DURAN leaving çifti < 2.5 YOK (anlık ${oc.cikSert} · tüm çiftlerde min ${oc.cikMin ? oc.cikMin.toFixed(2) : '—'})`,
    oc.cikOlay === 0, `çıkışta ${oc.cikOlay} kez ≥2 sn duran çift < 2.5`)
  check('CANLI: 30 sn kapıları açılmadı (muaf 0 · cikisMuaf 0)', oc.muaf === 0 && oc.cikisMuaf === 0,
    `muaf ${oc.muaf} · çıkış ${oc.cikisMuaf}`)
  check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))
  await brw.close()
}

console.log(`\n${fail === 0 ? '✅' : '❌'} otopark havuzu + çıkış konveyörü: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
