/**
 * BENERITS ÖZEL MÜŞTERİLER TESTİ (3 Eyl 2026, Oğuz'un isteği)
 *
 * Kapsanan:
 *  · Üç misafir: Oğuz/Çağan "BENERITS Şirket Aracı" (yakıt), Burak "BENERITS PATRON" (yalnız EV).
 *    Araçlar: beyaz sedan, fıstık yeşili ticari (van), siyah EV sedan; Kenney boya karesi tanımlı.
 *  · Zar: gün < 3 gelmez; ziyaretler arası ≥ 2 gün; şans ~%1,2/araç; marinada gelmez;
 *    şarj yoksa PATRON düşer (yakıtlı ikiliden seçilir); doğumda lastDay damgalanır.
 *  · Talep 2 KAT (Car: demandAmount ×2, demandKwh ×2 ≤ 100), FULLE yok, sabır bol, etiket var.
 *  · Bahşiş ₺8.000–10.000 yüzlüğe yuvarlı; deftere yazılır; kasa/istatistik tek kapıdan.
 *  · PATRON: şarj bitince molaya çıkar, GÖNDER çalışmaz, personel/müdür uğurlamaz, molaSn sonra gider.
 *  · Kayıt: 'benerits' SAVE_FIELDS'ta (additive), eski/kurcalanmış kayıt temizlenir.
 *  · Başarımlar: benerits-patron, benerits-ekip. Bildirim + toast (main.ts) + i18n.
 *  · Anti-cheat: bahşiş tavanı sunucu kovasının (260k) çok altında.
 *
 * Kullanım: npx tsx tools/tests/benerits-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const st = await import('../../src/state.ts')
const { GameState, hydrateState, serializeState, BENERITS_GUESTS, BENERITS_TALEP_KAT, BENERITS_BAHSIS_MAX, BENERITS_SANS_DAR, BENERITS_DAR_KASA,
  BENERITS_ILK_GUN, BENERITS_ARA_GUN, BENERITS_SANS } = st

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const main_ts = oku('src/main.ts')
const cars_ts = oku('src/cars.ts')
const state_ts = oku('src/state.ts')
const index_js = oku('server/index.js')

console.log('── MİSAFİR TANIMLARI ──')
{
  const g = BENERITS_GUESTS
  bekle(Object.keys(g).length === 3, 'üç misafir', Object.keys(g).join(','))
  bekle(g.oguz.title === 'BENERITS Şirket Aracı' && g.cagan.title === 'BENERITS Şirket Aracı', 'Oğuz/Çağan unvanı Şirket Aracı')
  bekle(g.burak.title === 'BENERITS PATRON' && g.burak.kind === 'ev', 'Burak PATRON ve yalnız EV (benzin almaz)')
  bekle(g.oguz.kind === 'fuel' && g.cagan.kind === 'fuel', 'Oğuz/Çağan yakıt alır')
  bekle(g.oguz.model === 'sedan' && g.oguz.color >= 0xe0e0e0, 'Oğuz: beyaz sedan (Egea)')
  bekle(g.cagan.model === 'van' && ((g.cagan.color >> 8) & 0xff) > ((g.cagan.color >> 16) & 0xff) && ((g.cagan.color >> 8) & 0xff) > (g.cagan.color & 0xff), 'Çağan: fıstık yeşili ticari (van) — yeşil kanal baskın')
  bekle(g.burak.model === 'race-future' && g.burak.color <= 0x202020, 'Burak: siyah EV sedan (EQE)')
  bekle(typeof g.burak.molaSn === 'number' && g.burak.molaSn >= 30 && g.burak.molaSn <= 90, 'Patron molası 30–90 sn', String(g.burak.molaSn))
  bekle(g.burak.quote.includes('çıkıyorum kardeşim'), 'Patron repliği: "…çıkıyorum kardeşim"')
  bekle(BENERITS_TALEP_KAT === 2, 'talep katı 2 (normal arabanın 2 katı)')
  bekle(g.oguz.bahsis === 5000 && g.cagan.bahsis === 5000 && g.burak.bahsis === 10000, 'sabit bahşiş: Oğuz/Çağan 5.000, Burak 10.000 (Oğuz, 3 Eyl 2026)')
  bekle(BENERITS_BAHSIS_MAX === Math.max(...Object.values(g).map(x => x.bahsis)), 'BAHSIS_MAX = en yüksek sabit bahşiş')
  // Kenney boya karesi her modelde tanımlı (cam/lastik boyanmaz, gövde boyanır)
  const paint = cars_ts.match(/export const KENNEY_PAINT[^=]*=\s*\{([^}]*\}[^}]*\}[^}]*\}[^}]*)\}/)?.[1] ?? ''
  for (const m of ['sedan', 'van', 'race-future']) bekle(paint.includes(m), `Kenney boya karesi tanımlı: ${m}`)
}

console.log('── ZAR: nadir, aralıklı, koşullu ──')
{
  const s = new GameState()
  s.money = 1_000_000 // işler iyi: normal şans
  s.day = 1
  bekle(s.beneritsRoll(true, 0) === null, `gün < ${BENERITS_ILK_GUN}: gelmez`)
  s.day = BENERITS_ILK_GUN
  bekle(s.beneritsRoll(true, BENERITS_SANS) === null, 'zar şansın üstünde: gelmez')
  const g1 = s.beneritsRoll(true, 0)
  bekle(!!g1, `gün ${BENERITS_ILK_GUN} + şanslı zar: misafir gelir`, g1?.name)
  bekle(s.benerits.lastDay === s.day, 'doğumda lastDay damgalanır (aynı gün ikinci gelmez)')
  bekle(s.beneritsRoll(true, 0) === null, 'aynı gün tekrar: gelmez')
  if (BENERITS_ARA_GUN > 1) {
    s.day += BENERITS_ARA_GUN - 1
    bekle(s.beneritsRoll(true, 0) === null, `ara ${BENERITS_ARA_GUN} günden az: gelmez`)
  }
  s.day += 1
  bekle(!!s.beneritsRoll(true, 0), `ara ${BENERITS_ARA_GUN} gün dolunca (ertesi gün) gelir`)
  // şarj yokken PATRON gelmez
  const s2 = new GameState(); s2.day = 10
  let patron = 0, top = 0
  for (let i = 0; i < 300; i++) { s2.benerits.lastDay = -99; s2.benerits.seen = []; const g = s2.beneritsRoll(false, 0); top++; if (g?.id === 'burak') patron++ }
  bekle(top === 300 && patron === 0, 'şarj ünitesi yokken Patron hiç gelmez (yakıtlı ikili gelir)')
  let evli = 0
  for (let i = 0; i < 300; i++) { s2.benerits.lastDay = -99; s2.benerits.seen = []; if (s2.beneritsRoll(true, 0)?.id === 'burak') evli++ }
  bekle(evli > 0, 'şarj varken Patron da gelir', `${evli}/300`)
  // tanışma önceliği: görülmemiş misafir önce
  const s3 = new GameState(); s3.day = 10; s3.benerits.seen = ['oguz', 'cagan']
  bekle(s3.beneritsRoll(true, 0)?.id === 'burak', 'görülmemiş misafir öncelikli (Oğuz+Çağan görüldü → Burak)')
  // marina: araba yok
  const s4 = new GameState(); s4.day = 10
  const isMarinaDesc = Object.getOwnPropertyDescriptor(GameState.prototype, 'isMarina')
  if (isMarinaDesc?.get) {
    Object.defineProperty(s4, 'isMarina', { value: true, configurable: true })
    bekle(s4.beneritsRoll(true, 0) === null, 'marinada BENERITS aracı doğmaz')
  } else bekle(state_ts.includes('if (this.isMarina) return null'), 'marinada BENERITS aracı doğmaz (kod)')
  // sıklık: gün ~65 araç → beklenen ziyaret/uygun gün < 1.5 (çok sık değil) ve > 0.3 (arada bir)
  // kullanıcı isteği (3 Eyl 2026): "her gün %50 ihtimalle biri gelsin" → P(en az bir) ≈ 0,45–0,55
  const pGun = 1 - Math.pow(1 - BENERITS_SANS, 65)
  bekle(pGun > 0.45 && pGun < 0.55, 'sıklık: günde ~%50 ihtimalle bir misafir', `P=${pGun.toFixed(3)}, ara ${BENERITS_ARA_GUN} gün`)
  bekle(BENERITS_ARA_GUN === 1, 'günde en fazla bir misafir; ertesi gün yine gelebilir')
}

console.log('── BAHŞİŞ ve DEFTER ──')
{
  const s = new GameState()
  bekle(s.beneritsBahsis(BENERITS_GUESTS.oguz) === 5000 && s.beneritsBahsis(BENERITS_GUESTS.burak) === 10000, 'beneritsBahsis misafirin sabit bahşişini verir')
  // "işler kötü" → daha sık: kasa dar ya da son kapanan gün zararda
  s.money = 1_000_000; s.salesLog = []
  bekle(!s.beneritsIslerKotu, 'işler iyi: kasa dolu, gün kaydı yok')
  s.money = BENERITS_DAR_KASA
  bekle(s.beneritsIslerKotu, 'kasa dar → işler kötü')
  s.money = 1_000_000; s.salesLog = [{ day: 3, rev: 900, profit: -250 }, { day: 4, rev: 300 }]
  bekle(s.beneritsIslerKotu, 'son gün-sonu kaydı zararda → işler kötü (sonraki satış satırı profit taşımaz, atlanır)')
  s.salesLog.push({ day: 4, rev: 2000, profit: 400 })
  bekle(!s.beneritsIslerKotu, 'son gün kârda → işler iyi')
  {
    const pIyi = 1 - Math.pow(1 - BENERITS_SANS, 65), pDar = 1 - Math.pow(1 - BENERITS_SANS_DAR, 65)
    bekle(pDar > 0.85 && pDar > pIyi * 1.6, 'işler kötüyken günlük ihtimal ~%90 (en az 1,6×)', `iyi ${pIyi.toFixed(2)} → dar ${pDar.toFixed(2)}`)
    const z = new GameState(); z.day = 10; z.money = 1_000_000
    bekle(z.beneritsRoll(true, BENERITS_SANS + 0.001) === null, 'işler iyiyken normal şans')
    z.money = 0
    bekle(!!z.beneritsRoll(true, BENERITS_SANS + 0.001), 'işler kötüyken yüksek şans devrede')
  }
  const para0 = s.money, ciro0 = s.stats.revenue
  s.beneritsBahsisAl(10000)
  bekle(s.money === para0 + 10000 && s.stats.revenue === ciro0 + 10000 && s.benerits.tips === 10000, 'beneritsBahsisAl: kasa + ciro + defter')
  const ev0 = s.events.length
  s.beneritsGeldi(BENERITS_GUESTS.oguz)
  bekle(s.benerits.visits === 1 && s.benerits.seen.includes('oguz') && s.events.length === ev0, 'beneritsGeldi: ziyaret + seen (events\'e yazmaz → tek toast)')
  s.beneritsGeldi(BENERITS_GUESTS.oguz)
  bekle(s.benerits.visits === 2 && s.benerits.seen.length === 1, 'aynı misafir ikinci gelişte seen tekrarlanmaz')
  // anti-cheat: bahşiş sunucu kovasının çok altında
  const burst = Number(index_js.match(/ALLOW_BURST\s*=\s*([\d_]+)/)?.[1]?.replace(/_/g, '') ?? 0)
  bekle(burst >= 100_000 && BENERITS_BAHSIS_MAX * 3 < burst, 'anti-cheat: 3 bahşiş bile kova tavanının altında', `kova ${burst}`)
}

console.log('── KAYIT (additive) ──')
{
  const s = new GameState()
  s.benerits = { visits: 4, tips: 36_000, lastDay: 12, seen: ['oguz', 'burak'] }
  const data = serializeState(s)
  bekle('benerits' in data, "'benerits' SAVE_FIELDS'ta")
  const s2 = new GameState(); hydrateState(s2, JSON.parse(JSON.stringify(data)))
  bekle(s2.benerits.visits === 4 && s2.benerits.tips === 36_000 && s2.benerits.lastDay === 12 && s2.benerits.seen.join() === 'oguz,burak', 'kayıt → geri yükleme birebir')
  const s3 = new GameState(); hydrateState(s3, { money: 5 })
  bekle(s3.benerits.visits === 0 && s3.benerits.lastDay === -99 && s3.benerits.seen.length === 0, 'eski kayıt (alan yok): sıfır defter, ilk ziyaret bekletilmez')
  const s4 = new GameState(); hydrateState(s4, { benerits: { visits: -3, tips: 'x', lastDay: NaN, seen: ['oguz', 'hacker', 7] } })
  bekle(s4.benerits.visits === 0 && s4.benerits.tips === 0 && s4.benerits.lastDay === -99 && s4.benerits.seen.join() === 'oguz', 'kurcalanmış kayıt temizlenir')
}

console.log('── BAŞARIMLAR ──')
{
  bekle(/\['benerits-patron'/.test(state_ts) && /\['benerits-ekip'/.test(state_ts), 'benerits-patron / benerits-ekip başarımları tanımlı')
  const s = new GameState()
  s.benerits.seen = ['burak']
  st.checkAchievements(s)
  bekle(s.achievements.has('benerits-patron'), 'Burak görülünce benerits-patron açılır')
  bekle(!s.achievements.has('benerits-ekip'), 'tek misafirle benerits-ekip açılmaz')
  s.benerits.seen = ['burak', 'oguz', 'cagan']; st.checkAchievements(s)
  bekle(s.achievements.has('benerits-ekip'), 'üçü görülünce benerits-ekip açılır')
}

console.log('── ARAÇ (cars.ts) ──')
{
  bekle(/guest: BeneritsGuest \| null = null\) \{/.test(cars_ts), 'Car constructor guest parametresi')
  bekle(/this\.demandAmount = Math\.round\(this\.demandAmount \* BENERITS_TALEP_KAT \/ 10\) \* 10/.test(cars_ts), 'yakıt talebi ×KAT (yuvarlı)')
  bekle(/this\.demandKwh = Math\.min\(100, this\.demandKwh \* BENERITS_TALEP_KAT\)/.test(cars_ts), 'kWh talebi ×KAT, tavan 100 (EQE)')
  bekle(/if \(guest\) \{[\s\S]{0,500}this\.wantsFull = false/.test(cars_ts), 'misafir FULLE istemez (tutar sabit ve büyük)')
  bekle(/if \(guest\) \{[\s\S]{0,500}this\.maxPatience \*= 1\.5/.test(cars_ts), 'misafir sabrı bol (tanıdık)')
  bekle(/repaintKenney\(this\.group, guest\.model, guest\.color\)/.test(cars_ts), 'Kenney modeli misafir rengine boyanır')
  bekle(/buildCarMesh\(guest\.model === 'van' \? 'suv' : 'sedan', guest\.color\)/.test(cars_ts), 'kit yoksa prosedürel gövde (renkli)')
  bekle(/textSprite\([^)]*BENERITS[^)]*,\s*BENERITS_TURUNCU, BENERITS_ROZET_ZEMIN\)/.test(cars_ts), 'BENERITS etiketi marka turuncusu (Oğuz: "benerits turuncusu olsun")')
  // ÇAKIŞMA REGRESYONU (Oğuz, 3 Eyl 2026): rozet, sayaç balonunun tepesinden (2.85 + 0.98/2 = 3.34) yukarıda olmalı
  {
    const balonZ = Number(/this\.bubble\.position\.z = ([\d.]+)/.exec(cars_ts)?.[1]), balonH = 0.98
    const rozet = /const et = textSprite\([\s\S]*?et\.scale\.set\([\d.]+, ([\d.]+), 1\)[\s\S]*?et\.position\.z = ([\d.]+)/.exec(cars_ts)
    const rozetH = Number(rozet?.[1]), rozetZ = Number(rozet?.[2])
    bekle(rozetZ - rozetH / 2 > balonZ + balonH / 2, 'BENERITS rozeti "MOLADA · PATRON" balonuyla çakışmaz', `rozet alt ${(rozetZ - rozetH / 2).toFixed(2)} > balon tepe ${(balonZ + balonH / 2).toFixed(2)}`)
  }
  bekle(/this\.feedback\.position\.z = this\.bubble \? 4\.6 : 2\.6/.test(cars_ts), 'satış emojisi molada sayacın üstüne çıkar (çakışmaz)')
  bekle(/liveSprite\(`⚡ \$\{this\.demandKwh\} kWh`, this\.guest \? BENERITS_TURUNCU/.test(cars_ts) && /const accent = this\.guest \? BENERITS_TURUNCU/.test(cars_ts), 'misafir sayaç balonu da turuncu')
  bekle(/const guest = force\?\.guest \?\? \(lane === 'near' && !boat && !force[\s\S]{0,200}beneritsGuest\?\.\(this\.stationHasEquipmentFor\('ev', 'near'\)\)/.test(cars_ts), 'spawnTransit: yalnız yakın şerit, tekne/premium yok, şarj varlığı zara verilir (zorla çağrı __dbg.benerits)')
  bekle(/spawnBenerits\(guest: BeneritsGuest\): boolean \{[\s\S]{0,300}stationHasEquipmentFor\(guest\.kind, 'near'\)/.test(cars_ts), 'zorla çağrı: ekipman yoksa (şarjsız Patron) false')
  bekle(/if \(car\.vip \|\| force\?\.premium \|\| car\.guest\) car\.wantsEnter = true/.test(cars_ts), 'misafir yoldan geçip gitmez (giriş zorunlu)')
  bekle(/const vipOl = !boat && !guest &&/.test(cars_ts), 'misafir aynı anda VIP olmaz (etiket çakışması yok)')
  bekle(/if \(car\.guest\) this\.opts\.onBenerits\?\.\(car\)/.test(cars_ts), 'yuvaya oturunca onBenerits tetiklenir')
  // boya: yalnız kartela karesi değişir, cam/lastik dokunulmaz (flipY glTF ile aynı)
  bekle(/ctx\.fillRect\(x, y, 64, 128\)/.test(cars_ts) && /tex\.flipY = false/.test(cars_ts), 'repaintKenney: 64×128 boya karesi + flipY=false')
}

console.log('── OYUN AKIŞI (main.ts) ──')
{
  bekle(/beneritsGuest: evOk => state\.beneritsRoll\(evOk\)/.test(main_ts), 'CarManager zarı state.beneritsRoll')
  bekle(/onBenerits: car => \{[\s\S]{0,700}notifyIfHidden\(t\('BENERITS \{0\} geldi!'/.test(main_ts), 'varışta bildirim ("BENERITS Oğuz geldi!")')
  bekle(/onBenerits: car => \{[\s\S]{0,700}ui\.toast\(msg, 'good', false, true\)/.test(main_ts), 'varış toast\'ı ÖNEMLİ (kaçırılmaz)')
  bekle(/onBenerits: car => \{[\s\S]{0,700}audio\.promo\(\)/.test(main_ts), 'varışta ses')
  // finishSale bahşişi
  const fs = main_ts.slice(main_ts.indexOf('function finishSale('), main_ts.indexOf('function wrongFuel('))
  bekle(/if \(car\.guest && revenue0 > 0\) \{/.test(fs), 'finishSale: misafir bahşiş bloğu')
  bekle(/if \(car\.guest && revenue0 > 0\) \{\s*const tip = state\.beneritsBahsis\(car\.guest\)/.test(fs) && !fs.includes('Depo yarım kaldı'), 'her tamamlanan satışta sabit bahşiş (yarım depo cezası yok)')
  bekle(/revenue \+= tip\s*\n\s*state\.benerits\.tips \+= tip/.test(fs), 'bahşiş revenue\'ya biner (tek kapı) + deftere yazılır')
  bekle(/car\.guest\.quote\), 'good', false, true\)/.test(fs), 'bahşiş toast\'ında replik, ÖNEMLİ')
  // EV / Patron
  const ev = main_ts.slice(main_ts.indexOf('function tickEvCharging('), main_ts.indexOf('// ---- Sipariş, inşaat, bakım ----'))
  bekle(/if \(c\.guest\) \{[\s\S]{0,900}state\.beneritsBahsisAl\(tip\)/.test(ev), 'Patron şarj bitince bahşiş')
  bekle(/if \(c\.guest\) \{[\s\S]{0,900}c\.squatting = true/.test(ev), 'Patron şarj bitince ZORUNLU mola')
  bekle(/c\.setCounter\(t\('MOLADA · PATRON'\)\)/.test(ev), 'sayaçta "MOLADA · PATRON"')
  bekle(/const limit = c\.guest \? \(c\.guest\.molaSn \?\? 45\) : hasStaff \? 8/.test(ev), 'personel/müdür Patron\'u uğurlamaz; molaSn sonra kendi gider')
  bekle(/c\.guest \? t\('BENERITS \{0\} gitti — "Gene gelirim\." Ünite boşaldı\.'/.test(ev), 'mola bitince "gitti" toast\'ı')
  const od = main_ts.slice(main_ts.indexOf('ui.onDismiss = car => {'), main_ts.indexOf('ui.onDismiss = car => {') + 600)
  bekle(/if \(car\.squatting && car\.guest\) \{\s*\n\s*ui\.toast\(t\('PATRON gönderilemez — "\{0\}"', car\.guest\.quote\), 'bad'\)\s*\n\s*return/.test(od), 'GÖNDER: "PATRON gönderilemez — Beş dakikaya çıkıyorum kardeşim."')
  bekle(od.indexOf('car.squatting && car.guest') < od.indexOf('if (car.squatting) {'), 'Patron kapısı genel molacı kapısından ÖNCE')
  bekle(/if \(car\.guest\) ui\.toast\(t\('BENERITS \{0\} beklemekten sıkılıp gitti/.test(main_ts), 'sabrı biten misafir için özel toast')
}

console.log('── i18n ──')
{
  const i18n = oku('src/i18n.ts')
  for (const k of ['BENERITS {0} geldi!', 'PATRON gönderilemez — "{0}"', 'MOLADA · PATRON', 'BENERITS PATRON bahşiş bıraktı: +₺{0}'])
    bekle(i18n.split(`'${k}'`).length - 1 >= 2, `EN+FR çevirisi var: ${k}`)
}

console.log(`\nSONUÇ: ${hata === 0 ? 'hepsi geçti' : hata + ' hata'}`)
process.exit(hata ? 1 : 0)
