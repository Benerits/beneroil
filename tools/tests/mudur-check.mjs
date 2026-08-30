/**
 * MÜDÜR TALİMATLARI TESTİ — 4 şikayet + Oğuz'un isteği.
 *
 *  #1145 "müdür seviye 1'deyken depoyu tamamen dolduruyor. müdürün ne yapabileceğine
 *         BİZ karar vermeliyiz"
 *  #1126 "müdür kafasına göre sipariş veriyor, keşke %10 gibi rakamlar versek"
 *  #1143 "müdüre kaç litre kaldığında yakıt alması gerektiği talimatı verilebilir"
 *  #1122 "en fazla dizel gidiyor fakat gidip benzini fulluyor"
 *
 * Varsayılanlar ESKİ davranışla birebir aynı olmalı — mevcut kayıtlarda hiçbir şey
 * değişmesin. Talimat değişince davranış GERÇEKTEN değişmeli (sadece UI değil).
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, serializeState, hydrateState } = await import('../../src/state.ts')
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

const kur = (lvl = 3) => {
  const s = new GameState()
  s.managerLevel = lvl; s.money = 5_000_000; s.managerT = 999
  for (const f of Object.keys(s.tanks)) s.tanks[f] = s.fuelCapacity(f)
  return s
}

// ── 1) VARSAYILAN = ESKİ DAVRANIŞ ──
{
  const v = new GameState().managerPolicy
  bekle(v.fuelAt === 0.20, 'varsayılan sipariş eşiği %20 (eski davranış)')
  bekle(v.fuelFull && v.orderFuel && v.collect && v.cleanSolar && v.fixBroken && v.buyUranium && v.grabPromo,
    'varsayılanda tüm görevler AÇIK (mevcut kayıtlar etkilenmiyor)')
}

// ── 2) YAKIT SİPARİŞİ KAPATILABİLİYOR (#1145) ──
{
  const s = kur(); s.tanks.benzin = 10
  s.managerPolicy.orderFuel = false
  s.managerTick(999)
  bekle(!s.orders.benzin.pending, 'talimat kapalıyken müdür yakıt sipariş ETMİYOR')
  const s2 = kur(); s2.tanks.benzin = 10
  s2.managerTick(999)
  bekle(s2.orders.benzin.pending, 'talimat açıkken sipariş veriyor (karşılaştırma)')
}

// ── 3) EŞİK GERÇEKTEN UYGULANIYOR (#1126 #1143) ──
{
  // tank %30 dolu: %20 eşiğinde sipariş VERMEZ, %35 eşiğinde VERİR
  const dus = kur(); dus.tanks.lpg = dus.fuelCapacity('lpg') * 0.30
  dus.managerPolicy.fuelAt = 0.20
  dus.managerTick(999)
  bekle(!dus.orders.lpg.pending, '%20 eşiğinde, tank %30 doluyken sipariş vermiyor')

  const yuk = kur(); yuk.tanks.lpg = yuk.fuelCapacity('lpg') * 0.30
  yuk.managerPolicy.fuelAt = 0.35
  yuk.managerTick(999)
  bekle(yuk.orders.lpg.pending, '%35 eşiğinde, aynı tankta sipariş VERİYOR')
}

// ── 4) YARIM DOLDURMA (#1145 "depoyu tamamen dolduruyor") ──
{
  const full = kur(); full.tanks.dizel = 0
  full.managerPolicy.fuelFull = true
  full.managerTick(999)
  const fullMiktar = full.orders.dizel.amount

  const yarim = kur(); yarim.tanks.dizel = 0
  yarim.managerPolicy.fuelFull = false
  yarim.managerTick(999)
  const yarimMiktar = yarim.orders.dizel.amount

  bekle(yarimMiktar > 0 && yarimMiktar < fullMiktar,
    'YARIM talimatı daha az yakıt alıyor', `full ${fullMiktar}L → yarım ${yarimMiktar}L`)
  bekle(yarimMiktar <= yarim.fuelCapacity('dizel') * 0.55,
    'yarım sipariş kapasitenin ~yarısını geçmiyor')
}

// ── 5) DİĞER GÖREVLER AÇILIP KAPANIYOR ──
{
  const s = kur(); s.solarCount = 2; s.solarDirt = 0.9
  s.managerPolicy.cleanSolar = false
  s.managerTick(999)
  bekle(s.solarDirt > 0.8, 'panel temizliği kapalıyken müdür temizlemiyor')
  const s2 = kur(); s2.solarCount = 2; s2.solarDirt = 0.9
  s2.managerTick(999)
  bekle(s2.solarDirt < 0.1, 'açıkken temizliyor (karşılaştırma)')
}
{
  const s = kur(); s.hasSMR = true; s.uranium = 5
  s.managerPolicy.buyUranium = false
  s.managerTick(999)
  bekle(!s.uraniumPending, 'uranyum talimatı kapalıyken sipariş vermiyor')
}
{
  const s = kur(); s.brokenPumps.add(0)
  s.managerPolicy.fixBroken = false
  s.managerTick(999)
  bekle(s.brokenPumps.has(0), 'tamir talimatı kapalıyken arızaya dokunmuyor')
}
{
  const s = kur(); s.pendingCash['market'] = 5000
  s.managerPolicy.collect = false
  s.managerTick(999)
  bekle((s.pendingCash['market'] ?? 0) > 0, 'toplama talimatı kapalıyken kumbaraya dokunmuyor')
}

// ── 6) KAYIT: talimat korunuyor, kurcalanmış değer varsayılana düşüyor ──
{
  const s = kur(); s.managerPolicy.fuelAt = 0.50; s.managerPolicy.cleanSolar = false
  const geri = new GameState()
  hydrateState(geri, JSON.parse(JSON.stringify(serializeState(s))))
  bekle(geri.managerPolicy.fuelAt === 0.50 && geri.managerPolicy.cleanSolar === false,
    'talimatlar kayıttan geri geliyor')

  const bozuk = new GameState()
  const ham = JSON.parse(JSON.stringify(serializeState(s)))
  ham.managerPolicy = { fuelAt: 99, cleanSolar: 'evet' }
  hydrateState(bozuk, ham)
  bekle(bozuk.managerPolicy.fuelAt === 0.20, 'kurcalanmış eşik varsayılana düşüyor')
  bekle(bozuk.managerPolicy.cleanSolar === true, 'kurcalanmış bayrak varsayılana düşüyor')
}

// ── 7) ESKİ KAYIT (talimat alanı hiç yok) ──
{
  const eski = new GameState()
  const ham = JSON.parse(JSON.stringify(serializeState(kur())))
  delete ham.managerPolicy
  hydrateState(eski, ham)
  bekle(eski.managerPolicy?.fuelAt === 0.20 && eski.managerPolicy?.orderFuel === true,
    'talimatı olmayan eski kayıt eski davranışla açılıyor')
}

console.log(hata ? `\n${hata} HATA` : '\nMÜDÜR TALİMATLARI TEMİZ')
process.exit(hata ? 1 : 0)
