/**
 * YAKIT SİPARİŞİ TESTİ — 70 kayıtlık grup.
 *
 * DEPO EXPLOIT'İ (#49 #155 #180 #247, 19-24 Tem): "sipariş verdikten sonra tankı
 * büyütünce depo fulleniyor". 27 Tem'de kapatıldı (commit b418164) ama regresyon
 * testi yoktu — bu dosya onu sabitliyor. Kural: teslimatta YALNIZ ödenen litre gelir.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState } = await import('../../src/state.ts')
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

// ── 1) SİPARİŞ YOLDAYKEN TANK BÜYÜTME (asıl exploit) ──
{
  const s = new GameState(); s.money = 5_000_000; s.tanks.benzin = 600
  s.orderQty.benzin = 1
  const need = s.orderNeed('benzin')
  s.placeOrder('benzin')
  s.tankLevel = 3                                   // sipariş yoldayken yükselt
  s.deliverFuel('benzin')
  bekle(s.tanks.benzin === 600 + need,
    'tank büyütülse de YALNIZ ödenen litre geliyor', `600 + ${need} = ${s.tanks.benzin}`)
}

// ── 2) SİPARİŞ YOLDAYKEN SATIŞ OLURSA (#180: "600'den 500'e düştü, full geldi") ──
{
  const s = new GameState(); s.money = 5_000_000; s.tanks.lpg = 600
  s.orderQty.lpg = 1
  const need = s.orderNeed('lpg')
  s.placeOrder('lpg')
  s.tanks.lpg = 500                                 // bu arada satış oldu
  s.deliverFuel('lpg')
  bekle(s.tanks.lpg === 500 + need, 'aradaki satıştan sonra da yalnız ödenen litre ekleniyor',
    `500 + ${need} = ${s.tanks.lpg}`)
  bekle(s.tanks.lpg < s.fuelCapacity('lpg') || need >= s.fuelCapacity('lpg') - 500,
    'kendiliğinden FULL olmuyor')
}

// ── 3) Kapasite aşılmıyor ──
{
  const s = new GameState(); s.money = 5_000_000
  s.tanks.dizel = s.fuelCapacity('dizel') - 50
  s.orderQty.dizel = 999
  s.placeOrder('dizel')
  s.deliverFuel('dizel')
  bekle(s.tanks.dizel <= s.fuelCapacity('dizel'), 'teslimat kapasiteyi aşmıyor',
    `${s.tanks.dizel} ≤ ${s.fuelCapacity('dizel')}`)
}

// ── 4) amount kaybolmuşsa BEDAVA yakıt gelmiyor (eski kayıt / şube değişimi) ──
{
  const s = new GameState(); s.money = 5_000_000; s.tanks.benzin = 100
  s.orders.benzin.pending = true
  s.orders.benzin.amount = 0                        // kayıp amount
  s.deliverFuel('benzin')
  bekle(s.tanks.benzin === 100, 'amount yoksa teslimat boş kapanıyor (bedava yakıt yok)')
}

// ── 5) Ödeme gerçekten alınıyor ──
{
  const s = new GameState(); s.money = 100_000; s.tanks.benzin = 0
  const cost = s.orderCost('benzin')
  const once = s.money
  s.placeOrder('benzin')
  bekle(s.money === once - cost, 'sipariş bedeli kasadan düşüyor', `-₺${cost.toLocaleString('tr-TR')}`)
  bekle(cost > 0, 'bedel sıfır değil')
}

// ── 6) Parası yetmeyen sipariş veremez (eksiye düşme yok) ──
{
  const s = new GameState(); s.money = 10; s.tanks.benzin = 0
  const verildi = s.placeOrder('benzin')
  bekle(!verildi && s.money === 10, 'para yetmezken sipariş verilemiyor, kasa eksiye düşmüyor')
}

console.log(hata ? `\n${hata} HATA` : '\nYAKIT SİPARİŞİ TEMİZ')
process.exit(hata ? 1 : 0)
