/**
 * OTEL + TEMİZLİKÇİ + MESAJ KUTUSU + HIZLI GEÇİŞ — L grubu (yeni özellik istekleri).
 *
 *  #1011 "otel ekleyebilirsin"        → pasif omurga, doluluk itibara bağlı, günlük OPEX'i var
 *  #1010 "temizlikçi ekleyebilirsin"  → bakım özeni + panel silme, yovmiyeli
 *  #988  "sürekli kumbaralar doluyor" → müdür turu seviyeyle hızlanıyor
 *  #1018 mesaj kutusu · #1038 hızlı şube geçişi (UI kancaları)
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, getShopItems, buyItem, sellInfo, applySell, serializeState, hydrateState } =
  await import('../../src/state.ts')
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }
const zengin = () => { const s = new GameState(); s.money = 5_000_000; return s }

// ── #1011 OTEL ──
const s = zengin()
const otelSatir = () => getShopItems(s).find(r => r.id === 'hotel')
bekle(!!otelSatir(), 'mağazada Otel satırı var')
bekle(otelSatir().status === 'locked', 'otel önce KİLİTLİ — tır parkı şartı var (kademe korunuyor)')
buyItem(s, 'truckpark')
bekle(otelSatir().status === 'buy', 'tır parkından sonra otel açılıyor')
bekle(buyItem(s, 'hotel') && s.hasHotel, 'otel satın alınabiliyor')
bekle(otelSatir().status === 'maxed', 'ikinci kez satın alınamıyor')

// gelir: itibar doluluğu belirlemeli
const gelir = (rep, saniye = 600) => {
  const g = zengin(); g.hasHotel = true; g.reputation = rep
  const ger = Math.random; Math.random = () => 0.5
  for (let i = 0; i < saniye; i++) g.tick(1)
  Math.random = ger
  return g.facTotal['hotel'] ?? 0
}
const dusuk = gelir(2.0), yuksek = gelir(5.0)
bekle(dusuk > 0, `otel pasif gelir üretiyor (itibar 2.0 → ₺${dusuk})`)
bekle(yuksek > dusuk * 1.2, `itibar doluluğu artırıyor: ₺${dusuk} → ₺${yuksek} (ihmal edilen otel boş kalır)`)

// gider: bedava pasif gelir olmamalı
const o1 = zengin(); o1.day = 30
const opexOncesi = o1.dailyOpex()
o1.hasHotel = true
bekle(o1.dailyOpex() > opexOncesi, `otel günlük gider ekliyor (₺${opexOncesi} → ₺${o1.dailyOpex()})`)
bekle(o1.dailyOpex() - opexOncesi >= 900, 'oda işletme gideri en az ₺900/gün')

// yık/iade + kayıt
bekle(!!sellInfo(s, 'hotel'), 'otel yıkılabiliyor (iade bilgisi var)')
const iade = applySell(s, 'hotel')
bekle(iade > 0 && !s.hasHotel, `yıkınca yatırımın yarısı iade: +₺${iade}`)
const kay = zengin(); kay.hasHotel = true; kay.hasCleaner = true
const geri = new GameState()
hydrateState(geri, JSON.parse(JSON.stringify(serializeState(kay))))
bekle(geri.hasHotel === true && geri.hasCleaner === true, 'otel ve temizlikçi kayıttan geri geliyor')

// ── #1010 TEMİZLİKÇİ ──
const c = zengin()
bekle(!!getShopItems(c).find(r => r.id === 'cleaner'), 'mağazada Temizlikçi satırı var')
bekle(buyItem(c, 'cleaner') && c.hasCleaner, 'temizlikçi tutulabiliyor')
const yovOnce = new GameState().dailyWages()
bekle(c.dailyWages() > yovOnce, `temizlikçi yovmiye ekliyor (₺${yovOnce} → ₺${c.dailyWages()})`)

const kirli = zengin(); kirli.solarCount = 2; kirli.solarDirt = 0.8; kirli.hasCleaner = true
const kirliRef = zengin(); kirliRef.solarCount = 2; kirliRef.solarDirt = 0.8
for (let i = 0; i < 200; i++) { kirli.tick(1); kirliRef.tick(1) }
bekle(kirli.solarDirt < kirliRef.solarDirt,
  `temizlikçi paneli siliyor (${kirli.solarDirt.toFixed(2)} < ${kirliRef.solarDirt.toFixed(2)})`)
bekle(kirli.maintCare > kirliRef.maintCare,
  `bakım özeni yüksek kalıyor (${kirli.maintCare.toFixed(2)} > ${kirliRef.maintCare.toFixed(2)})`)

// ── #988 müdür tur sıklığı ──
const durum = readFileSync(new URL('../../src/state.ts', import.meta.url), 'utf8')
// 69d4597: tablo `MANAGER_TOUR_SEC` sabitine taşındı (offline toplama da aynı tabloyu okuyor)
bekle(/MANAGER_TOUR_SEC = \[45, 45, 32, 22\]/.test(durum) && /managerTourSec\(\)/.test(durum),
  'müdür turu seviyeyle hızlanıyor (45/32/22 sn, tek tablo MANAGER_TOUR_SEC)')
const turla = lvl => {
  const g = zengin(); g.managerLevel = lvl
  for (const f of Object.keys(g.tanks)) g.tanks[f] = g.fuelCapacity(f)
  let tur = 0
  // müdür tur RAPORU ancak yapacak iş varsa döner → her karede kumbaraya para koy
  for (let i = 0; i < 90; i++) { g.pendingCash['market'] = 100; if (g.managerTick(1)) tur++ }
  return tur
}
bekle(turla(3) > turla(1), `Sv.3 müdür 90 sn'de daha çok tur atıyor (${turla(1)} → ${turla(3)})`)

// ── UI kancaları: mesaj kutusu (#1018) ve hızlı geçiş (#1038) ──
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const ana = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const ui = readFileSync(new URL('../../src/ui.ts', import.meta.url), 'utf8')
bekle(/id="inboxwrap"/.test(html) && /id="inboxbtn"/.test(html), 'mesaj kutusu paneli ve butonu var')
bekle(/readonly inbox: \{ text: string; kind: string; t: number \}\[\]/.test(ui), 'toast\'lar kutuda birikiyor')
bekle(/if \(this\.inbox\.length > 60\) this\.inbox\.shift\(\)/.test(ui), 'kutu 60 kayıtla sınırlı (bellek şişmiyor)')
bekle(/markInboxRead\(\)/.test(ui) && /inboxdot/.test(html), 'okunmamış rozeti var ve açınca sıfırlanıyor')
bekle(/id="locbtn"/.test(html) && /id="locmenu"/.test(html), 'HUD hızlı şube geçişi var')
bekle(/function subeyeGec\(id: LocId, go\?: HTMLButtonElement\)/.test(ana),
  'geçiş mantığı tek işlevde — ofis butonu ve hızlı menü AYNI kilit/push akışını kullanıyor')
bekle(/if \(locSwitching\)/.test(ana), 'çift tıklama kilidi korundu')
bekle(/i-hotel/.test(html), 'otel ikonu tanımlı (emoji değil)')
bekle(/buildHotel\(pos\?: THREE\.Vector2/.test(readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')),
  'otelin 3B görseli var')
// tekilKur() sarmalayıcısı (kayıt-kaybı fixi: ikiz bina koruması) araya girebilir
bekle(/if \(state\.hasHotel\)[\s\S]{0,60}world\.buildHotel\(pv\('hotel'\)\)/.test(ana), 'otel kayıttan sahneye geri kuruluyor')
bekle(/hotel: \(\) => \(\{ w: 7, d: 10 \}\)/.test(ana), 'otel yerleştirilebilir/taşınabilir')

console.log(hata ? `\n${hata} HATA` : '\nOTEL & TEMİZLİKÇİ TEMİZ')
process.exit(hata ? 1 : 0)
