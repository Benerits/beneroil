/**
 * HUD BİLGİ KUTULARI TESTİ — Twitter #5 (29 Ağu, @yenimustafagenc):
 * "Üst Bar'da bulunan itemlere tıklandığında bilgi kutuları gelmeli"
 *
 * Her göstergenin ne anlama geldiğini, değerinin nereden geldiğini ve oyuncunun ne
 * yapabileceğini anlatan baloncuk. İtibar kutusu CANLI veri gösterir (bugünkü servis/
 * kaçan sayısı + gün sonu hedefi) — "itibarım neden donuyor" sorusunun cevabı orada.
 *
 * Not: kayıt kapısı (#authgate) HUD'un üstünü örttüğü için gerçek fare tıklaması oraya
 * ulaşmaz — bu doğru davranış. Test handler mantığını olay göndererek doğrular.
 *
 * Kullanım: npm run dev -- --port 5311  →  node tools/tests/hud-bilgi-check.mjs
 */
import { chromium } from 'playwright-core'
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 860 } })
p.on('pageerror', e => console.log('HATA:', String(e).slice(0,120)))
await p.goto('http://localhost:5311/?full=1', { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(10000)
// Kayıt kapısı (#authgate) HUD'u örttüğü için gerçek fare tıklaması oraya ulaşmıyor —
// bu doğru davranış. Handler mantığını olay göndererek doğruluyoruz.
const sonuc = await p.evaluate(() => {
  const kutu = document.getElementById('chipinfo')
  const out = []
  for (const chip of document.querySelectorAll('.chip[data-bilgi]')) {
    kutu.classList.remove('show'); kutu.innerHTML = ''
    chip.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    const g = kutu.getBoundingClientRect()
    out.push({
      tur: chip.dataset.bilgi,
      acik: kutu.classList.contains('show'),
      baslik: kutu.querySelector('b')?.textContent ?? null,
      uzunluk: kutu.textContent.length,
      ekranIcinde: g.left >= 0 && g.top >= 0 && g.right <= innerWidth + 1 && g.bottom <= innerHeight + 1,
    })
  }
  // boşluğa tıklayınca kapanıyor mu
  document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  return { chipler: out, kapandi: !kutu.classList.contains('show') }
})
let ok = 0
for (const r of sonuc.chipler) {
  const gecti = r.acik && r.uzunluk > 60 && r.ekranIcinde && r.baslik
  if (gecti) ok++
  console.log(` ${gecti ? '✓' : '✗'} ${r.tur.padEnd(9)} "${r.baslik}" · ${r.uzunluk} karakter · ekranİçinde=${r.ekranIcinde}`)
}
console.log(`\n${ok}/${sonuc.chipler.length} bilgi kutusu çalışıyor · boşluğa tıklayınca kapanıyor: ${sonuc.kapandi}`)
await b.close()
process.exit(ok === sonuc.chipler.length && sonuc.kapandi ? 0 : 1)
