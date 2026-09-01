/**
 * EV MÜŞTERİSİ KAÇIŞ NEDENİ — #1275 #1276 #1292 (29 Ağu–1 Eyl, üç oyuncu).
 *
 * "EV müşterisi dolu (ama şarj etmeyen) üniteyi görüp KAÇTI — itibar düştü!" mesajı,
 * istasyonda HERHANGİ bir molacı varsa her kaçışta çıkıyor ve itibar kesiyordu:
 *  - boş ünite ÖNÜ KAPALI (şerit ağı erişemiyor) ya da ARIZALI olsa da suç molacıya atılıyordu
 *    (oyuncu "boş yer var, niye kaçıyor" diyordu — haklıydı, sebep başkaydı);
 *  - ünitede ŞARJCI (8 sn) ya da Sv.3 müdür (25 sn) molacıyı zaten uğurlayacakken de ceza
 *    vardı ("3 şubem var, oturup molacı mı kovalayacağım").
 * Artık neden ayrıştırılır: kapalı / arızalı / molacı / molacı-personelli (ceza yok, bilgi).
 *
 * Kullanım: npx tsx tools/tests/ev-kacis-check.mjs   (dev sunucu 5311'de)
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const cars = oku('src/cars.ts'), main = oku('src/main.ts')
bekle(/const neden = kapali > 0 \? 'kapali' : bozuk > 0 \? 'bozuk'/.test(cars), 'tryEnter kaçış nedenini ayrıştırıyor (kapalı > arızalı > molacı)')
bekle(/if \(neden !== 'dolu'\) this\.opts\.onEvTurnedAway\?\.\(neden\)/.test(cars), 'gerçekten dolu istasyonda ceza/bildirim yok (eski davranış korunur)')
bekle(/hasChargerStaff: i => state\.autoChargers\.has\(i\) \|\| state\.managerLevel >= 3/.test(main), 'şarjcı VEYA Sv.3 müdür = personelli')
bekle(/if \(neden === 'molaci-personelli'\) \{\s*ui\.toast\(.*\)\s*return\s*\}/.test(main), 'personelli molacıda itibar kesilmiyor (bilgi notu)')

console.log('\n── CANLI ──')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const jsHata = []
p.on('pageerror', e => jsHata.push(String(e).slice(0, 160)))
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })

await p.evaluate(() => {
  const d = window.__dbg, s = d.state
  document.getElementById('gguest')?.click() // vitrin modu: kayıt kapısı kapalıyken trafik (entryChance) 0
  document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
  s.evChargers = Math.max(2, s.evChargers)
  s.money = 5_000_000
  s.brokenChargers.clear(); s.autoChargers.clear(); s.managerLevel = 0
  // tüm gerçek araçları sahneden çıkar: yuvalar bizim kuklalarımızla dolacak
  for (const c of [...d.cars.cars]) d.cars.releaseCar(c)
  window.__nedenler = []
  const eski = d.cars.opts.onEvTurnedAway
  // yalnız BİZİM kukla aracımızın çağrısı main'e iner: gerçek doğan EV'ler 4 sn kilidi tetiklemesin
  d.cars.opts.onEvTurnedAway = n => { if (!window.__biz) return; window.__nedenler.push(n); eski?.(n) }
  window.__toasts = []
  const t0 = d.ui.toast.bind(d.ui)
  d.ui.toast = (m, k, q) => { window.__toasts.push(m); return t0(m, k, q) }
})
const dene = async (kur) => {
  const r = await p.evaluate((kurSrc) => {
    const d = window.__dbg, s = d.state, cm = d.cars
    const n = s.evChargers
    for (let i = 0; i < 16; i++) cm.evOcc[i] = null
    const kukla = sq => ({ squatting: sq, kind: 'ev', phase: 'atPump' })
    const dolu = () => { for (let i = 0; i < n; i++) cm.evOcc[i] = kukla(false) }
    const ctx = { s, cm, kukla, dolu, n }
    const geri = (new Function('ctx', kurSrc))(ctx)
    const repOnce = s.reputation, lostOnce = s.stats.lost
    window.__nedenler.length = 0; window.__toasts.length = 0
    window.__biz = true
    cm.tryEnter({ kind: 'ev', station: 'near', slotIndex: -1, waitIndex: -1, truckSlot: -1 })
    window.__biz = false
    geri?.()
    return { neden: [...window.__nedenler], toast: window.__toasts.join(' | '), rep: s.reputation - repOnce, lost: s.stats.lost - lostOnce }
  }, kur)
  await p.waitForTimeout(6000) // main tarafındaki 4 sn bildirim kilidi (+pay)
  return r
}

// A) hepsi ŞARJ OLAN müşteriyle dolu, molacı yok → bildirim yok, ceza yok
let r = await dene(`ctx.dolu()`)
bekle(r.neden.length === 0 && r.rep === 0 && r.lost === 0, 'A · dolu istasyon (molacı yok): bildirim/ceza yok', JSON.stringify(r))
// B) bir molacı + gerisi dolu, personel yok → 'molaci', ceza var
r = await dene(`ctx.dolu(); ctx.cm.evOcc[0] = ctx.kukla(true)`)
bekle(r.neden[0] === 'molaci' && r.rep < 0 && r.lost === 1 && /KAÇTI/.test(r.toast), 'B · personelsiz molacı: ceza + molacı mesajı', JSON.stringify(r))
// C) molacı var AMA boş ünite ARIZALI → 'bozuk' (suç molacıda değil)
r = await dene(`ctx.dolu(); ctx.cm.evOcc[0] = ctx.kukla(true); ctx.cm.evOcc[1] = null; ctx.s.brokenChargers.add(1); return () => ctx.s.brokenChargers.clear()`)
bekle(r.neden[0] === 'bozuk' && r.rep < 0 && /ARIZALI/.test(r.toast), 'C · boş ünite arızalı: "arızalı" mesajı (molacı suçlanmıyor)', JSON.stringify(r))
// D) molacı var AMA boş ünitenin ÖNÜ KAPALI → 'kapali'
r = await dene(`ctx.dolu(); ctx.cm.evOcc[0] = ctx.kukla(true); ctx.cm.evOcc[1] = null; const g = ctx.cm.graph; const e = g.unitErisilebilir; g.unitErisilebilir = () => false; return () => { g.unitErisilebilir = e }`)
bekle(r.neden[0] === 'kapali' && r.rep < 0 && /ULAŞAMADI/.test(r.toast), 'D · boş ünitenin önü kapalı: "ulaşamadı" mesajı', JSON.stringify(r))
// E) molacının ünitesinde ŞARJCI var → 'molaci-personelli', CEZA YOK
r = await dene(`ctx.dolu(); ctx.cm.evOcc[0] = ctx.kukla(true); ctx.s.autoChargers.add(0); return () => ctx.s.autoChargers.clear()`)
bekle(r.neden[0] === 'molaci-personelli' && r.rep === 0 && r.lost === 0 && /şarjcı birazdan/.test(r.toast), 'E · şarjcılı molacı: ceza YOK, bilgi notu', JSON.stringify(r))
bekle(jsHata.length === 0, 'JavaScript hatası yok', jsHata.slice(0, 2).join(' | '))

await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ EV kaçış nedeni kontrolleri geçti')
process.exit(hata ? 1 : 0)
