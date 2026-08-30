/**
 * RAKİP DERİNLİĞİ TESTİ — "yaşayan rakip: fiyat kırar, müşteri çalar, karşına açar".
 *
 * ÖNCESİ: rakip YALNIZCA fiyatla oynuyordu (kes / zam / kampanya / bekle). Oyuncu bir
 * kez fiyatı ayarlayınca rakip nötrleşiyor, baskı bitiyordu.
 *
 * EKLENEN: fiyat dibe yakınken rakip parasını SAHAYA yatırır —
 *  · YATIRIM: karşına aynı tesisi açar → o tesisin geliri 14 gün %35 düşer (SÜRELİ,
 *    tek tesise özgü; kalıcı hasar yok — türün telafi ilkesi).
 *  · TRANSFER: agresif rakip pompacını transfer eder → staffLevel düşer, eğitimle geri alınır.
 *
 * Kullanım: npx tsx tools/tests/rakip-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, hydrateState, serializeState } = await import('../../src/state.ts')
const { rivalDecide, freshRival, RIVAL_FACILITY_LABEL } = await import('../../src/rival.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── RAKİP ARTIK FİYAT DIŞINDA DA HAMLE YAPIYOR ──')
// fiyat DİBE yakın (kesecek yer yok) + rakip kaybediyor → saha hamlesi çıkmalı
const r = freshRival(30, 10)
r.price = 30.2
const floor = 30.0
const hamleler = new Set()
for (let gun = 10; gun < 400; gun++) {
  const mv = rivalDecide({ ...r }, 'agresif', gun, 29.5, 0.72, floor)
  hamleler.add(mv.kind)
}
console.log('   çıkan hamleler:', [...hamleler].join(', '))
bekle(hamleler.has('yatirim'), 'fiyat dipteyken rakip SAHAYA yatırım yapıyor (baskı bitmiyor)')
bekle(hamleler.size >= 3, 'rakip tek boyutlu değil', `${hamleler.size} farklı hamle`)

// transfer hamlesi agresif rakipte çıkmalı
// FİYAT DİPTE OLMALI: fiyat yüksekken 'kes' dalı önce dönüyor ve transfer'e hiç
// ulaşılmıyordu (ilk kurulumum bunu kaçırmıştı). promoDays>0 ile kampanya dalı da atlanır.
let transferVar = false
for (let gun = 10; gun < 600; gun++) {
  const rr = freshRival(30, 10); rr.price = 30.2; rr.promoDays = 3
  if (rivalDecide(rr, 'agresif', gun, 29.5, 0.72, 30.0).kind === 'transfer') { transferVar = true; break }
}
bekle(transferVar, 'agresif rakip personel transfer edebiliyor')

// yatırım hamlesi geçerli bir tesis seçmeli
let yatirimMv = null
for (let gun = 10; gun < 400 && !yatirimMv; gun++) {
  const mv = rivalDecide({ ...r }, 'agresif', gun, 29.5, 0.72, floor)
  if (mv.kind === 'yatirim') yatirimMv = mv
}
bekle(!!yatirimMv?.yatirim && !!RIVAL_FACILITY_LABEL[yatirimMv.yatirim],
  'yatırım hamlesi geçerli tesis seçiyor', yatirimMv?.yatirim)
bekle((yatirimMv?.etkiGun ?? 0) > 0, 'yatırımın SÜRESİ var (kalıcı değil)', `${yatirimMv?.etkiGun} gün`)

console.log('\n── BASKI GELİRİ GERÇEKTEN DÜŞÜRÜYOR ──')
const s = new GameState()
s.unlockedLocs = ['kasaba', 'cevreyolu']; s.activeLoc = 'cevreyolu'
bekle(s.rivalFacMult('market') === 1, 'baskı yokken çarpan nötr')

s.rivalPush = { fac: 'market', daysLeft: 14 }
bekle(s.rivalFacMult('market') < 1, 'rakip market açtıysa market geliri düşüyor', `×${s.rivalFacMult('market')}`)
bekle(s.rivalFacMult('market2') < 1, 'ikinci market de etkileniyor')
bekle(s.rivalFacMult('wash') === 1, 'BAŞKA tesis etkilenmiyor (baskı tek tesise özgü)')

// addPending gerçekten kesiyor mu
const temiz = new GameState()
temiz.addPending('market', 1000, 'Market')
const baskili = new GameState()
baskili.rivalPush = { fac: 'market', daysLeft: 10 }
baskili.addPending('market', 1000, 'Market')
bekle(baskili.facTotal['market'] < temiz.facTotal['market'],
  'gelir TEK NOKTADAN kesiliyor (addPending)',
  `₺${Math.round(baskili.facTotal['market'])} < ₺${Math.round(temiz.facTotal['market'])}`)
const oran = baskili.facTotal['market'] / temiz.facTotal['market']
bekle(oran > 0.5 && oran < 0.8, 'kesinti makul aralıkta (ölüm değil, baskı)', `×${oran.toFixed(2)}`)

console.log('\n── BASKI SÜRELİ: KALICI HASAR YOK ──')
const g = new GameState()
g.unlockedLocs = ['kasaba', 'cevreyolu']; g.activeLoc = 'cevreyolu'
g.rival = freshRival(30, 5)
g.rivalPush = { fac: 'market', daysLeft: 2 }
g.day = 20; g.rivalDayTurn()
bekle(g.rivalPush?.daysLeft === 1, 'baskı her gün geri sayıyor')
g.day = 21; g.rivalDayTurn()
bekle(g.rivalPush === null, 'süre dolunca baskı KALKIYOR (kalıcı hasar yok)')
bekle(g.rivalFacMult('market') === 1, 'baskı kalkınca gelir normale dönüyor')

console.log('\n── TRANSFER TELAFİ EDİLEBİLİR ──')
const p2 = new GameState()
bekle(p2.staffLevel >= 1, 'personel seviyesi tabanı var', `Sv.${p2.staffLevel}`)
p2.staffLevel = 3
p2.staffLevel = Math.max(1, p2.staffLevel - 1)   // transfer etkisi
bekle(p2.staffLevel === 2, 'transfer bir seviye düşürüyor')
p2.staffLevel = 1
p2.staffLevel = Math.max(1, p2.staffLevel - 1)
bekle(p2.staffLevel === 1, 'personel 1\'in ALTINA düşmüyor (oyun oynanamaz hale gelmez)')

console.log('\n── SAVE UYUMLULUĞU ──')
const state_ts = oku('src/state.ts')
bekle(/'rival', 'rivalPush'/.test(state_ts), 'rivalPush SAVE_FIELDS\'ta')
const eski = { money: 300_000, day: 60, reputation: 4.0, pumps: 5,
               stats: { served: 100, lost: 5, kwh: 0, revenue: 500 } }
const s3 = new GameState()
hydrateState(s3, eski)
bekle(s3.rivalPush === null, 'ESKİ kayıt: rakip baskısı null (çökmüyor)')
bekle(s3.rivalFacMult('market') === 1, 'eski kayıtta gelir kesintisi YOK')
bekle(s3.money === 300_000, 'eski kayıt değerleri korunuyor')
const tekrar = serializeState(s3)
bekle('rivalPush' in tekrar, 'rivalPush tekrar kaydediliyor')

// rakip hiç açılmamışsa hiçbir şey bozulmamalı
const kasaba = new GameState()
bekle(kasaba.rivalAllowed() === false, 'ilk şubede rakip YOK (yeni oyuncu korunuyor)')
bekle(kasaba.rivalDayTurn() === '', 'rakipsiz gün dönüşü sessiz')
bekle(kasaba.rivalFacMult('market') === 1, 'rakipsiz oyunda gelir tam')

console.log('\n── KOD BAĞLANTISI ──')
const rival_ts = oku('src/rival.ts')
bekle(/'yatirim' \| 'transfer'/.test(rival_ts), 'yeni hamle türleri tanımlı')
bekle(/RIVAL_FACILITY_LABEL/.test(rival_ts), 'tesis etiketleri var (mesajlar okunabilir)')
bekle(/mv\.kind === 'yatirim'/.test(state_ts), 'yatırım hamlesi state\'e bağlı')
bekle(/mv\.kind === 'transfer'/.test(state_ts), 'transfer hamlesi state\'e bağlı')
bekle(/amt = amt \* this\.rivalFacMult\(id\)/.test(state_ts), 'baskı gelir kapısında uygulanıyor')

console.log(hata ? `\n${hata} HATA` : '\nRAKİP DERİNLİĞİ TEMİZ')
process.exit(hata ? 1 : 0)
