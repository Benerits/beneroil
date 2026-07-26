// news.ts saf mantık testi (DOM stub'larıyla)
globalThis.localStorage = (() => { const m = new Map()
  return { getItem: k => m.has(k) ? m.get(k) : null, setItem: (k,v)=>m.set(k,String(v)), removeItem: k=>m.delete(k) } })()
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
globalThis.document = { getElementById: () => null, createElement: () => ({ style:{}, classList:{add(){},remove(){}}, addEventListener(){}, querySelector: () => null, appendChild(){} }), head: { appendChild(){} }, body: { appendChild(){} } }

const n = await import('../../src/news.ts')
let pass=0, fail=0
const check=(name,c)=>{ c?(pass++,console.log('  ✓ '+name)):(fail++,console.log('  ✗ '+name)) }

console.log('== news.ts: yenilikler + bildirim geçmişi ==')
check('sürüm notu listesi dolu', n.NEWS.length >= 2 && n.NEWS[0].items.length > 0)
check('NEWS_VERSION en yeni girdiyle eşleşir', n.NEWS_VERSION === n.NEWS[0].v)
check('sürümler azalan sırada', n.NEWS[0].v > n.NEWS[1].v)
check('ilk açılışta notlar GÖRÜLMEMİŞ sayılır', n.newsUnseen() === true)

// bildirim geçmişi
n.pushLog(3, '⛽ Pompa kuruldu!', 'good')
n.pushLog(3, '⛽ Pompa kuruldu!', 'good')   // aynısı üst üste → tekrar yazılmaz
n.pushLog(4, 'Müşteri beklemekten sıkıldı', 'bad')
const it = n.logItems()
check(`arka arkaya aynı mesaj tekrarlanmaz (${it.length} kayıt)`, it.length === 2)
check('en yeni EN ÜSTTE', it[0].day === 4)
check('emoji temizlenir (toast ile aynı görünüm)', it[1].msg === 'Pompa kuruldu!')
check('tür bilgisi korunur', it[0].kind === 'bad' && it[1].kind === 'good')
// halka tampon: 60 sınırı
for (let i=0;i<200;i++) n.pushLog(i, 'mesaj '+i, '')
check('geçmiş 60 kayıtla sınırlı (bellek sızıntısı yok)', n.logItems().length === 60)
check('sınıra dayanınca EN ESKİ atılır (202 itildi → son 60 kaldı)', n.logItems().at(-1).msg === 'mesaj 140')
// boş mesaj (yalnız emoji) loglanmaz
const before = n.logItems().length
n.pushLog(9, '🎉', '')
check('yalnız-emoji mesaj boş satır bırakmaz', n.logItems().length === before)
console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail?1:0)
