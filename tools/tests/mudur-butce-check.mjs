/**
 * MÜDÜR BÜTÇE SIRASI — #1239 "3. seviye müdür arızaları gidermiyor", #1263 "müdür
 * panelleri temizlemiyor".
 *
 * Kök: yakıt siparişi bütçeye uyumlu (kasanın tamamı eksi bir litre) ve bakım/tamirden
 * ÖNCE koşuyordu → dar kasada müdür her turda parayı litreye çevirip ₺300'lük panel /
 * ₺800'lük pompa için parasız kalıyor, üstelik SESSİZ kalıyordu. Reaktör için yapılan
 * sıralama düzeltmesi bütün bakım kalemlerine uygulandı; atlanan iş artık olay üretir.
 *
 * Kullanım: npx tsx tools/tests/mudur-butce-check.mjs
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState } = await import('../../src/state.ts')
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

console.log('── KOD: sıra ──')
const st = readFileSync(new URL('../../src/state.ts', import.meta.url), 'utf8')
const fn = st.slice(st.indexOf('managerTick(dt: number)'), st.indexOf('fireManager(): boolean'))
const iBakim = fn.indexOf('BAKIM/TAMİR, YAKIT SİPARİŞİNDEN ÖNCE'), iTamir = fn.indexOf('pol.fixBroken)'), iYakit = fn.indexOf('if (pol.orderFuel)')
bekle(iBakim > 0 && iTamir > 0 && iYakit > 0 && iTamir < iYakit, 'managerTick: tamir bloğu yakıt siparişinden ÖNCE')

/** dar kasa: 2 pompa arızalı, panel kirli, benzin tankı boş — Sv.3 müdür, tur zamanı gelmiş */
const kur = (para) => {
  const s = new GameState()
  s.managerLevel = 3; s.money = para; s.managerT = 999
  s.pumps = 3; s.brokenPumps = new Set([0, 1])
  s.solarCount = 1; s.solarDirt = 0.8
  for (const f of Object.keys(s.tanks)) s.tanks[f] = s.fuelCapacity(f)
  s.tanks.benzin = 0
  return s
}

console.log('\n── 1) ₺2.500 kasa: eskiden hepsi yakıta gidiyordu ──')
{
  const s = kur(2500)
  const r = s.managerTick(999)
  // REKLAM v2: tamir süre alır — ödeme anında, ünite sayaç bitince çalışır
  bekle(s.repairLeft('pump', 0) > 0 && s.repairLeft('pump', 1) > 0, 'iki pompanın da tamiri başlatıldı (₺1.600 ödendi)', `kalan arıza ${s.brokenPumps.size}`)
  bekle(s.solarDirt === 0, 'panel temizlendi (₺300)')
  bekle(r && r.fixed === 2 && r.cleaned, 'rapor: fixed=2, cleaned', JSON.stringify(r))
  bekle(!s.orders.benzin.pending && s.money === 600, 'kalan ₺600 100 litreye yetmiyor → sipariş yok, para duruyor', `kasa ₺${s.money}`)
  bekle(s.money >= 0, 'kasa eksiye düşmedi', `₺${s.money}`)
}

console.log('\n── 2) ₺1.100 kasa: panel + bir pompa, ikinci pompa için para yok → olay üretir ──')
{
  const s = kur(1100)
  s.managerTick(999)
  bekle(s.solarDirt === 0, 'panel temizlendi (₺300)')
  bekle(Object.keys(s.repairs).length === 1, 'bir pompanın tamiri başlatıldı (₺800)', `süren ${Object.keys(s.repairs).length}`)
  const ev = s.events.join(' | ')
  bekle(/tamir edemedi/.test(ev), 'ikinci tamir atlandı → olay yazıldı', ev)
  bekle(!s.orders.benzin.pending && s.money === 0, 'kasa ₺0 → sipariş yok', `kasa ₺${s.money}`)
}

console.log('\n── 2b) ₺200 kasa: hiçbir şey yapılamaz, iki olay ──')
{
  const s = kur(200)
  s.managerTick(999)
  const ev = s.events.join(' | ')
  bekle(/panelleri temizleyemedi/.test(ev) && /tamir edemedi/.test(ev), 'panel + tamir olayları yazıldı', ev)
  bekle(s.money === 200, 'para yerinde', `₺${s.money}`)
}

console.log('\n── 3) bol kasa: eski davranış aynen (tamir + temizlik + sipariş) ──')
{
  const s = kur(5_000_000)
  const r = s.managerTick(999)
  bekle(r && r.fixed === 2 && r.cleaned && r.ordered >= 1, 'hepsi yapıldı', JSON.stringify(r))
  bekle(s.events.length === 0, 'olay yok (sessizlik yalnız parasızlıkta)')
}

console.log('\n── 4) tamir talimatı KAPALI: pompalar arızalı kalır, olay da yazılmaz ──')
{
  const s = kur(5_000_000); s.managerPolicy.fixBroken = false
  s.managerTick(999)
  bekle(s.brokenPumps.size === 2 && s.events.length === 0, 'talimat kapalıysa dokunmaz ve şikâyet etmez')
}

console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ müdür bütçe sırası kontrolleri geçti')
process.exit(hata ? 1 : 0)
