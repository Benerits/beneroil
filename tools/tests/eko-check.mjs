/**
 * EKONOMİ/DENGE TESTİ — 15 şikayetin ölçülebilir olanları.
 *
 * Kapsam:
 *  #1005 self yıkama: ünite sayısı geliri gerçekten çarpıyor mu (şikayet algısaldı,
 *        bildirim etiketine ×N eklendi — burada matematiği kilitliyoruz).
 *  #994  marka yıldızı: yıldız arttıkça şube net geliri artmalı, sonsuza gitmemeli.
 *  #990/#992 Sv.3 müdür reaktörü yakıtsız bırakmamalı — uranyumu kendi sipariş etmeli.
 *  #991  ihale gün sayacı: daysLeft düştükçe süre gerçekten bitmeli.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, URANIUM_COST } = await import('../../src/state.ts')
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

// ── #1005 self yıkama: gelir ünite başına ölçekleniyor mu ──
// facTotal ham hasılatı tutar (kumbara tavanından etkilenmez) — asıl ölçüt bu.
const yikamaGeliri = adet => {
  const s = new GameState()
  s.selfWashCount = adet
  const gercek = Math.random
  Math.random = () => 0.5                       // sabit tohum: ünite başı 30+15 = ₺45
  for (let i = 0; i < 600; i++) s.tick(1)       // 10 oyun dakikası
  Math.random = gercek
  return s.facTotal['selfwash'] ?? 0
}
const y1 = yikamaGeliri(1), y2 = yikamaGeliri(2), y4 = yikamaGeliri(4)
bekle(y1 > 0, `self yıkama ×1 hasılatı ₺${y1}`)
bekle(Math.abs(y2 / y1 - 2) < 0.01, `self yıkama ×2 hasılatı tam iki katı (₺${y1} → ₺${y2})`)
bekle(Math.abs(y4 / y1 - 4) < 0.01, `self yıkama ×4 hasılatı tam dört katı (₺${y1} → ₺${y4})`)
// kumbara TAVANI da ünite sayısıyla büyümeli, yoksa fazlası eriyip şikayeti haklı çıkarır
const capOf = n => { const g = new GameState(); g.selfWashCount = n; return g.pendingCap('selfwash') }
bekle(capOf(4) === capOf(1) * 4, `kumbara tavanı ünite ile büyüyor (₺${capOf(1)} → ₺${capOf(4)})`)

// ── #994 marka yıldızı çarpanı ──
const yildizli = n => { const s = new GameState(); s.brandStars = n; return s.prestigeMult() }
const p0 = yildizli(0), p5 = yildizli(5), p15 = yildizli(15), p30 = yildizli(30), p99 = yildizli(99)
bekle(p0 === 1, `0 yıldızda çarpan ×${p0.toFixed(3)} (denge değişmiyor)`)
bekle(p5 > p0 && p15 > p5 && p30 > p15, `yıldız arttıkça çarpan artıyor: ×${p5.toFixed(2)} → ×${p15.toFixed(2)} → ×${p30.toFixed(2)}`)
// tavan yok ama AZALAN VERİM var: son yıldızların katkısı ilklerinden küçük olmalı
const ilk10 = (yildizli(10) - p0) / 10, son10 = (yildizli(40) - yildizli(30)) / 10
bekle(son10 < ilk10 / 2, `azalan verim çalışıyor: ilk 10★ +${ilk10.toFixed(3)}/★, 31-40★ +${son10.toFixed(3)}/★`)
bekle(p99 > p30, `yıldız hep değerli kalıyor (30★ ×${p30.toFixed(2)} → 99★ ×${p99.toFixed(2)})`)

// yıldızın ŞUBE gelirine gerçekten yansıdığını doğrula
const subeli = n => {
  const s = new GameState()
  s.brandStars = n
  s.unlockedLocs = ['kasaba', 'cevreyolu']; s.activeLoc = 'kasaba'
  s.locSnapshots['cevreyolu'] = { f: { managerLevel: 3, staffLevel: 1, pumps: 6, marketLevel: 2,
    hasRestaurant: true, hasWash: true, evChargers: 2 }, autoPumps: [0, 1], autoChargers: [] }
  return s.branchNetPerDay('cevreyolu').net
}
const n0 = subeli(0), n30 = subeli(30)
bekle(n30 > n0 * 1.5, `30 yıldız şube gelirini yükseltiyor: ₺${Math.round(n0)} → ₺${Math.round(n30)}/gün`)

// ── #990/#992 Sv.3 müdür uranyum sipariş ediyor mu ──
const reaktorlu = (lvl, para) => {
  const s = new GameState()
  s.managerLevel = lvl
  s.hasSMR = true
  s.uranium = 8               // kritik seviye
  s.uraniumPending = false
  // tankları doldur: yoksa müdür aynı turda yakıt da sipariş eder ve para farkı karışır
  for (const f of Object.keys(s.tanks)) s.tanks[f] = s.fuelCapacity(f)
  s.money = para
  return s
}
const m3 = reaktorlu(3, 50_000)
const r3 = m3.managerTick(999)
bekle(m3.uraniumPending === true, 'Sv.3 müdür yakıt kritikken uranyum sipariş etti')
bekle(m3.money === 50_000 - URANIUM_COST, `sipariş bedeli kasadan düştü (-₺${URANIUM_COST.toLocaleString('tr-TR')})`)
bekle((r3?.ordered ?? 0) > 0, 'sipariş müdür raporunda görünüyor')

const m2 = reaktorlu(2, 50_000)
m2.managerTick(999)
bekle(m2.uraniumPending === false, 'Sv.2 müdür uranyum sipariş ETMEZ (yükseltme anlamlı kalıyor)')

const mFakir = reaktorlu(3, 100)
mFakir.managerTick(999)
bekle(mFakir.uraniumPending === false && mFakir.money === 100, 'parası yetmeyen müdür sipariş vermiyor (eksiye düşmüyor)')

const mDolu = reaktorlu(3, 50_000)
mDolu.uranium = 90
mDolu.managerTick(999)
bekle(mDolu.uraniumPending === false && mDolu.money === 50_000, 'yakıt doluyken gereksiz sipariş yok')

const mBekleyen = reaktorlu(3, 50_000)
mBekleyen.uraniumPending = true
mBekleyen.managerTick(999)
bekle(mBekleyen.money === 50_000, 'zaten yolda olan sipariş ikinci kez ödenmiyor')

// ── #991 ihale gün sayacı: "15 gün diyor ama bitmiyor" ──
const ih = new GameState()
ih.money = 5_000_000
ih.contract = { name: 'Test Filosu', fuel: 'benzin', dailyLiters: 100, pricePerL: 40,
  bonus: 10_000, penalty: 1_000, daysTotal: 15, daysLeft: 15, deliveredToday: 0, missedDays: 0 }
let sonuc = { kind: 'none' }, gun = 0
while (gun < 40 && ih.contract) {
  ih.tanks[ih.contract.fuel] = 100_000        // her gün tam teslim → fesih değil, tamamlanma
  sonuc = ih.processContractDay()
  gun++
}
bekle(gun === 15, `15 günlük ihale tam 15 günde kapandı (${gun})`)
bekle(sonuc.kind === 'done', `ihale başarıyla tamamlandı (${sonuc.kind})`)
bekle(ih.contract === null, 'biten ihale temizlendi — sayaç takılı kalmıyor')

console.log(hata ? `\n${hata} HATA` : '\nEKONOMİ TEMİZ')
process.exit(hata ? 1 : 0)
