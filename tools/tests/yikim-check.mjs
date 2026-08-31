/**
 * YIKIM TESTİ — "yanlış ünite yıkılıyor" (#634 #1046) + paylaşılan kumbaranın silinmesi.
 *
 * BULUNAN İKİ HATA (ikisi de aynı fonksiyonda, removeBuildingVisual):
 *
 * 1) TIKLANAN DEĞİL, SON ÖRNEK GİDİYORDU. Sayılabilir tesislerde (solar/parking/
 *    selfwash/airwater/lamp) hangi örneğe tıklanırsa tıklansın SON örneğin görseli
 *    kaldırılıyordu. Bu, isim dizisinde boşluk kalmasın diye alınmış doğru bir karardı
 *    (#495) ama tek başına oyuncuya yalan söylüyordu: soldakine "yık" diyorsun, soldaki
 *    duruyor, sağdaki yok oluyor. Artık son örnek kaldırıldıktan sonra TIKLANAN örnek
 *    onun konumuna taşınıyor — ayakta kalan konumlar = eskisi eksi tıklanan nokta.
 *
 * 2) BİR ÜNİTE SATINCA TÜRÜN TÜM KUMBARASI SİLİNİYORDU. pendingCash tesis TÜRÜ başına
 *    tek kayıt tutuyor, yani 5 hava-su aynı kumbarayı paylaşıyor. Silme koşulsuzdu:
 *    ₺600 iade alıp ₺2.400 kaybetmek mümkündü. Artık tür tamamen kalkmadıkça kumbaraya
 *    dokunulmuyor.
 *
 * Kullanım:  npm run dev -- --port 5399   →   npx tsx tools/tests/yikim-check.mjs
 */
import { chromium } from 'playwright-core'

let pass = 0, fail = 0
const check = (ad, ok, ek = '') => { console.log(`  ${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`); ok ? pass++ : fail++ }

const PORTLAR = process.env.PORT ? [process.env.PORT] : ['5399', '5311', '5173', '5174']
let PORT = null
for (const p of PORTLAR) {
  try { if ((await fetch(`http://localhost:${p}/`, { signal: AbortSignal.timeout(1500) })).ok) { PORT = p; break } }
  catch { /* sıradaki */ }
}
if (!PORT) {
  console.log(`❌ dev sunucu bulunamadı (${PORTLAR.join(', ')}) — test KOŞMADI.`)
  console.log(`   Çalıştır: npm run dev -- --port ${PORTLAR[0]}`)
  process.exit(1)
}

const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(e.message))
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForFunction(() => !!window.__dbg?.kayit?.yik, null, { timeout: 30000 })
await p.waitForTimeout(1500)

console.log('== 1) TIKLANAN örnek gidiyor mu ==')
const r1 = await p.evaluate(async () => {
  const K = window.__dbg.kayit, S = window.__dbg.state ?? window.__dbg.s
  // üç hava-su ünitesi, ÜÇÜ DE FARKLI noktada
  const yerler = [[-12, 4], [-12, 8], [-12, 12]]
  window.__dbg.setCount?.('airwater', 3)
  return { yerler, once: K.binalar() }
})
// Sahneyi doğrudan kurmak yerine oyunun kendi yolunu kullanmak gerekiyor: hangi kancanın
// var olduğunu ölç, yoksa testi ATLAMA — açıkça düşür (bugün üç kez sessiz atlama çıktı).
const kanca = await p.evaluate(() => ({
  yik: !!window.__dbg?.kayit?.yik,
  yuk: !!window.__dbg?.kayit?.yukle,
  yuklem: !!window.__dbg?.kayit?.yuk,
}))
check('yıkım kancası sayfada var', kanca.yik)
check('kayıt yükleme kancası var', kanca.yuk && kanca.yuklem)

const sonuc = await p.evaluate(async () => {
  const K = window.__dbg.kayit
  const d = K.yuk()
  // 3 hava-su ünitesi, üçü de ayrı noktada — kayıt üzerinden kur
  d.s.airWaterCount = 3
  d.placedPos = { ...(d.placedPos ?? {}) }
  d.placedPos['airwater'] = [-12, 4]
  d.placedPos['airwater#1'] = [-12, 8]
  d.placedPos['airwater#2'] = [-12, 12]
  d.s.pendingCash = { ...(d.s.pendingCash ?? {}), airwater: 2400 }
  K.yukle(d)
  await new Promise(r => setTimeout(r, 400))
  // GERÇEK konumu okuyoruz, İSTEDİĞİMİZİ değil: onarım turu çakışan üniteyi
  // kaydırabiliyor, o yüzden "-12,8 gitti" demek boş bir iddia olurdu.
  const y0 = K.yuk()
  const oncekiKonumlar = ['airwater', 'airwater#1', 'airwater#2']
    .map(k => y0.placedPos?.[k]).filter(Boolean)
  const tiklananKonum = y0.placedPos?.['airwater#1'] ?? null
  const duranlar = [y0.placedPos?.['airwater'], y0.placedPos?.['airwater#2']].filter(Boolean)
  const oncekiKumbara = K.yuk().s.pendingCash?.airwater ?? 0
  // ORTADAKİNİ yık (en zor durum: ne ilk ne son)
  const sonra = K.yik('airwater#1')
  await new Promise(r => setTimeout(r, 400))
  const y = K.yuk()
  return {
    oncekiKonumlar, oncekiKumbara, tiklananKonum, duranlar,
    kalanBinalar: sonra.binalar.filter(x => String(x).startsWith('airwater')),
    kalanKonumlar: ['airwater', 'airwater#1', 'airwater#2']
      .map(k => y.placedPos?.[k]).filter(Boolean),
    sayac: y.s.airWaterCount,
    kumbara: y.s.pendingCash?.airwater ?? 0,
  }
})

const anahtar = xy => `${Number(xy[0]).toFixed(1)},${Number(xy[1]).toFixed(1)}`
check('kurulum: 3 ünite 3 ayrı noktada', sonuc.oncekiKonumlar.length === 3,
  sonuc.oncekiKonumlar.map(anahtar).join(' · '))
check('kurulum: kumbarada para var', sonuc.oncekiKumbara === 2400, `₺${sonuc.oncekiKumbara}`)

check('yıkımdan sonra sayaç 3 → 2', sonuc.sayac === 2, `${sonuc.sayac}`)
check('sahnede 2 hava-su kaldı', sonuc.kalanBinalar.length === 2, sonuc.kalanBinalar.join(', '))
check('isim dizisi bütün (boşluk yok: airwater + airwater#1)',
  sonuc.kalanBinalar.sort().join(',') === 'airwater,airwater#1', sonuc.kalanBinalar.join(', '))

const kalan = new Set(sonuc.kalanKonumlar.map(anahtar))
// İddialar ÖLÇÜLEN konumlara dayanıyor. Sabit koordinat yazmak boş bir iddia olurdu:
// onarım turu üniteyi kaydırırsa "yok" kontrolü kendiliğinden geçer ve test hiçbir şey
// kanıtlamaz. Testin yeşil olması çalıştığı anlamına gelmiyor — bugünün dersi.
check('tıklanan ünitenin konumu ölçülebildi', !!sonuc.tiklananKonum,
  sonuc.tiklananKonum ? anahtar(sonuc.tiklananKonum) : 'YOK')
check('ölçülen üç konum da birbirinden farklı',
  new Set(sonuc.oncekiKonumlar.map(anahtar)).size === 3)
check(`TIKLANAN nokta (${sonuc.tiklananKonum ? anahtar(sonuc.tiklananKonum) : '?'}) GERÇEKTEN gitti`,
  !!sonuc.tiklananKonum && !kalan.has(anahtar(sonuc.tiklananKonum)),
  `kalan: ${[...kalan].join(' · ')}`)
for (const d of sonuc.duranlar) {
  check(`tıklanmayan (${anahtar(d)}) yerinde duruyor`, kalan.has(anahtar(d)),
    'eskiden bunlardan biri yok oluyordu — oyuncunun tıklamadığı ünite')
}

console.log('\n== 2) Paylaşılan kumbara korunuyor mu ==')
check('bir ünite satılınca TÜRÜN kumbarası silinmiyor', sonuc.kumbara === 2400,
  `₺${sonuc.kumbara} (eskiden ₺0 oluyordu)`)

const son = await p.evaluate(async () => {
  const K = window.__dbg.kayit
  K.yik('airwater#1'); await new Promise(r => setTimeout(r, 250))
  const ara = K.yuk()
  K.yik('airwater'); await new Promise(r => setTimeout(r, 250))
  const y = K.yuk()
  return { ara: ara.s.pendingCash?.airwater ?? 0, araSayac: ara.s.airWaterCount,
           kumbara: y.s.pendingCash?.airwater ?? 0, sayac: y.s.airWaterCount,
           binalar: K.binalar().filter(x => String(x).startsWith('airwater')) }
})
check('ikinci satışta da kumbara duruyor', son.ara === 2400, `₺${son.ara} · sayaç ${son.araSayac}`)
check('SON ünite gidince sayaç 0', son.sayac === 0)
check('SON ünite gidince kumbara temizleniyor (ölü para kalmıyor)', son.kumbara === 0)
check('sahnede hava-su kalmadı', son.binalar.length === 0, son.binalar.join(', '))

console.log('\n== 3) Sayfa sağlığı ==')
check('tur boyunca sayfa hatası yok', hatalar.length === 0, hatalar.slice(0, 2).join(' | '))

await b.close()
console.log(`\n${fail === 0 ? '✅' : '❌'} yıkım: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
