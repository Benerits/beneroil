/**
 * ARAÇ DURUŞ AÇISI TESTİ — "karşı yakadaki araç 180° ters park ediyor".
 *
 * KÖK NEDEN: addPump/addEvCharger içinde araç YUVASI far-flip ile hesaplanıyordu
 * (`dir = ang + (far ? π : 0)`) ama araç AÇISI flip'siz `ang` olarak yazılıyordu.
 * Yuva pompanın batısında, araç ise doğu yönüne bakıyor → burun ters.
 * Yakın yakada dir === ang olduğu için sorun hiç görünmüyordu.
 */
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const world = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')

bekle(/this\.pumpAngles\[index\] = dir/.test(world), 'pompa açısı far-flip DAHİL (dir)')
bekle(/this\.evAngles\[index\] = evDir/.test(world), 'şarj açısı far-flip DAHİL (evDir)')
bekle(!/this\.pumpAngles\[index\] = ang\b/.test(world), 'flip\'siz eski pompa açısı kalmamış')
bekle(!/this\.evAngles\[index\] = ang\b/.test(world), 'flip\'siz eski şarj açısı kalmamış')

// yuva ile açı AYNI değişkenden türemeli — ileride biri değişip diğeri kalmasın
const pumpBlok = world.slice(world.indexOf('const dir = ang + (far ? Math.PI : 0)'),
                             world.indexOf('this.pumpBase[index] = base.clone()'))
bekle(/Math\.cos\(dir\)/.test(pumpBlok) && /pumpAngles\[index\] = dir/.test(pumpBlok),
  'pompa: yuva ve açı AYNI kaynaktan (dir)')
const evBlok = world.slice(world.indexOf('const evDir = ang + (base.x > ROAD_X'),
                           world.indexOf('this.evBase[index] = base.clone()'))
bekle(/Math\.cos\(evDir\)/.test(evBlok) && /evAngles\[index\] = evDir/.test(evBlok),
  'şarj: yuva ve açı AYNI kaynaktan (evDir)')

// GEOMETRİ: yakın yakada davranış DEĞİŞMEMELİ, karşı yakada 180° düzelmeli
const ROAD_X = 7.9
const aci = (baseX, rot) => {
  const ang = rot * Math.PI / 2
  return ang + (baseX > ROAD_X ? Math.PI : 0)
}
const norm = a => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
for (const rot of [0, 1, 2, 3]) {
  const yakin = aci(0, rot), eskiYakin = rot * Math.PI / 2
  bekle(Math.abs(norm(yakin) - norm(eskiYakin)) < 1e-9,
    `yakın yaka rot${rot}: açı DEĞİŞMEDİ (regresyon yok)`)
}
for (const rot of [0, 1, 2, 3]) {
  const karsi = aci(15.3, rot), eski = rot * Math.PI / 2
  const fark = Math.abs(norm(karsi) - norm(eski))
  bekle(Math.abs(fark - Math.PI) < 1e-9,
    `karşı yaka rot${rot}: açı 180° düzeltildi`, `${Math.round(fark * 180 / Math.PI)}°`)
}
console.log(hata ? `\n${hata} HATA` : '\nARAÇ DURUŞ AÇISI TEMİZ')
process.exit(hata ? 1 : 0)
