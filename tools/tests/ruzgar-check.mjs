/**
 * RÜZGÂR TÜRBİNİ TESTİ — yeni mekanik + Kenney asset geçişi.
 *
 * Türbinin NİŞİ: güneş yalnız gündüz üretir (sunFactor gece 0), türbin GECE DE
 * üretir ama rüzgâr değişkendir. Bu yüzden daha pahalı ve bakım ister — tür kuralı
 * gereği her güçlü yapının bir bedeli olmalı.
 *
 * Kullanım: npm run dev -- --port 5399  →  npx tsx tools/tests/ruzgar-check.mjs
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
const { GameState, hydrateState, serializeState, buyItem, getShopItems,
        getMaintenanceItems, doMaintenance, sellInfo, applySell } = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (ad, ok, ek = '') => { console.log(`  ${ok ? '✓' : '✗'} ${ad}${ek ? ' — ' + ek : ''}`); ok ? pass++ : fail++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const kur = () => { const s = new GameState(); s.money = 5_000_000; s.gridLevel = 1; return s }

console.log('== 1) Kenney assetleri yerinde ve ESKİ KİT BOZULMADI ==')
for (const f of ['windmill', 'solar-panel-portrait-group', 'detail-tank-large']) {
  check(`industrial2/${f}.glb var`, existsSync(new URL(`../../public/kenney/industrial2/${f}.glb`, import.meta.url)))
}
check('industrial2 KENDİ paletini taşıyor',
  existsSync(new URL('../../public/kenney/industrial2/Textures/colormap.png', import.meta.url)))
check('eski industrial kiti kendi paletini KORUYOR',
  existsSync(new URL('../../public/kenney/industrial/Textures/colormap.png', import.meta.url)),
  'iki atlas farklı — tek klasöre koymak birinin renklerini bozardı')
const models_ts = oku('src/models.ts')
check('modeller StaticLib üzerinden yükleniyor', /solarPanel: THREE\.Group \| null/.test(models_ts))
check('windmill yükleniyor', /industrial2\/windmill/.test(models_ts))
check('reaktör Kenney parçalarından', /industrial2\/detail-tank-large/.test(models_ts) && /industrial\/chimney-large/.test(models_ts))
const world_ts = oku('src/world.ts')
check('model yoksa YEDEK geometri var (sahne boş kalmaz)',
  /this\.statics\?\.solarPanel/.test(world_ts) && /this\.statics\?\.windmill/.test(world_ts))
check('kanatlar ayrı düğümden bulunuyor', /o\.name === 'blades'/.test(world_ts))
check('türbin kaldırılınca kanat kaydı temizleniyor',
  (world_ts.match(/blades = this\.blades\.filter/g) || []).length >= 2,
  'yoksa silinen türbinin kanadı her karede döndürülmeye çalışılır')

console.log('\n== 2) NİŞ: gece de üretir (güneşten farkı) ==')
const s = kur()
buyItem(s, 'wind')
check('türbin satın alınabiliyor', s.windCount === 1, `adet ${s.windCount}`)
s.sunFactor = 0                    // gece
const geceRuzgar = s.windRate()
s.solarCount = 1; s.sunFactor = 0
const geceToplam = s.freeRate()
check('GECE türbin üretiyor', geceRuzgar > 0, `${geceRuzgar.toFixed(2)} kWh/sn`)
const s2 = kur(); s2.solarCount = 1; s2.sunFactor = 0
check('GECE güneş paneli üretmiyor (niş gerçek)', s2.freeRate() === 0, `${s2.freeRate()} kWh/sn`)
check('gece toplam üretim = türbin', Math.abs(geceToplam - geceRuzgar) < 0.001)

console.log('\n== 3) RÜZGÂR DEĞİŞKEN ama makul aralıkta ==')
const s3 = kur(); buyItem(s3, 'wind')
let mn = 9, mx = 0
for (let i = 0; i < 4000; i++) { s3.windPhase += 1; const w = s3.windFactor(); mn = Math.min(mn, w); mx = Math.max(mx, w) }
check('rüzgâr gerçekten değişiyor', mx - mn > 0.3, `${mn.toFixed(2)} – ${mx.toFixed(2)}`)
check('hiç sıfıra düşmüyor (üretim tamamen durmaz)', mn > 0.2, mn.toFixed(2))
check('tavanı makul (bedava enerji patlaması yok)', mx <= 1.35, mx.toFixed(2))

console.log('\n== 4) YIPRANMA ve BAKIM ==')
const s4 = kur(); buyItem(s4, 'wind')
s4.windPhase = 0
const tazeUretim = s4.windRate()
for (let i = 0; i < 700; i++) s4.tick(1)
check('yıpranma zamanla artıyor', s4.windWear > 0.5, `%${Math.round(s4.windWear * 100)} (700 sn)`)
s4.windPhase = 0
check('yıpranınca üretim DÜŞÜYOR', s4.windRate() < tazeUretim * 0.75,
  `${tazeUretim.toFixed(2)} → ${s4.windRate().toFixed(2)} kWh/sn`)
const bakim = getMaintenanceItems(s4).find(r => r.id === 'service-wind')
check('bakım kalemi listede', !!bakim, bakim ? `₺${bakim.cost}` : 'YOK')
check('yıpranma yüksekken ACİL işaretli', !!bakim?.urgent)
const oncekiPara = s4.money
check('bakım uygulanıyor', doMaintenance(s4, 'service-wind') === true)
check('bakım yıpranmayı sıfırlıyor', s4.windWear === 0)
check('bakım ücreti kasadan düşüyor', s4.money === oncekiPara - 600, `₺${oncekiPara - s4.money}`)
s4.windPhase = 0
check('bakım sonrası üretim geri geliyor', Math.abs(s4.windRate() - tazeUretim) < 0.001)
const s5 = kur(); buyItem(s5, 'wind')
check('YIPRANMAMIŞ türbinde bakım kalemi PASİF (boş yere para alınmaz)',
  getMaintenanceItems(s5).find(r => r.id === 'service-wind')?.disabled === true)

console.log('\n== 5) MAĞAZA ve EKONOMİ ==')
const s6 = kur()
const satir = getShopItems(s6).find(r => r.id === 'wind')
check('mağaza satırı var', !!satir)
check('fiyat güneşten yüksek, reaktörden düşük', satir.cost > 9000 && satir.cost < 40000, `₺${satir.cost}`)
check('metin gece üretimini söylüyor', /GECE/i.test(satir.desc ?? ''))
const s7 = new GameState(); s7.money = 5_000_000
// Kilit `lock` alanında DEĞİL: satır status='locked' + note=sebep taşıyor. İlk
// yazdığımda `lock` diye bakmıştım — iddia yanlıştı, kod değil. Sebebin de
// yazılı olduğunu doğruluyoruz: tür kuralı "kilidin NEDENİ her zaman görünsün".
const s7row = getShopItems(s7).find(r => r.id === 'wind')
check('elektrik altyapısı YOKKEN kilitli', s7row?.status === 'locked', String(s7row?.status))
check('kilidin SEBEBİ yazıyor', /altyapı/i.test(s7row?.note ?? ''), s7row?.note)
const s8 = kur(); const p0 = s8.money
buyItem(s8, 'wind')
check('para tam olarak fiyat kadar düşüyor', p0 - s8.money === satir.cost, `₺${p0 - s8.money}`)
check('ekipman değerine giriyor (servet/teminat doğru)', s8.equipmentValue() > 0)
check('satılabiliyor, iade yarısı', sellInfo(s8, 'wind')?.refund === Math.round(satir.cost / 2))
applySell(s8, 'wind')
check('satınca sayaç düşüyor', s8.windCount === 0)

console.log('\n== 6) KAYIT UYUMLULUĞU (kırmızı çizgi) ==')
const s9 = kur(); buyItem(s9, 'wind'); buyItem(s9, 'wind'); s9.windWear = 0.42
const yuk = serializeState(s9)
check('windCount kaydediliyor', yuk.windCount === 2)
check('windWear kaydediliyor', Math.abs(yuk.windWear - 0.42) < 1e-9)
const s10 = new GameState(); hydrateState(s10, yuk)
check('yüklenince adet korunuyor', s10.windCount === 2)
check('yüklenince yıpranma korunuyor', Math.abs(s10.windWear - 0.42) < 1e-9)
const eski = { money: 300000, day: 60, reputation: 4, pumps: 5, stats: { served: 10, lost: 1, kwh: 0, revenue: 100 } }
const s11 = new GameState(); hydrateState(s11, eski)
check('ESKİ kayıt (alan yok) çökmüyor', s11.windCount === 0 && s11.windWear === 0)
check('eski kayıtta üretim değişmiyor', s11.windRate() === 0)
const state_ts = oku('src/state.ts')
check("SAVE_FIELDS'ta windCount+windWear var", /'windCount', 'windWear'/.test(state_ts))
check('LOC_FIELDS (şube anlık görüntüsü) da taşıyor', /'solarCount', 'windCount', 'windWear'/.test(state_ts))

console.log('\n== 7) DEVİR ve MÜDÜR ==')
const s12 = kur(); buyItem(s12, 'wind'); s12.windWear = 0.8
s12.money = 50_000_000; s12.pumps = 14; s12.evChargers = 12; s12.marketLevel = 3
s12.hasHotel = true; s12.hasTruckPark = true; s12.selfWashCount = 12
if (s12.handover()) {
  check('devirde türbin sıfırlanıyor', s12.windCount === 0)
  check('devirde yıpranma sıfırlanıyor', s12.windWear === 0)
} else { check('devir denenebildi', false, 'eşik sağlanmadı') }
const s13 = kur(); buyItem(s13, 'wind'); s13.windWear = 0.9; s13.managerLevel = 2
s13.managerT = 0
for (let i = 0; i < 200; i++) s13.managerTick(1)
check('Müdür Sv.2 türbin bakımını yapıyor', s13.windWear < 0.5, `%${Math.round(s13.windWear * 100)}`)
const s14 = kur(); buyItem(s14, 'wind'); s14.windWear = 0.9; s14.managerLevel = 1
for (let i = 0; i < 200; i++) s14.managerTick(1)
check('Sv.1 müdür türbine DOKUNMUYOR (kademe korunuyor)', s14.windWear > 0.8)

console.log('\n== 8) main.ts KABLOSU ==')
const main_ts = oku('src/main.ts')
check('buildVisual bağlı', /case 'wind': world\.buildWind/.test(main_ts))
check('yerleştirilebilir (ayak izi tanımlı)', /wind: \(\) => \(\{ w: 4, d: 4, grass: true \}\)/.test(main_ts))
check('yeniden kurulumda geri geliyor', /world\.buildWind\(pv\(iid\), iid\)/.test(main_ts))
check('sayılabilir tesis listesinde', /wind: \(\) => state\.windCount/.test(main_ts))
check('kanat hızı rüzgâra bağlanmış', /world\.windSpin = state\.windFactor\(\)/.test(main_ts))
check('yıpranma uyarısı sahnede rozet basıyor', /warns\.set\('wind'/.test(main_ts))
check('vitrin modunda kuruluyor', /'solar', 'wind', 'dieselgen'/.test(main_ts))
check('i-wind ikonu tanımlı', /id="i-wind"/.test(oku('index.html')))

console.log(`\n${fail === 0 ? '✅' : '❌'} rüzgâr türbini: ${pass} geçti, ${fail} kaldı`)
process.exit(fail === 0 ? 0 : 1)
