/**
 * GÖREV & HEDEF TESTİ — G grubu (İçerik / hedef).
 *
 *  #1004 "günlük görev gelmeli var gözüküyor ama yok gibi bi şey"
 *        → tek sabit "15 müşteri" sayacı vardı, mobilde rozeti de CSS ile gizliydi.
 *          Artık her gün 3 görev, ilerleme çubuğu, anında ödeme.
 *  #1063 "oyunda devam edecek bi amacım kalmadı"
 *        → sıradaki büyük hedefler her zaman görünür (kariyer listesi).
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, dailyQuests, claimDailyQuests, careerGoals } = await import('../../src/state.ts')
const { serializeState, hydrateState } = await import('../../src/state.ts')
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

const kur = (tarih = '2026-08-20') => { const s = new GameState(); s.dailyDate = tarih; return s }

// ── görev listesi ──
const s = kur()
const q = dailyQuests(s)
bekle(q.length === 3, `her gün 3 görev geliyor (${q.length})`)
bekle(q.every(x => x.need > 0 && x.reward > 0), 'her görevin hedefi ve ödülü var')
bekle(new Set(q.map(x => x.id)).size === 3, 'aynı görev iki kez seçilmiyor')
bekle(q.every(x => !x.done), 'gün başında hiçbir görev tamam değil')

// ── DETERMİNİSTİK: sayfa yenilenince görev değişmemeli ──
const ayniGun = dailyQuests(kur())
bekle(JSON.stringify(ayniGun.map(x => x.id)) === JSON.stringify(q.map(x => x.id)),
  `aynı gün her açılışta AYNI görevler (${q.map(x => x.id).join(', ')})`)
const baskaGun = dailyQuests(kur('2026-08-21')).map(x => x.id)
bekle(JSON.stringify(baskaGun) !== JSON.stringify(q.map(x => x.id)),
  `ertesi gün görevler değişiyor (${baskaGun.join(', ')})`)

// ── ölçek: hedef oyuncunun büyüklüğüne göre büyür ──
const kucuk = kur(); const buyuk = kur(); buyuk.pumps = 10
const gServeK = dailyQuests(kucuk).concat(dailyQuests(buyuk))
const serveK = dailyQuests(kucuk).find(x => x.id === 'serve')
const serveB = dailyQuests(buyuk).find(x => x.id === 'serve')
if (serveK && serveB) bekle(serveB.need > serveK.need,
  `10 pompalı oyuncuya daha büyük hedef (${serveK.need} → ${serveB.need})`)
else bekle(gServeK.length > 0, 'görev havuzu çalışıyor')

// ── ödül: bir kez ödenir, kasaya geçer ──
const o = kur()
o.dailyServed = 9999; o.dailyRevenue = 9_999_999; o.dailyLiters = 999_999
o.dailyCollected = 99; o.dailyPerfect = 99; o.reputation = 5
const paraOnce = o.money
const alinan = claimDailyQuests(o)
bekle(alinan.length === 3, `üç görev de tamamlanıp ödüllendi (${alinan.length})`)
bekle(o.money > paraOnce, `ödül kasaya geçti (+₺${Math.round(o.money - paraOnce).toLocaleString('tr-TR')})`)
const paraSonra = o.money
bekle(claimDailyQuests(o).length === 0 && o.money === paraSonra,
  'ikinci çağrıda ödül TEKRAR ödenmiyor (çift ödül yok)')
bekle(o.dailyDone === true, 'üçü bitince gün rozeti (dailyDone) yanıyor')

// ── kısmi tamamlanma ──
const k = kur()
const hedef = dailyQuests(k)[0]
if (hedef.id === 'serve') k.dailyServed = hedef.need
else if (hedef.id === 'revenue') k.dailyRevenue = hedef.need
else if (hedef.id === 'liters') k.dailyLiters = hedef.need
else if (hedef.id === 'collect') k.dailyCollected = hedef.need
else if (hedef.id === 'perfect') k.dailyPerfect = hedef.need
else k.reputation = 5
const alinan2 = claimDailyQuests(k)
bekle(alinan2.length === 1 && alinan2[0].id === hedef.id,
  `tek görev tamamlanınca yalnız o ödüllendi (${hedef.id})`)
bekle(k.dailyDone === false, 'tek görevle gün rozeti yanmıyor')

// ── kayıt: sayaçlar save/load'dan sağ çıkıyor mu ──
const kay = kur()
kay.dailyServed = 7; kay.dailyRevenue = 4321; kay.dailyLiters = 555
kay.dailyCollected = 3; kay.dailyPerfect = 2; kay.dailyClaimed = ['serve']
const geri = new GameState()
hydrateState(geri, JSON.parse(JSON.stringify(serializeState(kay))))
bekle(geri.dailyServed === 7 && geri.dailyRevenue === 4321 && geri.dailyLiters === 555,
  'görev sayaçları kayıttan geri geliyor')
bekle(geri.dailyCollected === 3 && geri.dailyPerfect === 2,
  'kumbara/5-yıldız sayaçları kayıtta')
bekle(Array.isArray(geri.dailyClaimed) && geri.dailyClaimed.includes('serve'),
  'alınmış ödüller kayıtta — reload ile ödül tekrarlanamıyor')

// ── #1063 kariyer hedefleri ──
const y = new GameState()
const h0 = careerGoals(y)
bekle(h0.length === 3, `sıradaki 3 hedef gösteriliyor (${h0.length})`)
bekle(h0.every(x => !x.done), 'gösterilen hedefler henüz tamamlanmamış')
bekle(h0[0].need > 0 && h0[0].have >= 0, `ilk hedef ilerleme taşıyor: ${h0[0].label} (${h0[0].have}/${h0[0].need})`)

const z = new GameState()
z.money = 250_000; z.pumps = 6; z.evChargers = 2; z.marketLevel = 3
const h1 = careerGoals(z)
bekle(!h1.some(x => x.label === h0[0].label) || h0[0].label.includes('şube'),
  'tamamlanan hedefler listeden düşüyor, sıradakiler geliyor')
bekle(h1.length === 3, 'ilerlemiş oyuncuya da 3 hedef var (liste tükenmiyor)')

const tam = new GameState()
tam.money = 99_000_000; tam.pumps = 14; tam.evChargers = 6; tam.marketLevel = 3
tam.unlockedLocs = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
tam.managerLevel = 3; tam.hasSMR = true; tam.contractsDone = 20; tam.brandStars = 40
tam.solarCount = 3; tam.batteryLevel = 2
for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) tam.ownedParcels.add(`${c},${r}`)
bekle(careerGoals(tam).length === 3, 'her şeyi bitiren oyuncuya BOŞ liste gösterilmiyor')

// ── UI kancaları ──
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
bekle(/data-oftab="gorev"/.test(html), 'Ofis\'te Görevler sekmesi var')
bekle(/id="of-quests"/.test(html) && /id="of-goals"/.test(html), 'görev ve hedef listeleri için alan var')
bekle(!/#onlinechip, #questchip, #repchip \{ display: none/.test(html),
  'görev rozeti artık mobilde GİZLİ DEĞİL (#1004\'ün ikinci yarısı)')
const ana = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
bekle(/getElementById\('questchip'\)\?\.addEventListener/.test(ana), 'rozete dokununca görev listesi açılıyor')
bekle(/dailyQuests\(state\)/.test(ana) && /careerGoals\(state\)/.test(ana), 'panel gerçek veriden çiziliyor')
bekle(/state\.dailyRevenue \+= revenue/.test(ana), 'ciro görevi satıştan besleniyor')
bekle(/state\.dailyLiters \+= car\.filled/.test(ana), 'litre görevi dolumdan besleniyor')
bekle(/state\.dailyCollected\+\+/.test(ana), 'kumbara görevi toplamadan besleniyor')
bekle(/if \(score >= 4\.8\) state\.dailyPerfect\+\+/.test(ana), '5 yıldız görevi servis puanından besleniyor')

console.log(hata ? `\n${hata} HATA` : '\nGÖREV & HEDEF TEMİZ')
process.exit(hata ? 1 : 0)
