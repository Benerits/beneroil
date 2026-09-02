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
const { parkHavuzuAyikla, PARK_NOKTA_AYRIK } = await import('../../src/traffic-graph.ts')

const ROAD_X = 7.9

// ÇARPIŞMA BAYRAĞI YOK: mimari kararla araç-araç çarpışması tamamen kaldırıldı
// (oyun sahibi: "gerekirse birbirinin içinden geçsinler"). Bu yüzden eski A/B (açık vs
// kapalı) kıyası anlamsızlaştı; onun yerine iç içe geçme AKIŞ/YERLEŞİM olarak ayrıştırılıp
// ölçülüyor. FORCE_COLLIDE değişkeni artık davranışı değiştirmez, koşum yine geçmelidir.
// OTOPARK YERLEŞİMİ (T9/T11) — oyundaki world.getParkingSpots() ile AYNI türetme.
// SABİTLER KAYNAK KODDAN OKUNUR (1 Eyl): helper'da 4x1.25 kopyası kalmıştı; ızgara
// 2x2.5'e geçince test ESKİ ızgarayı sürüyordu (T9 kırmızısının yarısı buydu) —
// sentetik yerleşim artık gerçek üreticinin sabitlerinden türer, ayrışamaz.
const __worldSrc = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')
const __stateSrc = readFileSync(new URL('../../src/state.ts', import.meta.url), 'utf8')
const PARK_YER = Number(__stateSrc.match(/export const PARK_YER = (\d+)/)[1])
const PARK_ARALIK = Number(__worldSrc.match(/export const PARK_ARALIK = ([\d.]+)/)[1])
const PARK_PAD_W = PARK_YER * PARK_ARALIK
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
  // her senaryo AYNI tohumla başlar → A/B birebir karşılaştırılabilir.
  // SEED env'i yalnız DAĞILIM ölçümü için (tohum duyarlılığı raporu); varsayılan sabit.
  __seed = Number(process.env.SEED) || 20260726
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
  // ── OTOPARK DURAN ÇİFT (canlı parked+parked kümesinin ölçümü): park fazındaki
  // (parked/toPark) iki araç İKİSİ DE DURURKEN < 2.15'e düşüp bu durum 2 sn SÜRERSE
  // canlı telemetri OLAY üretir (trafik-olay ICICE_MESAFE + ICICE_SURE) — park etmiş
  // komşu araç çifti bu şartı KALICI doldurur; ölçüt o olayın birebir lab kopyası.
  // Anlık tekil kareler (yol üstünden geçen toPark aracının dönüş karesi gibi) manevradır,
  // kuyruk ölçütündeki "yanaşma anı" ayrımının aynısı — anlık sayaç bilgi için tutulur.
  let pDuranIcice = 0, pDuranMin = Infinity, pOlay = 0, parkZirve = 0
  // ── ÇIKIŞ KONVEYÖRÜ ÖLÇÜMÜ: giden omurga (xOut) kolonundaki leaving çiftleri ──
  // Kuyruk ölçümünün aynası: DURAN çift < 2.5, 2 sn SÜRERSE olay (konveyör 2.55 taban
  // verir; park-çıkışından omurgaya KATILAN araç öndeki trafiğin 2.5 penceresine bir-iki
  // kare düşebilir — o bir katılma manevrası, donmuş iç içe kuyruk değil). Kolon dışına
  // çıkmış (yola katılmış) araç ölçüme girmez — kural kapsamı da aynı.
  let cikCift = 0, cikSert = 0, cikIhlal = 0, cikMin = Infinity, cikOlay = 0
  let agizCift = 0, agizIhlal = 0, agizMin = Infinity
  let korCift = 0, korIhlal = 0, korAgir = 0, korMin = Infinity
  let yolCift = 0, yolIhlal = 0, yolAgir = 0, yolMin = Infinity
  let carSeq = 0
  const cikSurek = new Map(), parkSurek = new Map()
  const cid = c => (c.__cid ??= ++carSeq)
  // ── KONVEYÖR ÖLÇÜMÜ: kuyruk/omurga hattında ARDIŞIK araç çifti mesafesi ──
  // Canlı telemetrideki en büyük küme (22x) kuyruk başında burun buruna araçlardı.
  // HER KAREDE ölçülür (örnekleme değil): hedef, hiçbir karede < 2.5 çift olmaması
  // ve < 2.66 (gövde boyu) çiftin ~0 olması — görsel iç içelik biter.
  let kuyrukCift = 0, kuyrukIhlal = 0, kuyrukSert = 0, kuyrukMin = Infinity, kuyrukZirve = 0
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
  const IZ = Number(process.env.AGIZ_IZ) || 0
  const yol = c => c.path.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' > ')
  const iz = c => { const p = c.group.position, h = c.headingDir(), n = c.hedefNokta
    return `#${cid(c)} (${p.x.toFixed(2)},${p.y.toFixed(2)}) yön=${h ? h.x.toFixed(2) + ',' + h.y.toFixed(2) : '-'} hedef=${n ? n.x.toFixed(1) + ',' + n.y.toFixed(1) : '-'} muaf=${c.blokMuaf} blokT=${c.blokT.toFixed(1)} hız=${c.speedScale.toFixed(2)} mov=${c.moving} yol[${yol(c)}]\n        geçmiş: ${(c.__hist ?? []).join(' → ')}` }
  for (let i = 0; i < steps; i++) {
    mgr.update(0.1)
    // İZ (AGIZ_IZ=<eşik>): her aracın faz geçmişi tutulur; kapı ağzı / çıkış kolonu çiftleri
    // eşiğin altına inince iki aracın konum+rota+geçmişi basılır. Teşhis aracı, ölçümü etkilemez.
    if (IZ) for (const c of mgr.cars) {
      const k = c.phase + '/' + (c.parkLane ? 'P' : '-') + '/' + c.slotIndex + '/' + c.waitIndex
      if (c.__ph !== k) { c.__ph = k; (c.__hist ??= []).push(`${(i / 10).toFixed(1)}s ${k} (${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)}) mov=${c.moving} yol[${yol(c)}]`) }
    }
    if (service) for (const c of mgr.cars) {
      if (seen.has(c)) continue
      seen.add(c)
      const x = c.group.position.x
      if (Math.abs(x - service.near) < 0.2 || Math.abs(x - service.far) < 0.2) svcSpawns++
    }
    for (const c of mgr.cars) {
      if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    }
    // ── KONVEYÖR: kuyruk hattındaki ardışık çiftler (her karede — "hiçbir karede" iddiası) ──
    // İki segment var: ANA hat (gelen omurga, xIn kolonu) + BANKET (yol omuzu, kapıdan
    // önce). Çift, iki araç da AYNI segmentin kolonundayken ölçülür; segmentler arası
    // geçiş yapan araç (kapı manevrası) o an hiçbir kolonda değildir ve ölçüme girmez —
    // indiği anda tekrar sayılır, kalıcı bir ihlal asla gizlenemez.
    // İKİ KADEME (bilerek): SERT ölçüt (<2.5, tek kare bile yasak) yalnız DURAN çiftlere
    // uygulanır — oyuncunun gördüğü "kuyruk iç içe" duran araçlardır ve konveyör bunlara
    // taban 2.55 garantisi verir. Slota ÇAPRAZ yanaşan araç yerleşmiş komşusunun 2.2-2.5
    // yanından yarım saniye geçebilir (ölçüldü, min ~2.0); o bir manevra, iç içelik değil —
    // yine de <2.66 oranı TÜM çiftlerde ~0 tutulur ki sürüklenme saklanamasın.
    for (const st of far ? ['near', 'far'] : ['near']) {
      const L = mgr.graph.get(st)
      if (!L) continue
      const spillX = L.spillStart < L.queue.length ? L.queue[L.spillStart].x : null
      const hat = c => Math.abs(c.group.position.x - L.xIn) < 0.6 ? 'ana'
        : (spillX != null && Math.abs(c.group.position.x - spillX) < 0.6 ? 'banket' : null)
      const q = mgr.cars.filter(c => c.station === st && c.waitIndex >= 0
        && (c.phase === 'waiting' || c.phase === 'driving') && hat(c))
        .sort((a, b) => a.waitIndex - b.waitIndex)
      if (q.length > kuyrukZirve) kuyrukZirve = q.length
      for (let k = 1; k < q.length; k++) {
        if (hat(q[k]) !== hat(q[k - 1])) continue
        const A = q[k - 1], B = q[k]
        const d = Math.hypot(A.group.position.x - B.group.position.x,
                             A.group.position.y - B.group.position.y)
        kuyrukCift++
        if (d < kuyrukMin) kuyrukMin = d
        if (d < 2.66) kuyrukIhlal++
        // DURAN çift: ikisi de son karede ~kıpırdamamış (kayan/yanaşan araç hariç;
        // ilk kez görülen araç NaN karşılaştırmasıyla duran SAYILMAZ)
        const durA = Math.hypot(A.group.position.x - (A.__kx ?? NaN),
                                A.group.position.y - (A.__ky ?? NaN)) < 0.02
        const durB = Math.hypot(B.group.position.x - (B.__kx ?? NaN),
                                B.group.position.y - (B.__ky ?? NaN)) < 0.02
        if (d < 2.5 && durA && durB) kuyrukSert++
      }
    }
    // ── ÇIKIŞ OMURGASI: aynı xOut kolonundaki ardışık leaving çiftleri (her karede) ──
    const duruyor = c => Math.hypot(c.group.position.x - (c.__kx ?? NaN),
                                    c.group.position.y - (c.__ky ?? NaN)) < 0.02
    const aktifCik = new Set(), aktifPark = new Set()
    for (const st of far ? ['near', 'far'] : ['near']) {
      const L = mgr.graph.get(st)
      if (!L) continue
      const q = mgr.cars.filter(c => c.station === st && c.phase === 'leaving'
        && Math.abs(c.group.position.x - L.xOut) < 0.6)
        .sort((a, b) => (a.group.position.y - b.group.position.y) * L.dirY)
      for (let k = 1; k < q.length; k++) {
        const A = q[k - 1], B = q[k]
        const d = Math.hypot(A.group.position.x - B.group.position.x,
                             A.group.position.y - B.group.position.y)
        cikCift++
        if (d < cikMin) cikMin = d
        if (d < 2.66) cikIhlal++
        if (IZ && d < IZ && (globalThis.__izC = (globalThis.__izC ?? 0) + 1) <= 3)
          console.log(`  [KOLON ${label} ${(i / 10).toFixed(1)}s d=${d.toFixed(2)}]\n      ${iz(A)}\n      ${iz(B)}`)
        if (d < 2.5 && duruyor(A) && duruyor(B)) {
          cikSert++
          const key = cid(A) < cid(B) ? `${cid(A)}|${cid(B)}` : `${cid(B)}|${cid(A)}`
          aktifCik.add(key)
          const su = (cikSurek.get(key) ?? 0) + 1
          cikSurek.set(key, su)
          if (su === 20) cikOlay++ // 2 sn doldu → canlı telemetri olay eşdeğeri
        }
      }
    }
    for (const k of [...cikSurek.keys()]) if (!aktifCik.has(k)) cikSurek.delete(k)
    // ── KORİDOR/KOL (2 Eyl canlı #5815): kolon DIŞINDA, henüz yola çıkmamış, AYNI yöne
    // seyreden leaving çiftleri (otopark çıkış koridoru, pompa kolu). Canlı 1054 bundle'ı:
    // iki lotun aracı aynı anda koridora çıkıp tam aynı noktada (d=0.00) kolona kadar
    // kilit adımda sürdü — kolon ölçümü bunu görmez (kolona girince kavşak kuralı ayırır).
    // Ölçüt: canlı iç içe (boyuna < 2.15) eşdeğeri; d < 1.0 "içine girmiş".
    for (const st of far ? ['near', 'far'] : ['near']) {
      const L = mgr.graph.get(st)
      if (!L) continue
      const q = mgr.cars.filter(c => c.station === st && c.phase === 'leaving' && c.moving
        && Math.abs(c.group.position.x - L.xOut) >= 0.6 && L.sideSign * (c.group.position.x - L.gateX) > 0.3)
      for (let a = 0; a < q.length; a++) for (let b = a + 1; b < q.length; b++) {
        const A = q[a], B = q[b]
        const da = A.headingDir(), db = B.headingDir()
        if (!da || !db || da.x * db.x + da.y * db.y < 0.7) continue
        const d = Math.hypot(A.group.position.x - B.group.position.x, A.group.position.y - B.group.position.y)
        korCift++
        if (d < korMin) korMin = d
        if (d < 2.15) korIhlal++
        if (d < 1.0) korAgir++
        if (IZ && d < IZ && (globalThis.__izK = (globalThis.__izK ?? 0) + 1) <= 3)
          console.log(`  [KORİDOR ${label} ${(i / 10).toFixed(1)}s d=${d.toFixed(2)}]\n      ${iz(A)}\n      ${iz(B)}`)
      }
    }
    // ── YOL ŞERİDİ (2 Eyl canlı 1054/1133): şerit kolonunda AYNI yöne seyreden transit/
    // leaving çiftleri. Canlıda kalan en büyük sınıf: transit+transit 1.4–2.0 (öndeki
    // yavaşlayınca orantılı takip 0.9'a kadar sokuluyordu), leaving+transit 1.2–2.2
    // (kapıdan 0.15'le katılanın dibine). Ölçüt: boyuna < 2.15 = canlı iç içe; < 1.5 ağır.
    for (const st of far ? ['near', 'far'] : ['near']) {
      const L = mgr.graph.get(st)
      if (!L) continue
      const q = mgr.cars.filter(c => c.lane === st && !c.boat && c.moving
        && (c.phase === 'transit' || c.phase === 'leaving') && Math.abs(c.group.position.x - L.lane) <= 0.6)
      for (let a = 0; a < q.length; a++) for (let b = a + 1; b < q.length; b++) {
        const A = q[a], B = q[b]
        const da = A.headingDir(), db = B.headingDir()
        if (!da || !db || da.x * db.x + da.y * db.y < 0.7) continue
        const d = Math.abs(A.group.position.y - B.group.position.y)
        if (d > 6) continue
        yolCift++
        if (d < yolMin) yolMin = d
        if (d < 2.15) yolIhlal++
        if (d < 1.5) yolAgir++
        if (IZ && d < IZ && (globalThis.__izY = (globalThis.__izY ?? 0) + 1) <= 3)
          console.log(`  [YOL ${label} ${(i / 10).toFixed(1)}s d=${d.toFixed(2)}]\n      ${iz(A)}\n      ${iz(B)}`)
      }
    }
    // ── KAPI AĞZI (2 Eyl canlı): kapıdan ÇIKMIŞ ama şeride henüz KATILMAMIŞ leaving
    // araçlar — omurga kolonu ölçümünün kör noktası. Canlı yığılma olaylarında (#4999,
    // #5016) kapı ağzında 0.8–1.1 aralıkla leaving dizisi vardı. Kural kapsamı xOut kolonu
    // olduğundan buradaki araç hiçbir şeyi beklemiyor. Her karede tüm çiftler.
    for (const st of far ? ['near', 'far'] : ['near']) {
      const L = mgr.graph.get(st)
      if (!L) continue
      const agiz = mgr.cars.filter(c => c.station === st && c.phase === 'leaving'
        && (c.group.position.y - L.gateOutY) * L.dirY > -0.5
        && (c.group.position.y - L.gateOutY) * L.dirY < 9
        && Math.abs(c.group.position.x - L.lane) > 0.6)
      for (let a = 0; a < agiz.length; a++) for (let b = a + 1; b < agiz.length; b++) {
        const d = Math.hypot(agiz[a].group.position.x - agiz[b].group.position.x,
                             agiz[a].group.position.y - agiz[b].group.position.y)
        agizCift++
        if (d < agizMin) agizMin = d
        if (d < 1.8) agizIhlal++
        if (IZ && d < IZ && (globalThis.__izN = (globalThis.__izN ?? 0) + 1) <= 3)
          console.log(`  [AĞIZ ${label} ${(i / 10).toFixed(1)}s d=${d.toFixed(2)}]\n      ${iz(agiz[a])}\n      ${iz(agiz[b])}`)
      }
    }
    // ── OTOPARK: park fazındaki DURAN çiftler (her karede; olay = 2 sn süren çift) ──
    if (parking) {
      const suAnParkli = mgr.cars.filter(c => c.phase === 'parked').length
      if (suAnParkli > parkZirve) parkZirve = suAnParkli
      const pk = mgr.cars.filter(c => (c.phase === 'parked' || c.phase === 'toPark') && duruyor(c))
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
          if (su === 20) pOlay++ // 2 sn doldu → canlı telemetri olay eşdeğeri
        }
      }
      for (const k of [...parkSurek.keys()]) if (!aktifPark.has(k)) parkSurek.delete(k)
    }
    // önceki konum (duran çift tespiti) her adımda HERKES için güncellenir
    for (const c of mgr.cars) { c.__kx = c.group.position.x; c.__ky = c.group.position.y }
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
  // TEK istisna KONVEYÖR DURUŞU: blok kuralı gereği sırasını bekleyen araç (blokFren
  // < 0.15) hardStuckT biriktirmez (Car.update) — o bir bekleme, kusur değil. Kuralın
  // kendisi kalıcı blok üretirse 30 sn kapısı açılır ve blokStats.muaf sayar; muaf'ın
  // patlaması ayrı bir kriter olarak aşağıda denetlenir. hardStuckT > 3 hâlâ gerçek kusur.
  const stuck = mgr.cars.filter(c => c.hardStuckT > 3).length
  const blok = { ...(mgr.blokStats ?? { durusSn: 0, muaf: 0 }) } // eski kod fallback (A/B stash koşusu)
  // BEKÇİ (kalıcı sıkışma sigortası): sağlıklı akışta İKİSİ DE 0. Sıfırdan farklıysa
  // rota bir yerde varılamayan hedefe çıkıyor demektir — sayı burada GÖRÜNÜR kalmalı.
  const bekci = { yenidenRota: 0, kurtarma: 0, kurtarmaFaz: {}, ...(mgr.kurtarmaStats ?? {}) }
  if (!quiet) console.log(`${label}: servis=${served} kayıp=${lost} giremeyen=${turnedAway}${highway ? ' rampKayıp=' + rampLost : ''}`
    + ` | buharlaşma=${st.total} | kalıcı sıkışan=${stuck}`
    + ` | ÇAKIŞMA ${cakOrt.toFixed(1)} çift/kare · içiçe ${cakAgirOrt.toFixed(2)} (akış ${icAkisOrt.toFixed(2)} + yerleşim ${icDuranOrt.toFixed(2)})`
    + ` | AKIŞ hız ${(fl.ort * 100).toFixed(0)}% sapma ${fl.sapma.toFixed(2)} durma ${fl.duraklama} (%${(fl.durmaOrani * 100).toFixed(1)} kare)`
    + ` | apron zirve ${apronMax}`
    + ` | KUYRUK zirve ${kuyrukZirve} · çift min ${isFinite(kuyrukMin) ? kuyrukMin.toFixed(2) : '—'}`
    + ` · <2.66 ${kuyrukIhlal}/${kuyrukCift} · <2.5 ${kuyrukSert}`
    + ` | ÇIKIŞ çift min ${isFinite(cikMin) ? cikMin.toFixed(2) : '—'} · <2.66 ${cikIhlal}/${cikCift} · duran<2.5 olay ${cikOlay} (anlık ${cikSert})`
    + ` | KORİDOR çift min ${isFinite(korMin) ? korMin.toFixed(2) : '—'} · <2.15 ${korIhlal}/${korCift} · <1.0 ${korAgir}`
    + ` | YOL çift min ${isFinite(yolMin) ? yolMin.toFixed(2) : '—'} · <2.15 ${yolIhlal}/${yolCift} · <1.5 ${yolAgir}`
    + ` | KAPI AĞZI çift min ${isFinite(agizMin) ? agizMin.toFixed(2) : '—'} · <1.8 ${agizIhlal}/${agizCift}`
    + ` | blok duruş ${blok.durusSn.toFixed(0)}sn muaf ${blok.muaf}`
    + ` · çıkış duruş ${(blok.cikisDurusSn ?? 0).toFixed(0)}sn muaf ${blok.cikisMuaf ?? 0}`
    + ` | BEKÇİ rota ${bekci.yenidenRota} kurtarma ${bekci.kurtarma}`
    + (bekci.kurtarma ? ` ${JSON.stringify(bekci.kurtarmaFaz)}` : ''))
  const park = { varis: parkVaris, cakisma: pOrnek ? pCakisma / pOrnek : 0,
    agir: pOrnek ? pAgir / pOrnek : 0, disari: pDisari, disariOrnek: pDisariOrnek,
    duranIcice: pDuranIcice, duranMin: pDuranMin, olay: pOlay, zirve: parkZirve }
  if (!quiet && parking) {
    console.log(`   ↳ OTOPARK: park eden ${park.varis} (aynı anda zirve ${park.zirve}) | çakışma ${park.cakisma.toFixed(2)} çift/kare`
      + ` · iç içe ${park.agir.toFixed(2)} | slot DIŞINDA park ${park.disari}/${park.disariOrnek}`
      + ` | DURAN çift <2.15: olay ${park.olay} · anlık ${park.duranIcice} (min ${isFinite(park.duranMin) ? park.duranMin.toFixed(2) : '—'})`
      + ` | kullanılabilir şerit ${mgr.graph.parkLanesOf?.('near').length ?? '-'}/${parkSpots.length}`)
  }
  return { st, stuck, served, rampLost, laneUse: svcSpawns, cakisma: cakOrt, cakismaAgir: cakAgirOrt,
    icAkis: icAkisOrt, icDuran: icDuranOrt, flow: fl, apronMax, turnedAway, park,
    kuyruk: { cift: kuyrukCift, ihlal: kuyrukIhlal, sert: kuyrukSert, min: kuyrukMin, zirve: kuyrukZirve },
    cikis: { cift: cikCift, ihlal: cikIhlal, sert: cikSert, olay: cikOlay, min: cikMin },
    koridor: { cift: korCift, ihlal: korIhlal, agir: korAgir, min: korMin },
    yol: { cift: yolCift, ihlal: yolIhlal, agir: yolAgir, min: yolMin },
    agiz: { cift: agizCift, ihlal: agizIhlal, min: agizMin }, blok, bekci }
}

let fail = 0
const kontrol = (ok, iyi, kotu) => { if (ok) console.log(`✓ ${iyi}`); else { console.log(`✗ ${kotu}`); fail++ } }
// ── YOL ŞERİDİ ÇİTİ (2 Eyl, canlı 1054/1133 transit+transit 1.4–2.0 · leaving+transit 1.2–2.2):
// takip kuralı orantı → ARALIK (2.2 altına inmez), katılım boşluğu sabit pencere → boşluk
// kabulü, katılım kapsamı 0.6 → 1.1 (takip kuralının yanal kapsamıyla aynı; iki kural
// aynı anda işlemez). Kapsamsız ölçüm (seed 1): T2 58/2561, T8 199/7346, T10 172/5954,
// <1.5: 31/94/73. Kalan: yoğun akışta kolona 1.1 kala tam hız katılım (min 1.37, geçici).
const yolCiti = (kod, r, pay) => kontrol(r.yol.agir <= pay && r.yol.ihlal <= Math.max(pay, r.yol.cift * 0.005),
  `${kod}: YOL ŞERİDİNDE aynı yönlü çift < 2.15 ${r.yol.ihlal}/${r.yol.cift} · < 1.5 ${r.yol.agir} (min ${isFinite(r.yol.min) ? r.yol.min.toFixed(2) : '—'})`,
  `${kod}: yol şeridinde ${r.yol.ihlal} çift-kare < 2.15 · ${r.yol.agir} < 1.5 (min ${r.yol.min.toFixed(2)}) — takip/katılım kuralı geriledi`)

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
  yolCiti(kod, r, 2)
  // KONVEYÖR (hedef metrik): kuyrukta ardışık çift hiçbir karede < 2.5 değil,
  // < 2.66 (gövde boyu) çift ~0 — görsel iç içelik bitti. Asıl laboratuvar T10'da;
  // burada regresyon çiti (T1-T3'te kuyruk nadir oluşur, boş küme geçer sayılmaz diye
  // "gördüyse temiz" biçiminde yazıldı: sert ihlal MUTLAK sıfır).
  kontrol(r.kuyruk.sert === 0, `${kod}: DURAN kuyruk çiftinde < 2.5 HİÇ yok (tüm çiftlerde min ${isFinite(r.kuyruk.min) ? r.kuyruk.min.toFixed(2) : '—'})`,
    `${kod}: ${r.kuyruk.sert} karede DURAN kuyruk çifti < 2.5 (min ${r.kuyruk.min.toFixed(2)}) — konveyör kapısı delik`)
  kontrol(r.kuyruk.ihlal <= Math.max(2, r.kuyruk.cift * 0.001),
    `${kod}: kuyrukta < 2.66 çift ~0 (${r.kuyruk.ihlal}/${r.kuyruk.cift})`,
    `${kod}: kuyrukta ${r.kuyruk.ihlal}/${r.kuyruk.cift} çift < 2.66 — iç içelik sürüyor`)
  kontrol(r.blok.muaf === 0, `${kod}: 30 sn kilitlenme kapısı hiç gerekmedi (muaf 0)`,
    `${kod}: kilitlenme kapısı ${r.blok.muaf} kez açıldı — blok bir yerde kalıcı kilit üretiyor`)
  // BEKÇİ SESSİZ KALMALI: sağlıklı yerleşimde hiçbir araç sıkışmaz, dolayısıyla ne
  // yeniden rota ne kurtarma gerekir. Sıfırdan farkı, rotanın varılamayan bir hedefe
  // çıktığının kanıtıdır (tools/tests/bekci-check.mjs bunun tersini ölçüyor).
  kontrol(r.bekci.kurtarma === 0 && r.bekci.yenidenRota === 0,
    `${kod}: bekçi hiç gerekmedi (yeniden rota 0 · kurtarma 0)`,
    `${kod}: bekçi çalıştı — yeniden rota ${r.bekci.yenidenRota}, kurtarma ${r.bekci.kurtarma} ${JSON.stringify(r.bekci.kurtarmaFaz)}`)
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
// KONVEYÖR (derin kuyruk çiti): duran çiftte < 2.5 MUTLAK yasak; < 2.66 oranı ≤ %1
// (KONVEYÖRSÜZ ölçüm: min 0.00 — tam üst üste — ve 874/19389 = %4.5; tüm ihlaller
// hareket hâlindeki yanaşma anlarına indi, duran kuyrukta iç içelik kalmadı.)
kontrol(t8.kuyruk.sert === 0, `T8: DURAN kuyruk çiftinde < 2.5 yok (min ${t8.kuyruk.min.toFixed(2)})`,
  `T8: ${t8.kuyruk.sert} karede DURAN çift < 2.5 — konveyör kapısı delik`)
kontrol(t8.kuyruk.ihlal <= t8.kuyruk.cift * 0.01,
  `T8: kuyrukta < 2.66 oranı %${(100 * t8.kuyruk.ihlal / Math.max(1, t8.kuyruk.cift)).toFixed(2)} ≤ %1 (konveyörsüz %4.5)`,
  `T8: kuyrukta ${t8.kuyruk.ihlal}/${t8.kuyruk.cift} çift < 2.66 — iç içelik geri geldi`)
kontrol(t8.blok.muaf === 0, 'T8: 30 sn kilitlenme kapısı hiç gerekmedi (muaf 0)',
  `T8: kilitlenme kapısı ${t8.blok.muaf} kez açıldı`)
// ÇIKIŞ KONVEYÖRÜ (1 Eyl): giden omurgada DURAN leaving çifti < 2.5 MUTLAK yasak.
// KONVEYÖRSÜZ ölçüm (aynı tohum): çift min 0.29 — leaving araçlar omurgada birbirinin
// içinden akıyordu (canlı faz analizindeki leaving ailesinin lab kopyası). Ölçüm dolu
// kümede olmalı: boş kümeden geçen iddia YASAK.
kontrol(t8.cikis.cift >= 1000, `T8: çıkış ölçümü DOLU kümede (${t8.cikis.cift} çift-kare)`,
  `T8: çıkış omurgası hiç dolmadı (${t8.cikis.cift}) — boş kümeden geçen iddia YASAK`)
kontrol(t8.cikis.olay === 0, `T8: ÇIKIŞTA ≥2 sn süren duran çift < 2.5 YOK (anlık ${t8.cikis.sert} · tüm çiftlerde min ${isFinite(t8.cikis.min) ? t8.cikis.min.toFixed(2) : '—'}, konveyörsüz min 0.29)`,
  `T8: çıkışta ${t8.cikis.olay} kez ≥2 sn duran çift < 2.5 — çıkış konveyörü donmuş kuyruk üretiyor`)
kontrol((t8.blok.cikisMuaf ?? 0) === 0, 'T8: çıkış 30 sn kapısı hiç gerekmedi (cikisMuaf 0)',
  `T8: çıkış kilitlenme kapısı ${t8.blok.cikisMuaf} kez açıldı — blok çıkışta kalıcı kilit üretiyor`)
kontrol(t8.bekci.kurtarma === 0 && t8.bekci.yenidenRota === 0,
  'T8: baskı altında bile bekçi hiç gerekmedi (yeniden rota 0 · kurtarma 0)',
  `T8: bekçi çalıştı — yeniden rota ${t8.bekci.yenidenRota}, kurtarma ${t8.bekci.kurtarma}`)
// KAPI AĞZI (2 Eyl canlı yığılma olaylarının %60'ı): kapıdan çıkmış, şeride katılmamış
// leaving çiftleri. KAPSAMSIZ ölçüm (aynı tohum): 161/333 çift < 1.8, min 0.49 — yola
// katılım boşluğu öndekini 0.15'e düşürünce arkası üstüne biniyordu. Konveyör kapsamı
// kapı ağzını da alınca: 0. Ölçüm dolu kümede olmalı.
kontrol(t8.agiz.cift >= 100, `T8: kapı ağzı ölçümü DOLU kümede (${t8.agiz.cift} çift-kare)`,
  `T8: kapı ağzı hiç dolmadı (${t8.agiz.cift}) — boş kümeden geçen iddia YASAK`)
yolCiti('T8', t8, 5)
kontrol(t8.agiz.ihlal === 0, `T8: KAPI AĞZINDA < 1.8 çift YOK (min ${t8.agiz.min.toFixed(2)}, kapsamsız 161/333 · min 0.49)`,
  `T8: kapı ağzında ${t8.agiz.ihlal}/${t8.agiz.cift} çift < 1.8 (min ${t8.agiz.min.toFixed(2)}) — çıkış bacağında üst üste binme geri geldi`)

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
  // 6 pompa, otopark pompa sırasının HEMEN dibinde (oyundaki varsayılan yerleşimin dar
  // hâli — canlı varsayılan taşımasıyla aynı geometri: yataklar pompa bandının ALTINDA,
  // koridor arka cepheden). 2-yatak ızgarasında (0.4,−0.2) konumu batı yatağı pompa
  // zarfının içine sokuyordu (ölçüldü: tek şerit, canlıdaki 0-park kırmızısının kopyası) —
  // lot, yatakların İKİSİ de meşru olacak şekilde sıranın dibine (0.4,−8.5) alındı.
  // NOKTA HAVUZU (1 Eyl): oyundaki world.getParkingSpots() artık parkHavuzuAyikla'dan
  // geçer — test yerleşimi de aynı süzgeçten geçmeli (lab, oyunun kopyası).
  const t9 = run('T9 otopark · 6 pompa · trafik ×1.6', {
    pumps: 6, evs: 2, far: false, wide: true, entryMul: 1.2, pullMul: 1.6,
    parking: parkHavuzuAyikla(parkLot(THREE, 'parking', 0.4, -8.5)), parkChance: 0.75,
  })
  kontrol(t9.stuck === 0, 'T9: kalıcı sıkışan 0 (park kuyruğu kilitlenmedi)', `T9: kalıcı sıkışan ${t9.stuck}`)
  kontrol(t9.st.total === 0, 'T9: buharlaşma 0', `T9: buharlaşma ${t9.st.total}`)
  // İKİ YATAK DA GERÇEKTEN İŞLİYOR (1 Eyl kırmızısının çiti): kümülatif ≥ 20 VE aynı
  // anda ≥ 2 park etmiş araç görülmüş olmalı — tek yatak sağ kalsa kümülatif yine dolar,
  // zirve 2'ye ÇIKAMAZ; bu çift, "yatak feda edildi" gerilemesini tek başına yakalar.
  kontrol(t9.park.varis >= 20, `T9: ${t9.park.varis} araç park etti (taban 20)`,
    `T9: park eden ${t9.park.varis} < 20 — yataklar ölü ya da atama kilitli`)
  kontrol(t9.park.zirve >= 2, `T9: aynı anda ${t9.park.zirve} araç parktaydı (iki yatak da canlı)`,
    `T9: aynı anda en çok ${t9.park.zirve} — ikinci yatak hiç kullanılamadı`)
  kontrol(t9.park.disari === 0, 'T9: park eden her araç KENDİ çizgili yerinde (slot dışı 0)',
    `T9: ${t9.park.disari}/${t9.park.disariOrnek} örnekte araç slotunun dışında durdu`)
  kontrol(t9.park.agir <= 0.3, `T9: otoparkta iç içe ${t9.park.agir.toFixed(2)} ≤ 0.3 (eski mimari 2.06)`,
    `T9: otoparkta iç içe ${t9.park.agir.toFixed(2)} > 0.3 — park kolları ayrık değil`)
  // CANLI parked+parked KÜMESİNİN ÇİTİ: park fazında DURAN çift < 2.15 hiçbir karede yok
  // (canlı telemetri iç içe eşiği; duran çift 2 sn şartını her zaman doldurur → olay).
  kontrol(t9.park.olay === 0,
    `T9: park fazında ≥2 sn süren DURAN çift < 2.15 YOK (anlık ${t9.park.duranIcice} · min ${isFinite(t9.park.duranMin) ? t9.park.duranMin.toFixed(2) : '—'})`,
    `T9: ${t9.park.olay} kez ≥2 sn park çifti < 2.15 — canlı küme lab'da duruyor`)
  // Bekçi dalında bu çit "kurtarma > 0" idi (park kolu geometri L'siyle bulunamayınca hayalet
  // çıkış devreye giriyordu). Şerit ağı + A* yedeği (64af362) birleşince ölçüm 0'a düştü:
  // park koridoruna A* rota buluyor, bekçinin işi kalmıyor. Ölçüm: rota 0 · kurtarma 0.
  kontrol(t9.bekci.kurtarma === 0 && t9.bekci.yenidenRota === 0,
    'T9: otoparkta bekçi hiç gerekmedi (A* park koridorunu buluyor · kurtarma 0)',
    `T9: bekçi devrede — yeniden rota ${t9.bekci.yenidenRota} · kurtarma ${t9.bekci.kurtarma} (A* park kolunu bulamıyor)`)
  // KORİDOR KİLİTLENMESİ (2 Eyl, canlı #5815 d=0.00): iki yatağın aracı aynı anda park
  // koridoruna çıkıp aynı noktada kolona kadar üst üste giderdi — konveyör kapsamı (d)
  // koridor/kol aracını kavşak kuralına aldı. Ölçüm: koridor kapsamı olmadan seed 3 min 0.00.
  yolCiti('T9', t9, 5)
  kontrol(t9.koridor.agir === 0,
    `T9: park koridorunda aynı yönlü çift < 1.0 YOK (${t9.koridor.cift} çift-karede min ${isFinite(t9.koridor.min) ? t9.koridor.min.toFixed(2) : '—'}, kapsamsız min 0.00)`,
    `T9: koridorda ${t9.koridor.agir} kare < 1.0 (min ${t9.koridor.min.toFixed(2)}) — koridor kilitlenmesi geri geldi`)
}

// ---- T11: BİTİŞİK OTOPARKLAR (canlı parked+parked kümesinin laboratuvar kopyası) ----
// Canlı faz analizi (400 olay, <2.15 çift dağılımı): kuyruk fixlerinden SONRA kalan en
// büyük kütle parked+parked (240) + toPark+toPark (124). Kütlenin gövdesi 1,25 aralıklı
// ESKİ ızgaraydı — o kaynak 2x2,5 ızgarasıyla (görsel dürüstlük) kökten kalktı: meşru
// yerleşimde (footprint 5,2 → merkezler ≥5,2) komşu lot uçları 2,7 ≥ eşik. Havuz elemesi
// artık MEŞRU yerleşimin değil, LEGACY/BOZUK yerleşimin sigortası: üst üste binmiş lot
// (eski onarım artığı, bozuk kayıt) noktaları hâlâ <2,4'e sokabilir — kanıt koşusu
// aşağıda tam bunu sürüyor (merkezler 2,6: ham min 0,1 → eleme sonrası ≥ eşik).
console.log('--- T11: BİTİŞİK OTOPARKLAR (2 lot yan yana, yoğun tesis trafiği) ---')
{
  // Lotlar kuzey bandında (cy 8.2): pompa zarflarından uzak — 4 yatağın 4'ü de meşru,
  // "aynı anda ≥2" ölçümü dolu kümede yapılır (pompa dibi baskısının laboratuvarı T9'da).
  const bitisik = [...parkLot(THREE, 'parking', -2.4, 8.2), ...parkLot(THREE, 'parking#1', 2.8, 8.2)]
  // 1) HAVUZ TEKLİĞİ: elemeden geçen havuzda hiçbir çift PARK_NOKTA_AYRIK'tan yakın değil
  const havuz = parkHavuzuAyikla(bitisik)
  let enYakin = Infinity
  for (let a = 0; a < havuz.length; a++) for (let b = a + 1; b < havuz.length; b++) {
    const d = Math.hypot(havuz[a].pos.x - havuz[b].pos.x, havuz[a].pos.y - havuz[b].pos.y)
    if (d < enYakin) enYakin = d
  }
  kontrol(havuz.length > 0 && enYakin >= PARK_NOKTA_AYRIK,
    `T11: nokta havuzu TEKLİK — ${bitisik.length} noktadan ${havuz.length} kaldı, en yakın çift ${enYakin.toFixed(2)} ≥ ${PARK_NOKTA_AYRIK}`,
    `T11: havuzda ${enYakin.toFixed(2)} < ${PARK_NOKTA_AYRIK} çift var — eleme delik`)
  const ayar = { pumps: 6, evs: 2, far: false, wide: true, entryMul: 1.8, pullMul: 2.2, parkChance: 0.9 }
  const t11 = run('T11 bitişik 2 otopark · trafik ×2.2', { ...ayar, parking: havuz })
  kontrol(t11.stuck === 0, 'T11: kalıcı sıkışan 0', `T11: kalıcı sıkışan ${t11.stuck}`)
  kontrol(t11.st.total === 0, 'T11: buharlaşma 0', `T11: buharlaşma ${t11.st.total}`)
  kontrol(t11.park.varis >= 30, `T11: ${t11.park.varis} araç park etti (ölçüm dolu kümede)`,
    `T11: park eden ${t11.park.varis} < 30 — küme boş, iddia geçersiz`)
  kontrol(t11.park.zirve >= 2, `T11: aynı anda ${t11.park.zirve} araç parktaydı (bitişik lotlar birlikte işliyor)`,
    `T11: aynı anda en çok ${t11.park.zirve} — lotlar sırayla bile dolmuyor`)
  kontrol(t11.park.disari === 0, 'T11: slot dışında park 0', `T11: ${t11.park.disari} örnekte slot dışı`)
  kontrol(t11.park.olay === 0,
    `T11: park fazında ≥2 sn süren DURAN çift < 2.15 YOK (anlık ${t11.park.duranIcice} · min ${isFinite(t11.park.duranMin) ? t11.park.duranMin.toFixed(2) : '—'})`,
    `T11: ${t11.park.olay} kez ≥2 sn park çifti < 2.15 — canlı parked+parked kümesi lab'da duruyor`)
  kontrol((t11.blok.cikisMuaf ?? 0) === 0 && t11.blok.muaf === 0,
    'T11: 30 sn kapıları hiç gerekmedi (muaf 0 · cikisMuaf 0)',
    `T11: muaf ${t11.blok.muaf} · çıkış muaf ${t11.blok.cikisMuaf}`)
  kontrol(t11.cikis.olay === 0,
    `T11: çıkışta ≥2 sn süren duran çift < 2.5 YOK (${t11.cikis.cift} çift-karede anlık ${t11.cikis.sert} · min ${isFinite(t11.cikis.min) ? t11.cikis.min.toFixed(2) : '—'})`,
    `T11: çıkışta ${t11.cikis.olay} kez ≥2 sn duran çift < 2.5`)
  // Bitişik lotlarda koridora giriş anı: arkadaki koridor aracının 1.0 önüne çıkan lot
  // aracı geçici birleşme (arkadaki durur, açılır). Kapsamsız ölçüm 32 kare; kapsamlı 1–2.
  yolCiti('T11', t11, 5)
  kontrol(t11.koridor.agir <= 5,
    `T11: koridorda aynı yönlü çift < 1.0 en çok geçici (${t11.koridor.agir} kare / ${t11.koridor.cift}, min ${isFinite(t11.koridor.min) ? t11.koridor.min.toFixed(2) : '—'}; kapsamsız 32 kare)`,
    `T11: koridorda ${t11.koridor.agir} kare < 1.0 (min ${t11.koridor.min.toFixed(2)}) — koridor birleşmesi kilitleniyor`)
  // 2) KANIT KOŞUSU (elemesiz + LEGACY üst üste lot, sessiz): eleme fix'i olmadan hazard
  // GERÇEKTEN üretiliyor — boş/etkisiz senaryodan geçen iddia yasak. Meşru bitişik lotlar
  // yeni ızgarada zaten temiz (uçlar 2,7); hazard, üst üste binmiş legacy çifti (merkezler
  // 2,6 → çapraz uçlar 0,1) + eleme KAPALI ile sürülür. Eleme AÇIK aynı bozuk yerleşimi
  // teklik havuzuna indirger (t11c) — sigorta işliyor.
  // legacy çift KULLANILABİLİR bölgede olmalı (pompa zarfına gömülü yatak zaten şerit
  // alamaz ve hazard üretemez) — kuzeyde, çapraz uçlar 0,1 birim: ham koşuda iki araç
  // neredeyse aynı noktaya park eder.
  const legacy = [...parkLot(THREE, 'parking', -1.3, 8.5), ...parkLot(THREE, 'parking#1', 1.3, 8.5)]
  const ham = run('T11-ham', { ...ayar, parking: legacy, quiet: true })
  kontrol(ham.park.olay > 10,
    `T11: eleme OLMADAN legacy üst üste lotlar ${ham.park.olay} kez ≥2 sn'lik duran çift olayı üretiyor (anlık ${ham.park.duranIcice}, min ${ham.park.duranMin.toFixed(2)}) — ölçüm hazardı görüyor`,
    `T11: elemesiz koşu bile temiz (olay ${ham.park.olay}) — senaryo hazardı üretmiyor, çit anlamsız`)
  const t11c = run('T11-legacy-elemeli', { ...ayar, parking: parkHavuzuAyikla(legacy), quiet: true })
  kontrol(t11c.park.olay === 0 && t11c.park.varis > 0,
    `T11: aynı bozuk yerleşim ELEMEYLE temiz (olay 0 · park eden ${t11c.park.varis}) — sigorta işliyor`,
    `T11: elemeli legacy koşuda olay ${t11c.park.olay} / park eden ${t11c.park.varis}`)
  // 3) DETERMİNİZM: aynı tohum, aynı senaryo → aynı sayaçlar (trafik-load tohumu)
  const t11b = run('T11-tekrar', { ...ayar, parking: havuz, quiet: true })
  kontrol(t11.served === t11b.served && t11.park.varis === t11b.park.varis
    && t11.park.duranIcice === t11b.park.duranIcice && t11.cikis.cift === t11b.cikis.cift,
    `T11: determinizm — iki koşu birebir aynı (servis ${t11.served} · park ${t11.park.varis} · çıkış çift ${t11.cikis.cift})`,
    `T11: koşular ayrıştı (servis ${t11.served}/${t11b.served} · park ${t11.park.varis}/${t11b.park.varis})`)
}

// ---- T10: TEK POMPA YOĞUN (canlı telemetrideki 22x kümenin laboratuvar kopyası) ----
// Gün-1 istasyonu: 1 pompa, şarj yok, yoğun giriş. 19 saatlik canlı olay kaydında en
// büyük iç içe kümesi (22x) tam bu profildeydi: kuyruk başında araçlar burun buruna
// (replay #2647: 4 bekleyen + 1 serviste). Konveyör kuralının asıl sınavı burası:
// kuyruk sürekli dolu, terfi zinciri her serviste baştan sona işliyor.
console.log('--- T10: TEK POMPA YOĞUN (gün-1 istasyonu, telemetri kümesinin kopyası) ---')
{
  const t10 = run('T10 tek pompa · trafik ×2.2 · yoğun saat ×1.8',
    { pumps: 1, evs: 0, far: false, wide: false, entryMul: 1.8, pullMul: 2.2 })
  kontrol(t10.kuyruk.cift >= 1000 && t10.kuyruk.zirve >= 5,
    `T10: ölçüm DOLU kümede (${t10.kuyruk.cift} çift-kare · kuyruk zirvesi ${t10.kuyruk.zirve} araç)`,
    `T10: kuyruk hiç dolmadı (${t10.kuyruk.cift} çift-kare, zirve ${t10.kuyruk.zirve}) — boş kümeden geçen iddia YASAK`)
  // KONVEYÖRSÜZ AYNI SENARYO (ölçüldü): çift min 0.03 (tam üst üste) · < 2.66 oranı
  // 931/37111 = %2.5. Konveyörle: DURAN çiftte < 2.5 MUTLAK sıfır; < 2.66 kalıntısı
  // yalnız slota yanaşma ANLARINDA (hareket hâlinde, ölçülen min ~1.4, tipik 2.2-2.5)
  // ve oran ≥ 6 kat düşük. "Görsel iç içelik" duran kuyruğun kusuruydu — bitti.
  kontrol(t10.kuyruk.sert === 0,
    `T10: DURAN kuyruk çiftinde < 2.5 HİÇBİR karede yok (tüm çiftlerde min ${isFinite(t10.kuyruk.min) ? t10.kuyruk.min.toFixed(2) : '—'}, konveyörsüz 0.03)`,
    `T10: ${t10.kuyruk.sert} karede DURAN çift < 2.5 (min ${t10.kuyruk.min.toFixed(2)}) — 22x küme lab kopyasında hâlâ iç içe`)
  yolCiti('T10', t10, 5)
  kontrol(t10.agiz.ihlal === 0, `T10: kapı ağzında < 1.8 çift YOK (${t10.agiz.cift} çift-kare, kapsamsız 81/146)`,
    `T10: kapı ağzında ${t10.agiz.ihlal}/${t10.agiz.cift} çift < 1.8 — çıkış bacağında üst üste binme`)
  kontrol(t10.kuyruk.ihlal <= t10.kuyruk.cift * 0.01,
    `T10: kuyrukta < 2.66 oranı %${(100 * t10.kuyruk.ihlal / Math.max(1, t10.kuyruk.cift)).toFixed(2)} ≤ %1 (konveyörsüz %2.5)`,
    `T10: kuyrukta ${t10.kuyruk.ihlal}/${t10.kuyruk.cift} çift < 2.66 — görsel iç içelik sürüyor`)
  kontrol(t10.stuck === 0, 'T10: kalıcı sıkışan 0', `T10: kalıcı sıkışan ${t10.stuck}`)
  kontrol(t10.st.total === 0, 'T10: buharlaşma 0', `T10: buharlaşma ${t10.st.total}`)
  kontrol(t10.blok.muaf === 0, 'T10: 30 sn kilitlenme kapısı hiç gerekmedi (muaf 0)',
    `T10: kilitlenme kapısı ${t10.blok.muaf} kez açıldı`)
  kontrol(t10.icAkis <= 0.3, `T10: iç içe (AKIŞ) ${t10.icAkis.toFixed(2)} ≤ 0.3`,
    `T10: iç içe (AKIŞ) ${t10.icAkis.toFixed(2)} > 0.3`)
  kontrol(t10.bekci.kurtarma === 0 && t10.bekci.yenidenRota === 0,
    'T10: sürekli dolu kuyrukta bile bekçi hiç gerekmedi (yeniden rota 0 · kurtarma 0)',
    `T10: bekçi çalıştı — yeniden rota ${t10.bekci.yenidenRota}, kurtarma ${t10.bekci.kurtarma}`)
  kontrol(t10.turnedAway > 0, `T10: ${t10.turnedAway} müşteri kapasiteden giremedi (tek pompa, doğal)`,
    'T10: tek pompa yoğun saatte hiç kapasite baskısı üretmedi — senaryo yanlış kurulmuş')
}

const sum = a => a.reduce((x, y) => x + y, 0)
const servOn = sum(on.map(([, r]) => r.served))
console.log(`\nTOPLAM servis ${servOn} (eski mimari ${TABAN.T1 + TABAN.T2 + TABAN.T3})`)
console.log(fail === 0 ? '\n✓ YÜK TESTİ GEÇTİ (şerit ağı, deterministik)' : `\n✗ ${fail} kriter başarısız`)
if (process.env.YOLSTATS) { const { yolStats } = await import('../../src/yol-bul.ts'); console.log('YOLSTATS', JSON.stringify(yolStats), 'ROTA', JSON.stringify(Car.rotaCacheStats)) }
process.exit(fail ? 1 : 0)
