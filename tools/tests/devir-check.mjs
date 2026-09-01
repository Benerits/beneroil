/**
 * DEVİR (PRESTİJ) DÖNGÜSÜ TESTİ — "tek seferlik jest" değil SONSUZ DÖNGÜ.
 *
 * Neyi kilitliyor:
 *  1) Devir her turda ERİŞİLEBİLİR (eşik fiziksel maksimumu aşamaz).
 *  2) Her devir ÜÇ EKSENDE kalıcı kazanç verir: gelir çarpanı, müşteri akışı,
 *     kuruluş sermayesi + kadro mirası. Hepsi AZALAN VERİMLİ.
 *  3) Devir hâlâ NET MALİYETLİ: servet asla artmaz (sunucu anti-cheat uyumu).
 *  4) Save ADDITIVE: yeni alan yok, eski kayıt çökmez, round-trip korunur.
 *  5) İSTEMCİ ve SUNUCU çarpanı BİREBİR AYNI (server/index.js'ten sökülüp karşılaştırılır).
 *
 * Çalıştır: npm run test:devir
 */
import fs from 'node:fs'
import path from 'node:path'

globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, serializeState, hydrateState, MANAGER_COSTS, STAFF_TRAIN_COSTS } =
  await import('../../src/state.ts')

let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }
const tl = n => Math.round(n).toLocaleString('tr-TR')

/** Tek şubede kurulabilecek (gerçekçi) büyük istasyon — eşik testleri için. */
const buyuk = () => {
  const x = new GameState()
  x.pumps = 14; x.evChargers = 12; x.signLevel = 3; x.tankLevel = 3
  x.marketLevel = 3; x.market2Level = 3; x.toiletLevel = 2; x.toilet2Level = 2
  x.gridLevel = 2; x.batteryLevel = 6; x.solarCount = 6
  x.airWaterCount = 3; x.selfWashCount = 3; x.parkingCount = 8; x.lampCount = 6
  x.tankCounts = { benzin: 4, dizel: 4, lpg: 4 }
  x.hasWash = x.hasOil = x.hasCoffee = x.hasRestaurant = x.hasTruckPark = true
  x.hasWash2 = x.hasOil2 = x.hasCoffee2 = x.hasRestaurant2 = x.hasTruckPark2 = true
  x.hasSMR = x.hasDiesel = x.hasHotel = x.hasCleaner = x.wideGates = true
  x.day = 120; x.money = 50_000
  x.salesLog = Array.from({ length: 30 }, (_, i) => ({ day: 120 - i, rev: 9000 }))
  return x
}

console.log('== 1) YENİ EKSENLER VAR MI (API) ==')
bekle(typeof GameState.prestigeFlowFor === 'function', 'prestigeFlowFor (müşteri akışı ekseni) var')
bekle(typeof GameState.prestigeSeedFor === 'function', 'prestigeSeedFor (kuruluş sermayesi ekseni) var')
bekle(typeof GameState.prestigeCrewFor === 'function', 'prestigeCrewFor (kadro mirası ekseni) var')
bekle(typeof GameState.prestigeStarMult === 'function', 'prestigeStarMult (sunucu ile ortak çarpan) var')

console.log('\n== 2) AZALAN VERİM ==')
if (typeof GameState.prestigeFlowFor === 'function') {
  const f = n => GameState.prestigeFlowFor(n)
  bekle(Math.abs(f(0) - 1) < 1e-9, 'yıldızsız oyuncuda akış çarpanı ×1.00 (mevcut denge BOZULMAZ)')
  bekle(f(1) > f(0) && f(5) > f(1) && f(20) > f(10), 'akış çarpanı her yıldızda ARTIYOR')
  const d1 = f(1) - f(0), d7 = f(7) - f(6), d15 = f(15) - f(14)
  bekle(d1 > d7 && d7 > d15, `akış artışı AZALIYOR (+${d1.toFixed(3)} → +${d7.toFixed(3)} → +${d15.toFixed(3)})`)
  bekle(f(40) <= 1.5 + 1e-9, `akış çarpanı TAVANLI (40★ → ×${f(40).toFixed(3)} ≤ 1.50)`)
}
if (typeof GameState.prestigeSeedFor === 'function') {
  const g = n => GameState.prestigeSeedFor(n)
  bekle(g(0) === 0, 'yıldızsızken kuruluş sermayesi 0')
  bekle(g(1) > 0 && g(5) > g(1) && g(20) > g(10), 'kuruluş sermayesi her yıldızda ARTIYOR')
  bekle((g(1) - g(0)) > (g(8) - g(7)) && (g(8) - g(7)) > (g(20) - g(19)),
    `sermaye artışı AZALIYOR (+${tl(g(1) - g(0))} → +${tl(g(8) - g(7))} → +${tl(g(20) - g(19))})`)
  bekle(Number.isFinite(g(40)) && g(40) <= 1_000_000, `sermaye TAVANLI (40★ → ₺${tl(g(40))})`)
}
if (typeof GameState.prestigeCrewFor === 'function') {
  const c = n => GameState.prestigeCrewFor(n)
  bekle(c(0).manager === 0 && c(0).staff === 1, 'yıldızsızken kadro mirası YOK (müdür 0, personel 1)')
  bekle(c(1).manager >= 1, '1★ → en az müdür Sv.1 mirası')
  bekle(c(40).manager <= 3 && c(40).staff <= 4, 'kadro mirası seviye tavanını AŞMIYOR (azalan verim)')
}

console.log('\n== 3) ART ARDA 3 DEVİR: her turda daha güçlü, daha hızlı ==')
{
  let s = buyuk()
  const tur = []
  for (let i = 1; i <= 3; i++) {
    const eq = s.equipmentValue()
    const servetOnce = s.money + eq
    const oncekiAkis = s.entryChance()
    const pv = s.handoverPreview()
    bekle(s.canHandover(), `Tur ${i}: devir eşiği ERİŞİLEBİLİR (ekipman ₺${tl(eq)} ≥ eşik ₺${tl(s.handoverThreshold())})`)
    bekle(typeof pv.seed === 'number' && pv.seed >= 0, `Tur ${i}: önizleme kuruluş sermayesini GÖSTERİYOR (₺${tl(pv.seed ?? -1)})`)
    const res = s.handover()
    bekle(!!res, `Tur ${i}: devir gerçekleşti`)
    if (!res) break
    const servetSonra = s.money + s.equipmentValue()
      + sumUpto(MANAGER_COSTS, s.managerLevel) + sumUpto(STAFF_TRAIN_COSTS, s.staffLevel - 1)
    tur.push({
      yildiz: s.brandStars,
      nakit: res.cash,
      sermaye: res.seed ?? 0,
      gelirMult: s.prestigeMult(),
      akisMult: GameState.prestigeFlowFor ? GameState.prestigeFlowFor(s.brandStars) : 1,
      mudur: s.managerLevel, personel: s.staffLevel,
      entry: s.entryChance(), oncekiAkis,
      servetDelta: servetSonra - servetOnce,
    })
    // yeniden kur (grind simülasyonu): aynı istasyonu tekrar dik, prestij taşınır
    const tasi = { brandStars: s.brandStars, handoverCount: s.handoverCount, money: s.money,
                   managerLevel: s.managerLevel, staffLevel: s.staffLevel }
    s = buyuk(); Object.assign(s, tasi)
  }
  for (const x of tur) {
    console.log(`   Tur→${x.yildiz}★  kasa +₺${tl(x.nakit)} (sermaye ₺${tl(x.sermaye)})`
      + `  gelir ×${x.gelirMult.toFixed(2)}  akış ×${x.akisMult.toFixed(3)}`
      + `  müdür Sv.${x.mudur} personel Sv.${x.personel}  servet Δ₺${tl(x.servetDelta)}`)
  }
  bekle(tur.length === 3, '3 tur art arda devredilebildi (SONSUZ DÖNGÜ)')
  if (tur.length === 3) {
    bekle(tur[0].gelirMult < tur[1].gelirMult && tur[1].gelirMult < tur[2].gelirMult, 'gelir çarpanı her turda arttı')
    bekle(tur[0].akisMult < tur[1].akisMult && tur[1].akisMult < tur[2].akisMult, 'müşteri akışı çarpanı her turda arttı')
    bekle(tur[0].sermaye < tur[1].sermaye || tur[1].sermaye < tur[2].sermaye, 'kuruluş sermayesi turlarla büyüdü')
    bekle(tur[2].mudur >= 2 && tur[2].personel >= 2, '3. turda kadro mirası geldi (müdür ≥ Sv.2, personel ≥ Sv.2)')
    bekle(tur.every(x => x.servetDelta <= 0),
      'DEVİR HÂLÂ NET MALİYETLİ: hiçbir turda servet ARTMADI (sunucu anti-cheat uyumu)')
  }
}

console.log('\n== 4) DEVİR SONRASI OYUN DAHA HIZLI: aynı istasyon daha çok müşteri çekiyor ==')
{
  const orta = st => {
    const x = new GameState()
    x.pumps = 4; x.signLevel = 1; x.marketLevel = 1; x.brandStars = st
    return x
  }
  const e0 = orta(0).entryChance(), e1 = orta(1).entryChance(), e3 = orta(3).entryChance()
  bekle(e1 > e0 && e3 > e1, `aynı kurulumda akış artıyor (0★ ${e0.toFixed(3)} → 1★ ${e1.toFixed(3)} → 3★ ${e3.toFixed(3)})`)
  bekle(orta(40).entryChance() <= 0.99, 'akış çarpanı olasılığı 1.0 üstüne TAŞIRMIYOR')
}

console.log('\n== 5) SAVE UYUMU (ADDITIVE, eski kayıt çökmez) ==')
{
  const a = buyuk(); a.handover()
  const b = new GameState(); hydrateState(b, serializeState(a))
  bekle(b.brandStars === a.brandStars && b.handoverCount === a.handoverCount, 'prestij round-trip korundu')
  bekle(b.managerLevel === a.managerLevel && b.staffLevel === a.staffLevel, 'kadro mirası round-trip korundu')
  bekle(Math.abs(b.prestigeMult() - a.prestigeMult()) < 1e-9, 'gelir çarpanı round-trip korundu')

  // ESKİ KAYIT: yeni alanların hiçbiri yok
  const eski = new GameState()
  hydrateState(eski, { money: 12_345, day: 40, pumps: 3, marketLevel: 1, reputation: 3.4 })
  const sayilar = [eski.prestigeMult(), eski.entryChance(), eski.handoverThreshold(), eski.handoverValue()]
  bekle(sayilar.every(Number.isFinite), 'ESKİ KAYIT: hiçbir değer NaN değil')
  bekle(eski.brandStars === 0 && eski.handoverCount === 0, 'ESKİ KAYIT: prestij alanları 0 varsayılanına düştü')
  bekle(Math.abs(eski.prestigeMult() - 1) < 1e-9, 'ESKİ KAYIT: çarpan ×1.00 (denge değişmedi)')
  const pv = eski.handoverPreview()
  bekle(Object.values(pv).every(v => typeof v !== 'number' || Number.isFinite(v)), 'ESKİ KAYIT: önizleme NaN üretmiyor')

  // BOZUK KAYIT
  const bozuk = new GameState()
  hydrateState(bozuk, { brandStars: 'x', handoverCount: -9 })
  bekle(bozuk.brandStars === 0 && bozuk.handoverCount === 0, 'BOZUK KAYIT: prestij alanları 0 a çekildi')
  bekle(Number.isFinite(bozuk.entryChance()) && Number.isFinite(bozuk.prestigeMult()), 'BOZUK KAYIT: çarpanlar sonlu')
}

console.log('\n== 6) İSTEMCİ == SUNUCU (server/index.js sökülüp karşılaştırılıyor) ==')
{
  const srvSrc = fs.readFileSync(path.join(new URL('../../', import.meta.url).pathname, 'server/index.js'), 'utf8')
  const i = srvSrc.indexOf('function prestigeStarMult')
  let srvFn = null
  if (i >= 0) {
    let d = 0, j = srvSrc.indexOf('{', i), k = j
    for (; k < srvSrc.length; k++) { if (srvSrc[k] === '{') d++; else if (srvSrc[k] === '}') { d--; if (!d) break } }
    srvFn = new Function(`${srvSrc.slice(i, k + 1)}; return prestigeStarMult`)()
  }
  bekle(!!srvFn, 'server/index.js içinde prestigeStarMult() tanımlı')
  // Ham starMult ifadesi ARTIK kopyalanmamalı — tek kaynak fonksiyon olmalı
  const hamKopya = (srvSrc.match(/const starMult = 1 \+ 0\.25/g) || []).length
  bekle(hamKopya === 0, 'sunucuda kopyala-yapıştır starMult ifadesi KALMADI (tek kaynak)')
  if (srvFn && typeof GameState.prestigeStarMult === 'function') {
    let ayrik = null
    for (let st = 0; st <= 40; st++) {
      const c = GameState.prestigeStarMult(st), sv = srvFn(st)
      if (Math.abs(c - sv) > 1e-9) { ayrik = `${st}★: istemci ×${c.toFixed(4)} ≠ sunucu ×${sv.toFixed(4)}`; break }
    }
    bekle(!ayrik, ayrik ? `ÇARPAN AYRIŞMASI → ${ayrik}` : '0-40★ için istemci ve sunucu çarpanı BİREBİR AYNI')
    console.log(`   örnek: 0★ ×${srvFn(0).toFixed(3)} · 1★ ×${srvFn(1).toFixed(3)} · 5★ ×${srvFn(5).toFixed(3)}`
      + ` · 10★ ×${srvFn(10).toFixed(3)} · 20★ ×${srvFn(20).toFixed(3)} · 40★ ×${srvFn(40).toFixed(3)}`)
  }
  // sunucu doğrulama iskeleti BOZULMADI mı (yıldız monotonik + en fazla +1)
  bekle(/stars > prevStars \+ 1/.test(srvSrc), 'sunucu: yıldız +1 den fazla artamaz kuralı DURUYOR')
  bekle(/stars < prevStars/.test(srvSrc), 'sunucu: yıldız monotonik (azalamaz) kuralı DURUYOR')
  bekle(/if \(firstSave\) \{ stars = 0/.test(srvSrc), 'sunucu: ilk save de yıldız 0 lanır kuralı DURUYOR')
}

console.log('\n== 7) EŞİK HER TURDA ERİŞİLEBİLİR ==')
{
  const maks = buyuk().equipmentValue()
  let engel = null
  for (let h = 0; h <= 12; h++) {
    const s = new GameState(); s.handoverCount = h
    if (s.handoverThreshold() > maks) { engel = `${h}. devirde eşik ₺${tl(s.handoverThreshold())} > tek şube maks ₺${tl(maks)}` ; break }
  }
  bekle(!engel, engel ? `KİLİT: ${engel}` : `tek şubeyle 12 devire kadar eşik aşılabilir (maks ekipman ₺${tl(maks)})`)
}

console.log('\n== 8) YILDIZ TAVANI (#1291): 40★ da devir KAPALI, 39★ da açık, sunucu ile aynı tavan ==')
{
  // 40★'lık oyuncu devredince istemci 41 yazıyor, hydrate/sunucu 40'a kırpıyordu → ekipman gitti, yıldız gelmedi
  const srvSrc = fs.readFileSync(path.join(process.cwd(), 'server/index.js'), 'utf8')
  bekle(GameState.BRAND_STARS_MAX === 40, `BRAND_STARS_MAX = ${GameState.BRAND_STARS_MAX}`)
  bekle(/Math\.min\(40, n\(s\.brandStars\)\)/.test(srvSrc) && /clamp\(s\.brandStars, 0, 40, 0\)/.test(srvSrc),
    'sunucu tavanı da 40 (maxIncomeRate + sanitize)')
  const s39 = buyuk(); s39.brandStars = 39; s39.handoverCount = 39
  const s40 = buyuk(); s40.brandStars = 40; s40.handoverCount = 40
  bekle(s39.canHandover() && !s39.atStarCap(), '39★: devir açık')
  bekle(!s40.canHandover() && s40.atStarCap(), '40★: devir KAPALI (canHandover false)')
  bekle(s40.handover() === null, '40★: handover() null döner, ekipman gitmez')
  bekle(s40.pumps === 14 && s40.brandStars === 40, '40★: pompalar ve yıldız yerinde')
  bekle(s40.rehber().engel === 'tavan' && !s40.rehber().ready, "40★: rehber engel='tavan', ready=false")
  bekle(s39.rehber().engel === null, "39★: engel yok")
  const h = new GameState(); hydrateState(h, serializeState(s40))
  bekle(h.brandStars === 40 && h.atStarCap(), 'hydrate: 40★ korunur ve tavan bayrağı doğru')
}

function sumUpto(arr, k) {
  return arr.slice(0, Math.max(0, Math.min(arr.length, Math.floor(k) || 0))).reduce((a, b) => a + b, 0)
}

console.log(hata ? `\n❌ ${hata} kontrol BAŞARISIZ` : '\n✅ devir döngüsü sağlam')
process.exit(hata ? 1 : 0)
