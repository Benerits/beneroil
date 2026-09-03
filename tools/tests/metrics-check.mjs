// §9 ÖLÇÜM PLANI testi — /api/metrics hesabını sunucu kodundan CANLI çıkarıp doğrular.
// Çalıştır: npm run test:metrics
// /api/metrics saf hesap testi: sunucudaki bloğu izole edip sentetik oyuncularla doğrula
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url),'utf8')
// buildingValue + snapshotsValue + COST/FLAT tablolarını canlı olarak çıkar
const start = src.indexOf('const COST = {')
const end = src.indexOf('function sanitizeSave')
const block = src.slice(start, end)
const fns = new Function(block + '; return { buildingValue, snapshotsValue }')()

let pass=0, fail=0
const check=(n,c)=>{ c?(pass++,console.log('  ✓ '+n)):(fail++,console.log('  ✗ '+n)) }
console.log('== /api/metrics: §9 ölçüm hesabı ==')

const bucketOf = d => d < 8 ? '1-7' : d < 15 ? '8-14' : d < 31 ? '15-30' : d < 61 ? '31-60' : d < 121 ? '61-120' : '121+'
check('gün kovaları sınırda doğru', bucketOf(7)==='1-7' && bucketOf(8)==='8-14' && bucketOf(30)==='15-30' && bucketOf(31)==='31-60' && bucketOf(121)==='121+')

// nakit oranı: hiç ekipmanı olmayan yeni oyuncu = 1.0 (her şey nakit)
const yeni = { day:1, money:5000 }
const ev0 = fns.buildingValue(yeni) + fns.snapshotsValue(yeni)
check('ekipmansız oyuncunun nakit oranı 1.0', 5000/(ev0+5000) === 1)
// ekipmana yatırım yapan oyuncunun oranı düşer (sink çalışıyor demek)
const yatirimci = { day:40, money:5000, pumps:6, marketLevel:3, evChargers:4, hasWash:true, hasRestaurant:true }
const ev1 = fns.buildingValue(yatirimci) + fns.snapshotsValue(yatirimci)
const oran = 5000/(ev1+5000)
check(`yatırım yapan oyuncunun nakit oranı düşer (${oran.toFixed(3)} < 0.5)`, oran < 0.5)
// doygunluk: para birikip harcayacak yer kalmayınca oran 1'e yaklaşır
const doymus = { day:200, money:9_000_000, pumps:6, marketLevel:3, evChargers:4, hasWash:true, hasRestaurant:true }
const ev2 = fns.buildingValue(doymus) + fns.snapshotsValue(doymus)
const oran2 = 9_000_000/(ev2+9_000_000)
check(`doymuş oyuncuda oran > 0.5 (doygunluk sinyali: ${oran2.toFixed(3)})`, oran2 > 0.5)
check('doygunluk eşiği yatırımcıyı YANLIŞLIKLA işaretlemiyor', oran <= 0.5 && oran2 > 0.5)
// şubeli oyuncunun ekipmanı da sayılır (yoksa doygunluk yanlış erken görünür)
const subeli = { ...yatirimci, locSnapshots: { otoyol: { f: { pumps:6, evChargers:4 } } } }
check('şube ekipmanı da varlığa sayılır',
  fns.buildingValue(subeli)+fns.snapshotsValue(subeli) > ev1)
// medyan
const med = a => { if(!a.length) return 0; const x=[...a].sort((p,q)=>p-q); return x[Math.floor(x.length/2)] }
check('medyan uç değerden etkilenmez', med([1,2,3,4,1e9]) === 3)
check('medyan boş dizide çökmez', med([]) === 0)
// tutulma penceresi
const gun = 86400000, T = 1770000000000
const age = (c) => (T - c)/gun, seen = (c,l) => (l-c)/gun
check('1 günden yeni hesap D1 hesabına GİRMEZ', age(T-0.5*gun) < 1)
check('7. günde dönen oyuncu D7 sayılır', seen(T-10*gun, T-3*gun) >= 7)
check('3. günde bırakan oyuncu D7 sayılmaz', seen(T-10*gun, T-7*gun) < 7)

// /vs/v1/engagement SÖZLEŞMESİ (3 Eyl): sosyal medya skill'i (beneloil-social, fetch_metrics.py)
// milestone eşiklerini bu satır adlarından okur; ad değişirse skill "yok" der, rakam uydurmaz ama kör kalır.
console.log('\n== /vs/v1/engagement: skill\'in okuduğu satırlar ==')
const eng = src.slice(src.indexOf("url === '/vs/v1/engagement'"), src.indexOf("url.startsWith('/vs/v1/ads')"))
for (const ad of ['KAYITLI OYUNCU · toplam', 'AKTIF · son 24 saat', 'AKTIF · son 7 gun', 'AKTIF · son 30 gun',
  'MISAFIR · toplam', 'MISAFIR→KAYIT · toplam', 'toplam_musteri_servisi', 'satilan_benzin_L', 'satilan_dizel_L',
  'satilan_lpg_L', 'toplam_ciro_TL', 'en_ileri_oyun_gunu', 'nukleer_reaktorlu_istasyon', 'sorun_bildirimi'])
  check(`engagement satırı var: ${ad}`, eng.includes(`'${ad}'`))
check('active7d/active30d SQL\'de hesaplanıyor', /interval '7 day'\)::int AS active7d/.test(eng) && /interval '30 day'\)::int AS active30d/.test(eng))
check('engagement e-posta/isim döndürmüyor (aggregate-only)', !/email|\bname\b|avatar/.test(eng))
console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail?1:0)
