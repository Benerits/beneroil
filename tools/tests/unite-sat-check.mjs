/**
 * POMPA/ŞARJ ÜNİTESİ: HERHANGİSİNİ YIK · DÖNDÜRÜNCE KLON YOK · TAŞI — #1289 #1306 #1281.
 *
 * #1289 "7 DC şarjım var, sadece 1'i satılabiliyor": sellInfo yalnız SON indeksi kabul
 *   ediyordu. Artık tıklanan ünite gider; sonuncunun yeri/bayrakları (arıza, personel)
 *   tıklanan indekse taşınır (sayaç dizisi boşluksuz kalır).
 * #1306 "DC şarj döndürünce klonlama": onRotate `addEvCharger` ile EKLİYORDU (silmeden) →
 *   her döndürmede sahnede sahipsiz bir kopya birikiyordu. removeBuildingGroup yalnız İLK
 *   kaydı sahneden alıp unregister ile hepsini listeden siliyordu → kopya bir daha silinemiyordu.
 * #1281 "dc üniteler taşınmıyor": aynı kök — taşıma kopyayı yerinde bırakıyordu.
 *
 * Kullanım: npx tsx tools/tests/unite-sat-check.mjs   (dev sunucu 5311'de)
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const PORT = process.env.PORT ?? '5311'
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const main = oku('src/main.ts'), world = oku('src/world.ts'), state = oku('src/state.ts')
bekle(!/world\.addEvCharger\(parseInt\(id\.slice\(8\)\)/.test(main), 'onRotate şarjı addEvCharger ile EKLEMİYOR (klon kaynağı)')
bekle(/if \(p2\) applyDynamicMove\(id, p2\[0\], p2\[1\], yeni\)/.test(main), 'onRotate pompa/şarjı taşıma yoluyla (açıyla dönen ofset) yeniden kuruyor')
bekle(/const list = this\.buildings\.filter\(x => x\.id === id\)/.test(world), 'removeBuildingGroup aynı id\'li TÜM grupları sahneden alıyor')
bekle(/if \(s\.evChargers <= 0 \|\| ci < 0 \|\| ci >= s\.evChargers\) return null/.test(state), 'sellInfo: her şarj indeksi satılabilir')
bekle(/if \(s\.pumps <= 1 \|\| pi < 0 \|\| pi >= s\.pumps\) return null/.test(state), 'sellInfo: her pompa indeksi satılabilir (en az 1 kalır)')

console.log('\n── CANLI ──')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage({ viewport: { width: 1400, height: 900 } })
const jsHata = []
p.on('pageerror', e => jsHata.push(String(e).slice(0, 160)))
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'load' })
await p.waitForFunction(() => window.__dbg?.kayit, null, { timeout: 60_000 })

const r = await p.evaluate(() => {
  const d = window.__dbg, s = d.state, w = d.world, out = {}
  for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) d.kayit.arsaAl(c, rr)
  s.money = 50_000_000
  d.place.rebuild()
  const k = JSON.parse(JSON.stringify(d.kayit.yuk()))
  k.s.evChargers = 7; k.s.pumps = 4
  for (const key of Object.keys(k.placedPos)) if (key.startsWith('charger-') || key.startsWith('pump-')) delete k.placedPos[key]
  k.placedRects = k.placedRects.filter(x => !x.id.startsWith('charger-') && !x.id.startsWith('pump-'))
  d.kayit.yukle(k)
  const evPos = () => w.evBase.slice(0, s.evChargers).map(v => [+v.x.toFixed(2), +v.y.toFixed(2)])
  const sahne = id => w.scene.children.filter(c => c.userData.buildingId === id).length
  const sahneTop = pre => w.scene.children.filter(c => String(c.userData.buildingId ?? '').startsWith(pre)).length
  const kayitli = id => w.buildings.filter(x => x.id === id).length
  out.baslangic = { ev: s.evChargers, pompa: s.pumps, sahneEv: sahneTop('charger-'), pos: evPos() }

  // ── 1) ORTADAKİ şarjı yık: bayraklar sonuncudan tıklanana geçsin
  s.brokenChargers.clear(); s.autoChargers.clear()
  s.brokenChargers.add(6); s.autoChargers.add(2); s.autoChargers.add(6)
  const once = evPos()
  d.sec('charger-3')
  const satBtn = document.getElementById('binfo-sell')
  out.satButonu = !!satBtn && satBtn.style.display !== 'none'
  const paraOnce = s.money
  d.ui.onSell('charger-3')
  const sonra = evPos()
  out.sat = {
    ev: s.evChargers, iade: s.money - paraOnce,
    ucAyniYerde: JSON.stringify(sonra[3]) === JSON.stringify(once[6]),
    digerleriSabit: [0, 1, 2, 4, 5].every(i => JSON.stringify(sonra[i]) === JSON.stringify(once[i])),
    bozuk: [...s.brokenChargers], personel: [...s.autoChargers].sort(),
    sahneEv: sahneTop('charger-'), kayitPos: Object.keys(d.kayit.yuk().placedPos).filter(x => x.startsWith('charger-')).sort(),
    kayitCift: ['charger-0', 'charger-1', 'charger-2', 'charger-3', 'charger-4', 'charger-5'].filter(id => kayitli(id) !== 1),
  }
  // ── 1b) ortadaki pompayı yık (en az 1 kalır kuralı da korunur)
  const pOnce = w.pumpBase.slice(0, s.pumps).map(v => [+v.x.toFixed(2), +v.y.toFixed(2)])
  d.ui.onSell('pump-1')
  const pSonra = w.pumpBase.slice(0, s.pumps).map(v => [+v.x.toFixed(2), +v.y.toFixed(2)])
  out.pompa = { n: s.pumps, birAyniYerde: JSON.stringify(pSonra[1]) === JSON.stringify(pOnce[3]), sahne: sahneTop('pump-') }
  s.pumps = 1; out.sonPompaSatilamaz = document.getElementById('binfo-sell') && (d.sec('pump-0'), document.getElementById('binfo-sell').style.display === 'none')
  s.pumps = 3

  // ── 2) DÖNDÜR: sahnede klon birikmesin, kayıt tek kalsın
  d.sec('charger-1')
  for (let i = 0; i < 4; i++) document.getElementById('binfo-rot')?.click()
  out.dondur = { sahne: sahne('charger-1'), kayit: kayitli('charger-1'), rot: d.kayit.yuk().placedRot['charger-1'] ?? 0, sahneEv: sahneTop('charger-') }

  // ── 3) TAŞI: eski yerde kopya kalmasın
  const eski = [+w.evBase[1].x.toFixed(2), +w.evBase[1].y.toFixed(2)]
  d.place.start('charger-1', true)
  let hedef = null
  for (let x = -14; x <= 2 && !hedef; x += 1) for (let y = -16; y <= 16 && !hedef; y += 1) {
    d.place.at(x, y); const g = d.place.ghost()
    if (g && g.valid && (Math.abs(x - eski[0]) > 3 || Math.abs(y - eski[1]) > 3)) hedef = [x, y]
  }
  if (hedef) d.place.confirm(); else d.place.cancel()
  const yeni = [+w.evBase[1].x.toFixed(2), +w.evBase[1].y.toFixed(2)]
  out.tasi = { hedef, eski, yeni, tasindi: JSON.stringify(eski) !== JSON.stringify(yeni), sahne: sahne('charger-1'), sahneEv: sahneTop('charger-') }
  return out
})

bekle(r.baslangic.ev === 7 && r.baslangic.sahneEv === 7, '7 şarj kuruldu, sahnede 7 grup', JSON.stringify(r.baslangic))
bekle(r.satButonu, 'ORTADAKİ şarjın (#4) kartında Yık düğmesi var (eskiden yalnız sonuncuda)')
bekle(r.sat.ev === 6 && r.sat.iade > 0, 'yıkınca sayaç 6, iade geldi', `ev=${r.sat.ev} iade=${r.sat.iade}`)
bekle(r.sat.ucAyniYerde, 'sonuncunun yeri tıklanan indekse taşındı (charger-3 ← eski charger-6)')
bekle(r.sat.digerleriSabit, 'diğer 5 şarj yerinden oynamadı')
bekle(JSON.stringify(r.sat.bozuk) === '[3]' && JSON.stringify(r.sat.personel) === '[2,3]', 'arıza + personel bayrakları 6→3 taşındı', `bozuk=${r.sat.bozuk} personel=${r.sat.personel}`)
bekle(r.sat.sahneEv === 6 && r.sat.kayitCift.length === 0, 'sahnede 6 şarj grubu, kayıt listesinde çift yok', `sahne=${r.sat.sahneEv} çift=${r.sat.kayitCift}`)
// varsayılan yuvadaki üniteler placedPos'a yazılmaz; taşınan (charger-3) yazılır, silinen (charger-6) kalkar
bekle(r.sat.kayitPos.includes('charger-3') && !r.sat.kayitPos.includes('charger-6'), 'kayıtta charger-3 konumu var, charger-6 silindi', r.sat.kayitPos.join(','))
bekle(r.pompa.n === 3 && r.pompa.birAyniYerde && r.pompa.sahne === 3, 'ortadaki pompa da yıkılıyor (4→3, sonuncu yeri alıyor)', JSON.stringify(r.pompa))
bekle(r.sonPompaSatilamaz, 'son pompa yıkılamaz (en az 1 kalır)')
bekle(r.dondur.sahne === 1 && r.dondur.kayit === 1 && r.dondur.sahneEv === 6, '4 kez döndürünce sahnede TEK charger-1 (klon yok)', JSON.stringify(r.dondur))
bekle(r.tasi.hedef && r.tasi.tasindi, 'şarj taşındı', JSON.stringify(r.tasi))
bekle(r.tasi.sahne === 1 && r.tasi.sahneEv === 6, 'taşıma sonrası eski yerde kopya kalmadı', JSON.stringify(r.tasi))
bekle(jsHata.length === 0, 'JavaScript hatası yok', jsHata.slice(0, 2).join(' | '))

await b.close()
console.log(hata ? `\n❌ ${hata} kontrol düştü` : '\n✅ ünite yık/döndür/taşı kontrolleri geçti')
process.exit(hata ? 1 : 0)
