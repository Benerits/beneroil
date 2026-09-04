/**
 * MARİNA İHALESİ + TEKNE DEBİSİ TESTİ (Oğuz, 4 Eyl 2026; feedback #1252 #719 #729 #909 #934 #1302).
 *
 * ŞİKÂYETLER:
 *  · "Marinada ihalede Belediye Otobüs Filosu / Taksi Durağı çıkıyor" — şablonlar konuma bakmıyordu.
 *  · "Hep otobüs avantajlı, ihale dinamik değil" — liste sabitti, en uzun şablon primde hep öndeydi.
 *  · "Süperyat dakikalarca doluyor, bekleyenler kaçıyor, itibar eriyor" — tekne 7 L/sn kara
 *    debisiyle doluyordu (2.500–6.000 L → 6–14 dk); BOAT_SEGMENTS.serviceSec hiç kullanılmıyordu.
 *  · İhale filosu marinaya hiç gelmiyordu (spawnFleet su şubesinde kapalıydı) — artık tekne gelir.
 *
 * Kullanım: npx tsx tools/tests/marina-ihale-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState, hydrateState, serializeState, CONTRACT_TEMPLATES_KARA, CONTRACT_TEMPLATES_DENIZ,
  contractBonusRate, tekneDebisi, FILL_RATE } = await import('../../src/state.ts')
const { BOAT_SEGMENTS } = await import('../../src/marina.ts')

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

/** her yakıtı bol satan, deposu geniş bir şube (teklif şartlarını sağlasın) */
const kur = (loc) => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'marina']
  s.activeLoc = loc
  s.day = 20
  s.tankLevel = 3
  s.tankCounts = { benzin: 4, dizel: 4, lpg: 4 }
  for (let d = 13; d <= 20; d++) for (const f of ['benzin', 'dizel', 'lpg'])
    s.fuelLog.push({ day: d, f, liters: 3000, cost: 20000 })
  return s
}

console.log('── ŞABLON: kara ↔ deniz ayrımı ──')
const karaAd = new Set(CONTRACT_TEMPLATES_KARA.map(t => t.name))
const denizAd = new Set(CONTRACT_TEMPLATES_DENIZ.map(t => t.name))
bekle(CONTRACT_TEMPLATES_DENIZ.length === 5 && CONTRACT_TEMPLATES_KARA.length === 5, '5 kara + 5 deniz şablonu')
bekle(CONTRACT_TEMPLATES_DENIZ.every(t => t.boat && BOAT_SEGMENTS.some(b => b.id === t.boat)), 'her deniz şablonunun geçerli bir tekne türü var')
bekle(CONTRACT_TEMPLATES_DENIZ.every(t => t.fuel !== 'lpg'), 'deniz şablonunda LPG yok (marinada satılmaz)')
bekle(CONTRACT_TEMPLATES_KARA.every(t => !t.boat), 'kara şablonunda tekne yok')
bekle(![...denizAd].some(n => /otobüs|taksi|şantiye/i.test(n)), 'deniz listesinde otobüs/taksi/şantiye yok')

const marina = kur('marina')
bekle(marina.isMarina, 'marina şubesi aktif')
const mTeklif = marina.contractOffers()
bekle(mTeklif.length === 3, 'marinada 3 teklif sunulur', `${mTeklif.length}`)
bekle(mTeklif.every(o => denizAd.has(o.name) && !karaAd.has(o.name)), 'marina teklifleri YALNIZ deniz şablonu', mTeklif.map(o => o.name).join(' | '))
bekle(mTeklif.every(o => o.boat && o.fuel !== 'lpg'), 'marina tekliflerinde tekne türü var, LPG yok')

const kara = kur('kasaba')
const kTeklif = kara.contractOffers()
bekle(kTeklif.length === 3, 'karada 3 teklif sunulur', `${kTeklif.length}`)
bekle(kTeklif.every(o => karaAd.has(o.name) && !o.boat), 'kara teklifleri YALNIZ kara şablonu, tekne yok', kTeklif.map(o => o.name).join(' | '))

console.log('\n── ROTASYON: gün değişince teklif seti değişir ──')
const setler = new Set()
for (let d = 20; d < 30; d++) { kara.day = d; setler.add(kara.contractOffers().map(o => o.name).sort().join('|')) }
bekle(setler.size >= 3, '10 günde en az 3 farklı teklif seti', `${setler.size} set`)
kara.day = 20
const tekrar = kara.contractOffers().map(o => o.id).join('|')
bekle(tekrar === kTeklif.map(o => o.id).join('|'), 'aynı gün aynı teklifler (gün tohumlu, deterministik)')

console.log('\n── PRİM: indirim derinse prim oranı yüksek ──')
bekle(contractBonusRate(0.88) > contractBonusRate(0.90) && contractBonusRate(0.90) > contractBonusRate(0.92),
  'prim oranı sıralaması 0.88 > 0.90 > 0.92', `${contractBonusRate(0.88)} / ${contractBonusRate(0.90)} / ${contractBonusRate(0.92)}`)
bekle(contractBonusRate(0.5) <= 0.18 && contractBonusRate(1) >= 0.06, 'prim oranı %6–%18 bandında sıkışır')
bekle(kTeklif.every(o => o.bonus > 0 && o.bonus % 100 === 0), 'primler pozitif ve 100 katı')

console.log('\n── KAYIT: tekne türü kayıtta korunur ──')
marina.signContract(mTeklif[0])
bekle(marina.contract?.boat === mTeklif[0].boat, 'imzalanan sözleşme tekne türünü taşır', String(marina.contract?.boat))
const kayit = () => JSON.parse(JSON.stringify(serializeState(marina)))
const yukle = d => { const g = new GameState(); hydrateState(g, d); return g }
const geri = yukle(kayit())
bekle(geri.contract?.boat === mTeklif[0].boat, 'serialize → hydrate: boat korunur')
const bozuk = kayit(); bozuk.contract.boat = 'ucaklar'
bekle(yukle(bozuk).contract?.boat === undefined, 'geçersiz tekne türü kayıttan elenir (eski/bozuk kayıt)')
const eski = kayit(); delete eski.contract.boat
bekle(yukle(eski).contract && yukle(eski).contract.boat === undefined, 'boat alanı olmayan eski kayıt yine yüklenir (ek alan, kırıcı değil)')

console.log('\n── TEKNE DEBİSİ: büyük tekne büyük hortumla dolar ──')
const sy = BOAT_SEGMENTS.find(b => b.id === 'superyat')
const jet = BOAT_SEGMENTS.find(b => b.id === 'jetski')
bekle(tekneDebisi(4000, sy.serviceSec) >= 4000 / sy.serviceSec, 'süperyat 4000 L → servis süresi ≤ serviceSec', `${(4000 / tekneDebisi(4000, sy.serviceSec)).toFixed(0)} sn ≤ ${sy.serviceSec}`)
bekle(4000 / tekneDebisi(4000, sy.serviceSec) < 240, 'süperyat 4000 L dolumu 4 dakikadan kısa (eskiden ~9,5 dk)')
bekle(tekneDebisi(40, jet.serviceSec) === FILL_RATE, 'jet ski tabana (FILL_RATE) düşer — küçük tekne yavaşlamaz')
bekle(tekneDebisi(500, undefined) === FILL_RATE && tekneDebisi(500, 0) === FILL_RATE, 'serviceSec yoksa/0 ise taban debi')
bekle(tekneDebisi(0, 60) === FILL_RATE, 'hedef litre 0 ise taban (NaN/0 yok)')
for (const b of BOAT_SEGMENTS) {
  const L = b.max / 9 // dizel fiyatıyla en büyük talep
  const sn = L / tekneDebisi(L, b.serviceSec)
  bekle(sn <= Math.max(b.serviceSec, L / FILL_RATE) + 1e-9 && sn <= 200, `${b.id}: en büyük talep ${Math.round(L)} L → ${sn.toFixed(0)} sn`)
}
const segs = marina.boatCarSegments()
bekle(segs.length > 0 && segs.every(cs => cs.serviceSec === BOAT_SEGMENTS.find(b => b.id === cs.id)?.serviceSec), 'boatCarSegments serviceSec\'i taşır')
// Marinada LPG yok: her tekne segmenti benzin ya da dizel istemeli (fuel boşsa cars.ts LPG atıyordu → yelkenli 0 L alıp gidiyordu)
bekle(segs.every(cs => cs.fuel === 'benzin' || cs.fuel === 'dizel'), 'her tekne segmentinin yakıtı benzin/dizel (LPG isteyen tekne yok)')
bekle(segs.find(cs => cs.id === 'surat')?.fuel === 'benzin' && segs.find(cs => cs.id === 'balikci')?.fuel === 'dizel', 'sürat teknesi benzin, balıkçı dizel')

console.log('\n── KOD BAĞLANTISI (canlı hat) ──')
const main = oku('src/main.ts'), cars = oku('src/cars.ts')
bekle(/c\.boat \? tekneDebisi\(c\.fullMode \? c\.hiddenNeedL : c\.demandLiters, c\.serviceSec\)/.test(main), 'dolum tıkı teknede tekneDebisi kullanıyor')
bekle(/boat: state\.contract\.boat/.test(main), 'sözleşme tekne türü cars.ts\'ye geçiyor (contract opts)')
bekle(/if \(ct && \(!suda \|\| ct\.boat\)\)/.test(cars), 'marinada filo yalnız tekne türü varsa doğar')
bekle(/new Car\(this\.scene, this\.lib, 'fuel', this\.opts\.prices\(\), seg, tekne,/.test(cars), 'spawnFleet teknesi Car\'a boat olarak gidiyor')
bekle(/this\.serviceSec = picked\?\.serviceSec \?\? 0/.test(cars), 'Car segmentten serviceSec alıyor')
// Tekne sabrı servis süresiyle büyür (süperyat 45 sn'de kaçmasın); serviceSec ataması sabırdan ÖNCE olmalı
bekle(/if \(boat\) this\.maxPatience \+= 0\.8 \* this\.serviceSec/.test(cars) && cars.indexOf('this.serviceSec = picked') < cars.indexOf('if (boat) this.maxPatience'), 'tekne sabrı serviceSec ile büyüyor (atama sırası doğru)')
bekle(/BOAT_SEGMENTS\.find\(b => b\.id === o\.boat\)/.test(main), 'ihale satırında filo tekne adı yazıyor')

console.log(hata ? `\n❌ ${hata} hata` : '\n✅ marina ihale + tekne debisi: hepsi geçti')
process.exit(hata ? 1 : 0)
