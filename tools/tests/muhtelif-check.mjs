/**
 * SINIFLANDIRILMAMIŞ (Z) GRUBU TESTİ.
 *
 *  #1067 "akaryakıt alımı için birkaç farklı marka satıcı olabilir" → üç kurgusal
 *        tedarikçi (gerçek marka adı YOK), hız/fiyat takası
 *  #1014 "arka planda çalışıyor ama ilerleme olmuyor" +
 *  #1016 "sekme bile değiştirsek duruyor"                → dönüşte offline telafi
 *  #1025 itibar şeffaflığı · #1030 arsa-asfalt boşluğu · #1075 otoyol şeritleri
 *  #1032 tabela yola dikilemez · #1043/#1044 uranyum ömrü
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, SUPPLIERS, serializeState, hydrateState } = await import('../../src/state.ts')
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

// ── #1067 tedarikçiler ──
const idler = Object.keys(SUPPLIERS)
bekle(idler.length === 3, `üç tedarikçi tanımlı (${idler.join(', ')})`)
const markalar = /aygaz|milangaz|ipragaz|petrol ofisi|opet|shell|bp/i
bekle(!markalar.test(JSON.stringify(SUPPLIERS)), 'gerçek marka adı kullanılmıyor (ticari marka riski yok)')
bekle(SUPPLIERS.ekonomi.priceMult < 1 && SUPPLIERS.ekonomi.etaMult > 1, 'ucuz tedarikçi YAVAŞ (takas gerçek)')
bekle(SUPPLIERS.hizli.priceMult > 1 && SUPPLIERS.hizli.etaMult < 1, 'hızlı tedarikçi PAHALI')
bekle(SUPPLIERS.standart.priceMult === 1 && SUPPLIERS.standart.etaMult === 1,
  'standart tedarikçi mevcut dengeyi AYNEN koruyor (varsayılan)')

const kur = sup => { const s = new GameState(); s.money = 2_000_000; s.supplier = sup; return s }
bekle(new GameState().supplier === 'standart', 'yeni oyun standart tedarikçiyle başlıyor')
const ucuz = kur('ekonomi'), std = kur('standart'), hiz = kur('hizli')
bekle(ucuz.orderCost('benzin') < std.orderCost('benzin'),
  `ucuz tedarikçi daha az tutuyor (₺${ucuz.orderCost('benzin')} < ₺${std.orderCost('benzin')})`)
bekle(hiz.orderCost('benzin') > std.orderCost('benzin'),
  `hızlı tedarikçi daha pahalı (₺${hiz.orderCost('benzin')} > ₺${std.orderCost('benzin')})`)
ucuz.placeOrder('benzin'); std.placeOrder('benzin'); hiz.placeOrder('benzin')
bekle(hiz.orders.benzin.eta < std.orders.benzin.eta,
  `hızlı tanker daha erken geliyor (${hiz.orders.benzin.eta} sn < ${std.orders.benzin.eta} sn)`)
bekle(ucuz.orders.benzin.eta > std.orders.benzin.eta,
  `ucuz tanker daha geç geliyor (${ucuz.orders.benzin.eta} sn)`)

const geri = new GameState()
hydrateState(geri, JSON.parse(JSON.stringify(serializeState(kur('hizli')))))
bekle(geri.supplier === 'hizli', 'seçilen tedarikçi kayıttan geri geliyor')
const bozuk = new GameState()
hydrateState(bozuk, { ...JSON.parse(JSON.stringify(serializeState(std))), supplier: 'yok-boyle-bir-sey' })
bekle(bozuk.supplier === 'standart', 'bilinmeyen tedarikçi standarda düşüyor (fiyat NaN olmuyor)')
bekle(Number.isFinite(bozuk.orderCost('benzin')), 'kurcalanmış kayıtta sipariş tutarı sayı kalıyor')

// ── #1014 / #1016 arka plan telafisi ──
const ana = oku('src/main.ts')
bekle(/function applyOfflineEarnings\(gecenSn\?: number\)/.test(ana), 'offline gelir açık süreyle çağrılabiliyor')
bekle(/gizlendiT = Date\.now\(\)/.test(ana), 'sekme gizlenince zaman damgası alınıyor')
bekle(/if \(gecen >= 120\) \{[\s\S]{0,200}applyOfflineEarnings\(gecen\)/.test(ana),
  'dönüşte 2 dakikadan uzun kesinti telafi ediliyor')
bekle(/loadedSaveAt = Date\.now\(\)/.test(ana), 'aynı süre reload\'da İKİNCİ kez ödenmiyor')
bekle(/this\.ctx\?\.suspend\(\)/.test(oku('src/audio.ts')),
  'arka planda ses askıya alınıyor (#1014 "ilerleme yoksa sesi de kapatsın")')

// ── #1025 itibar şeffaflığı ──
const r = new GameState()
r.stats.served = 40; r.stats.lost = 0
const bugun = r.repToday()
bekle(bugun.served === 40 && bugun.lost === 0, 'bugünkü servis/kayıp okunabiliyor')
bekle(bugun.target === 5, `kayıpsız günün hedefi 5.0 (donma değil, hedefe ulaşmış)`)
const r2 = new GameState()
r2.stats.served = 30; r2.stats.lost = 10
bekle(r2.repToday().target < 4, `kayıplı günde hedef düşüyor (${r2.repToday().target.toFixed(2)})`)
bekle(/Gün sonu itibar hedefi/.test(ana), 'panel gün sonu hedefini gösteriyor')

// ── #1030 / #1075 sahne ──
const dunya = oku('src/world.ts')
bekle(/const seritSayisi = Math\.max\(1, th\.lane\.count \?\? 1\)/.test(dunya), 'asfalt genişliği şerit sayısından türüyor')
bekle(/seritSayisi >= 3 \? 6\.8 : seritSayisi === 2 \? 6\.0 : 4\.6/.test(dunya), 'otoyol (3 şerit) geniş asfalt alıyor')
bekle(/const edgeOff = roadW \/ 2 - 0\.14/.test(dunya), 'kenar çizgileri asfaltla birlikte kayıyor (elle sabit yok)')
bekle(/th\.id !== 'kasaba' && asfaltBasi > 5\.0/.test(dunya), 'arsa-asfalt arası beton payla kapatılıyor')
bekle(/kır istasyonu\s*\n?\s*\/\/ imzası|kır istasyonu/.test(dunya), 'kasabada yeşil bant BİLEREK korunuyor')

// ── #1032 tabela yola dikilemez ──
bekle(/const yolBandi = Math\.abs\(eff\.cx - ROAD_X\) < 2\.6 \+ eff\.w \/ 2/.test(ana), 'tabela yol bandına konamıyor')
bekle(/placing\.valid = !yolBandi/.test(ana), 'yol bandı geçersiz konum sayılıyor')

// ── #1043 / #1044 uranyum ──
const durum = oku('src/state.ts')
const dr = durum.match(/const URANIUM_DRAIN_PER_S = 100 \/ (\d+)/)
bekle(!!dr, 'uranyum tükenme hızı okunabiliyor')
if (dr) {
  const omur = Number(dr[1])
  bekle(omur >= 700, `tam çubuk ${omur} sn ≈ ${(omur / 160).toFixed(1)} oyun günü (eskiden 300 sn)`)
}

// ── #1271/#1272 arsa tavanı "para yetmiyor" diyordu (metropol-2 12/12, kasada ₺701M) ──
{
  const main = oku('src/main.ts')
  const i = main.indexOf("state.parcelLimitReached() ? t('Bu şubede arsa tavanı dolu")
  const j = main.indexOf('Para yetmiyor: bu arsa ₺')
  bekle(i > 0 && j > i, 'arsa tavanı doluyken sebep TAVAN (para metninden ÖNCE sınanıyor)')
  bekle(/state\.money < cost \? `Para yetmiyor: bu arsa/.test(main), '"para yetmiyor" yalnız para gerçekten yetmeyince yazılıyor')
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'metropol', 'metropol-2']; s.activeLoc = 'metropol-2'
  s.money = 701_000_000
  for (const k of ['0,0', '1,0', '2,0', '2,1', '2,2', '1,2', '0,2', '1,1', '3,0', '3,1', '3,2']) s.ownedParcels.add(k)
  bekle(s.parcelLimit() === 12 && s.parcelLimitReached(), `metropol-2: ${s.ownedParcels.size}/${s.parcelLimit()} → tavan dolu (oyuncunun durumu)`)
}

console.log(hata ? `\n${hata} HATA` : '\nMUHTELİF TEMİZ')
process.exit(hata ? 1 : 0)
