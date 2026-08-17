globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, getShopItems } = await import('./src/state.ts')
const s = new GameState()
const dump = tag => {
  const rows = getShopItems(s).filter(r => r.id.includes('truckpark') || r.id === 'restaurant2')
  console.log(tag, JSON.stringify(rows.map(r => ({ id: r.id, status: r.status, note: r.note }))))
}
dump('taze:')
s.hasTruckPark = true
dump('ana kurulu:')
s.pavedParcels.add('3,1')
dump('karşı beton:')
