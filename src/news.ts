/**
 * YENİLİKLER + BİLDİRİM GEÇMİŞİ (#465 "oyun içi güncelleme notları" · "kaçırdığım bildirimi göremiyorum")
 *
 * İki ayrı ihtiyaç, tek modül:
 *  1) YENİLİKLER — sürüm notları. Yeni sürümde bir kez kendiliğinden açılır, sonra
 *     Ayarlar'dan istendiği zaman görülür. Okundu bilgisi localStorage'da tutulur;
 *     SAVE FORMATINA DOKUNMAZ (oyuncu kaydı bu yüzden hiç etkilenmez).
 *  2) BİLDİRİM GEÇMİŞİ — toast'lar 3 saniyede kayboluyor ve oyuncu kaçırdığını bir daha
 *     göremiyordu. Artık son 60 bildirim oyun günü damgasıyla saklanıp listelenebiliyor.
 *
 * Arayüz tamamen buradan üretilir (index.html'e markup eklenmez) — böylece modal,
 * sayfa iskeletinden bağımsız kalır.
 */
import { t } from './i18n'

// ---- 1) Sürüm notları ----
export interface NewsEntry { v: string; date: string; items: string[] }

/** En yeni en üstte. Yeni sürüm eklerken listenin BAŞINA ekle ve `NEWS_VERSION`'ı güncelle. */
export const NEWS: NewsEntry[] = [
  {
    v: '1.5', date: '2026-07-30',
    items: [
      'DEVİR KİLİDİ ÇÖZÜLDÜ: bir sonraki yıldızın ekipman eşiği, şubelerine sığandan fazlasını isteyebiliyordu — 3 şubeyle ₺5.950.000 istenip en fazla ~₺5.170.000 kurulabildiği için ilerlemek imkânsız hale geliyordu. Eşik artık şube başına ₺1.500.000 ile SINIRLI ve bu sınırı hiçbir koşulda aşamaz.',
      'Devir eşiğine takılan oyuncular kaydına dokunulmadan açıldı — oyuna girdiğinde devir düğmen çalışır durumda olacak.',
      'Yeni şube açmak artık kademeli olarak pahalı: her açık şube bir sonrakinin bedelini artırıyor. Şube açmak yıldız yolunu genişlettiği için bedeli de büyüyor.',
    ],
  },
  {
    v: '1.4', date: '2026-07-26',
    items: [
      'Tesis kumbarası dolduğunda ciro artık kaybolmuyor — dolu kumbara üstüne gelen kazanç kısılarak da olsa birikiyor ve ne kadarının eridiği rapor ediliyor.',
      'İtibar 5,0\'da donmuyor: her gün sonunda o günün hizmet kalitesine göre yükseliyor ya da düşüyor.',
      'Pompacı artık her araçta camı siliyor; şarj görevlisi de siliyor.',
      'Sokak lambası satın alınabilir oldu — istediğin yere kur, taşı, sat. Yok ettiğin lambaları geri koyabilirsin.',
      'Ofiste son 7 günün kâr grafiği ve cironun yaka dağılımı var.',
      'Haczedilen bina artık sahnede işlevsiz kalmıyor.',
      'Yakıt alış fiyatı günlük dalgalanıyor — ucuzken stoklamak kâr getiriyor.',
      'Sıralama tablosu ve mevsimler eklendi.',
    ],
  },
  {
    v: '1.3', date: '2026-07-25',
    items: [
      'Kayıp save sorunu kapatıldı — oyundan çıkarken ilerleme garanti kaydediliyor.',
      'Satın alınan ürünün kaybolması sorunu giderildi.',
      'Şube sistemi: çevre yolu ve otoyol istasyonları açıldı.',
      'Kurumsal sözleşmeler, marka devri ve müdür otomasyonu eklendi.',
    ],
  },
]

export const NEWS_VERSION = NEWS[0].v
const SEEN_KEY = 'beneloil-news-seen'

/** oyuncu bu sürümün notlarını gördü mü? */
export function newsUnseen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) !== NEWS_VERSION } catch { return false }
}
function markSeen() {
  try { localStorage.setItem(SEEN_KEY, NEWS_VERSION) } catch { /* özel sekme: sessizce geç */ }
}
/** Sürüm notlarını "görülmüş" say — YENİ oyuncuda açılışta göstermemek için.
 *  Değişiklik günlüğü, oyunu ilk kez açan birine hiçbir şey ifade etmiyor ve
 *  onboarding balonunun üstünü kapatıyor. (Meta'da her oyuncu yeni oyuncu.) */
export function markNewsSeen() { markSeen() }

// ---- 2) Bildirim geçmişi ----
export interface LogItem { day: number; msg: string; kind: 'good' | 'bad' | '' }
const LOG_MAX = 60
const log: LogItem[] = []

/** toast'la AYNI temizlik: oyuncu ekranda emojisiz gördüyse geçmişte de emojisiz görsün */
const strip = (s: string) =>
  s.replace(/\p{Extended_Pictographic}/gu, '').replace(/\uFE0F/g, '').replace(/\s{2,}/g, ' ').trim()

/** ui.toast her çağrıldığında buraya da düşer (main.ts bağlar) */
export function pushLog(day: number, rawMsg: string, kind: 'good' | 'bad' | '' = '') {
  const msg = strip(rawMsg)
  if (!msg) return
  const last = log[log.length - 1]
  if (last && last.msg === msg && last.day === day) return // toast spam kırıcıyla aynı mantık
  log.push({ day, msg, kind })
  if (log.length > LOG_MAX) log.shift()
}
export function logItems(): LogItem[] { return log.slice().reverse() }

// ---- 3) Ortak modal iskeleti (index.html'den bağımsız) ----
function ensureShell(): HTMLDivElement {
  let wrap = document.getElementById('newswrap') as HTMLDivElement | null
  if (wrap) return wrap
  wrap = document.createElement('div')
  wrap.className = 'backdrop'
  wrap.id = 'newswrap'
  wrap.innerHTML = `
    <div class="modal" style="height:auto; max-height:84vh">
      <div class="mhead"><h3 id="news-title"></h3>
        <button class="mclose" id="news-close"><svg class="ic"><use href="#i-x"/></svg></button>
      </div>
      <div class="mbody" id="news-body"></div>
    </div>`
  document.body.appendChild(wrap)
  const close = () => wrap!.classList.remove('show')
  wrap.querySelector('#news-close')?.addEventListener('click', close)
  wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close() })
  return wrap
}

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Yenilikler modalını aç. `auto` = sürüm değiştiği için kendiliğinden açıldı. */
export function openNews(auto = false) {
  const wrap = ensureShell()
  const title = wrap.querySelector('#news-title')!
  const body = wrap.querySelector('#news-body')!
  title.textContent = auto ? t('Neler Yeni?') : t('Yenilikler')
  body.innerHTML = NEWS.map((n, i) => {
    const items = n.items.map(x => `<li>${esc(t(x))}</li>`).join('')
    return `<div class="ofsec">${t('Sürüm {0}', n.v)} · ${n.date}${i === 0 && auto ? ` · <b>${t('yeni')}</b>` : ''}</div>`
      + `<ul class="news-list">${items}</ul>`
  }).join('')
  wrap.classList.add('show')
  markSeen()
}

/** Bildirim geçmişi modalını aç. */
export function openLog() {
  const wrap = ensureShell()
  wrap.querySelector('#news-title')!.textContent = t('Bildirim Geçmişi')
  const items = logItems()
  wrap.querySelector('#news-body')!.innerHTML = items.length
    ? `<div class="news-log">` + items.map(x =>
        `<div class="news-log-row ${x.kind}"><span class="news-log-day">${t('Gün {0}', x.day)}</span>`
        + `<span>${esc(x.msg)}</span></div>`).join('') + `</div>`
    : `<div class="acc-note">${t('Henüz bildirim yok.')}</div>`
  wrap.classList.add('show')
}

/** Sürüm değiştiyse notları bir kez göster (oyun açılışında çağrılır). */
export function maybeShowNews() {
  if (newsUnseen()) setTimeout(() => openNews(true), 1200) // açılış animasyonu bitsin
}

/** Ayarlar paneline "Yenilikler" + "Bildirim Geçmişi" düğmelerini ekler.
 *  Markup buradan enjekte edilir; index.html iskeletine dokunulmaz. */
export function mountNewsButtons() {
  if (document.getElementById('set-news')) return
  // "Geri bildirim" etiketinin bulunduğu satırı çapa al (Profil sheet'ine taşınmış olabilir)
  const fb = document.getElementById('set-feedback')
  const anchor = fb?.parentElement
  if (!anchor) return
  const label = document.createElement('label')
  label.style.marginTop = '12px'
  label.textContent = t('Yenilikler & geçmiş')
  const row = document.createElement('div')
  row.className = 'row'
  row.innerHTML = `
    <button id="set-news" class="btn" style="flex:1; justify-content:center"></button>
    <button id="set-log" class="btn" style="flex:1; justify-content:center"></button>`
  anchor.parentElement?.insertBefore(label, anchor)
  anchor.parentElement?.insertBefore(row, anchor)
  const nb = row.querySelector('#set-news') as HTMLButtonElement
  nb.textContent = t('Yenilikler')
  if (newsUnseen()) nb.classList.add('primary')
  nb.addEventListener('click', () => { openNews(); nb.classList.remove('primary') })
  const lb = row.querySelector('#set-log') as HTMLButtonElement
  lb.textContent = t('Bildirim Geçmişi')
  lb.addEventListener('click', () => openLog())
}

/** Modül kendi stilini enjekte eder — index.html'e dokunulmaz. */
export function injectNewsStyle() {
  if (document.getElementById('news-style')) return
  const st = document.createElement('style')
  st.id = 'news-style'
  st.textContent = `
    .news-list { margin: 4px 0 2px; padding-left: 18px; }
    .news-list li { font-size: 13px; font-weight: 650; line-height: 1.5; margin: 5px 0; color: var(--ink); }
    .news-log { display: flex; flex-direction: column; }
    .news-log-row { display: grid; grid-template-columns: 62px 1fr; gap: 9px; align-items: baseline;
      font-size: 12.5px; font-weight: 700; padding: 7px 0; border-top: 1px solid var(--line); color: var(--ink); }
    .news-log-row:first-child { border-top: 0; }
    .news-log-row.good { color: var(--green-dark); }
    .news-log-row.bad  { color: var(--red); }
    .news-log-day { font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase;
      color: var(--muted); font-variant-numeric: tabular-nums; }`
  document.head.appendChild(st)
}
