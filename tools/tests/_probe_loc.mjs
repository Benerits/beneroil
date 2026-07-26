globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, serializeState, hydrateState } = await import('../../src/state.ts')
const SRV = '/private/tmp/claude-502/-Users-oguz-Desktop-benerits-beneloil/8d4de92a-bb13-4424-85fa-e9c5da1a7a06/scratchpad/srv.mjs'
const { buildingValue, snapshotsValue, sanitizeSave } = await import(SRV)
const W = s => (Number(s.money)||0) + buildingValue(s) + snapshotsValue(s)
const lay = () => ({ placedPos:{}, placedRot:{}, placedRects:[] })

console.log('--- 1) ESKİ SAVE (şube alanları YOK) → varsayılan ---')
const old = { money: 50000, day: 30, pumps: 6, marketLevel: 2, tankLevel: 2 }
const a = new GameState(); hydrateState(a, old)
console.log('activeLoc:', a.activeLoc, '| unlockedLocs:', a.unlockedLocs, '| snaps:', JSON.stringify(a.locSnapshots))

console.log('\n--- 2) ESKİ İSTEMCİ yeni save üstüne yazarsa (locSnapshots alanı YOK) ---')
const rich = new GameState()
rich.money = 3_000_000; rich.day = 120; rich.brandStars = 6
rich.pumps = 14; rich.marketLevel = 3; rich.hasSMR = true; rich.tankLevel = 3
rich.unlockedLocs = ['kasaba','cevreyolu','otoyol']
// kasaba dolu → cevreyolu'na geç, orayı da doldur → otoyol'a geç
rich.switchLoc('cevreyolu', lay())
rich.pumps = 12; rich.marketLevel = 3; rich.hasRestaurant = true; rich.evChargers = 10; rich.tankLevel = 3
rich.switchLoc('otoyol', lay())
rich.pumps = 8; rich.hasTruckPark = true
const newSave = { s: serializeState(rich), placedPos:{}, placedRot:{}, placedRects:[] }
sanitizeSave(newSave)
console.log('YENİ save serveti:', W(newSave.s), '| snapshotsValue:', snapshotsValue(newSave.s), '| snaps:', Object.keys(newSave.s.locSnapshots))

// ESKİ istemci: SAVE_FIELDS'ta şube alanı yok → serialize ederken hiç üretmez
const oldClientSave = { s: { ...newSave.s } }
delete oldClientSave.s.activeLoc; delete oldClientSave.s.unlockedLocs; delete oldClientSave.s.locSnapshots
sanitizeSave(oldClientSave)
console.log('ESKİ istemci save serveti:', W(oldClientSave.s), '| snaps var mı:', 'locSnapshots' in oldClientSave.s)
const prevWealth = W(newSave.s), newWealth = W(oldClientSave.s)
const prevDay = newSave.s.day, newDay = oldClientSave.s.day
const bval = buildingValue(oldClientSave.s) + snapshotsValue(oldClientSave.s)
const freshStart = newDay <= 2 && bval <= 0 && newWealth <= 5000*1.5
const goBack = newDay < prevDay - 1 && newWealth < prevWealth*0.5
console.log('KAYIP servet:', prevWealth - newWealth, '| freshStart guard:', freshStart, '| geriGidis guard:', goBack)
console.log(freshStart||goBack ? '>>> 409 ile KORUNUR' : '>>> !!! 409 YOK — SAVE KABUL EDİLİR, ŞUBELER SİLİNİR !!!')

console.log('\n--- 3) Şube değişiminde servet korunumu ---')
const s3 = new GameState(); s3.money = 1_000_000; s3.pumps = 10; s3.marketLevel = 3; s3.tankLevel = 3
s3.unlockedLocs = ['kasaba','cevreyolu']
const w0 = W(serializeState(s3))
s3.switchLoc('cevreyolu', lay())
const w1 = W(serializeState(s3))
s3.switchLoc('kasaba', lay())
const w2 = W(serializeState(s3))
console.log('kasaba:', w0, '→ cevreyolu:', w1, '(delta', w1-w0, ') → kasaba:', w2, '(delta', w2-w1, ')')

console.log('\n--- 4) Snapshot ile fiyat clamp BYPASS ---')
const hack = new GameState(); hack.unlockedLocs = ['kasaba','cevreyolu']
hack.locSnapshots.cevreyolu = { f: { pumps: 4, elecPrice: 999999, tankLevel: 3 }, tanks:{benzin:5000,dizel:5000,lpg:5000},
  tankCounts:{benzin:4,dizel:4,lpg:4}, prices:{benzin:999999,dizel:999999,lpg:999999}, pendingCash:{},
  ownedParcels:[], pavedParcels:[], autoPumps:[0,1,2,3], autoChargers:[], brokenPumps:[], brokenChargers:[],
  placedPos:{}, placedRot:{}, placedRects:[] }
const hs = { s: serializeState(hack), placedPos:{}, placedRot:{}, placedRects:[] }
sanitizeSave(hs)
console.log('sunucudan sonra snapshot prices:', JSON.stringify(hs.s.locSnapshots.cevreyolu.prices),
            '| elecPrice:', hs.s.locSnapshots.cevreyolu.f.elecPrice)
const back = new GameState(); hydrateState(back, hs.s)
back.switchLoc('cevreyolu', lay())
console.log('şubeye geçtikten sonra AKTİF prices:', JSON.stringify(back.prices), '| elecPrice:', back.elecPrice)
console.log('üst seviye clamp: prices [1,30], elecPrice [4,18] →', (back.prices.benzin>30||back.elecPrice>18) ? '!!! BYPASS EDİLDİ !!!' : 'kapalı')

console.log('\n--- 5) LOC_FIELDS dışı: orders / facTotal / loan.collateral ---')
const s5 = new GameState(); s5.unlockedLocs = ['kasaba','cevreyolu']
s5.tankLevel = 3; s5.tankCounts.benzin = 4
s5.orders.benzin = { pending:true, eta:5, arrived:false, delivering:false, amount:15000, cost:100000 }
s5.facTotal.market = 500000; s5.loan = { active:true, principal:200000, monthly:9000, remaining:24, overdue:0, collateral:['market','smr'], rate:0.02 }
s5.marketLevel = 3; s5.hasSMR = true
s5.switchLoc('cevreyolu', lay())
console.log('geçiş sonrası orders.benzin:', JSON.stringify(s5.orders.benzin))
console.log('yeni şube tankLevel:', s5.tankLevel, '→ tank kapasitesi:', [800,1500,3000,5000][s5.tankLevel]*s5.tankCounts.benzin, '(15000L teslimat gelecek)')
console.log('facTotal taşındı mı (şirket seviyesi):', JSON.stringify(s5.facTotal))
console.log('loan.collateral:', s5.loan.collateral, '| yeni şubede marketLevel:', s5.marketLevel, 'hasSMR:', s5.hasSMR, '→ haciz edilecek varlık YOK')
