/**
 * ARAÇ / TRAFİK / MÜŞTERİ TESTİ — I grubu (5 şikayet).
 *
 *  #1028 "istasyonda alan olmasına rağmen pompa doluysa sıradaki araç GİRİŞ ALANINDA
 *        bekliyor, içeri gelmiyor"  → iç bekleme koridoru 4 yuvadan 8'e çıktı.
 *  #1019 "toplu olarak sarjcı ve pompacı tutabilsek" + "karşı dükkanlar ters duruyor"
 *  #1023 "elektrikli araba sayısı çok az gibi"
 *  #1009 / #1039 sıkışma: traffic-load.mjs zaten A/B ölçüyor; burada regresyon çiti.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState } = await import('../../src/state.ts')
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

const cars = readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')
const dunya = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')
const ana = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

// ── #1028: iç bekleme koridoru (kuyruk İÇERİDE) ──
// Sabit WAIT_OFFSETS dizisi kalktı: kuyruk slotları şerit ağından TÜRETİLİYOR.
const grafik = readFileSync(new URL('../../src/traffic-graph.ts', import.meta.url), 'utf8')
const qn = grafik.match(/const qn = g\.wide \? (\d+) : (\d+)/)
bekle(!!qn && Number(qn[2]) >= 8, `iç kuyruk slotu ${qn ? qn[2] : '?'} (dar kapı) / ${qn ? qn[1] : '?'} (geniş kapı)`)
// KUYRUK SIRALAMASI: slot 0 = SIRANIN BAŞI ve akış yönünde EN İLERİDEKİ nokta; kuyruk
// oradan kapıya doğru GERİ dizilir. Ters dizilseydi yeni gelen her araç, önündeki
// sıranın gövdesinden geçerek arkaya giderdi (ölçüldü: T8'de 174 iç içe çift).
bekle(/const y = capa - g\.dirY \* i \* step/.test(grafik),
  'kuyruk slotları BAŞTAN GERİYE diziliyor (kimse kimseyi geçmiyor)')
// MARİNA: tekne boyu (süperyat 8.5 birim) araç aralığına sığmaz — su şubesi 4 geniş slot.
bekle(/QUEUE_STEP_WATER = 9/.test(grafik), 'marina kuyruk aralığı tekne boyuna göre (9 birim)')
bekle(/g\.water \? 4 : qn/.test(grafik), 'su şubesinde 4 slot (tekneler iç içe girmiyor)')
bekle(/private waitSlotCount\(st: 'near' \| 'far'\)/.test(cars),
  'yuva sayısı şubeye göre hesaplanıyor (waitSlotCount)')
bekle(/for \(let i = 0; i < this\.waitSlotCount\(car\.station\); i\+\+\)/.test(cars),
  'yuva arama döngüsü şube farkındalıklı (marinada 5. tekne üst üste binmiyor)')

// ── #1019a: toplu personel alımı ──
bekle(/id="of-staff"/.test(html), 'Ofis › Özet\'te Personel bölümü var')
bekle(/of-hire-pumps/.test(ana) && /of-hire-chargers/.test(ana), 'toplu pompacı/şarjcı butonları var')
bekle(/function topluIseAl\(tur: 'pump' \| 'charger'\)/.test(ana), 'toplu işe alım işlevi mevcut')
bekle(/getElementById\('of-staff'\)\?\.addEventListener/.test(ana),
  'butonlar her render\'da yeniden yazıldığı için dinleyici SABİT kapsayıcıda (delegasyon)')
bekle(/if \(state\.money < bedel\) \{ atlanan\+\+; continue \}/.test(ana),
  'para yetmeyince eksiye düşmüyor, atlananı bildiriyor')

// ── #1019b: karşı yaka dükkanları ──
bekle(/private farFlip\(g: THREE\.Object3D\)/.test(dunya), 'karşı yaka dönüş yardımcısı (farFlip) var')
bekle(/rotation\.z = rot \* Math\.PI \/ 2 \+ this\.farFlip\(b\.group\)/.test(dunya),
  'oyuncu binayı döndürse de karşı yaka flip\'i KAYBOLMUYOR')
bekle(/this\.theme\.lane\.kind === 'water'\) return 0/.test(dunya),
  'marinada flip uygulanmıyor (adanın yol karşısı yok)')
bekle(/&& this\.farFlip\(group\)\)/.test(dunya), 'kurulum anında da doğru yöne bakıyor')

// ── #1023: EV payı ──
const ev = ana.match(/evShare: \(\) => \(state\.evChargers > 0 \? Math\.min\(([\d.]+), ([\d.]+) \+ ([\d.]+) \* state\.evChargers\)/)
bekle(!!ev, 'evShare formülü okunabiliyor')
if (ev) {
  const [, tavan, taban, adim] = ev.map(Number)
  bekle(taban >= 0.20, `EV tabanı %${Math.round(taban * 100)} (eskiden %15)`)
  bekle(adim >= 0.11, `ünite başı katkı %${Math.round(adim * 100)} (eskiden %9)`)
  bekle(tavan >= 0.55, `tavan %${Math.round(tavan * 100)} (eskiden %50)`)
  const s = new GameState()
  const pay = n => Math.min(tavan, taban + adim * n) * s.evPriceFactor()
  bekle(pay(1) > 0.20, `1 şarj ünitesiyle akışın %${Math.round(pay(1) * 100)}'i EV`)
  bekle(pay(4) > pay(1), `4 ünitede %${Math.round(pay(4) * 100)} — yatırım sahnede görünüyor`)
  bekle(pay(99) <= tavan * 1.26, 'tavan korunuyor — istasyon tamamen EV\'ye dönmüyor')
}

// ── regresyon çiti: sıkışma sigortaları yerinde mi (#1009 / #1039) ──
// ── regresyon çiti: ŞERİT AĞI mimarisi (ajan müzakeresi GERİ GELMESİN) ──
// Aşağıdaki katmanlar bilerek silindi. Biri geri eklenirse bu test düşer ve gerekçeyi
// yeniden okumaya zorlar: hepsi "araç bekletildi → kilitlendi" zincirinin panzehiriydi.
// Yorumlarda ADLARI GEÇİYOR (bilerek: neden silindiklerini anlatıyorlar) — bu yüzden
// kontrol YORUMSUZ kaynak üzerinde yapılır, yoksa kendi açıklamamız testi düşürürdü.
const yorumsuz = t => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
const carsKod = yorumsuz(cars)
const yasak = ['softPassT', 'stuckHits', 'recoverStuck', 'dodgeRight', 'evaporate(',
  'rampBusy', 'stationCrowdFactor(', 'gorselAyrim', 'tryAcquire', 'waitingForToken']
for (const y of yasak) bekle(!carsKod.includes(y), `müzakere katmanı geri gelmemiş: ${y}`)
bekle(/LaneNetwork/.test(cars), 'şerit ağı (LaneNetwork) kullanılıyor')
bekle(/kuyrukIlerlet/.test(cars), 'kuyruk sabit slotlarda İLERLİYOR (araç slota kayar)')
// fbcf15e: sabit 0.3 tabanı `taban` değişkenine taşındı — AYNI YÖNDE ve hareket eden
// öndeki için öndekinin hızına (≥0.15) inebilir, diğer her durumda 0.3. Sıfır asla değil.
// 2 Eyl: oran (`forward / sep`) yerine ARALIK — `(forward - bos) / (sep - bos)`; taban aynen.
bekle(/speedScale = Math\.min\(c\.speedScale, Math\.max\(taban, \(forward - bos\) \/ \(sep - bos\)\)\)/.test(cars)
  && /const taban = ayniYon && o\.hizOrani >= 0\.15 \? Math\.min\(0\.3, o\.hizOrani\) : 0\.3/.test(cars),
  'hız eşitlemesi tabanı 0 DEĞİL (≥0.15 ya da 0.3; kimse durmaz → kilitlenme imkânsız)')
const serit = readFileSync(new URL('../../src/traffic-graph.ts', import.meta.url), 'utf8')
bekle(!/tryAcquire|RESERVE_TTL|waitQ/.test(yorumsuz(serit)), 'rezervasyon defteri silinmiş')
bekle(/UNIT_CLEAR/.test(serit) && /LANE_SEP/.test(serit), 'şerit ayrıklığı sabitlerle garanti')

// ── DOLAMBAÇLILIK (kat edilen yol ÷ kuş uçuşu) — near ve far AYNI olmalı ──
// NEDEN VAR: oyun sahibi "karşı istasyonda araçlar saçma rotalar takip ediyor" dedi.
// Şerit ağı near'ın (ROAD_X,0) etrafında 180° dönmüş hâli olduğu için karşı yakada
// dolambaçlılık near'dan FARKLI çıkarsa aynalamada bir yer bozulmuş demektir.
// traffic-graph saf geometridir (three.js/DOM bilmez) → burada doğrudan koşturulabilir.
{
  const { LaneNetwork } = await import('../../src/traffic-graph.ts')
  const ROAD_X = 7.9, GATE_X = 4.2
  const ayna = p => ({ x: 2 * ROAD_X - p.x, y: -p.y }) // 180° dönüş: near → far
  const nearUnits = [
    { id: 'pump-0', x: 1.8, y: -2.2 }, { id: 'pump-1', x: 1.8, y: 2.2 },
    { id: 'ev-0', x: 1.8, y: 6.2 }, { id: 'ev-1', x: 1.8, y: 8.8 },
  ]
  const net = new LaneNetwork()
  net.rebuild([
    { station: 'near', gateX: GATE_X, lane: 6.95, gateInY: -8, gateOutY: 8,
      sideSign: -1, dirY: 1, wide: true, units: nearUnits },
    { station: 'far', gateX: 2 * ROAD_X - GATE_X, lane: 8.85, gateInY: 8, gateOutY: -8,
      sideSign: 1, dirY: -1, wide: true, units: nearUnits.map(u => ({ ...u, ...ayna(u) })) },
  ])
  const uzunluk = pts => pts.reduce((s, p, i) => i ? s + Math.hypot(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : 0, 0)
  /** kapı ağzından üniteye: kat edilen yol ÷ kuş uçuşu */
  const oran = (st, u) => {
    const L = net.get(st)
    const kapi = { x: L.gateX, y: L.gateInY }
    const yol = [kapi, ...net.entryPath(st, u, false)]
    return uzunluk(yol) / Math.hypot(u.x - kapi.x, u.y - kapi.y)
  }
  const olc = st => {
    const us = st === 'near' ? nearUnits : nearUnits.map(u => ({ ...u, ...ayna(u) }))
    return us.map(u => oran(st, u))
  }
  const yakin = olc('near'), karsi = olc('far')
  const ort = a => a.reduce((x, y) => x + y, 0) / a.length
  const enBuyukFark = Math.max(...yakin.map((v, i) => Math.abs(v - karsi[i])))
  bekle(enBuyukFark < 0.01,
    `dolambaçlılık AYNALI: near ort ${ort(yakin).toFixed(3)} · far ort ${ort(karsi).toFixed(3)} (en büyük fark ${enBuyukFark.toFixed(4)})`)
  // Üst sınır: kapı → omurga → ünite hizası → kol (dik dörtgen rota). Bunun üstü
  // "gereksiz uzun rota" demektir; 1.6 sınırı ölçülmüş değerlerin (≈1.2) çok üstünde
  // değil, yani bir gün biri araya nokta eklerse test görür.
  bekle(Math.max(...yakin, ...karsi) <= 1.6,
    `en dolambaçlı ünite rotası ${Math.max(...yakin, ...karsi).toFixed(3)} ≤ 1.6`)

  // ── ÇIKIŞ ROTASI GERİ ADIM ATMASIN ──
  // Giden omurga dar avluda kapı hattının YOL TARAFINA düşebiliyor; o durumda eski rota
  // aracı kapı ağzına, yani 0.3 birim GERİ (avlunun içine) çekip sonra yola çıkarıyordu.
  // Ekranda kapıda küçük bir "S" kıvrımı, ölçümde gereksiz yol. Ölçüt: kapıdan yola doğru
  // olan derinlik, çıkış rotası boyunca ASLA artmamalı (araç içeri geri dönmemeli).
  // DAR AVLU da denenir: giden omurga kapının YOL TARAFINA düştüğünde (dOut < 0) hata
  // ancak orada ortaya çıkıyor — geniş avlu tek başına regresyonu görmez.
  const darNet = new LaneNetwork()
  const darUnits = [{ id: 'pump-0', x: 2.4, y: -2 }, { id: 'pump-1', x: 2.4, y: 2 }]
  darNet.rebuild([
    { station: 'near', gateX: GATE_X, lane: 6.95, gateInY: -8, gateOutY: 8,
      sideSign: -1, dirY: 1, wide: true, units: darUnits },
    { station: 'far', gateX: 2 * ROAD_X - GATE_X, lane: 8.85, gateInY: 8, gateOutY: -8,
      sideSign: 1, dirY: -1, wide: true, units: darUnits.map(u => ({ ...u, ...ayna(u) })) },
  ])
  for (const [ad, N] of [['geniş avlu', net], ['dar avlu', darNet]]) {
    for (const st of ['near', 'far']) {
      const L = N.get(st)
      const yol = N.exitPath(st, { x: L.xIn, y: 0 })
      const derin = pt => L.sideSign * (pt.x - L.gateX) // + = avlunun içi
      let geri = 0
      for (let i = 1; i < yol.length; i++) if (derin(yol[i]) > derin(yol[i - 1]) + 1e-6) geri++
      bekle(geri === 0, `${ad} · ${st}: çıkış rotasında geri adım yok (${yol.map(q => derin(q).toFixed(2)).join(' → ')})`)
    }
  }

  // ── OTOPARK ŞERİT AĞA DAHİL Mİ (oyuncu şikâyeti: park yerleri boş, araçlar üst üste) ──
  const parkNet = new LaneNetwork()
  const lot = [0, 1, 2, 3].map(i => ({ id: `parking:${i}`, x: -2.5 + 1.25 * (i + 0.5) - 3, y: -6.5, sx: -2.5 + 1.25 * (i + 0.5) - 3, sy: -4.1 }))
  parkNet.rebuild([{ station: 'near', gateX: GATE_X, lane: 6.95, gateInY: -8, gateOutY: 8,
    sideSign: -1, dirY: 1, wide: true, units: nearUnits, parks: lot }])
  const serit = parkNet.parkLanesOf('near')
  bekle(serit.length === 4, `açık alandaki otoparkın 4 yerinin hepsi şeride bağlandı (${serit.length}/4)`)
  bekle(serit.every(l => Math.hypot(l.inArm.x - l.outArm.x, l.inArm.y - l.outArm.y) > 1.0),
    'park koridorunda GİRİŞ ve ÇIKIŞ hattı ayrık (çıkmaz sokakta kafa kafaya gelme yok)')
  // Kapalı yola araç gönderilmemeli: yanaşma hattını katı cisimle kapat, slot listeden düşsün
  const kapali = new LaneNetwork()
  kapali.rebuild(
    [{ station: 'near', gateX: GATE_X, lane: 6.95, gateInY: -8, gateOutY: 8,
      sideSign: -1, dirY: 1, wide: true, units: nearUnits, parks: lot }],
    (x, y) => Math.abs(y + 5.2) < 1.4, // otoparkın İKİ cephesini de kesen bant
  )
  bekle(kapali.parkLanesOf('near').length < 4,
    `yolu katı cisimle kapalı park yeri listeye girmiyor (${kapali.parkLanesOf('near').length}/4 kaldı)`)
}
// ── KAPI OKU İKİ KEZ AYNALANMASIN (oyuncu: "karşı istasyonun okları yanlış yerde") ──
// register() ROAD_X'in doğusundaki grubu zaten 180° döndürüyor (farFlip). buildGate ayrıca
// `(far ? -1 : 1)` ile çevirirse ok TAM TERSİNİ gösterir; tabela da kameraya sırtını döner.
// (kontrol YORUMSUZ kaynakta: yukarıdaki açıklama hatanın kendisini anlatıyor)
bekle(!/\(far \? -1 : 1\)/.test(yorumsuz(dunya)), 'kapı oku İKİ KEZ aynalanmıyor (aynalama tek kaynakta: farFlip)')
bekle(/const dir = kind === 'in' \? -1 : 1/.test(dunya), 'ok yerel eksende: giriş −x, çıkış +x')
bekle(/far \? new THREE\.Vector3\(-1, 0, 0\) : undefined/.test(dunya),
  'karşı kapı tabelası 180° dönüşten SONRA kameraya bakıyor (yerelde ters kuruluyor)')

bekle(/parkLanesOf\(car\.station\)/.test(cars), 'otopark yeri ŞERİT AĞINDAN seçiliyor (elle waypoint değil)')
bekle(!/preStageX/.test(cars), 'sabit "ön-sahneleme kolonu" (x=3.0) silinmiş — omurgaların arasında üçüncü kolon yok')
bekle(/parkExitPath/.test(cars), 'otopark çıkışı AYRI hattan (giriş koridoruna girmiyor)')

console.log(hata ? `\n${hata} HATA` : '\nTRAFİK TEMİZ')
process.exit(hata ? 1 : 0)
