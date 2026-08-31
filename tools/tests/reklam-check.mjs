/**
 * ÖDÜLLÜ REKLAM TESTİ — "ÖDÜL = FIRSAT, nakit değil" ilkesinin bekçisi.
 *
 * Kapsanan iki yeni yerleşim:
 *  · ACİL YAKIT TESLİMATI — dolum sırasında tank boşalınca teklif çıkar; ödül 300 L MAL,
 *    nakit değil. Tank kapasitesini ASLA aşmaz (sunucu zaten kapasiteye kırpıyor,
 *    aşan litre sessizce buharlaşırdı).
 *  · ÜCRETSİZ TAMİR — ünite arızalanınca teklif çıkar; ödül üniteyi çalışır yapar.
 *    Oyuncu bu arada kendi parasıyla tamir ettiyse hak HARCANMAZ (fail-closed).
 *
 * Ayrıca korunanlar:
 *  · günlük sınır (2) aşılamıyor — F5 ile sınırsız ödül alınamasın diye sayaç SAVE_FIELDS'ta
 *  · eski kayıt (alanlar yok) yüklenince 0 ve çökme yok
 *  · hiçbir ödül dalı state.money'yi ARTIRMIYOR (ekonomi şişmez)
 *  · teklif yolları TEK KAPIDAN rewardedReady() ile geçiyor (hazır değilken buton yok)
 *
 * Kullanım: npx tsx tools/tests/reklam-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, hydrateState, serializeState } = await import('../../src/state.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

const main_ts = oku('src/main.ts')
const state_ts = oku('src/state.ts')
const i18n_ts = oku('src/i18n.ts')

console.log('── ACİL YAKIT TESLİMATI: MAL VERİR, NAKİT VERMEZ ──')
{
  const s = new GameState()
  s.tanks.benzin = 0
  const paraOnce = s.money
  const gelen = s.adYakitTeslim('benzin')
  bekle(gelen === GameState.AD_YAKIT_LITRE, 'boş tanka tam teslimat yapılıyor', `${gelen} L`)
  bekle(s.tanks.benzin === GameState.AD_YAKIT_LITRE, 'yakıt gerçekten tanka giriyor', `${s.tanks.benzin} L`)
  bekle(s.money === paraOnce, 'ÖDÜL NAKİT DEĞİL: kasa değişmedi', `₺${s.money}`)
  bekle(s.adYakitUsed === 1, 'hak sayacı işliyor')
}

console.log('\n── 300 L TANK KAPASİTESİNİ AŞMIYOR ──')
{
  const s = new GameState()
  const cap = s.fuelCapacity('dizel')
  // kapasitenin 100 L altı: teslimat 300 değil 100 vermeli
  s.tanks.dizel = cap - 100
  const gelen = s.adYakitTeslim('dizel')
  bekle(gelen === 100, 'kalan boşluk kadar veriliyor (300 değil)', `${gelen} L`)
  bekle(s.tanks.dizel === cap, 'tank tam kapasitede duruyor, TAŞMIYOR', `${s.tanks.dizel}/${cap} L`)
  bekle(s.tanks.dizel <= cap, 'kapasite aşımı yok')
}
{
  // DOLU TANK: fayda yok → hak da YANMAMALI ("reklam izledim, hiçbir şey olmadı" olmasın)
  const s = new GameState()
  s.tanks.lpg = s.fuelCapacity('lpg')
  const gelen = s.adYakitTeslim('lpg')
  bekle(gelen === 0, 'dolu tanka teslimat 0 L')
  bekle(s.adYakitUsed === 0, 'faydasız teklifte HAK YANMIYOR (fail-closed)')
  bekle(s.tanks.lpg === s.fuelCapacity('lpg'), 'dolu tank bozulmadı')
}

console.log('\n── GÜNLÜK SINIR (2) AŞILAMIYOR ──')
{
  const s = new GameState()
  bekle(GameState.AD_YAKIT_LIMIT === 2, 'AD_YAKIT_LIMIT = 2')
  bekle(GameState.AD_TAMIR_LIMIT === 2, 'AD_TAMIR_LIMIT = 2')
  bekle(s.adYakitHak === 2, 'gün başında 2 yakıt hakkı')
  s.tanks.benzin = 0; s.adYakitTeslim('benzin')
  s.tanks.benzin = 0; s.adYakitTeslim('benzin')
  bekle(s.adYakitHak === 0, 'iki kullanımdan sonra hak bitti')
  s.tanks.benzin = 0
  const ucuncu = s.adYakitTeslim('benzin')
  bekle(ucuncu === 0, '3. kez teslimat REDDEDİLİYOR', `${ucuncu} L`)
  bekle(s.tanks.benzin === 0, 'reddedilen teslimatta tanka yakıt girmedi')
  bekle(s.adYakitUsed === 2, 'sayaç sınırın üstüne çıkmıyor')
}
{
  const s = new GameState()
  s.brokenPumps.add(0); s.brokenPumps.add(1); s.brokenPumps.add(2)
  bekle(s.adTamirYap('pump', 0) === true, '1. ücretsiz tamir kabul')
  bekle(s.adTamirYap('pump', 1) === true, '2. ücretsiz tamir kabul')
  bekle(s.adTamirYap('pump', 2) === false, '3. kez tamir REDDEDİLİYOR (günlük sınır)')
  bekle(s.brokenPumps.has(2), 'reddedilen tamirde ünite BOZUK kaldı')
  bekle(s.adTamirHak === 0, 'tamir hakkı tükendi')
}

console.log('\n── ÜCRETSİZ TAMİR ÜNİTEYİ GERÇEKTEN ÇALIŞIR YAPIYOR ──')
{
  const s = new GameState()
  const paraOnce = s.money
  s.brokenPumps.add(1)
  bekle(s.adTamirYap('pump', 1) === true, 'bozuk pompa onarılıyor')
  bekle(!s.brokenPumps.has(1), 'pompa artık bozuk listesinde DEĞİL')
  bekle(s.money === paraOnce, 'ÖDÜL NAKİT DEĞİL: tamirden para İADESİ yok', `₺${s.money}`)

  s.brokenChargers.add(0)
  bekle(s.adTamirYap('charger', 0) === true, 'bozuk şarj ünitesi onarılıyor')
  bekle(!s.brokenChargers.has(0), 'şarj ünitesi artık bozuk listesinde DEĞİL')
  bekle(s.money === paraOnce, 'şarj tamiri de kasaya dokunmuyor')
}
{
  // TEKLİF EKRANDAYKEN OYUNCU KENDİ PARASIYLA TAMİR ETTİ → ödül verilmemeli
  const s = new GameState()
  bekle(s.adTamirYap('pump', 0) === false, 'zaten çalışan üniteye tamir ödülü YOK')
  bekle(s.adTamirUsed === 0, 'boşa hak yanmıyor (oyuncu kendi tamir ettiyse)')
  bekle(s.adTamirYap('charger', 7) === false, 'olmayan üniteye ödül YOK')
}

console.log('\n── SAVE UYUMLULUĞU: YALNIZCA EKLENDİ ──')
bekle(/'adSeriUsed', 'adVipUsed', 'adYakitUsed', 'adTamirUsed'/.test(state_ts),
  'adYakitUsed + adTamirUsed SAVE_FIELDS\'ta (sayaç kaydedilmezse F5 = sınırsız ödül)')
{
  // ESKİ KAYIT: yeni alanlar YOK → 0 kabul edilmeli, çökmemeli
  const eski = { money: 250_000, day: 40, reputation: 4.2, pumps: 4,
                 adSeriUsed: 1, adVipUsed: 2,
                 stats: { served: 200, lost: 9, kwh: 0, revenue: 900 } }
  const s = new GameState()
  hydrateState(s, eski)
  bekle(s.adYakitUsed === 0, 'ESKİ kayıt: adYakitUsed = 0 (çökmüyor)')
  bekle(s.adTamirUsed === 0, 'ESKİ kayıt: adTamirUsed = 0')
  bekle(s.adYakitHak === 2 && s.adTamirHak === 2, 'eski kayıtta haklar tam')
  bekle(s.adSeriUsed === 1 && s.adVipUsed === 2, 'MEVCUT alanların anlamı değişmedi')
  bekle(s.money === 250_000 && s.day === 40, 'eski kayıt değerleri korunuyor')
  // eski kayıt yüklenip yeniden serialize edilince alanlar ARTIK var
  const tekrar = serializeState(s)
  bekle('adYakitUsed' in tekrar && 'adTamirUsed' in tekrar, 'tekrar serialize edilince alanlar kaydediliyor')
  bekle(tekrar.adYakitUsed === 0 && tekrar.adTamirUsed === 0, 'kaydedilen değerler doğru')
  // gidiş-dönüş: kullanılmış hak kayıtta yaşıyor mu
  s.tanks.benzin = 0; s.adYakitTeslim('benzin'); s.brokenPumps.add(0); s.adTamirYap('pump', 0)
  const s2 = new GameState()
  hydrateState(s2, serializeState(s))
  bekle(s2.adYakitUsed === 1 && s2.adTamirUsed === 1, 'kullanılan hak yenilemeden SONRA da hatırlanıyor')
}

console.log('\n── NAKİT ÖDÜL YOK: ÖDÜL DALLARI KASAYA DOKUNMUYOR ──')
{
  // state tarafındaki iki ödül fonksiyonu money'ye hiç değmemeli (kaynak denetimi)
  const yakitFn = state_ts.slice(state_ts.indexOf('adYakitTeslim(f: FuelType)'))
    .slice(0, state_ts.slice(state_ts.indexOf('adYakitTeslim(f: FuelType)')).indexOf('\n  }') + 4)
  const tamirFn = state_ts.slice(state_ts.indexOf("adTamirYap(kind: 'pump' | 'charger'"))
    .slice(0, state_ts.slice(state_ts.indexOf("adTamirYap(kind: 'pump' | 'charger'")).indexOf('\n  }') + 4)
  bekle(!/money/.test(yakitFn), 'adYakitTeslim state.money\'ye DOKUNMUYOR')
  bekle(!/money/.test(tamirFn), 'adTamirYap state.money\'ye DOKUNMUYOR')
  bekle(/Math\.min\(GameState\.AD_YAKIT_LITRE, this\.fuelCapacity\(f\) - this\.tanks\[f\]\)/.test(state_ts),
    'kapasite kırpması kodda TEK NOKTADA')
  // main.ts: yakit/tamir ödül dallarında para artışı olmamalı
  const clickBlok = main_ts.slice(main_ts.indexOf("adBtn.addEventListener('click'"))
  const yakitDal = clickBlok.slice(clickBlok.indexOf("offer.kind === 'yakit'"), clickBlok.indexOf("offer.kind === 'vip'"))
  bekle(!/state\.money\s*\+=/.test(yakitDal), 'main.ts yakıt/tamir dallarında state.money += YOK')
  bekle(/state\.adYakitTeslim\(/.test(main_ts), 'main.ts ödülü state kapısından veriyor (yakıt)')
  bekle(/state\.adTamirYap\(/.test(main_ts), 'main.ts ödülü state kapısından veriyor (tamir)')
}

console.log('\n── REKLAM HAZIR DEĞİLKEN BUTON ÇIKMIYOR (TEK KAPI) ──')
{
  bekle(/function showAdOffer\([\s\S]{0,400}?if \(!adsEnabled\(\) \|\| !rewardedReady\(\)/.test(main_ts),
    'showAdOffer rewardedReady() kapısını İÇERİDE uyguluyor')
  bekle(/if \(showAdOffer\('double', profit\)\) doubleOfferT = 22/.test(main_ts),
    '2x teklifi: reklam hazır değilse sayaç bile başlamıyor')
  // 'rush' teklifi artık showAdOffer'ın kapısından geçiyor (ayrı kontrole gerek yok)
  bekle(/showAdOffer\('rush'\)/.test(main_ts), 'rush teklifi tek kapıdan geçiyor')
  bekle(/showAdOffer\('seri', mult\)\) \{/.test(main_ts), 'seri teklifi: durum yalnız teklif çıkarsa kuruluyor')
  bekle(/showAdOffer\('vip', car\.demandAmount\)\) \{/.test(main_ts), 'vip teklifi: durum yalnız teklif çıkarsa kuruluyor')
  bekle(!/rewardedReady\(\) && adBtn\.style\.display/.test(main_ts),
    'eski dağınık rewardedReady kontrolleri kaldırıldı (tek kapı)')
}

console.log('\n── TETİKLEYİCİLER VE TEKLİF ÖMRÜ ──')
bekle(/teklifAcilYakit\(bosYakit\)/.test(main_ts), 'tank boşalınca acil yakıt teklifi çıkıyor')
bekle(/teklifUcretsizTamir\('pump', bozukPompa\)/.test(main_ts), 'pompa arızasında ücretsiz tamir teklifi çıkıyor')
bekle(/teklifUcretsizTamir\('charger', bozukSarj\)/.test(main_ts), 'şarj arızasında da teklif çıkıyor')
bekle(/const bozukPompa = c\.slotIndex/.test(main_ts), 'ünite kimliği finishSale ÖNCESİ yakalanıyor')
bekle(/if \(showAdOffer\('yakit', 0, \{ fuel: f \}\)\) teklifT = 20/.test(main_ts), 'yakıt teklifi ~20 sn süreli')
bekle(/if \(showAdOffer\('tamir', 0, \{ unit: \{ kind, i \} \}\)\) teklifT = 18/.test(main_ts), 'tamir teklifi süreli')
bekle(/const tamirBitti = adOffer\.kind === 'tamir' && \(!adOffer\.unit \|\| !uniteBozukMu\(adOffer\.unit\)\)/.test(main_ts),
  'oyuncu kendi tamir ederse teklif ANINDA iniyor (tickAdOffer)')
bekle(/const tankDoldu = adOffer\.kind === 'yakit'/.test(main_ts), 'tank dolduysa yakıt teklifi iniyor')
bekle(/state\.adYakitUsed = 0[\s\S]{0,60}state\.adTamirUsed = 0/.test(main_ts), 'haklar gün dönüşünde sıfırlanıyor')

console.log('\n── DİL: EN + FR KARŞILIKLARI ──')
for (const anahtar of [
  'Reklam İzle: Acil {0} Teslimatı ({1} L)',
  'Reklam İzle: Ücretsiz Tamir',
  'Acil teslimat geldi: {0} tankına +{1} L — satışa devam!',
  'Tank zaten dolu — teslimata gerek kalmadı, hakkın duruyor.',
  'Pompa #{0} ücretsiz onarıldı — hemen servise hazır!',
  'Şarj #{0} ücretsiz onarıldı — hemen servise hazır!',
  'Ünite zaten onarılmış — hakkın duruyor.',
]) {
  const kac = i18n_ts.split(`'${anahtar}'`).length - 1
  bekle(kac >= 2, `çeviri var (EN + FR): "${anahtar.slice(0, 34)}…"`, `${kac} kayıt`)
}

console.log(hata ? `\n${hata} HATA` : '\nÖDÜLLÜ REKLAM TEMİZ')
process.exit(hata ? 1 : 0)
