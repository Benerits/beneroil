/**
 * MİSAFİR KAPISI ERKEN TIKLAMA TESTİ — "Misafir olarak devam"a boot bitmeden basılırsa?
 *
 * BULUNAN HATA (canlıda ölçüldü, 3 Eyl 2026): kapı düğmesi modülün üst-seviye `await`inden
 * (Kenney kit fetch'i, 20 sn'ye kadar) ÖNCE bağlanıyor; düğme `maybeGuestGate()` çağırıyor,
 * o da await'ten SONRA tanımlanan `state` / `isFullMode` / `donusumKapisiKapali`'yi okuyor.
 * Yavaş bağlantıda erken tıklayan oyuncu: "ReferenceError: Cannot access 'Wf' before
 * initialization" (t≈1.8 sn). Kapı kapanıyordu ama gün-5 eşiği o an kontrol edilmiyordu;
 * gün ≥ 5 misafir bir gün boyunca kayıtsız oynayabiliyordu.
 *
 * Düzeltme: `bootTamam` bayrağı — boot bitmeden kontrol ertelenir, boot bitince telafi edilir.
 *
 * Kullanım:  npm run dev -- --port 5399   →   npx tsx tools/tests/misafir-kapi-check.mjs
 */
import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

let pass = 0, fail = 0
const check = (ad, ok, ek = '') => { console.log(`  ${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`); ok ? pass++ : fail++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('== 1) Kaynak: erken tıklama ertelemesi ==')
const main_ts = oku('src/main.ts')
check('bootTamam bayrağı await\'ten ÖNCE tanımlı', main_ts.indexOf('let bootTamam = false') < main_ts.indexOf('const [modelLib, staticLib, branchKit] = await'))
check('proceedGuest boot bitmeden maybeGuestGate çağırmıyor', /if \(bootTamam\) maybeGuestGate\(\)\s*\n\s*else misafirKapiBekliyor = true/.test(main_ts))
check('boot bitince telafi ediliyor', /bootTamam = true\s*\n\s*if \(misafirKapiBekliyor\) \{ misafirKapiBekliyor = false; maybeGuestGate\(\) \}/.test(main_ts))
check('telafi, misafir kaydı yüklendikten SONRA', main_ts.indexOf('bootTamam = true') > main_ts.indexOf('const g = auth.loadGuest()'))

const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5199', '5173', '5174']
let PORT = null
for (const p of PORTLAR) {
  try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } }
  catch { /* sıradaki */ }
}
if (!PORT) { console.log('  (dev sunucu yok — tarayıcı bölümü atlandı; npm run dev -- --port 5399)'); bitir() }

console.log(`== 2) Tarayıcı (:${PORT}): kit fetch'i 4 sn geciktirilip kapıya ANINDA basılıyor ==`)
const b = await chromium.launch({ channel: 'chrome' })
const page = await b.newPage({ viewport: { width: 1400, height: 800 } })
page.setDefaultTimeout(4000)
// gün 7 misafir: gün-5 eşiği dolmuş → kapı GERİ AÇILMALI (kayıt zorunlu)
const save = { at: Date.now(), s: { money: 20_000, day: 7, pumps: 2, activeLoc: 'kasaba', unlockedLocs: ['kasaba'] } }
await page.addInitScript(save => {
  window.__errs = []
  window.addEventListener('error', e => window.__errs.push(e.message))
  localStorage.setItem('benzinlik-guest', JSON.stringify(save))
  localStorage.setItem('beneloil-loc', 'kasaba')
  localStorage.setItem('benzinlik-guest-joined', '1')
}, save)
await page.route('**/*.glb', async r => { await new Promise(res => setTimeout(res, 4000)); await r.continue() })
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
const btn = page.locator('#gguest')
await btn.waitFor({ state: 'visible' })
const t0 = Date.now()
await btn.click()
const tik = Date.now() - t0
const hemenKapandi = await page.evaluate(() => document.getElementById('authgate')?.style.display === 'none')
check('kapı ilk tıklamada kapandı (oyun oynanır kaldı)', hemenKapandi, `tıklama +${tik} ms`)
// boot: geciktirilmiş kit + sahne kurulumu; __dbg boot bitince çıkar (en çok 30 sn bekle)
let bootMs = 0
for (; bootMs < 30_000; bootMs += 500) {
  await page.waitForTimeout(500)
  if (await page.evaluate(() => typeof window.__dbg === 'object')) break
}
await page.waitForTimeout(1000)
const son = await page.evaluate(() => ({
  errs: window.__errs,
  day: window.__dbg?.state?.day,
  gate: document.getElementById('authgate')?.style.display,
}))
check('boot bitti (__dbg çıktı)', bootMs < 30_000, `~${bootMs} ms`)
check('TDZ hatası yok', !son.errs.some(m => /before initialization/.test(m)), JSON.stringify(son.errs).slice(0, 200))
check('sayfa hatasız', son.errs.length === 0, JSON.stringify(son.errs).slice(0, 200))
check('misafir kaydı yüklendi (gün 7)', son.day === 7, `gün ${son.day}`)
check('gün-5 eşiği boot sonrası TELAFİ edildi: kapı geri açık', son.gate !== 'none', `display=${son.gate}`)
await b.close()
bitir()

function bitir() {
  console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
  process.exit(fail ? 1 : 0)
}
