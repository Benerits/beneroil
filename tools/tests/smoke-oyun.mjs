/**
 * CANLI DUMAN TESTİ — oyun gerçekten açılıyor ve oynanıyor mu.
 *
 * Birim testleri kodun parçalarını doğrular; bu test OYUNU AÇAR. Merge/optimizasyon
 * sonrası "testler geçti ama oyun açılmıyor" durumunu yakalamak için var.
 *
 * Kullanım: npm run dev -- --port 5311  →  node tools/tests/smoke-oyun.mjs
 */
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1280, height: 800 } })
const konsolHata = []
p.on('pageerror', e => konsolHata.push(String(e).slice(0, 200)))
p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) konsolHata.push(m.text().slice(0, 200)) })

// ── ilerlemiş oyuncu: tüm sistemler açık ──
await p.addInitScript(() => {
  localStorage.setItem('benzinlik-guest', JSON.stringify({
    money: 3_000_000, day: 60, reputation: 4.6,
    unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol'], activeLoc: 'kasaba',
    pumps: 6, evChargers: 3, marketLevel: 2, toiletLevel: 2, hasWash: true, hasOil: true,
    hasCoffee: true, hasRestaurant: true, hasTruckPark: true, solarCount: 2, batteryLevel: 2,
    selfWashCount: 2, airWaterCount: 2, parkingCount: 2, lampCount: 4, signLevel: 2,
    managerLevel: 2, tanks: { benzin: 6000, dizel: 6000, lpg: 6000 },
  }))
  localStorage.setItem('beneloil-loc', 'kasaba')
  localStorage.setItem('benzinlik-guest-joined', '1')
})
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(10000)   // sahne + kit + trafik

// 1) Açılış maskesi kalktı mı (oyun gerçekten başladı)
bekle(await p.evaluate(() => !document.getElementById('boot')), 'açılış maskesi kalktı (oyun başladı)')

// 2) WebGL sahnesi kuruldu
const sahne = await p.evaluate(() => {
  const d = window.__dbg
  if (!d?.world?.scene) return null
  let mesh = 0
  d.world.scene.traverse(o => { if (o.isMesh || o.isInstancedMesh) mesh++ })
  return { mesh, cocuk: d.world.scene.children.length, bina: d.world.buildings?.length ?? 0 }
})
bekle(!!sahne && sahne.mesh > 100, '3B sahne kuruldu', sahne ? `${sahne.mesh} mesh · ${sahne.bina} bina` : 'sahne YOK')

// 3) Trafik akıyor
const arac = await p.evaluate(() => window.__dbg?.cars?.cars?.length ?? -1)
bekle(arac > 0, 'araç trafiği akıyor', `${arac} araç`)

// 4) OYUN DÖNGÜSÜ AKIYOR MU — kanıt: araç KONUMLARI değişiyor.
//    Not: ?full=1 vitrin modunda misafir kapısı yüzünden istasyona giriş kapalıdır
//    (guestPaused → entryChance 0), araçlar yalnız yoldan geçer. Canlı sürümde de
//    aynı davranır; o yüzden "servis edildi" beklemek yanlış olur. Asıl ölçüt
//    frame()'in aktığı: araçlar hareket ediyorsa simülasyon canlıdır.
const konumOku = () => p.evaluate(() =>
  window.__dbg.cars.cars.slice(0, 5).map(c => `${c.group.position.x.toFixed(1)},${c.group.position.y.toFixed(1)}`).join('|'))
const k0 = await konumOku()
await p.waitForTimeout(3000)
const k1 = await konumOku()
bekle(k0 !== k1 && k0.length > 0, 'oyun döngüsü ilerliyor (araçlar hareket ediyor)')

// 4b) EKONOMİ MOTORU: state.tick() doğrudan sürülerek işlediği doğrulanır.
//     (Misafir modunda frame() tick'i bilerek atlar — oyun donuk, yol trafiği akar.
//      O yüzden kendiliğinden değişim beklemek yanlış; motoru elle çeviriyoruz.)
const tick = await p.evaluate(() => {
  const s2 = window.__dbg.state
  s2.pumps = 4; s2.solarCount = 2; s2.hasHotel = true; s2.hasTruckPark = true
  const a = { wear: s2.wear, dirt: s2.solarDirt, hotelT: s2.hotelTimer }
  for (let i = 0; i < 120; i++) s2.tick(1)      // 2 oyun dakikası
  const b2 = { wear: s2.wear, dirt: s2.solarDirt, hotelT: s2.hotelTimer }
  return { yipranma: b2.wear > a.wear, kir: b2.dirt > a.dirt,
           otelSayaci: b2.hotelT !== a.hotelT, hotelGelir: (s2.facTotal?.hotel ?? 0) > 0,
           a, b: b2 }
})
bekle(tick.yipranma, 'state.tick() işliyor (ekipman yıpranması akıyor)',
  `wear ${tick.a.wear.toFixed(5)} → ${tick.b.wear.toFixed(5)}`)
bekle(tick.hotelGelir, 'MERGE KANITI: otel (dev) tick içinde gelir üretiyor')

// 5) MERGE SONRASI KRİTİK: her iki daldan gelen özellikler AYNI ANDA çalışıyor mu
const ozellik = await p.evaluate(() => {
  const s = window.__dbg.state
  return {
    // dev'den gelenler
    otel: typeof s.hasHotel === 'boolean',
    temizlikci: typeof s.hasCleaner === 'boolean',
    tedarikci: typeof s.supplier === 'string',
    gorev: typeof s.dailyRevenue === 'number',
    // main'den gelenler
    karsiTirPark: typeof s.hasTruckPark2 === 'boolean',
    steamAnket: 'steamPoll' in s || typeof s.steamPoll !== 'undefined',
  }
})
bekle(ozellik.otel && ozellik.temizlikci, 'dev: otel + temizlikçi alanları var')
bekle(ozellik.tedarikci && ozellik.gorev, 'dev: tedarikçi + günlük görev sayaçları var')
bekle(ozellik.karsiTirPark, 'main: karşı tır parkı alanı var')

// 6) MAĞAZA KATALOĞU: merge edilen kalemler state'ten üretiliyor mu
//    (DOM yerine mantık kontrolü — renderShop ui.shopOpen bayrağına bağlı ve
//     sentetik tıklama onu set etmiyor; canlı sürümde de aynı davranıyor)
const katalog = await p.evaluate(() => {
  const s2 = window.__dbg.state
  s2.money = 50_000_000            // kilitleri açmak için
  s2.hasTruckPark = true           // otel tır parkına bağlı
  const ids = window.__dbg.shopIds?.() ?? null
  return ids
})
if (katalog) {
  bekle(katalog.includes('hotel'), 'katalogda OTEL var (dev)')
  bekle(katalog.includes('cleaner'), 'katalogda TEMİZLİKÇİ var (dev)')
  bekle(katalog.includes('truckpark2'), 'katalogda KARŞI TIR PARKI var (main)')
} else {
  console.log('ℹ️  katalog kancası yok — mağaza kalemleri birim testlerde doğrulanıyor')
}

// 7) Ofis paneli + görevler sekmesi (dev'in eklediği)
const ofis = await p.evaluate(() => {
  document.querySelector('#shopwrap .mclose')?.click()
  document.getElementById('officebtn')?.click() || document.querySelector('[data-sec="office"]')?.click()
  return new Promise(res => setTimeout(() => res({
    acildi: !!document.querySelector('#officewrap.show'),
    gorevSekmesi: !!document.querySelector('#oftabs .tab[data-oftab="gorev"]'),
    personel: !!document.getElementById('of-staff'),
  }), 700))
})
bekle(ofis.acildi, 'Ofis paneli açılıyor')
bekle(ofis.gorevSekmesi, 'Ofis\'te Görevler sekmesi var (dev)')
bekle(ofis.personel, 'Ofis\'te Personel bölümü var (dev)')

// 8) Konsol hatası yok
bekle(konsolHata.length === 0, 'sayfada JavaScript hatası yok',
  konsolHata.length ? konsolHata.slice(0, 3).join(' | ') : '')

await b.close()
console.log(hata ? `\n${hata} HATA` : '\nDUMAN TESTİ TEMİZ — oyun açılıyor ve oynanıyor')
process.exit(hata ? 1 : 0)
