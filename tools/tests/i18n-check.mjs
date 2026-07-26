// DİL DENETÇİSİ — "İngilizce modda araya Türkçe karışıyor" hatasının kalıcı çözümü.
//
// Önceki denetim yalnız t('...') çağrılarını ve data-i18n özniteliklerini görüyordu.
// Kaçırdığı ÜÇ hata sınıfı var; bu dosya üçünü de ayrı ayrı yakalar:
//
//   1) KIRIK ANAHTAR — kendisi çeviren bir hedefe ŞABLON DİZESİ verilmesi:
//        ui.toast(`⛽ Pompa #${state.pumps} kuruldu!`)
//      toast() içeride t(msg) çağırır ama interpolasyonlu metin sözlükte anahtar OLAMAZ;
//      arama daima ıskalar ve metin Türkçe kalır.
//
//   2) ÇEVRİLMEMİŞ — çeviri YAPMAYAN bir hedefe düz Türkçe verilmesi:
//        setText(el, `${a}/${b} · +${n}L sipariş`)   ·   el.textContent = 'Bulunamadı.'
//
//   3) EKSİK ANAHTAR — çeviren hedefe verilen düz metnin sözlükte karşılığı olmaması.
//
// Çalıştır: npm run test:i18n
import fs from 'node:fs'
import path from 'node:path'

const ROOT = new URL('../../', import.meta.url).pathname
const SRC = path.join(ROOT, 'src')

// Türkçeye özgü harfler + yalnız Türkçede geçen sık kelimeler (yanlış alarm üretmesin diye dar tutuldu)
const TR = new RegExp(String.raw`[ğışĞİŞ]|ç[aeıioöuü]|\b(ve|için|gerek|yok|var|gün|para|satış|alış|sipariş|`
  + String.raw`müşteri|istasyon|pompa|yakıt|kasa|itibar|şube|tesis|arsa|kuruldu|açıldı|kapandı|toplandı|`
  + String.raw`kaldı|başladı|bitti|hazır|tamam|seviye|adet|litre|bahşiş|kredi|taksit|ödeme|borç|gelir|`
  + String.raw`gider|fiyat|indirim|görev|ödül|puan|yıldız|bulunamadı|verilemedi|yetmiyor)\b`, 'i')

/** kendisi t()'den geçiren hedefler → verilen düz metin ANAHTARDIR */
const AUTO = /\b(?:ui\.)?toast\(/
/** çeviri yapmayan hedefler → burada t() ile sarmak ZORUNLU */
const RAW = /textContent\s*=|innerHTML\s*=|setText\(|setCounter\(|\.placeholder\s*=|\.title\s*=/

const stripComments = c => c
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"\\])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length))
/** t(...) ile sarılı literalleri maskele — onlar zaten doğru yolda */
const maskT = c => c.replace(/\bt\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g,
  (m, q, b) => 't(' + q + ' '.repeat(b.length) + q)

const brokenKeys = [], untranslated = []
const autoLiterals = new Set()          // toast'a verilen düz metinler = sözlük anahtarı

const files = fs.readdirSync(SRC).filter(f => f.endsWith('.ts') && f !== 'i18n.ts')
for (const f of files) {
  const raw = fs.readFileSync(path.join(SRC, f), 'utf8')
  const rawLines = raw.split('\n')
  const lines = maskT(stripComments(raw)).split('\n')
  lines.forEach((line, i) => {
    if (/querySelector|classList|dataset\.|cssText|^\s*[.#@][a-z-]/i.test(line)) return
    const auto = AUTO.test(line), rawSink = RAW.test(line)
    if (!auto && !rawSink) return
    for (const m of line.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      const [, quote, body] = m
      if (body.length < 3 || body.length > 220) continue
      const plain = body.replace(/\$\{[^}]*\}/g, ' ').trim()
      if (plain.length < 3 || !TR.test(plain)) continue
      // CSS dizesi metin değildir: var(--x), "a:b;c:d", px/%/rem içeren bildirimler
      if (/var\(--|[a-z-]+\s*:\s*[^;]+;|\d(px|rem|vh|vw|%)\b/i.test(body)) continue
      const isTemplate = quote === '`' && /\$\{/.test(body)
      const rec = { file: f, line: i + 1, text: plain.slice(0, 64), src: rawLines[i].trim().slice(0, 92) }
      if (auto && isTemplate) brokenKeys.push(rec)          // 1) aranan anahtar hiç oluşmaz
      else if (auto) autoLiterals.add(body)                 // 3) sözlükte olmalı
      else untranslated.push(rec)                           // 2) t() ile sarılmalı
    }
  })
}

let pass = 0, fail = 0
const ok = (n) => { pass++; console.log('  ✓ ' + n) }
const no = (n, list) => {
  fail++; console.log(`  ✗ ${n} — ${list.length} yer:`)
  for (const x of list.slice(0, 30)) console.log(`      ${x.file}:${x.line}  «${x.text}»`)
  if (list.length > 30) console.log(`      … ve ${list.length - 30} tane daha`)
}

console.log('== 1) KIRIK ANAHTAR: çeviren hedefe şablon dizesi ==')
brokenKeys.length ? no('interpolasyonlu metin sözlükte aranamaz → hep Türkçe kalır', brokenKeys)
                  : ok('çeviren hedeflere yalnız sabit metin veriliyor')

console.log('\n== 2) ÇEVRİLMEMİŞ: çevirmeyen hedefe düz Türkçe ==')
untranslated.length ? no('t() ile sarılmamış', untranslated)
                    : ok('çevirmeyen hedeflerin hepsi t() ile sarılı')

// ---- sözlük ----
const i18n = fs.readFileSync(path.join(SRC, 'i18n.ts'), 'utf8')
function dict(name) {
  const i = i18n.indexOf(`const ${name}: Record<string, string> = {`)
  let d = 0, j = i18n.indexOf('{', i), k = j
  for (; k < i18n.length; k++) { if (i18n[k] === '{') d++; else if (i18n[k] === '}') { d--; if (!d) break } }
  const out = new Set()
  for (const m of i18n.slice(j + 1, k).matchAll(/(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\s*:/g))
    out.add((m[1] ?? m[2]).replace(/\\'/g, "'").replace(/\\"/g, '"'))
  return out
}
const EN = dict('EN'), FR = dict('FR')
const keys = new Set(autoLiterals)
for (const f of files) {
  const c = fs.readFileSync(path.join(SRC, f), 'utf8')
  for (const m of c.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1].replace(/\\'/g, "'"))
  for (const m of c.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(m[1].replace(/\\"/g, '"'))
}
for (const m of fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .matchAll(/data-i18n(?:-ph)?="([^"]+)"/g)) keys.add(m[1].replace(/&amp;/g, '&'))

const mEN = [...keys].filter(k => k.trim() && !EN.has(k))
const mFR = [...keys].filter(k => k.trim() && !FR.has(k))
console.log('\n== 3) EKSİK ANAHTAR: sözlük bütünlüğü ==')
const c2 = (n, good, d) => { good ? ok(n) : (fail++, console.log(`  ✗ ${n}\n      ${d}`)) }
c2(`kullanılan ${keys.size} metnin hepsi İngilizce sözlükte`, mEN.length === 0,
   mEN.slice(0, 8).map(x => `«${x.slice(0, 60)}»`).join('\n      '))
c2('hepsi Fransızca sözlükte', mFR.length === 0,
   mFR.slice(0, 8).map(x => `«${x.slice(0, 60)}»`).join('\n      '))
c2(`EN ve FR anahtar sayısı eşit (${EN.size}/${FR.size})`, EN.size === FR.size,
   'EN’de olup FR’de olmayan: ' + [...EN].filter(k => !FR.has(k)).slice(0, 4).join(' · '))
c2('boş çeviri değeri yok', !/:\s*''\s*[,}]/.test(i18n), 'i18n.ts içinde boş değer var')

// ---- 4) index.html: data-i18n'i OLMAYAN Türkçe metinler ----
// Bir elemanın metni ya data-i18n ile çevrilir ya da JS tarafından (t()'den geçmiş)
// yazılır. İkisi de yoksa o metin İngilizce modda Türkçe kalır.
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
const jsAll = files.map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('\n')
const htmlBad = []

/** id'den değişken adını bulup o değişkene metin yazılıp yazılmadığını izler */
function jsWritesText(id) {
  const q = "['\"`]" + id.replace(/[-]/g, '\\-') + "['\"`]"
  // a) aynı satırda doğrudan yazım
  if (new RegExp(q + "[^\n]*(textContent|innerHTML|setText)").test(jsAll)) return true
  if (new RegExp("(textContent|innerHTML|setText)[^\n]*" + q).test(jsAll)) return true
  // b) şablonla üretilen id (`fbtn-${f}`)
  if (id.includes('-') && new RegExp("`" + id.slice(0, id.lastIndexOf('-') + 1) + "\\$\\{").test(jsAll)) return true
  // c) değişkene alınıp başka satırda yazım
  const decl = new RegExp("(?:const|let|var|private)\\s+(\\w+)\\s*=\\s*[^\n]*" + q, 'g')
  for (const m of jsAll.matchAll(decl)) {
    const v = m[1]
    if (new RegExp("\\b(this\\.)?" + v + "\\.(textContent|innerHTML)\\s*=").test(jsAll)) return true
    if (new RegExp("setText\\(\\s*(this\\.)?" + v + "\\b").test(jsAll)) return true
  }
  return false
}

// dil seçici düğmeleri bilerek çevrilmez: dil adı kendi dilinde yazılır
const LANG_NAMES = /^(Türkçe|English|Français)$/
for (const m of htmlSrc.matchAll(/<(button|span|div|label|h3|h4|p|option|small|b|a|title)([^>]*)>([^<>]{3,90})<\/\1>/g)) {
  const [, tag, attrs, txtRaw] = m
  const txt = txtRaw.trim()
  if (/data-i18n/.test(attrs)) continue
  if (!TR.test(txt)) continue
  if (LANG_NAMES.test(txt)) continue
  if (/^[\d.,₺%×+\-\s/]*$/.test(txt)) continue
  // JS bu elemanı yazıyorsa metin çalışma anında değişir → sorun değil
  const id = attrs.match(/id="([^"]+)"/)?.[1]
  // JS bu elemanın METNİNİ yazıyorsa çalışma anında değişir → sorun değil.
  // Kod genelde elemanı bir değişkene alıp BAŞKA satırda yazar, o yüzden
  // önce id → değişken adı izi sürülür, sonra o değişkene yazılıp yazılmadığına bakılır.
  if (id && jsWritesText(id)) continue
  htmlBad.push({ tag, txt: txt.slice(0, 60), id: id ?? '—' })
}
console.log('\n== 4) index.html: çevrilmeyen sabit metinler ==')
if (htmlBad.length === 0) ok('sabit HTML metinlerinin hepsi çevrilebilir')
else {
  fail++
  console.log(`  ✗ ${htmlBad.length} eleman ne data-i18n'e ne JS'e bağlı:`)
  for (const x of htmlBad.slice(0, 20)) console.log(`      <${x.tag} id=${x.id}> «${x.txt}»`)
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
