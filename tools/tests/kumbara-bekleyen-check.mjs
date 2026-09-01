/**
 * "KUMBARALARDA ₺X TOPLANMAYI BEKLİYOR" DOĞRU SAYIYI MI SÖYLÜYOR? — #1300 #1290 (31 Ağu–1 Eyl).
 *
 * ŞİKÂYET: "güncelleme sonrası diğer istasyonların parasını alamıyoruz" / "önceki şube
 * çalışmıyor para gelmiyor". GERÇEK KAYITLA ÖLÇÜLDÜ: gün dönüşü şube müdürleri +₺436.287
 * yazıyor (mekanik çalışıyor) AMA hemen ardından "Kumbaralarda ₺3.925.278 toplanmayı
 * bekliyor" toast'ı çıkıyordu — bu sayı `facTotal` (tesislerin ÖMÜR BOYU cirosu) idi,
 * hiçbir yerde toplanamayan hayalet para. Oyuncu haklı olarak "param nerede?" diyordu.
 *
 * FIX: toast `state.pendingWaiting()` (pendingCash × prestij = collectPending'in vereceği) okur.
 *
 * Kullanım: npx tsx tools/tests/kumbara-bekleyen-check.mjs   (dev sunucu 5311'de)
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const main = oku('src/main.ts'), state = oku('src/state.ts')
bekle(!/Object\.values\(state\.facTotal\)\.reduce/.test(main), 'gün raporu facTotal (ömür boyu ciro) toplamıyor')
bekle(/const kumbara = state\.pendingWaiting\(\)/.test(main), 'gün raporu pendingWaiting() okuyor')
bekle(/pendingWaiting\(\): number \{ return Math\.round\(this\.pendingTotal\(\) \* this\.prestigeMult\(\)\) \}/.test(state),
  'pendingWaiting = pendingCash toplamı × prestij (collectPending ile aynı çarpan)')

console.log('\n── CANLI: ömür boyu ciro 1.000.000, kumbarada 900 → toast 900 civarı demeli ──')
const PORT = process.env.PORT ?? '5311'
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__dbg?.state && window.__dbg?.saat, null, { timeout: 60_000 })
const r = await p.evaluate(async () => {
  const d = window.__dbg
  document.getElementById('gguest')?.click()
  document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
  const s = d.state
  window.__toasts = []
  const t0 = d.ui.toast.bind(d.ui); d.ui.toast = (m, k, q) => { window.__toasts.push(String(m)); return t0(m, k, q) }
  s.facTotal = { market: 1_000_000, wash: 250_000 }
  s.pendingCash = { market: 600, wash: 300 }
  const beklenen = s.pendingWaiting()
  d.saat(0.995)
  await new Promise(r => setTimeout(r, 6000))
  const t = window.__toasts.find(x => x.startsWith('Kumbaralarda'))
  return { beklenen, toast: t ?? null, day: s.day }
})
const sayi = r.toast ? Number((r.toast.match(/₺([\d.]+)/) ?? [])[1]?.replace(/\./g, '')) : NaN
bekle(r.toast !== null, 'gün dönüşünde kumbara toast\'ı çıktı', r.toast ?? 'yok')
bekle(sayi === r.beklenen, `toast bekleyen parayı söylüyor (${r.beklenen})`, `toast ${sayi}`)
bekle(sayi < 10_000, 'ömür boyu ciro (1.250.000) toast\'a sızmadı', `${sayi}`)

console.log('\n── CANLI 2 (#1274): çok üniteli tesisin rozeti "ortak" der, tek ünitelininki demez ──')
const rz = await p.evaluate(async () => {
  const d = window.__dbg
  d.state.hasAirWater = true; d.state.airWaterCount = 3
  d.kayit.yukle(d.kayit.yuk()) // sahneyi state'ten yeniden kur (3 hava-su ünitesi)
  const s = d.state
  const cok = ['airwater', 'selfwash', 'parking'].find(k => d.world.buildings.filter(b => b.id.split('#')[0] === k).length > 1)
  const tek = ['wash', 'oil', 'coffee'].find(k => d.world.buildings.filter(b => b.id.split('#')[0] === k).length === 1)
  s.pendingCash = { [cok]: 300, [tek]: 300 }
  await new Promise(r => setTimeout(r, 400))
  const m = k => d.world.buildings.filter(b => b.id.split('#')[0] === k).map(b => b.cashText)
  return { cok, tek, cokYazi: m(cok), tekYazi: m(tek) }
})
bekle(!!rz.cok && !!rz.tek, 'vitrinde çok üniteli + tek üniteli tesis bulundu', `${rz.cok} / ${rz.tek}`)
bekle(rz.cokYazi.length > 1 && rz.cokYazi.every(x => x === '₺300 · ortak'), `${rz.cok} rozetleri "₺300 · ortak"`, JSON.stringify(rz.cokYazi))
bekle(JSON.stringify(rz.tekYazi) === '["₺300"]', `${rz.tek} rozeti çıplak "₺300"`, JSON.stringify(rz.tekYazi))
bekle(errs.length === 0, 'sayfa hatası yok', errs.join(' | '))
await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ kumbara-bekleyen kontrolleri geçti')
process.exit(hata ? 1 : 0)
