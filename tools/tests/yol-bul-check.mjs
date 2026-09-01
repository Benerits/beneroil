// ════════ YOL BULUCU DENETİMİ (src/yol-bul.ts) + DÖNDÜRÜLMÜŞ POMPA ENTEGRASYONU ════════
//
// NEDEN: eski rota temizliği sezgiseldi ve çözemediğinde SESSİZCE kirli rota dönüyordu.
// Araç o bacağa girince Car.insideSolid duvarına toslayıp orada kalıyordu. Canlı
// telemetride en büyük kusur sınıfı buydu (olay #4403, kasaba: ~20 `leaving` araç aynı
// noktada yığılmış — 180° döndürülmüş pompaların yuvası çıkış omurgasının TERS yanında).
//
// Bu dosya iki kademe denetler:
//   1) BİRİM: yol bulucunun kendisi — duvar dolanma, U tuzağı, hedef gövdenin içinde
//      (kaydırma), ulaşılamaz (null), HER BACAK şişirilmiş engelden temiz, ip germe
//      kısa çıktı üretiyor, determinizm.
//   2) ENTEGRASYON: gerçek CarManager, pompa gövdesi YUVA ile ÇIKIŞ OMURGASI ARASINDA.
//      3 dakika simülasyon: kalıcı sıkışan yok, aynı noktada çakılan yok, servis edilen
//      HER araç haritadan çıkıyor, rotaKopukSayac = 0.

const { segmentDikdortgeniKesiyor, noktaKutuda, yolBul, erisilebilir, engelleriAyarla,
        onbellegiBosalt, yolStats } = await import('../../src/yol-bul.ts')

let fail = 0
const kontrol = (ok, iyi, kotu) => { if (ok) console.log(`✓ ${iyi}`); else { console.log(`✗ ${kotu}`); fail++ } }

/** cars.ts ile AYNI ölçüt: bir bacak şişirilmiş dikdörtgeni kesiyor mu.
 *  (Fonksiyon yol-bul.ts'ten geliyor — cars.ts de aynı kopyayı kullanıyor, iki ölçüt
 *   birbirinden ayrılamaz.) */
function bacaklariDenetle(from, yol, pad, solids, sonBacagiAtla = false, ilkBacagiAtla = false) {
  const noktalar = [from, ...yol]
  const kirli = []
  const bit = sonBacagiAtla ? noktalar.length - 1 : noktalar.length
  for (let i = ilkBacagiAtla ? 2 : 1; i < bit; i++) {
    const a = noktalar[i - 1], b = noktalar[i]
    for (const r of solids) {
      if (segmentDikdortgeniKesiyor(a.x, a.y, b.x, b.y, r, pad)) {
        kirli.push(`(${a.x.toFixed(2)},${a.y.toFixed(2)})→(${b.x.toFixed(2)},${b.y.toFixed(2)}) ∩ [${r.cx},${r.cy}]`)
      }
    }
  }
  return kirli
}

let surum = 0
const kur = solids => { engelleriAyarla(solids, ++surum) }

console.log('--- BİRİM: YOL BULUCU ---')

// ── 1) BASİT DUVAR DOLANMA ──
{
  const solids = [{ cx: 0, cy: 0, w: 1, d: 10 }]
  kur(solids)
  const from = { x: -5, y: 0 }, to = { x: 5, y: 0 }, pad = 1.0
  const yol = yolBul(from, to, pad)
  kontrol(!!yol && yol.length > 0, `duvar dolanma: rota bulundu (${yol ? yol.length : 0} nokta)`,
    'duvar dolanma: rota BULUNAMADI')
  if (yol) {
    kontrol(Math.abs(yol[yol.length - 1].x - to.x) < 1e-9 && Math.abs(yol[yol.length - 1].y - to.y) < 1e-9,
      'duvar dolanma: son nokta gerçek hedef', 'duvar dolanma: son nokta hedef DEĞİL')
    const kirli = bacaklariDenetle(from, yol, pad, solids)
    kontrol(kirli.length === 0, 'duvar dolanma: hiçbir bacak engeli kesmiyor',
      `duvar dolanma: ${kirli.length} kirli bacak → ${kirli[0]}`)
    // İP GERME: merdiven basamağı değil kırık çizgi çıkmalı (A* ham çıktısı ~30 nokta olurdu)
    kontrol(yol.length <= 8, `ip germe: ${yol.length} nokta ≤ 8 (ham A* ~25+ olurdu)`,
      `ip germe ÇALIŞMIYOR: ${yol.length} nokta`)
    kontrol(Math.max(...yol.map(p => Math.abs(p.y))) > 5,
      'duvar dolanma: rota gerçekten duvarın UCUNDAN dolaşmış',
      'duvar dolanma: rota duvarı aşmamış (ölçüm boş)')
  }
  kontrol(erisilebilir(from, to, pad) === true, 'erisilebilir(): açık hedef için true',
    'erisilebilir(): açık hedefe false dedi')
}

// ── 2) U TUZAĞI (hedef güneye açık bir U'nun içinde) ──
{
  const solids = [
    { cx: 0, cy: 5, w: 12, d: 1 },     // kuzey kapak
    { cx: -5.5, cy: 0, w: 1, d: 11 },  // batı duvar
    { cx: 5.5, cy: 0, w: 1, d: 11 },   // doğu duvar
  ]
  kur(solids)
  const from = { x: 0, y: 12 }, to = { x: 0, y: 0 }, pad = 1.0
  const yol = yolBul(from, to, pad)
  kontrol(!!yol, `U tuzağı: rota bulundu (${yol ? yol.length : 0} nokta)`, 'U tuzağı: rota BULUNAMADI')
  if (yol) {
    const kirli = bacaklariDenetle(from, yol, pad, solids)
    kontrol(kirli.length === 0, 'U tuzağı: hiçbir bacak engeli kesmiyor',
      `U tuzağı: ${kirli.length} kirli bacak → ${kirli[0]}`)
    kontrol(Math.min(...yol.map(p => p.y)) < -5.5,
      'U tuzağı: rota GÜNEY ağzından dolaşmış (kestirme yok)',
      'U tuzağı: rota güney ağzına inmemiş — U anlaşılmamış')
  }
}

// ── 3) HEDEF GÖVDENİN İÇİNDE → EN YAKIN SERBEST HÜCREYE KAYDIRMA ──
// Bu tam olarak pompa yuvası vakasıdır: yuva kendi gövdesinin çarpışma zarfında kalabilir.
{
  // Gövde 1.5×1.5: pad 1.0 ile zarf ±1.75, ızgara payıyla ±2.02 — kaydırma yarıçapı
  // (2.5) içinde serbest hücre VAR. Oyundaki pompa yuvası da bu ölçekte kalır: gövde
  // 1.5 geniş, yuva merkezden 1.8 birim ötede → kaydırma ~0.7 birim. Gövde büyürse
  // kaydırma yetmez ve dürüstçe null döner (4b).
  const solids = [{ cx: 0, cy: 0, w: 1.5, d: 1.5 }]
  kur(solids)
  const from = { x: -8, y: 0 }, to = { x: 0, y: 0 }, pad = 1.0
  const yol = yolBul(from, to, pad)
  kontrol(!!yol, 'hedef gövdede: rota bulundu', 'hedef gövdede: rota BULUNAMADI (null döndü)')
  if (yol) {
    const son = yol[yol.length - 1]
    kontrol(Math.abs(son.x - to.x) < 1e-9 && Math.abs(son.y - to.y) < 1e-9,
      'hedef gövdede: GERÇEK hedef son nokta olarak korunuyor',
      'hedef gövdede: hedef değiştirilmiş — onArrive yanlış yerde tetiklenirdi')
    const onceki = yol.length >= 2 ? yol[yol.length - 2] : from
    kontrol(!noktaKutuda(onceki.x, onceki.y, solids[0], pad),
      'hedef gövdede: son bacaktan önceki nokta gövdenin DIŞINDA (kaydırma çalıştı)',
      'hedef gövdede: kaydırma yapılmamış')
    // SON bacak (kaydırılmış hücre → gerçek hedef) kaçınılmaz olarak gövdeye girer;
    // ondan ÖNCEKİ tüm bacaklar temiz olmalı.
    const kirli = bacaklariDenetle(from, yol, pad, solids, true)
    kontrol(kirli.length === 0, 'hedef gövdede: son bacak hariç tüm bacaklar temiz',
      `hedef gövdede: ${kirli.length} kirli bacak → ${kirli[0]}`)
  }
}

// ── 4) ULAŞILAMAZ → null (sessiz "en iyi çaba" YOK) ──
{
  const solids = [
    { cx: 0, cy: 6, w: 14, d: 2 }, { cx: 0, cy: -6, w: 14, d: 2 },
    { cx: -6, cy: 0, w: 2, d: 14 }, { cx: 6, cy: 0, w: 2, d: 14 },
  ]
  kur(solids)
  const yol = yolBul({ x: 20, y: 0 }, { x: 0, y: 0 }, 1.0)
  kontrol(yol === null, 'kapalı oda: null döndü (ulaşılamaz DÜRÜSTÇE bildiriliyor)',
    `kapalı oda: null yerine ${yol ? yol.length + ' noktalı rota' : '?'} döndü — duvardan geçiyor`)
  kontrol(erisilebilir({ x: 20, y: 0 }, { x: 0, y: 0 }, 1.0) === false,
    'erisilebilir(): kapalı oda için false', 'erisilebilir(): kapalı odaya true dedi')
}

// ── 4b) HEDEF DEV GÖVDENİN GÖBEĞİNDE (2.5 birimde serbest hücre yok) → null ──
{
  kur([{ cx: 0, cy: 0, w: 20, d: 20 }])
  const yol = yolBul({ x: 20, y: 0 }, { x: 0, y: 0 }, 1.0)
  kontrol(yol === null, 'gövde göbeği: null (kaydırma yarıçapı aşıldı)',
    'gövde göbeği: rota uydurdu — kaydırma sınırsız çalışıyor')
}

// ── 5) DETERMİNİZM: aynı girdi, boşaltılmış önbellek → BİREBİR aynı çıktı ──
{
  const solids = [
    { cx: 0, cy: 5, w: 12, d: 1 }, { cx: -5.5, cy: 0, w: 1, d: 11 }, { cx: 5.5, cy: 0, w: 1, d: 11 },
    { cx: -12, cy: -8, w: 4, d: 4 }, { cx: 9, cy: -3, w: 2, d: 9 },
  ]
  kur(solids)
  const a = yolBul({ x: -20, y: 14 }, { x: 0, y: 0 }, 1.0)
  onbellegiBosalt()
  const b = yolBul({ x: -20, y: 14 }, { x: 0, y: 0 }, 1.0)
  kontrol(!!a && !!b && JSON.stringify(a) === JSON.stringify(b),
    `determinizm: iki koşu birebir aynı (${a ? a.length : 0} nokta)`,
    'determinizm: aynı girdi FARKLI rota verdi')
}

// ── 6) YOĞUN YERLEŞİM TARAMASI: rastgele 200 sorgu, HİÇBİR bacak kesmesin ──
// "Boş kümeden geçen iddia" olmasın diye: kaç sorgunun gerçekten rota bulduğu raporlanır
// ve en az yarısının rota bulmuş olması şart koşulur.
{
  const solids = []
  for (let i = 0; i < 8; i++) solids.push({ cx: -1, cy: -12 + i * 3.6, w: 1.5, d: 3.4 })
  for (let i = 0; i < 4; i++) solids.push({ cx: 6.5, cy: -6 + i * 4, w: 0.9, d: 1.4 })
  solids.push({ cx: -8, cy: 4, w: 4.2, d: 4.6 })
  kur(solids)
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let bulundu = 0, kirliToplam = 0, sonKirli = ''
  const pad = 1.0
  for (let k = 0; k < 200; k++) {
    const from = { x: -16 + rnd() * 32, y: -20 + rnd() * 40 }
    const to = { x: -16 + rnd() * 32, y: -20 + rnd() * 40 }
    const yol = yolBul(from, to, pad)
    if (!yol) continue
    bulundu++
    // hedef gövdenin içindeyse son bacak kaçınılmaz — onu atla
    const hedefIcerde = solids.some(r => noktaKutuda(to.x, to.y, r, pad))
    const basIcerde = solids.some(r => noktaKutuda(from.x, from.y, r, pad))
    // Başlangıç/hedef gövdenin içindeyse İLK/SON bacak kaçınılmazdır (araç zaten
    // zarfın içinde duruyor) — eski rotayiTemizle da bu cisimleri elemişti.
    const kirli = bacaklariDenetle(from, yol, pad, solids, hedefIcerde, basIcerde)
    kirliToplam += kirli.length
    if (kirli.length && !sonKirli) sonKirli = kirli[0]
  }
  kontrol(bulundu >= 100, `tarama: 200 sorgunun ${bulundu}'ünde rota bulundu (ölçüm DOLU kümede)`,
    `tarama: yalnız ${bulundu}/200 rota — küme çok seyrek, iddia anlamsız`)
  kontrol(kirliToplam === 0, `tarama: ${bulundu} rotanın HİÇBİR bacağı engel kesmiyor`,
    `tarama: ${kirliToplam} kirli bacak → ${sonKirli}`)
}

console.log(`   (A* ölçümü: ${yolStats.arama} arama · ${yolStats.isabet} önbellek isabeti · ${yolStats.yok} "yol yok" · ${yolStats.dugum} düğüm)`)

// ═══════════════════════════════════════════════════════════════════════════
// ENTEGRASYON: DÖNDÜRÜLMÜŞ POMPA (gövde YUVA ile ÇIKIŞ OMURGASI ARASINDA)
// ═══════════════════════════════════════════════════════════════════════════
console.log('--- ENTEGRASYON: DÖNDÜRÜLMÜŞ POMPA (telemetri #4403 kopyası) ---')

// tarayıcı kalıntıları (traffic-load.mjs ile aynı shim'ler)
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
let __seed = 20260901
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd

const THREE = await import('three')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

{
  const POMPA = 4
  // YUVA KONUMU: gövde 1.5×3.4, merkezi x = −1 (görev tanımı). Yuva gövdenin BATISINDA.
  // Görevdeki −1.9 yerine −2.6 kullanılıyor ÇÜNKÜ: |−1.9 − (−1)| = 0.9 < 1.5/2 + 0.45
  // → yuva pompanın KENDİ çarpışma zarfının içinde kalır ve Car.insideSolid oraya
  // hareketi tamamen keser. O yerleşim hiçbir yol bulucuyla çözülemez (kusur rota
  // değil, yerleşimdir); testin ölçmek istediği şey ise "çıkış bacağı gövdeyi kesiyor"
  // kusuru. −2.6 gövdenin zarfının 0.4 birim dışında: fiziksel olarak ULAŞILABİLİR,
  // ama çıkış omurgasına (doğuda x≈2) giden DÜZ bacak gövdeyi tam ortasından keser.
  const YUVA_X = -2.6, GOVDE_X = -1
  const pumpSlots = Array.from({ length: POMPA }, (_, i) => new THREE.Vector3(YUVA_X, -6 + i * 4, 0))
  const govdeler = pumpSlots.map(s => ({ cx: GOVDE_X, cy: s.y, w: 1.5, d: 3.4 }))

  const scene = new THREE.Scene()
  const state = new GameState()
  state.pumps = POMPA; state.evChargers = 0; state.wideGates = true
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3

  let served = 0, girisAcik = true
  const servisEdilen = new Set()
  const mgr = new CarManager(scene, null, {
    pumpCount: () => POMPA, evCount: () => 0,
    pumpSlot: i => pumpSlots[Math.min(i, pumpSlots.length - 1)],
    evSlot: () => new THREE.Vector3(1.8, 6, 0),
    pumpAngle: () => Math.PI, evAngle: () => 0,   // 180° DÖNDÜRÜLMÜŞ (olayın kendisi)
    gateInY: () => -14, gateOutY: () => 14,
    entryChance: () => (girisAcik ? Math.min(1, state.entryChance() * 1.6) : 0),
    evShare: () => 0,
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => (girisAcik ? state.trafficPull() * 1.8 : 0),
    isPumpBroken: () => false, isChargerBroken: () => false,
    parkSpots: () => [], truckSpots: () => [], extraObstacles: () => [],
    wideGates: () => true,
    onCarReady: c => { served++; servisEdilen.add(c); c.phase = 'atPump' },
    onCarLost: () => {},
    farActive: () => false, farGateInY: () => 8, farGateOutY: () => -8,
    highway: () => null, serviceLane: () => null,
    onRampFull: () => {}, onTurnedAway: () => {},
  })
  Car.solids = govdeler
  Car.rotaKopukSayac = 0
  Car.reaktifKacis = 0

  // A* SAYACI AĞ KURULMADAN ÖNCE ALINIR: şerit ağı, L biçimli ünite kolu kapalıysa A*
  // yedeğine gider ve rotayı ağa PİŞİRİR (uniteKolu → yolBul). Sim boyunca araçlar
  // pişmiş kolu kullanır, yeniden arama gerekmez — "yol bulucu devrede" kanıtı burada.
  const aramaOnce = yolStats.arama
  mgr.update(0.1) // şerit ağı ilk update'te kurulur — omurga x'i ancak ondan sonra okunur
  // SENARYO GEÇERLİLİĞİ: yuvadan çıkış omurgasına giden DÜZ bacak gerçekten gövdeyi
  // kesiyor mu? Kesmiyorsa test hiçbir şey ölçmüyor demektir.
  const L = mgr.graph.get('near')
  const duzKesiyor = L && govdeler.some(r =>
    segmentDikdortgeniKesiyor(YUVA_X, pumpSlots[1].y, L.xOut, pumpSlots[1].y, r, 0.5))
  kontrol(!!duzKesiyor,
    `senaryo geçerli: yuva(${YUVA_X}) → çıkış omurgası(x=${L ? L.xOut.toFixed(2) : '?'}) düz bacağı pompa gövdesini KESİYOR`,
    `senaryo GEÇERSİZ: düz çıkış bacağı gövdeyi kesmiyor (xOut=${L ? L.xOut.toFixed(2) : '?'}) — kusur tetiklenmiyor`)

  // ── 3 DAKİKA SİMÜLASYON + 2 DAKİKA BOŞALTMA ──
  const busy = new Map()
  let enUzunCakili = 0, cakiliOrnek = 0, cakiliOlay = 0
  const izle = new Map() // araç → { x, y, t }
  const DT = 0.1
  const ADIM = 3 * 60 * 10        // 3 dakika: müşteri akışı
  const BOSALT = 2 * 60 * 10      // +2 dakika: yeni müşteri yok, kalanlar çıkısın
  for (let i = 0; i < ADIM + BOSALT; i++) {
    if (i === ADIM) girisAcik = false
    mgr.update(DT)
    for (const c of mgr.cars) if (c.phase === 'atPump' && !busy.has(c)) busy.set(c, i + 60)
    for (const [c, until] of [...busy]) {
      if (i < until) continue
      busy.delete(c)
      if (c.phase === 'atPump' || c.phase === 'parked') mgr.releaseCar(c)
    }
    // AYNI NOKTADA ÇAKILMA: leaving/driving fazındaki araç 0.3 birimlik bir kutunun
    // içinden 20 sn boyunca çıkamıyorsa "takıldı" demektir (telemetrideki yığın tam bu).
    for (const c of mgr.cars) {
      if (c.phase !== 'leaving' && c.phase !== 'driving') { izle.delete(c); continue }
      cakiliOrnek++
      const p = c.group.position
      const k = izle.get(c)
      if (!k || Math.hypot(p.x - k.x, p.y - k.y) > 0.3) { izle.set(c, { x: p.x, y: p.y, t: 0 }) }
      else {
        k.t += DT
        if (k.t > enUzunCakili) enUzunCakili = k.t
        if (k.t > 20) cakiliOlay++
      }
    }
  }

  const stuck = mgr.cars.filter(c => c.hardStuckT > 3)
  const kalan = [...servisEdilen].filter(c => mgr.cars.includes(c))

  kontrol(served > 0 && cakiliOrnek > 0,
    `ölçüm DOLU kümede: ${served} araç servis edildi · ${cakiliOrnek} araç-kare leaving/driving`,
    `ölçüm BOŞ kümede: servis ${served}, örnek ${cakiliOrnek} — senaryo hiç çalışmamış`)
  kontrol(stuck.length === 0, 'kalıcı sıkışan (hardStuckT > 3) = 0',
    `${stuck.length} araç kalıcı sıkıştı → ${stuck.slice(0, 3).map(c => `${c.phase}@(${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)})`).join(' | ')}`)
  kontrol(cakiliOlay === 0,
    `hiçbir araç 20 sn'den uzun aynı noktada çakılmadı (en uzun ${enUzunCakili.toFixed(1)} sn)`,
    `${cakiliOlay} araç-kare boyunca araç 20 sn+ aynı noktada çakılı kaldı (en uzun ${enUzunCakili.toFixed(1)} sn)`)
  kontrol(kalan.length === 0,
    `servis edilen ${served} aracın HEPSİ haritadan çıktı (|y| > 42.5)`,
    `${kalan.length}/${served} servis edilen araç hâlâ haritada → ${kalan.slice(0, 3).map(c => `${c.phase}@(${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)})`).join(' | ')}`)
  // ── ESKİ KODLA ÖLÇÜLMÜŞ TABAN (aynı tohum, aynı yerleşim; sezgisel rota temizliği) ──
  //   servis 39 · reaktif kaçış 556 · en uzun çakılma 2.2 sn
  // Eski kod aracı KALICI kilitlemiyordu ama çıkış bacağı gövdeyi kestiği için araçlar
  // 1.6 sn'de bir engelin dibinde "kaçış" manevrası yapıyor, avlu tıkanıyor ve hacim
  // yarıya iniyordu. Asıl kusurun sayısal karşılığı bu iki kalem:
  kontrol(Car.reaktifKacis <= 20,
    `reaktif kaçış ${Car.reaktifKacis} ≤ 20 (eski sezgisel kod: 556) — araçlar gövdenin dibinde çırpınmıyor`,
    `reaktif kaçış ${Car.reaktifKacis} — araçlar hâlâ engelin dibinde manevra deniyor (eski kod 556)`)
  kontrol(served >= 60,
    `servis ${served} ≥ 60 (eski sezgisel kod aynı yerleşimde 39) — çıkış hattı açıldı`,
    `servis ${served} < 60 — çıkış hattı tıkalı (eski sezgisel kod 39)`)
  kontrol(yolStats.arama > aramaOnce,
    `yol bulucu GERÇEKTEN devrede: ağ kurulumu + simülasyon boyunca ${yolStats.arama - aramaOnce} A* araması koştu`,
    'yol bulucu hiç çağrılmadı — test sezgisel rotayı ölçüyor, iddia boş')
  kontrol(Car.rotaKopukSayac === 0, 'Car.rotaKopukSayac = 0 (hiçbir araca kopuk rota verilmedi)',
    `Car.rotaKopukSayac = ${Car.rotaKopukSayac} — çözülemeyen rota üretiliyor`)
  console.log(`   (servis ${served} · reaktif kaçış ${Car.reaktifKacis} · A* arama ${yolStats.arama} · "yol yok" ${yolStats.yok})`)
  Car.solids = []
}

console.log(fail === 0 ? '\n✓ YOL BULUCU DENETİMİ GEÇTİ' : `\n✗ ${fail} kriter başarısız`)
process.exit(fail ? 1 : 0)
