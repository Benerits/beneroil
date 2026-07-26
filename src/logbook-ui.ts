/**
 * ÖTV'SİZ YAKIT ALIM DEFTERİ — KARAR EKRANI (lategame raporu §6.5.3)
 *
 * Raporun tarifi birebir uygulanır:
 *
 *   🚤 "MAVİ RÜZGAR" — Balıkçı Teknesi
 *      İstek: 1.800 L  ÖTV'siz motorin   (₺11/L yerine ₺6.5/L)
 *      📄 Defter ibraz edildi
 *      [İNCELE]   ← Kota: 1.400/2.000 L · Vize: geçerli · İmza: ✓
 *      [ONAYLA — ÖTV'siz ver]        [REDDET — tam fiyat teklif et]
 *
 * Tasarımın özü: bu "yanlış tabanca" hatasının zihinsel muadili ama BİLGİ İŞLEME
 * ekseninde. Oyuncu tahmin etmez — İNCELER. Kusurlu her defterin mutlaka görünür bir
 * işareti vardır (marina.ts'te testle kilitli); iş, o işareti fark etmektir.
 *
 * Arayüz buradan enjekte edilir (index.html'e markup eklenmez).
 */
import { t } from './i18n'
import { logbookFlags, type Logbook, type LogbookChoice } from './marina'

let shell: HTMLDivElement | null = null

function ensureShell(): HTMLDivElement {
  if (shell) return shell
  const w = document.createElement('div')
  w.className = 'backdrop'
  w.id = 'logbookwrap'
  w.innerHTML = `
    <div class="modal" style="height:auto; max-height:84vh; max-width:440px">
      <div class="mhead"><h3 id="lb-title"></h3></div>
      <div class="mbody" id="lb-body"></div>
    </div>`
  document.body.appendChild(w)
  const st = document.createElement('style')
  st.textContent = `
    #logbookwrap .lb-line { display:flex; justify-content:space-between; gap:10px; font-size:13px;
      font-weight:700; padding:6px 0; border-top:1px solid var(--line); }
    #logbookwrap .lb-line:first-child { border-top:0; }
    #logbookwrap .lb-doc { margin-top:10px; padding:11px 12px; border-radius:12px;
      background:#fbf7ea; border:1.5px dashed #d8c9a0; }
    #logbookwrap .lb-flag { font-size:12.5px; font-weight:800; color:var(--red); padding:4px 0; }
    #logbookwrap .lb-clean { font-size:12.5px; font-weight:800; color:var(--green-dark,#2f7d4f); padding:4px 0; }
    #logbookwrap .lb-hint { font-size:11.5px; font-weight:650; color:var(--muted); margin-top:8px; line-height:1.45; }
    #logbookwrap .lb-btns { display:flex; gap:8px; margin-top:14px; }
    #logbookwrap .lb-btns .btn { flex:1; justify-content:center; }`
  document.head.appendChild(st)
  shell = w
  return w
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
const tl = (n: number) => Math.round(n).toLocaleString('tr-TR')

/**
 * Karar ekranını aç. `onChoice` oyuncu ONAYLA/REDDET seçince çağrılır.
 * İNCELE'ye basılmadan karar verilebilir — ama incelemeden onaylamak kumar oynamaktır.
 */
export function openLogbook(
  lb: Logbook, segLabel: string, exemptPrice: number, fullPrice: number,
  onChoice: (c: LogbookChoice, inspected: boolean) => void,
) {
  const w = ensureShell()
  let inspected = false
  const title = w.querySelector('#lb-title')!
  const body = w.querySelector('#lb-body')!
  title.textContent = t('Yakıt Alım Defteri')

  const render = () => {
    const flags = logbookFlags(lb)
    body.innerHTML =
      `<div class="lb-line"><span>${esc(lb.boatName)}</span><span>${esc(segLabel)}</span></div>`
      + `<div class="lb-line"><span>${t('İstek')}</span><span>${tl(lb.liters)} L ${t('ÖTV\'siz motorin')}</span></div>`
      + `<div class="lb-line"><span>${t('Fiyat farkı')}</span>`
      + `<span>₺${fullPrice.toFixed(1)} → <b>₺${exemptPrice.toFixed(1)}</b>/L</span></div>`
      + `<div class="lb-doc">`
      + (inspected
          ? `<div class="lb-line"><span>${t('Kota')}</span><span>${tl(lb.quotaUsed)} / ${tl(lb.quotaTotal)} L</span></div>`
            + `<div class="lb-line"><span>${t('Vize')}</span><span>${lb.visaValid ? t('geçerli') : t('SÜRESİ DOLMUŞ')}</span></div>`
            + `<div class="lb-line"><span>${t('İmza')}</span><span>${lb.signatureOk ? '✓' : t('UYUŞMUYOR')}</span></div>`
            + `<div class="lb-line"><span>${t('Tarih')}</span><span>${lb.dateConsistent ? t('tutarlı') : t('TUTARSIZ')}</span></div>`
            + (flags.length
                ? flags.map(f => `<div class="lb-flag">${esc(f)}</div>`).join('')
                : `<div class="lb-clean">${t('Defterde kusur bulunamadı')}</div>`)
          : `<div class="lb-line"><span>${t('Defter ibraz edildi')}</span><span>${t('incelenmedi')}</span></div>`)
      + `</div>`
      + `<div class="lb-hint">${t('Doğru onay düşük marjla yüksek hacim getirir. Sahte deftere onay verirsen denetimde ağır ceza yersin. Geçerli defteri reddedersen o ticari müşteri bir daha gelmez.')}</div>`
      + `<div class="lb-btns">`
      + (inspected ? '' : `<button class="btn" id="lb-inspect">${t('İNCELE')}</button>`)
      + `</div>`
      + `<div class="lb-btns">`
      + `<button class="btn primary" id="lb-ok">${t('ONAYLA')}</button>`
      + `<button class="btn warn" id="lb-no">${t('REDDET')}</button>`
      + `</div>`

    body.querySelector('#lb-inspect')?.addEventListener('click', () => { inspected = true; render() })
    const close = (c: LogbookChoice) => { w.classList.remove('show'); onChoice(c, inspected) }
    body.querySelector('#lb-ok')?.addEventListener('click', () => close('approve'))
    body.querySelector('#lb-no')?.addEventListener('click', () => close('reject'))
  }
  render()
  w.classList.add('show')
}
