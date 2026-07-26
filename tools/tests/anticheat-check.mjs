// HİLE FRENİ testleri — iki şeyi BİRLİKTE kanıtlamak zorunda:
//   (a) MEŞRU oyuncu asla kırpılmaz (yanlış alarm = "param gitti" şikâyeti)
//   (b) HİLEKÂR gerçekten durur (push spam'i bedava para getirmez)
// Sunucu fonksiyonlarını kaynaktan CANLI çıkarır — kopya sürüklenmesi olamaz.
// Çalıştır: npm run test:anticheat
import fs from 'node:fs'
const src = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
const block = src.slice(src.indexOf('const clamp = '), src.indexOf('function sanitizeSave'))
const fn = new Function(block + '; return { buildingValue, snapshotsValue, maxIncomeRate, ALLOW_BURST, clamp }')()
const { buildingValue, snapshotsValue, maxIncomeRate, ALLOW_BURST } = fn

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const wealth = s => (s.money || 0) + buildingValue(s) + snapshotsValue(s)

/** Sunucunun allowance mantığını birebir taklit et (jeton kovası) */
function simulate(save, pushes, gainPerPush, gapSec) {
  let s = JSON.parse(JSON.stringify(save))
  let bucket = ALLOW_BURST, t = Date.now(), clampedTotal = 0, granted = 0
  for (let i = 0; i < pushes; i++) {
    const now = t + gapSec * 1000
    const rate = maxIncomeRate(s)
    bucket = Math.min(ALLOW_BURST, bucket + ((now - t) / 1000) * rate)
    const prevW = wealth(s)
    const want = gainPerPush
    const allowed = Math.min(want, bucket)
    clampedTotal += want - allowed
    granted += allowed
    s.money = (s.money || 0) + allowed
    bucket = Math.max(0, bucket - Math.max(0, wealth(s) - prevW))
    t = now
  }
  return { granted, clampedTotal, saatlik: granted / (pushes * gapSec) * 3600 }
}

const gun1  = { money: 5000, pumps: 1, day: 1, brandStars: 0 }
const orta  = { money: 200000, pumps: 6, evChargers: 2, marketLevel: 2, hasWash: true, hasOil: true, day: 60, brandStars: 0 }
const ileri = { money: 5e6, pumps: 14, evChargers: 12, marketLevel: 3, hasWash: true, hasOil: true,
                hasRestaurant: true, hasCoffee: true, hasTruckPark: true, selfWashCount: 4, hasSMR: true,
                day: 300, brandStars: 14 }

console.log('== 1) Sunucu türevli kazanç hızı ekipmana bağlı mı ==')
const r1 = maxIncomeRate(gun1), r2 = maxIncomeRate(orta), r3 = maxIncomeRate(ileri)
console.log(`   gün-1 ${r1.toFixed(0)} ₺/sn · orta ${r2.toFixed(0)} · ileri ${r3.toFixed(0)}`)
check('gün-1 oyuncusu milyon iddia EDEMEZ (hız düşük)', r1 < 200)
check('hız ekipmanla artıyor', r2 > r1 * 2 && r3 > r2 * 2)
check('yıldız hızı çarpıyor ama sınırsız değil', maxIncomeRate({ ...ileri, brandStars: 40 }) < r3 * 3)

console.log('\n== 2) MEŞRU oyuncu kırpılmıyor (yanlış alarm yok) ==')
// gelişmiş istasyon aktif oyunda ~267 ₺/sn kazanır; istemci 30 sn'de bir push atar
const mesru = simulate(ileri, 40, 267 * 30, 30)
check(`gelişmiş istasyon 30sn'de bir push · hiç kırpılmadı (${Math.round(mesru.clampedTotal)} ₺)`,
  mesru.clampedTotal === 0, `${Math.round(mesru.clampedTotal)} ₺ kırpıldı`)
// gün dönüşü sıçraması: tek push'ta sözleşme + gün sonu ödemesi
const sicrama = simulate(ileri, 1, 240000, 60)
check(`tek seferlik büyük ödeme (₺240.000) geçiyor`, sicrama.clampedTotal === 0)
// orta oyuncu normal tempoda
const ortaSim = simulate(orta, 40, 98 * 30, 30)
check(`orta oyuncu hiç kırpılmadı`, ortaSim.clampedTotal === 0)
// uzun offline dönüş: 2 saat sonra tek push
const offline = simulate(ileri, 1, 150000, 7200)
check('2 saatlik offline kazanç (₺150.000) geçiyor', offline.clampedTotal === 0)

console.log('\n== 3) HİLEKÂR duruyor ==')
// eski açık: 3 sn'de 2 push, her push'ta 100.000 taban
const hile = simulate(gun1, 400, 100000, 1.5)
console.log(`   gün-1 hesabı push spam: ${Math.round(hile.saatlik).toLocaleString('tr-TR')} ₺/saat`)
check(`push spam'i artık işe yaramıyor (saatlik ${Math.round(hile.saatlik / 1e6)}M ≤ 5M)`,
  hile.saatlik < 5e6)
check('istenen paranın çoğu KIRPILDI', hile.clampedTotal > hile.granted * 5)
// eski sistemle kıyas
const eskiSaatlik = (100000 + 1.5 * 2500) * (2 / 3) * 3600
console.log(`   eski sistem aynı senaryoda: ${Math.round(eskiSaatlik).toLocaleString('tr-TR')} ₺/saat`)
check(`eski açığa göre en az 50 kat kısıldı`, eskiSaatlik / hile.saatlik > 50,
  `${(eskiSaatlik / hile.saatlik).toFixed(0)}x`)
// ASIL GÜVENLİK ÖZELLİĞİ: sürekli kazanç hızı EKİPMANA bağlı bir tavanla sınırlı.
// (Jeton kovası doğası gereği sık push'a bir miktar avantaj verir — kova dolduktan
//  sonraki refill boşa gider. Bu kabul edilebilir: avantaj SABİT bir katsayıyla
//  sınırlı ve sürekli hız yine ekipman tavanını aşamaz.)
const sik = simulate(ileri, 400, 1e7 / 40, 3)
const tavan = maxIncomeRate(ileri)
check(`sürekli hız ekipman tavanını aşmıyor (${Math.round(sik.granted / 1200)} ≤ ${Math.round(tavan * 1.1)} ₺/sn)`,
  sik.granted / 1200 <= tavan * 1.1)
const seyrek = simulate(ileri, 10, 1e7, 120)
check(`sık push avantajı sınırlı (≤3x: seyrek ${Math.round(seyrek.granted / 1000)}k vs sık ${Math.round(sik.granted / 1000)}k)`,
  sik.granted <= seyrek.granted * 3)
// EN ÖNEMLİSİ: tavan SAHİP OLUNANLA ölçekleniyor — taze hesap para basamaz
const tazeHile = simulate(gun1, 2400, 1e6, 1.5)
check(`taze hesap saatte ${Math.round(tazeHile.saatlik / 1000)}k'dan fazla basamıyor (≤500k)`,
  tazeHile.saatlik <= 500_000, `${Math.round(tazeHile.saatlik).toLocaleString('tr-TR')} ₺/saat`)

console.log('\n== 4) Kova sunucu-sahipli (istemci kurcalayamaz) ==')
check('_ab sanitizeSave içinde clamp\'leniyor', /'_ab' in s[\s\S]{0,240}clamp\(a\.b, 0, 260000/.test(src))
check('kova tavanı sabit (ALLOW_BURST)', /const ALLOW_BURST = 260_000/.test(src))
check('kabul edilen artış kovadan DÜŞÜLÜYOR', /bucket = Math\.max\(0, bucket - gain\)/.test(src))
check('kova her push\'ta save\'e yazılıyor', /clean\.s\._ab = \{ t: nowMs/.test(src))
check('kırpma ve enjeksiyon DENETİM kaydına giriyor',
  /auditCheat\(email, 'clamp'/.test(src) && /auditCheat\(email, 'inject'/.test(src))
check('ilk save (misafirden taşıma) serbest kaldı', /firstSave\s*\n?\s*\?\s*\(60_000 \+ gameDays \* 40_000\)/.test(src))

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
