/**
 * İLERLEME BEKÇİSİ TESTİ — "hiçbir araç kalıcı sıkışamaz" garantisinin kanıtı.
 *
 * NEDEN VAR: son çare katmanı (`evaporate`/`recoverStuck`) bilerek silinmişti çünkü
 * müşteriyi SESSİZCE yok ediyordu. Silindikten sonra `driving`/`toPark`/`leaving`
 * fazlarının hiçbir zaman aşımı kalmadı: varılamayan bir hedefe kilitlenen araç
 * sonsuza dek kalıyor ve tuttuğu kaynağı (kuyruk slotu, pompa yuvası, otopark yeri)
 * hiç bırakmıyordu. Canlı telemetri bunu ölçtü (14 saat / 2.781 olay).
 *
 * Bu test bekçinin İKİ yüzünü birden ölçer:
 *   POZİTİF (a,b): gerçekten sıkışan araç T1'de yeniden rotalanır, T2'de kurtarılır,
 *                  kaynağı serbest kalır, sahneden ÇIKAR ve kayıp GÖRÜNÜR olur.
 *   NEGATİF (c,d): sağlıklı trafikte bekçi HİÇ çalışmaz; konveyör kuralı gereği duran
 *                  araç, kural onu tuttuğu SÜRECE kurtarılmaz (duruş kusur değildir).
 *                  Bu muafiyet kalıcı boşluk DEĞİLDİR: konveyörün kendi kapısı 30 sn'de
 *                  (BLOK_KILIT_SN) açılır ve bekçi oradan devralır — (d) ikisini de ölçer.
 *
 * Koşum:  npx tsx tools/tests/bekci-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const noopCtx = new Proxy({}, { get: (_t, k) => (k === 'measureText' ? () => ({ width: 10 }) : () => undefined), set: () => true })
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => noopCtx }) }
// DETERMİNİST: seed'li PRNG (traffic-load.mjs ile aynı reçete) — senaryolar tekrarlanabilir
let __seed = 0
const __rnd = () => { __seed = (__seed * 1103515245 + 12345) & 0x7fffffff; return __seed / 0x7fffffff }
Math.random = __rnd
const THREE = await import('three')
const { CarManager, Car } = await import('../../src/cars.ts')
const { GameState, FUEL_PRICE } = await import('../../src/state.ts')

let fail = 0
const kontrol = (ok, iyi, kotu) => { if (ok) console.log(`✓ ${iyi}`); else { console.log(`✗ ${kotu}`); fail++ } }
const DT = 0.1

/** Ortak sahne: N pompa (x = 1.2 kolonunda), opsiyonel otopark. traffic-load.mjs'in
 *  kurulumunun sadeleştirilmiş hâli — aynı CarManager, aynı gerçek kod yolları. */
function sahne({ pumps = 1, evs = 0, park = [], entryMul = 1.6, pullMul = 1.8, wide = true } = {}) {
  __seed = 20260726
  const state = new GameState()
  state.pumps = pumps; state.evChargers = evs; state.wideGates = wide
  state.signLevel = 3; state.reputation = 5; state.marketLevel = 3
  const pumpSlots = Array.from({ length: pumps }, (_, i) =>
    new THREE.Vector3(1.2, -5 + i * (10 / Math.max(1, pumps)) + 5 / Math.max(1, pumps), 0))
  const evSlots = Array.from({ length: Math.max(1, evs) }, (_, i) => new THREE.Vector3(0.6, -4 + i * 3, 0))
  let girisKapali = false   // kapı: false = istasyona giriş açık
  const kayip = []          // onCarLost ile bildirilen araçlar (KİMLİK ile karşılaştırılır)
  const parkOlan = []       // 'parked' fazına gerçekten ulaşan araçlar
  let servis = 0
  const mgr = new CarManager(new THREE.Scene(), null, {
    pumpCount: () => pumps, evCount: () => evs,
    pumpSlot: i => pumpSlots[Math.min(i, pumpSlots.length - 1)],
    evSlot: i => evSlots[Math.min(i, evSlots.length - 1)],
    pumpAngle: () => 0, evAngle: () => 0,
    gateInY: () => -14, gateOutY: () => 14,
    entryChance: () => (girisKapali ? 0 : Math.min(1, state.entryChance() * entryMul)),
    evShare: () => (evs ? 0.35 : 0),
    prices: () => FUEL_PRICE, segments: () => state.activeSegments(),
    trafficPull: () => state.trafficPull() * pullMul,
    isPumpBroken: () => false, isChargerBroken: () => false,
    parkSpots: () => park, truckSpots: () => [], extraObstacles: () => [],
    wideGates: () => wide,
    onCarReady: c => { servis++; c.phase = 'atPump' },
    onCarLost: c => { kayip.push(c) },
    onTurnedAway: () => {},
  })
  const busy = new Map()
  let adimNo = 0
  /** n kare ilerlet (dt = 0.1 sn). servisEt=false ise pompadaki araç UĞURLANMAZ. */
  const sur = (n, { servisEt = true, herKare = null } = {}) => {
    for (let i = 0; i < n; i++) {
      mgr.update(DT)
      adimNo++
      for (const c of mgr.cars) {
        if (c.phase === 'parked' && !c.__p) { c.__p = 1; parkOlan.push(c) }
        if (servisEt && c.phase === 'atPump' && !busy.has(c)) busy.set(c, adimNo + 40)
      }
      if (servisEt) for (const [c, until] of [...busy]) {
        if (adimNo < until) continue
        busy.delete(c)
        if (c.phase === 'atPump' || c.phase === 'parked') mgr.releaseCar(c)
      }
      if (herKare) herKare(i)
    }
  }
  return { mgr, sur, kayip, parkOlan, pumpSlots, park, sayaclar: () => ({ servis }),
    /** İSTASYON KAPISI: kapatınca yeni müşteri girmez (kuyruk oluşmaz). Süre ölçen
     *  senaryolar bunu kullanır — kuyruk varsa konveyör kuralı sıkışan aracı MEŞRU
     *  olarak tutar ve bekçi bilerek donar (kapı 30 sn'de açılır, garanti kaybolmaz),
     *  ama o zaman ölçülen süre bekçinin değil konveyörün süresi olurdu. */
    kapi: (acik) => { girisKapali = !acik } }
}

/** Katı cisim listesini ATA (setter içerik karmasına bakıp şerit ağını tazeler) */
const katiCisim = (list) => { Car.solids = list.map(r => ({ ...r })) }

// ─────────────────────────────────────────────────────────────────────────────
// (a) POMPAYA GİDEN ARAÇ · hedef katı cismin İÇİNDE → T1 rota, T2 kurtarma
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== (a) Varılamayan pompa yuvası: T1 yeniden rota (≤6 sn) + T2 kurtarma (≤30 sn) ==')
{
  katiCisim([])
  // SEYREK TRAFİK: bu senaryo T1/T2 SÜRELERİNİ ölçüyor. Kalabalıkta konveyör kuralı
  // aracı meşru olarak tutabilir (o hâlde bekçi bilerek donar, kapı 30 sn'de açılır) —
  // süre iddiası bulanıklaşırdı. Konveyörün payı (d) senaryosunda AYRICA ölçülüyor.
  const S = sahne({ pumps: 1, entryMul: 0.5, pullMul: 0.8 })
  // pompaya sürmekte olan bir araç belirene kadar akıt
  let A = null
  for (let i = 0; i < 3000 && !A; i++) {
    S.sur(1)
    A = S.mgr.cars.find(c => c.phase === 'driving' && c.slotIndex === 0) ?? null
  }
  kontrol(!!A, `pompaya sürmekte olan araç bulundu (ölçüm boş kümede DEĞİL)`,
    'pompaya giden araç hiç oluşmadı — senaryo kurulamadı')
  if (!A) process.exit(1)

  // POMPA YUVASINI KAPAT: yuva noktası artık bir gövdenin içinde → araç oraya ASLA varamaz.
  // (Oyundaki karşılığı: oyuncu pompanın önüne bina taşır / yuva gövdenin zarfına düşer.)
  const yuva = S.pumpSlots[0]
  katiCisim([{ cx: yuva.x, cy: yuva.y, w: 1.2, d: 1.2 }])
  S.kapi(false)   // kuyruk oluşmasın: ölçülen süre BEKÇİNİN süresi olsun (bkz. kapi())
  // SAATLER "SON GERÇEK İLERLEME"DEN başlar, engelin konduğu andan DEĞİL: araç engel
  // konduğunda hedefinden 25 birim uzaktaydı ve yaklaşmaya devam etti. Bu yüzden
  // bağımsız bir ölçü tutuluyor: aracın yuvaya EN YAKIN mesafesi ne zaman iyileşti.
  const rota0 = S.mgr.kurtarmaStats.yenidenRota
  let enYakin = Infinity, t0 = 0, rotaAt = -1, kurtAt = -1, anlik = null
  S.sur(500, { herKare: (i) => {
    const t = (i + 1) * DT
    const d = Math.hypot(A.group.position.x - yuva.x, A.group.position.y - yuva.y)
    if (kurtAt < 0 && d < enYakin - 0.5) { enYakin = d; t0 = t }   // son gerçek ilerleme
    if (rotaAt < 0 && S.mgr.kurtarmaStats.yenidenRota > rota0) rotaAt = t
    if (kurtAt < 0 && S.mgr.kurtarmaStats.kurtarma > 0) {
      kurtAt = t
      // durum KURTARMA ANINDA fotoğraflanır: araç birkaç saniye sonra haritadan düşecek
      anlik = { faz: A.phase, hayalet: A.hayalet, slot: A.slotIndex, blokT: A.blokT }
    }
  } })
  const rotaSn = rotaAt - t0, kurtarmaSn = kurtAt - t0
  kontrol(enYakin > 0.9, `araç yuvaya en fazla ${enYakin.toFixed(2)} birim yaklaşabildi (gövdenin içine giremez)`,
    `araç hedefine vardı (${enYakin.toFixed(2)}) — senaryo "varılamayan hedef" kurmuyor`)
  kontrol(rotaAt > 0 && rotaSn > 0 && rotaSn <= 6.5, `T1: ilerleme durduktan ${rotaSn.toFixed(1)} sn sonra yeniden rotalandı (≤ 6 sn + 1 kare pay)`,
    `T1 çalışmadı ya da geç çalıştı (${rotaSn.toFixed(1)} sn) — sıkışan araç rota tazelemesi almıyor`)
  kontrol(kurtAt > 0 && kurtarmaSn > 0 && kurtarmaSn <= 30.5, `T2: ilerleme durduktan ${kurtarmaSn.toFixed(1)} sn sonra KURTARILDI (≤ 30 sn + 1 kare pay)`,
    `T2 çalışmadı (${kurtarmaSn.toFixed(1)} sn) — araç kalıcı sıkışmış olurdu`)
  kontrol(S.mgr.kurtarmaStats.kurtarma === 1 && S.mgr.kurtarmaStats.kurtarmaFaz.driving === 1,
    `kurtarma sayacı 1 ve fazı doğru (${JSON.stringify(S.mgr.kurtarmaStats.kurtarmaFaz)})`,
    `kurtarma sayacı beklenmedik: ${S.mgr.kurtarmaStats.kurtarma} ${JSON.stringify(S.mgr.kurtarmaStats.kurtarmaFaz)}`)
  kontrol(anlik?.faz === 'leaving' && anlik?.hayalet === true && anlik?.slot === -1,
    `kurtarma anında: faz ${anlik?.faz}, hayalet ${anlik?.hayalet}, pompa yuvası bırakıldı (${anlik?.slot})`,
    `kurtarılan araç doğru duruma gelmedi: ${JSON.stringify(anlik)}`)
  kontrol(anlik?.blokT === 0, 'kurtarma konveyör freni yüzünden DEĞİL (blokT 0) — süre iddiası temiz',
    `araç konveyör frenindeydi (blokT ${anlik?.blokT}) — bu senaryoda süre ölçümü bulanık`)
  kontrol(S.kayip.includes(A), 'servis EDİLMEMİŞ müşteri GÖRÜNÜR kayıp olarak bildirildi (onCarLost)',
    'kurtarılan müşteri sessizce yok oldu — onCarLost çağrılmadı')

  // YUVA GERÇEKTEN SERBEST Mİ: engeli kaldır, kapıyı aç, sıradaki müşteri aynı yuvaya girsin
  katiCisim([])
  S.kapi(true)
  const servisOnce = S.sayaclar().servis
  S.sur(1200)
  const sonra = S.sayaclar().servis
  kontrol(sonra > servisOnce, `bırakılan pompa yuvasını başka araçlar kullandı (servis ${servisOnce} → ${sonra})`,
    'pompa yuvası kurtarmadan sonra da kullanılamadı — kaynak bırakılmamış')
  // DESPAWN: kurtarılan araç sahneden |y| > 42.5'te düşer (transit/leaving kuralı)
  kontrol(!S.mgr.cars.includes(A) && Math.abs(A.group.position.y) > 42.5,
    `kurtarılan araç haritanın dışında düştü (|y| = ${Math.abs(A.group.position.y).toFixed(1)} > 42.5)`,
    `kurtarılan araç sahnede kaldı: sahnede=${S.mgr.cars.includes(A)} y=${A.group.position.y.toFixed(1)}`)
  // Sağlıklı akışta ikinci bir kurtarma OLMAMALI (engel kalktı)
  kontrol(S.mgr.kurtarmaStats.kurtarma === 1,
    'engel kalkınca yeni kurtarma olmadı (sayaç 1'.concat(')'),
    `engel kalktıktan sonra da kurtarma sürdü: ${S.mgr.kurtarmaStats.kurtarma}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// (b) OTOPARKA GİDEN ARAÇ · park yeri kutulandı → 45 sn kapağı yeri serbest bırakır
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== (b) Varılamayan otopark yeri: 45 sn kapağı + yerin yeniden kullanımı ==')
{
  katiCisim([])
  // TEK park yeri: "yer serbest kaldı" iddiası ancak aynı yerin yeniden kullanılmasıyla kanıtlanır
  const park = [{ id: 'parking:0', pos: new THREE.Vector3(-3.2, -2.0, 0), stage: new THREE.Vector3(-3.2, 0.4, 0), rot: -Math.PI / 2 }]
  const S = sahne({ pumps: 2, park })
  // pompada servis bekleyen bir araç bul ve otoparka yolla
  let B = null
  for (let i = 0; i < 3000 && !B; i++) {
    S.sur(1, { servisEt: false })
    const aday = S.mgr.cars.find(c => c.phase === 'atPump')
    if (aday && S.mgr.sendToParking(aday)) B = aday
  }
  kontrol(!!B && B.parkId === 'parking:0', `araç otoparka yollandı (parkId ${B?.parkId})`,
    'otoparka araç yollanamadı — senaryo kurulamadı')
  if (!B) process.exit(1)
  // PARK YERİNİ KUTULA: araç oraya asla varamaz (oyunda: oyuncu park yerinin dibine bina koyar)
  katiCisim([{ cx: park[0].pos.x, cy: park[0].pos.y, w: 1.6, d: 1.6 }])
  let kurtarmaSn = -1, anlik = null
  S.sur(600, { servisEt: false, herKare: (i) => {
    if (kurtarmaSn < 0 && S.mgr.kurtarmaStats.kurtarma > 0) {
      kurtarmaSn = (i + 1) * DT
      anlik = { parkId: B.parkId, faz: B.phase, hayalet: B.hayalet }
    }
  } })
  kontrol(kurtarmaSn > 0 && kurtarmaSn <= 45.5, `toPark aracı ${kurtarmaSn.toFixed(1)} sn'de kurtarıldı (kapak 45 sn)`,
    `toPark kapağı çalışmadı (${kurtarmaSn.toFixed(1)} sn) — park yeri sonsuza dek dolu kalırdı`)
  kontrol((S.mgr.kurtarmaStats.kurtarmaFaz.toPark ?? 0) >= 1,
    `kurtarma FAZ kırılımında toPark var (${JSON.stringify(S.mgr.kurtarmaStats.kurtarmaFaz)})`,
    'toPark kurtarması faz kırılımında sayılmadı')
  kontrol(anlik?.parkId === null && anlik?.faz === 'leaving' && anlik?.hayalet === true,
    'kurtarma anında park yeri kaydı bırakıldı (parkId null) ve araç çıkışa geçti',
    `park kaydı bırakılmadı: ${JSON.stringify(anlik)}`)
  // YER GERÇEKTEN SERBEST Mİ: engeli kaldır, başka bir müşteri AYNI yere park etsin
  katiCisim([])
  let C = null
  for (let i = 0; i < 3000 && !C; i++) {
    S.sur(1, { servisEt: false })
    const aday = S.mgr.cars.find(c => c.phase === 'atPump' && c !== B)
    if (aday && S.mgr.sendToParking(aday)) C = aday
  }
  kontrol(!!C && C.parkId === 'parking:0', 'boşalan park yerini SIRADAKİ müşteri aldı',
    'park yeri boşalmış görünüyor ama yeniden kullanılamadı')
  S.sur(600, { servisEt: false })
  kontrol(S.parkOlan.includes(C), 'sıradaki müşteri o yere GERÇEKTEN park etti (faz parked)',
    `sıradaki müşteri park edemedi (faz ${C?.phase})`)
}

// ─────────────────────────────────────────────────────────────────────────────
// (c) NEGATİF: sağlıklı trafikte bekçi HİÇ çalışmaz
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== (c) NEGATİF: sağlıklı yükte kurtarma 0 ve yeniden rota 0 ==')
{
  katiCisim([])
  const S = sahne({ pumps: 6, evs: 2, entryMul: 1.4, pullMul: 1.6 })
  S.sur(6000) // 10 dakika oyun zamanı
  const { servis } = S.sayaclar()
  const k = S.mgr.kurtarmaStats
  kontrol(servis >= 100, `ölçüm DOLU kümede: ${servis} servis (boş kümeden geçen iddia YASAK)`,
    `senaryo yeterli trafik üretmedi (${servis} servis < 100)`)
  kontrol(k.kurtarma === 0, `sağlıklı yükte kurtarma 0 (${servis} servis boyunca)`,
    `sağlıklı yükte ${k.kurtarma} kurtarma — bekçi yanlış tetikliyor: ${JSON.stringify(k.kurtarmaFaz)}`)
  kontrol(k.yenidenRota === 0, 'sağlıklı yükte yeniden rota 0 (bekçi sessiz)',
    `sağlıklı yükte ${k.yenidenRota} yeniden rota — T1 eşiği sağlıklı manevraya takılıyor`)
  kontrol(S.mgr.evapStats.total === 0, 'buharlaşma 0 (sessiz silme geri gelmedi)',
    `buharlaşma ${S.mgr.evapStats.total}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// (d) KONVEYÖR DURUŞU KURTARILMAZ: kural gereği duran araç kusurlu değildir
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n== (d) Konveyör freni: kural gereği duran araç KURTARILMAZ (duruş kusur değil) ==')
{
  katiCisim([])
  // Pompaya sürmekte olan GERÇEK bir araç alınır, hedefi katı cisimle kapatılır (araç
  // ASLA varamaz → bekçi için gerçek sıkışma adayı). Sonra kuralın KENDİ DEFTERİ üzerinden
  // 30 sn'lik bir konveyör duruşu uygulanır: hız 0, blokFren 0, blokT işler, 30 sn'de
  // blokMuaf açılır — konveyorBlok'un f<0.15 dalının yaptığı işlemin aynısı, aynı
  // çağrı sırasında (konveyorBlok → car.update → bekci).
  //
  // NEDEN DEFTER ÜZERİNDEN: bekçi dalında bu duruş doğal oluşuyordu (araç kapalı yuvaya
  // burun burnuna dayanıp omurgada 30 sn frende kalıyordu). Şerit ağı + A* yedeği
  // (64af362) birleşince aynı senaryoda araç katı cismin ETRAFINDAN dolanıyor, frende
  // tutulmuyor ve 36 sn'de kurtarılıyor — yani 30 sn'lik doğal konveyör duruşu artık
  // ÜRETİLEMİYOR (ölçüldü: fren 0.0 sn). Kuralın kendisi konveyor-check'te ölçülür;
  // burada ölçülen bekçinin sözleşmesi: "blokT > 0 ve muafiyet kapalıyken sayaç DONAR,
  // kapı açılınca devralır". Boş küme yasağı korunur: aracın gerçekten 30 sn yerinde
  // tutulduğu (yer değiştirme ≈ 0) ayrıca doğrulanır.
  const S = sahne({ pumps: 1 })
  let A = null
  for (let i = 0; i < 3000 && !A; i++) {
    S.sur(1)
    A = S.mgr.cars.find(c => c.phase === 'driving' && c.slotIndex === 0) ?? null
  }
  kontrol(!!A, 'senaryo kuruldu: pompaya sürmekte olan araç var', 'pompaya giden araç oluşmadı')
  if (!A) process.exit(1)
  const yuva = S.pumpSlots[0]
  katiCisim([{ cx: yuva.x, cy: yuva.y, w: 1.2, d: 1.2 }]) // araç hedefine ASLA varamaz
  const TUT_SN = 30                                        // = BLOK_KILIT_SN (cars.ts)
  let tutSn = 0, donmusT = -1
  const origBlok = S.mgr.konveyorBlok.bind(S.mgr)
  S.mgr.konveyorBlok = function (dt) {
    origBlok(dt)
    if (A.blokMuaf || A.phase !== 'driving') return
    // Fren, araç EN YAKIN noktasına varıp bekçi saymaya BAŞLADIKTAN sonra biner (bekçi
    // dalındaki doğal senaryonun aynısı: araç kapalı yuvanın dibinde tutuluyordu). Aksi
    // hâlde kapı açılınca araç bir süre daha "ilerler" ve kapı-sonrası süre ölçümü bekçiyi
    // değil aracın yolunu ölçer.
    if (tutSn === 0 && A.bekciT < 2) return
    if (donmusT < 0) donmusT = A.bekciT
    tutSn += dt
    A.speedScale = 0; A.blokFren = 0; A.blokT = tutSn
    if (tutSn >= TUT_SN) A.blokMuaf = true
  }
  let frenKare = 0, muafAt = -1, kurtAt = -1, frendeKurtarma = false, kayma = 0, bekciZirve = 0
  let onceki = A.group.position.clone()
  S.sur(900, { herKare: (i) => {
    const t = (i + 1) * DT
    const frende = A.blokT > 0 && !A.blokMuaf     // kural ŞU AN tutuyor
    if (frende) { frenKare++; kayma = Math.max(kayma, A.group.position.distanceTo(onceki)); bekciZirve = Math.max(bekciZirve, A.bekciT) }
    onceki = A.group.position.clone()
    if (muafAt < 0 && A.blokMuaf) muafAt = t      // 30 sn kapısı açıldı: mazeret bitti
    if (kurtAt < 0 && S.mgr.kurtarmaStats.kurtarma > 0) {
      kurtAt = t
      if (frende) frendeKurtarma = true
    }
  } })
  kontrol(kayma < 0.05, `fren GERÇEK: tutulan araç kare başına en çok ${kayma.toFixed(3)} birim kıpırdadı`,
    `fren sahte: araç frende ${kayma.toFixed(2)} birim/kare ilerledi`)
  kontrol(donmusT >= 2 && A.bekciT >= 0 && bekciZirve <= donmusT + DT,
    `bekçi saati frende DONDU (fren başında ${donmusT.toFixed(1)} sn, fren boyunca en çok ${bekciZirve.toFixed(1)} sn)`,
    `bekçi saati frende işledi: başlangıç ${donmusT.toFixed(1)} sn, frende zirve ${bekciZirve.toFixed(1)} sn`)
  const frenSn = frenKare * DT
  kontrol(frenSn >= 20, `ölçüm DOLU kümede: araç ${frenSn.toFixed(1)} sn konveyör freninde tutuldu`,
    `konveyör freni hiç/az oluştu (${frenSn.toFixed(1)} sn) — boş kümeden geçen iddia YASAK`)
  kontrol(!frendeKurtarma && kurtAt > muafAt,
    `fren sürerken KURTARMA YOK: kurtarma ancak 30 sn kapısı açıldıktan (${muafAt.toFixed(1)} sn) sonra geldi (${kurtAt.toFixed(1)} sn)`,
    `araç konveyör freni ALTINDAYKEN kurtarıldı (kurtarma ${kurtAt.toFixed(1)} sn, kapı ${muafAt.toFixed(1)} sn) — meşru duruş cezalandırılıyor`)
  // MUAFİYET DELİK DEĞİL: donma en fazla BLOK_KILIT_SN (30 sn) sürebilir, çünkü kural
  // kendi kapısını açar (blokMuaf) ve bekçi oradan devralır. Ölçülen gecikme bunu doğrular.
  kontrol(muafAt > 0 && kurtAt - muafAt <= 30.5,
    `kapı açıldıktan sonra bekçi ${(kurtAt - muafAt).toFixed(1)} sn içinde devraldı (donma KALICI DEĞİL)`,
    `kapı açıldıktan sonra kurtarma gecikti (${(kurtAt - muafAt).toFixed(1)} sn) — muafiyet kalıcı boşluk üretiyor`)
  kontrol(A.hayalet && A.slotIndex === -1, 'sonunda araç kurtarıldı ve pompa yuvasını bıraktı',
    `araç kurtarılmadı: hayalet ${A.hayalet} yuva ${A.slotIndex}`)
}

katiCisim([])
console.log(fail === 0 ? '\n✓ BEKÇİ TESTİ GEÇTİ (kalıcı sıkışma imkânsız, sessiz silme yok)'
  : `\n✗ ${fail} kriter başarısız`)
process.exit(fail ? 1 : 0)
