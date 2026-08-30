/**
 * GERİLİM TESTİ — "zamana karşı yarış hissi yok" geri bildirimi (Oğuz, 30 Ağu).
 *
 * TEŞHİS (koddan ölçüldü, tahmin değil):
 *   · cars.ts sabır çubuğunu HER KAREDE gizliyordu ("sabır mekaniği görünmez işler")
 *     → geri sayım dönüyor ama oyuncu müşteriyi ancak KAYBEDİNCE fark ediyordu.
 *   · main.ts emojiFor() dört dalın DÖRDÜNDE de boş string döndürüyordu (ilk POC
 *     commit'inden beri) → servis memnuniyeti hiç görünmemiş.
 *   · carsPassThrough VARSAYILAN true idi → "araçlar iç içe geçiyor" şikâyeti.
 *
 * Bu test hem kodu hem ÇALIŞAN OYUNU denetler: sahnede gerçekten sabır çubuğu
 * beliriyor mu, duygu yüzü çıkıyor mu, çarpışma açık mı.
 *
 * Kullanım: npm run dev -- --port 5311  →  npx tsx tools/tests/gerilim-check.mjs
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const cars = oku('src/cars.ts'), main = oku('src/main.ts'), state = oku('src/state.ts'), audio = oku('src/audio.ts')

console.log('── KOD DENETİMİ ──')

// ── Faz 1: gerilim görünür mü ──
bekle(!/^\s*this\.patienceBg\.visible = false\s*$[\s\S]{0,60}^\s*this\.patienceFill\.visible = false\s*$/m.test(
  cars.slice(cars.indexOf('this.patience -= dt'), cars.indexOf('this.patience -= dt') + 400)),
  'sabır çubuğunu koşulsuz gizleyen eski kod kaldırılmış')
bekle(/this\.patienceBg\.visible = goster/.test(cars), 'çubuk görünürlüğü sabır oranına bağlı')
bekle(/export const SABIR_GOSTER = /.test(cars), 'gösterim eşiği tek sabitten geliyor')
bekle(/function moodEmoji\(frac: number\)/.test(cars), 'kademeli duygu fonksiyonu var')
for (const e of ['😐', '😠', '😡']) bekle(cars.includes(e), `duygu kademesi ${e} tanımlı`)

const ef = main.match(/function emojiFor\(score: number\): string \{\s*return ([^\n]+)/)
bekle(!!ef, 'emojiFor bulundu')
const bosDal = ef && /\?\s*''\s*:/.test(ef[1])
bekle(!bosDal, 'emojiFor artık BOŞ STRING döndürmüyor (POC\'tan beri açık olan hata)')
bekle(!!ef && /🤩|😄|🙂|😒/.test(ef[1]), 'servis sonu emojileri gerçek', ef?.[1]?.slice(0, 46))

bekle(/showLoss\(text: string\)/.test(cars), 'kayıp yazısı (−₺X) API\'si var')
bekle(/car\.showLoss\(`−₺\$\{/.test(main), 'kaçan müşteri gerçek parayla gösteriliyor')
bekle(/function ekranFlasi\(\)/.test(main), 'ekran flaşı efekti var')
bekle(/prefers-reduced-motion/.test(main), 'flaş, hareket azaltma tercihine saygı duyuyor')
bekle(/'sawtooth'/.test(audio), 'kaçış sesi sertleştirildi (eskiden duyulmayan iki sinüs)')

// ── emoji dokusu önbelleği: kademeli duygu sık sık sprite üretiyor ──
bekle(/const EMOJI_TEX = new Map<string, THREE\.Texture>/.test(cars),
  'emoji dokuları önbellekli (her kademede yeni GPU dokusu yüklenmiyor)')
bekle(/this\.feedbackTex\.dispose\(\)/.test(cars), 'tek kullanımlık kayıp dokusu serbest bırakılıyor')

// ── Faz 2: baskı tırmanıyor mu ──
const mp = cars.match(/this\.maxPatience = \(kind === 'ev' \? (\d+) : (\d+)\) \* patienceMult/)
bekle(!!mp, 'sabır tabanı çarpanla hesaplanıyor')
bekle(!!mp && Number(mp[2]) < 75, `yakıt sabrı düşürüldü (75 → ${mp?.[2]} sn)`)
bekle(/patienceMult\(\): number/.test(state), 'yeni oyuncu koruması var (ilk günler daha sabırlı)')
bekle(/this\.day <= 2 \? 1\.6/.test(state), 'gün ≤2 için ×1.6 sabır')
bekle(/c\.sabirHizi = kuyrukCarpani/.test(cars), 'sabır hızı kuyruk kalabalığına bağlı')
bekle(/patienceFrac < SABIR_KIRMIZI \? 1\.4 : 1/.test(cars), 'son dilimde sabır hızlanıyor')
bekle(/get rushHour\(\): boolean/.test(state), 'doğal yoğun saat tanımlı')
bekle(/state\.rushHour \? 1\.8 : 1/.test(main), 'yoğun saatte trafik artıyor')
bekle(/state\.hourOfDay = hTot/.test(main), 'oyun saati state\'e yazılıyor')
bekle(/onTurnedAway\?\.\(\)/.test(cars), 'kuyruk dolu → giremeyen müşteri ayrı sayılıyor')

// ── Faz 3: ödül ritmi ──
bekle(/comboMult\(\): number/.test(state), 'seri çarpanı var')
bekle(/function comboIlerlet/.test(main), 'seri ilerletme var')
bekle(/state\.combo = 0/.test(main), 'kaçan müşteri seriyi kırıyor')
bekle(/combo\(seri: number\)/.test(audio), 'seri kademesinde ses var')
bekle(/Kaçırdığın müşteri/.test(main), 'gün sonu raporunda kayıp satırı var')
bekle(/state\.dayLostCount = 0/.test(main), 'günlük kayıp sayacı gün dönüşünde sıfırlanıyor')

// ── Faz 4: fizik ──
bekle(/carsPassThrough: \(\) => new URLSearchParams\(location\.search\)\.has\('nocollide'\)/.test(main),
  'çarpışma VARSAYILAN açık (eskiden yalnız ?collide ile açılıyordu)')

// ── SAVE UYUMLULUĞU: eski kayıtlar bozulmamalı ──
console.log('\n── SAVE UYUMLULUĞU ──')
bekle(/'dayLostCount', 'dayLostMoney'/.test(state), 'yeni günlük sayaçlar SAVE_FIELDS\'ta')
bekle(/'lostMoney', 'turnedAway'/.test(state), 'yeni istatistikler geri yükleme listesinde')
bekle(/if \(f in data\) \(s as any\)\[f\] = data\[f\]/.test(state),
  'kayıt geri yükleme "alan varsa" korumalı — eski kayıtta yeni alan yoksa varsayılan kalır')
bekle(!/'combo'/.test(state.match(/const SAVE_FIELDS = \[[\s\S]*?\] as const/)?.[0] ?? ''),
  'seri KAYDA GİRMİYOR (oturum içi ritim aracı — F5\'te sıfırlanmalı)')

// eski kayıt gerçekten yükleniyor mu: yeni alanları OLMAYAN bir kayıt
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, hydrateState, serializeState } = await import('../../src/state.ts')
const eski = { money: 123456, day: 40, reputation: 4.2, pumps: 6, stats: { served: 900, lost: 12, kwh: 5, revenue: 77 } }
const s2 = new GameState()
hydrateState(s2, eski)
bekle(s2.money === 123456 && s2.day === 40, 'yeni alanları olmayan ESKİ kayıt sorunsuz yükleniyor')
bekle(s2.stats.lostMoney === 0 && s2.stats.turnedAway === 0, 'eksik yeni sayaçlar 0\'a düşüyor (NaN değil)')
bekle(s2.dayLostCount === 0 && s2.dayLostMoney === 0, 'eksik günlük sayaçlar 0')
bekle(s2.stats.lost === 12 && s2.stats.served === 900, 'eski istatistikler korunuyor')
const tekrar = serializeState(s2)
bekle(typeof tekrar.dayLostCount === 'number', 'yeni alanlar tekrar kaydediliyor')
bekle(Number.isFinite(s2.comboMult()) && s2.comboMult() === 1, 'seri çarpanı temiz kayıtta nötr (×1)')

// çarpan kademeleri
s2.combo = 3; bekle(s2.comboMult() === 1.1, 'seri 3 → ×1.10')
s2.combo = 6; bekle(s2.comboMult() === 1.25, 'seri 6 → ×1.25')
s2.combo = 12; bekle(s2.comboMult() === 1.5, 'seri 12 → ×1.50')

// yoğun saat pencereleri
s2.hourOfDay = 8; bekle(s2.rushHour === true, 'saat 08 yoğun')
s2.hourOfDay = 18; bekle(s2.rushHour === true, 'saat 18 yoğun')
s2.hourOfDay = 13; bekle(s2.rushHour === false, 'saat 13 normal')

// ── ÇALIŞAN OYUN ──
console.log('\n── ÇALIŞAN OYUN ──')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const konsolHata = []
p.on('pageerror', e => konsolHata.push(String(e).slice(0, 160)))
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(10000)
// MİSAFİR KAPISINI GEÇ ve GEÇTİĞİNİ DOĞRULA: kapı arkasında entryChance 0 döner,
// yani hiçbir araç istasyona girmez ve sabır hiç düşmez. Bu sessiz kurulum hatası
// "gerilim yok" gibi görünüyordu — artık test kapıyı geçemezse HATA verir.
for (let deneme = 0; deneme < 8; deneme++) {
  const gecti = await p.evaluate(() => {
    if (window.__dbg?.cars?.opts?.entryChance?.() > 0) return true
    document.getElementById('gguest')?.click()
    return false
  })
  if (gecti) break
  await p.waitForTimeout(1500)
}
bekle(await p.evaluate(() => (window.__dbg?.cars?.opts?.entryChance?.() ?? 0) > 0),
  'misafir kapısı geçildi (oyun donuk değil)')
// OYUNCU SERVİS ETMİYOR: ?full=1 vitrin modunda pompacı her müşteriyi anında servis
// ediyor → kimse beklemiyor, sabır hiç düşmüyordu. Otomatik personeli kapatınca
// müşteri pompada oyuncuyu bekler ve gerilim gözlemlenebilir hale gelir.
// (staffLevel'a DOKUNULMUYOR — o servis hızı, giriş kararı değil.)
await p.evaluate(() => {
  const st = window.__dbg.state
  st.autoPumps.clear(); st.autoChargers.clear()
  st.day = 10           // grace penceresini kapat: sabır tam 45 sn olsun
})

// PERİYODİK ÖRNEKLEME: tek bir ana bakmak kırılgan (araçlar gelir gider). 90 saniye
// boyunca 3 sn'de bir ölçüp huzursuzluğun GÖRÜLDÜĞÜ en iyi anı saklıyoruz.
let enIyi = { cubuk: 0, yuz: 0, enDusukFrac: 1, bekleyen: 0, girenToplam: 0 }
for (let i = 0; i < 30; i++) {
  // MİSAFİR KAPISI GERİ AÇILIYOR: para/gün eşiğine gelince maybeGuestGate() gate'i
  // yeniden gösterip guestPaused'u true yapıyor → oyun donuyor, entryChance 0 oluyor.
  // Vitrin modunda kasa yüksek olduğu için bu sürekli tetikleniyor; her turda geçiyoruz.
  await p.evaluate(() => {
    if ((window.__dbg?.cars?.opts?.entryChance?.() ?? 0) === 0) document.getElementById('gguest')?.click()
  })
  const o = await p.evaluate(() => {
    const liste = window.__dbg.cars.cars ?? []
    let cubuk = 0, yuz = 0, enDusukFrac = 1, bekleyen = 0
    for (const c of liste) {
      if ((c.phase === 'waiting' || c.phase === 'atPump') && !c.beingServed) {
        bekleyen++; enDusukFrac = Math.min(enDusukFrac, c.patienceFrac)
      }
      for (const ch of c.group.children) {
        if (!ch.isSprite || !ch.visible) continue
        if (ch.scale.y < 0.3) cubuk++                       // ince çubuk sprite'ı
        else if (ch.scale.x > 0.9 && ch.scale.x < 1.0) yuz++ // duygu yüzü (0.95)
      }
    }
    const st = window.__dbg.state
    return { cubuk, yuz, enDusukFrac, bekleyen,
             girenToplam: liste.filter(c => c.phase !== 'transit').length }
  })
  if (o.cubuk > enIyi.cubuk) enIyi = { ...enIyi, cubuk: o.cubuk, yuz: o.yuz }
  if (o.yuz > enIyi.yuz) enIyi.yuz = o.yuz
  enIyi.enDusukFrac = Math.min(enIyi.enDusukFrac, o.enDusukFrac)
  enIyi.bekleyen = Math.max(enIyi.bekleyen, o.bekleyen)
  enIyi.girenToplam = Math.max(enIyi.girenToplam, o.girenToplam)
  await p.waitForTimeout(3000)
}
const son = await p.evaluate(() => {
  const st = window.__dbg.state
  return { kayip: st.stats.lost, kayipPara: Math.round(st.stats.lostMoney),
           giremeyen: st.stats.turnedAway, gunKayip: st.dayLostCount }
})
console.log('  ', JSON.stringify({ ...enIyi, ...son }))
bekle(enIyi.girenToplam > 0, 'müşteriler istasyona giriyor', `${enIyi.girenToplam} araç içeride`)
bekle(enIyi.bekleyen > 0, 'servis bekleyen müşteri oluştu', `${enIyi.bekleyen} bekleyen`)
bekle(enIyi.enDusukFrac < 0.65, 'sabır huzursuzluk eşiğinin ALTINA indi',
  `en düşük %${Math.round(enIyi.enDusukFrac * 100)}`)
bekle(enIyi.cubuk > 0, 'sabır çubuğu sahnede GÖRÜNDÜ', `${enIyi.cubuk} çubuk parçası`)
bekle(enIyi.yuz > 0, 'duygu yüzü sahnede GÖRÜNDÜ', `${enIyi.yuz} yüz`)
bekle(son.kayip === 0 || son.kayipPara > 0, 'kayıp varsa parasal karşılığı işleniyor',
  `${son.kayip} kayıp / ₺${son.kayipPara} / günlük ${son.gunKayip}`)
bekle(konsolHata.length === 0, 'konsolda hata yok', konsolHata[0] ?? '')
await b.close()

console.log(hata ? `\n${hata} HATA` : '\nGERİLİM SİSTEMİ TEMİZ')
process.exit(hata ? 1 : 0)
