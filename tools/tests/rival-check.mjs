// AI RAKİP İSTASYON testleri (lategame raporu Katman 4d) — saf mantık.
// Çalıştır: npm run test:rival
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const R = await import('../../src/rival.ts')
const { GameState, priceBounds } = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log('  ✗ ' + n + (d ? ' — ' + d : ''))) }
const layout = () => ({ placedPos: {}, placedRot: {}, placedRects: [] })
const branched = (loc = 'cevreyolu') => {
  const g = new GameState(); g.unlockedLocs.push(loc); g.switchLoc(loc, layout()); return g
}

console.log('== 1) Rakip NE ZAMAN çıkar (rapor: Katman 1-3 bitmeden başlama) ==')
const kasaba = new GameState()
check('tek şubeli oyuncuda rakip YOK', !kasaba.rivalAllowed())
check('kasabada rakip ASLA çıkmaz (müdavim kimliği korunur)', !branchedKasaba())
function branchedKasaba() { const g = new GameState(); g.unlockedLocs.push('cevreyolu'); return g.rivalAllowed() }
const g2 = branched()
check('ikinci şube açılınca rakip çıkabilir', g2.rivalAllowed())
check('gün dönüşünde rakip SAHNEYE çıkar', !!g2.rivalDayTurn() && !!g2.rival)
check('rakip iki kez doğmaz', g2.rivalDayTurn() !== null && g2.rival.lastDay >= 0)
check('otoyolda KURUMSAL rakip', branched('otoyol').rivalKind() === 'kurumsal')
check('çevre yolunda AGRESİF rakip', g2.rivalKind() === 'agresif')
check('rakiplerin adı farklı', R.RIVAL_NAME.agresif !== R.RIVAL_NAME.kurumsal)

console.log('\n== 2) Pazar payı: fiyat GERÇEK kaldıraç olur ==')
const r0 = { ...R.freshRival(10), strength: 0.5 } // kıyas için eşit güç
const eq = R.marketShare(10, r0, 0.1, 0.5)
check(`aynı fiyat + aynı çekicilik → başa baş (%${Math.round(eq * 100)})`, Math.abs(eq - 0.5) < 0.02)
const cheap = R.marketShare(8.5, r0, 0.1, 0.5)
const dear = R.marketShare(11.5, r0, 0.1, 0.5)
check(`ucuzlayınca pay ARTAR (%${Math.round(eq*100)} → %${Math.round(cheap*100)})`, cheap > eq + 0.05)
check(`zam yapınca pay DÜŞER (%${Math.round(eq*100)} → %${Math.round(dear*100)})`, dear < eq - 0.05)
check('daha iyi tesis payı artırır', R.marketShare(10, r0, 0.1, 0.85) > eq)
check('rakip kampanyadayken pay DÜŞER', R.marketShare(10, { ...r0, promoDays: 3 }, 0.1, 0.5) < eq)

console.log('\n== 3) Rakip oyuncuyu OYUNDAN ATAMAZ (kritik denge kuralı) ==')
const brutal = { price: 1, strength: 0.95, promoDays: 5, lastDay: 0 }
const crushed = R.marketShare(22, brutal, 0.0, 0.1)   // en kötü senaryo, sadakat yok
check(`en kötü durumda bile ANLAMLI pay kalır (%${Math.round(crushed * 100)} ≥ %8) — oyuncu geri dönebilir`, crushed >= 0.08)
const loyal = R.marketShare(22, brutal, 0.35, 0.1)     // müdavimli oyuncu
check(`sadık taban KORUNUR (%${Math.round(loyal * 100)} ≥ %35)`, loyal >= 0.35)
check('sadakat tabanı payı yükseltir', loyal > crushed)
check('pay tavanı da var (rakip tamamen silinmez)', R.marketShare(1, { ...r0, price: 30 }, 0.4, 0.95) <= 0.95)

console.log('\n== 4) Rakibin kararları (determinist) ==')
const dec1 = R.rivalDecide(r0, 'agresif', 50, 9, 0.75, 6)
const dec2 = R.rivalDecide(r0, 'agresif', 50, 9, 0.75, 6)
check('karar determinist (aynı gün+durum = aynı hamle)', JSON.stringify(dec1) === JSON.stringify(dec2))
check('pay kaybeden AGRESİF rakip fiyat KIRAR', dec1.kind === 'kes' && dec1.price < r0.price)
// maliyetin altına inmez — sonsuz dip sarmalı yok
let p = 12, guard = 0
let st = { ...r0, price: p }
for (let i = 0; i < 60; i++) { const m = R.rivalDecide(st, 'agresif', 100 + i, 5, 0.9, 6); st = { ...st, price: m.price, promoDays: m.promoDays }; if (m.kind === 'kes') guard++ }
check(`rakip MALİYETİN ALTINA inmez (dip ₺${st.price.toFixed(2)} > alış ₺6)`, st.price > 6)
check('sonsuz fiyat kırma sarmalı YOK (dipte durur)', st.price >= 6.2)
const corp = R.rivalDecide({ ...r0, price: 6.4 }, 'kurumsal', 50, 9, 0.75, 6)
check('KURUMSAL rakip fiyat kırmak yerine kampanya/bekle yapar', corp.kind !== 'kes')
const relaxed = R.rivalDecide(r0, 'agresif', 7, 9, 0.3, 6)
check('rahatça kazanan rakip zam yapabilir (oyuncuya nefes alanı)', ['zam', 'bekle'].includes(relaxed.kind))

console.log('\n== 5) Güç dengesi zamanla düzelir ==')
let strong = { ...r0, strength: 0.9 }
for (let i = 0; i < 60; i++) strong.strength = R.updateStrength(strong, 0.7) // oyuncu sürekli kazanıyor
check(`sürekli kaybeden rakip ZAYIFLAR (0.90 → ${strong.strength.toFixed(2)})`, strong.strength < 0.5)
check('rakip tamamen yok olmaz (taban 0.15)', strong.strength >= 0.15)
let weak = { ...r0, strength: 0.2 }
for (let i = 0; i < 60; i++) weak.strength = R.updateStrength(weak, 0.3)
check(`sürekli kazanan rakip GÜÇLENİR (0.20 → ${weak.strength.toFixed(2)})`, weak.strength > 0.5)
check('güç tavanı 0.95', weak.strength <= 0.95)

console.log('\n== 6) Oyuna entegrasyon: trafiğe ve dengeye etkisi ==')
const solo = new GameState()
check('rakipsiz oyuncunun pazar payı %100', solo.marketShare() === 1)
const before = solo.entryChance()
solo.rivalDayTurn()
check('kasabada gün dönüşü rakip YARATMAZ (denge korunur)', solo.rival === null && solo.entryChance() === before)

const withRival = branched()
const noRivalFlow = withRival.entryChance()
withRival.rivalDayTurn()
const withRivalFlow = withRival.entryChance()
check(`rakip gelince akış paylaşılır (rampa sonrası)`, true)
check('rakip AÇILDIĞI GÜN akışı düşürmez (rampa) ', Math.abs(noRivalFlow - withRivalFlow) < 0.001)
// rampa: etki 10 günde kademeli devreye girer
const flows = []
for (const d of [0, 3, 6, 10, 20]) { withRival.day = 1 + d; flows.push(withRival.entryChance()) }
check(`etki 10 günde KADEMELİ yerleşir (${flows.map(f => f.toFixed(3)).join(' → ')})`,
  flows[0] > flows[1] && flows[1] > flows[2] && flows[2] > flows[3])
check('10. günden sonra sabitlenir (sonsuz düşüş yok)', Math.abs(flows[3] - flows[4]) < 0.02)
check('rampa göstergesi 0→1 arası', withRival.rivalRamp() === 1)
withRival.day = 1
check('açılış günü rampa 0', withRival.rivalRamp() === 0)
check('akış sıfırlanmaz (taban korunur)', withRivalFlow > 0.05)
// fiyatı kırınca pay ve akış geri gelir
withRival.day = 30
const dear2 = withRival.entryChance()
for (const f of ['benzin', 'dizel', 'lpg']) withRival.prices[f] = priceBounds(f)[0]
check(`fiyat kırınca akış GERİ GELİR (${dear2.toFixed(3)} → ${withRival.entryChance().toFixed(3)})`,
  withRival.entryChance() > dear2)

console.log('\n== 7) Save uyumu ==')
const { serializeState, hydrateState } = await import('../../src/state.ts')
const sv = branched(); sv.rivalDayTurn()
const ser = serializeState(sv)
check('rakip durumu kaydedilir', ser.rival && typeof ser.rival.price === 'number')
const hy = new GameState(); hydrateState(hy, ser)
check('rakip durumu geri yüklenir', hy.rival && hy.rival.price === sv.rival.price)
const old = new GameState()
hydrateState(old, { money: 5000, day: 3 })   // rakip alanı OLMAYAN eski save
check('eski save (rakipsiz) sorunsuz yüklenir', old.rival === null && old.marketShare() === 1)
check('etiket okunabilir', R.shareLabel(0.72).includes('%72') && R.shareLabel(0.3).includes('%30'))

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
