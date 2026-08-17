import { GameState } from './src/state.ts'
const s = new GameState()
const dump = (tag: string) => {
  const rows = s.getShopItems().filter(r => r.id.includes('truckpark') || r.id === 'restaurant2')
  console.log(tag, JSON.stringify(rows.map(r => ({ id: r.id, status: r.status, note: r.note })), null, 0))
}
dump('taze hesap:')
s.hasTruckPark = true
dump('ana tır parkı kurulu:')
s.pavedParcels.add('3,1') // karşı yakada beton
dump('+ karşıda beton:')
