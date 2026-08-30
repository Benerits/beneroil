/**
 * YERLEŞİM TESTİ — "hayaletin göründüğü yere pompalar ÖZELLİKLE yerleşmiyor" (oyuncu
 * raporu, oyun sahibi). Açık geri bildirimlerdeki ~40 kayıtlık yerleştirme/grid
 * kümesinin kalbi: "grid'e koyduğun yere oturmuyor", "taşınmış objeyi geri koyamama,
 * kırmızı yanıyor".
 *
 * KÖK NEDEN: Pompa ve DC şarjın GÖVDESİ footprint merkezinde durmaz — merkezin batısında
 * durur (pompa 0.9, şarj 0.5 birim); araç yuvası da simetrik olarak doğusunda. Yani
 * footprint merkezi = gövde ile yuvanın ortası.
 *   · HAYALET bu ofseti DÖNEN root'un ÇOCUĞU olarak uyguluyordu → ofset hem oyuncunun
 *     açısıyla hem karşı-yaka 180° flip'iyle DÖNÜYORDU.
 *   · COMMIT / TAŞIMA / KURULUM / RELOAD ise ofseti SABİT −x olarak uyguluyordu.
 * Sonuç: yapı hayaletin gösterdiği yere değil, 1.27 birim (90°/270°) ya da 1.8 birim
 * (180° ve KARŞI YAKA) uzağa oturuyordu. Şarjda commit ofseti hiç uygulamıyordu →
 * yapı kurulduğu yerde duruyor ama bir sonraki açılışta 0.5 birim batıya zıplıyordu.
 *
 * FİX: tek doğru kaynak `unitBodyPos()` — ofset AÇIYLA DÖNER, hayalet/commit/reload
 * hepsi ondan geçer. placedPos hâlâ footprint MERKEZİNİ tutar (save formatı değişmedi).
 *
 * Bu test bağımsız bir geometri kâhini (aşağıdaki `beklenenGovde`) kurar ve HEM hayaleti
 * HEM sahnedeki gerçek yapıyı ona karşı ölçer — src'deki fonksiyonu tekrar çağırmaz.
 *
 * Kullanım: npm run dev -- --port 5344  →  npm run test:yerlesim
 */
import { readFileSync } from 'node:fs'
import { chromium } from 'playwright-core'

const PORT = process.env.PORT ?? '5344'
const TOL = 0.02 // birim — ölçüm toleransı (float kiri dışında sapma kabul edilmez)
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }

// ---- BAĞIMSIZ GEOMETRİ KÂHİNİ (src'den kopya DEĞİL, kuralın kendisi) ----
const ROAD_X = 7.9
const OFS = id => (id.startsWith('pump-') ? 0.9 : id.startsWith('charger-') ? 0.5 : 0)
/** footprint merkezinden gövdenin DÜNYA konumu: ofset açıyla + karşı-yaka flip'iyle döner */
function beklenenGovde(id, cx, cy, rot) {
  const off = OFS(id)
  const ang = rot * Math.PI / 2 + (cx > ROAD_X ? Math.PI : 0)
  return [cx - Math.cos(ang) * off, cy - Math.sin(ang) * off]
}
const uzak = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

// ---------------------------------------------------------------- KOD DENETİMİ
console.log('── KOD DENETİMİ ──')
const main = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
const world = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')

bekle(/function unitBodyPos\(id: string, cx: number, cy: number, rot: number\)/.test(main),
  'gövde ofseti TEK yerden hesaplanıyor (unitBodyPos)')
bekle(/const ang = rot \* Math\.PI \/ 2 \+ \(cx > ROAD_X \? Math\.PI : 0\)/.test(main),
  'ofset açıyla VE karşı-yaka flip\'iyle birlikte dönüyor')
// Hayalet önizlemesi de aynı kaynaktan beslenmeli — elle yazılmış -0.9 / -0.5 kalmamalı
// (satır başı şartı: unitBodyPos'un açıklama bloğu eski kodu alıntılıyor, o sayılmasın)
bekle(!/^\s*preview\.position\.x = -0\.[95]/m.test(main),
  'hayalet önizlemesi elle yazılmış ofset kullanmıyor')
bekle(/const off = unitBodyPos\(id, 0, 0, 0\)/.test(main), 'hayalet ofseti unitBodyPos\'tan türüyor')
// Dört yerleşim yolu da aynı fonksiyondan geçmeli
for (const [re, ad] of [
  [/world\.addPump\(parseInt\(base\.slice\(5\)\), unitBodyPos\(/, 'kurulum (buildVisual) → unitBodyPos'],
  [/world\.addEvCharger\(parseInt\(base\.slice\(8\)\), unitBodyPos\(/, 'kurulum (buildVisual, şarj) → unitBodyPos'],
  [/world\.addPump\(i, sp \? unitBodyPos\(/, 'reload (rebuildFromState) → unitBodyPos'],
  [/world\.addEvCharger\(i, sp \? unitBodyPos\(/, 'reload (rebuildFromState, şarj) → unitBodyPos'],
  [/world\.movePump\(0, unitBodyPos\('pump-0'/, 'reload pump-0 → unitBodyPos'],
  [/world\.movePump\(n, unitBodyPos\(id, cx, cy, r\), r\)/, 'taşıma (applyDynamicMove) → unitBodyPos'],
  [/world\.moveCharger\(n, unitBodyPos\(id, cx, cy, r\), r\)/, 'taşıma (applyDynamicMove, şarj) → unitBodyPos'],
  [/world\.movePump\(idx, unitBodyPos\(p\.id, p\.cx, p\.cy, p\.rot\), p\.rot\)/, 'onay (confirmPlacement) → unitBodyPos'],
  [/world\.moveCharger\(idx, unitBodyPos\(p\.id, p\.cx, p\.cy, p\.rot\), p\.rot\)/, 'onay (confirmPlacement, şarj) → unitBodyPos'],
]) bekle(re.test(main), ad)
// Eski sabit ofsetlerin hiçbiri geride kalmamalı
bekle(!/new THREE\.Vector2\([^)]*\.x - 0\.9/.test(main) && !/Vector2\(s0\[0\] - 0\.9/.test(main),
  'main.ts\'te sabit −0.9 pompa ofseti kalmadı')
bekle(!/new THREE\.Vector2\([^)]*\.x - 0\.5/.test(main), 'main.ts\'te sabit −0.5 şarj ofseti kalmadı')
// Taşımada hayaletteki AÇI kullanılmalı (eski placedRot değil)
bekle(/applyDynamicMove\(p\.id, p\.cx, p\.cy, p\.rot\)/.test(main),
  'taşıma onayı hayaletteki açıyı uyguluyor')
// Araç yuvası da ünitenin GÖRSEL yönüyle dönmeli (yalnız X bileşenine flip uygulanamaz)
bekle(/const dir = ang \+ \(far \? Math\.PI : 0\)/.test(world) &&
  /pumpSlots\[index\] = new THREE\.Vector3\(base\.x \+ Math\.cos\(dir\) \* 1\.8, base\.y \+ Math\.sin\(dir\) \* 1\.8/.test(world),
  'pompa araç yuvası tam dönüşle hesaplanıyor (karşı yaka + 90°/270°)')
bekle(/const evDir = ang \+ \(base\.x > ROAD_X \? Math\.PI : 0\)/.test(world) &&
  /evSlots\[index\] = new THREE\.Vector3\(base\.x \+ Math\.cos\(evDir\) \* 1\.1, base\.y \+ Math\.sin\(evDir\) \* 1\.1/.test(world),
  'şarj araç yuvası tam dönüşle hesaplanıyor')
// SAVE UYUMU: kayda hâlâ footprint MERKEZİ yazılıyor (format değişmedi)
bekle(/placedPos\[p\.id\] = \[p\.cx, p\.cy\]/.test(main), 'placedPos hâlâ footprint merkezini tutuyor (save uyumu)')

// ---------------------------------------------------------- GERÇEK TARAYICI
console.log('\n── GERÇEK TARAYICI (hayalet ↔ gerçek yerleşim) ──')
const b = await chromium.launch({ channel: 'chrome' })
const p = await b.newPage()
const sayfaHatasi = []
p.on('pageerror', e => sayfaHatasi.push(String(e).slice(0, 200)))
await p.addInitScript(() => {
  localStorage.setItem('benzinlik-guest-joined', '1')
  localStorage.setItem('benzinlik-music', '0')
})
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
await p.waitForTimeout(9000)
// MİSAFİR KAPISI: position:fixed olduğu için offsetParent HER ZAMAN null →
// görünürlüğü getComputedStyle ile ölç (mobil-check.mjs'teki tuzağın aynısı).
for (let i = 0; i < 8; i++) {
  const acik = await p.evaluate(() => {
    const g = document.getElementById('gguest')
    if (g && getComputedStyle(g).display !== 'none') { g.click(); return true }
    return false
  })
  if (!acik) break
  await p.waitForTimeout(400)
}
await p.waitForTimeout(1200)
bekle(await p.evaluate(() => !!window.__dbg?.place), 'yerleşim debug kancası hazır (?full=1)')

// karşı yakayı aç: 3. sütun parselleri satın alınmış+betonlanmış say
await p.evaluate(() => {
  const d = window.__dbg
  for (const key of ['3,0', '3,1', '3,2']) {
    const [c, r] = key.split(',').map(Number)
    d.state.ownedParcels.add(key); d.state.pavedParcels.add(key)
    d.world.markOwned(c, r); d.world.paveParcel(c, r)
  }
})

// Senaryolar: yakın/karşı yaka × 4 açı, pompa ve şarj için (hepsi GEÇERLİ noktalar)
const SENARYO = []
for (const id of ['pump-3', 'charger-3']) {
  for (const [yaka, cx] of [['yakın', -14], ['karşı', 18]]) {
    for (const rot of [0, 1, 2, 3]) SENARYO.push({ id, yaka, cx, cy: 0, rot })
  }
}

const olcum = await p.evaluate(async (senaryolar) => {
  const d = window.__dbg
  const sonuc = []
  for (const s of senaryolar) {
    d.place.start(s.id, true)          // TAŞIMA modu (oyuncunun yaptığı şey)
    d.place.rot(s.rot)
    d.place.at(s.cx, s.cy)
    const g = d.place.ghost()          // hayaletin GÖVDE konumu (onaydan ÖNCE)
    d.place.confirm()                  // ✓ onayla
    const r = d.place.real(s.id)       // sahnedeki GERÇEK gövde
    const kayit = d.place.saved(s.id)  // kayda giden footprint merkezi + açı
    sonuc.push({ ...s, ghost: g, real: r, kayit })
  }
  return sonuc
}, SENARYO)

let enBuyukSapma = 0
for (const o of olcum) {
  const bekleyen = beklenenGovde(o.id, o.cx, o.cy, o.rot)
  const hayalet = [o.ghost.bx, o.ghost.by]
  const gercek = [o.real.bx, o.real.by]
  const sapma = uzak(hayalet, gercek)
  enBuyukSapma = Math.max(enBuyukSapma, sapma)
  const etiket = `${o.id} ${o.yaka} rot${o.rot} @(${o.cx},${o.cy})`
  bekle(sapma <= TOL, `${etiket} — hayalet ↔ gerçek`,
    `hayalet (${hayalet[0].toFixed(2)}, ${hayalet[1].toFixed(2)}) · gerçek (${gercek[0].toFixed(2)}, ${gercek[1].toFixed(2)}) · sapma ${sapma.toFixed(3)}`)
  bekle(uzak(gercek, bekleyen) <= TOL, `${etiket} — geometri kuralı`,
    `beklenen (${bekleyen[0].toFixed(2)}, ${bekleyen[1].toFixed(2)})`)
  // SAVE UYUMU + RELOAD: kayıt footprint MERKEZİNİ tutmalı ve reload aynı gövdeyi kurmalı
  bekle(o.kayit.pos && Math.abs(o.kayit.pos[0] - o.cx) < 1e-6 && Math.abs(o.kayit.pos[1] - o.cy) < 1e-6,
    `${etiket} — kayıtta footprint merkezi`, JSON.stringify(o.kayit.pos))
  bekle(o.kayit.rot === o.rot, `${etiket} — kayıtta açı`, String(o.kayit.rot))
  const reload = beklenenGovde(o.id, o.kayit.pos[0], o.kayit.pos[1], o.kayit.rot)
  bekle(uzak(reload, gercek) <= TOL, `${etiket} — reload zıplaması yok`,
    `reload (${reload[0].toFixed(2)}, ${reload[1].toFixed(2)}) · fark ${uzak(reload, gercek).toFixed(3)}`)
  // Araç yuvası ünitenin baktığı yönde olmalı → gövde+yuva ORTASI ≈ footprint merkezi.
  // (Şarjda gövde ofseti 0.5, yuva ofseti 1.1 — tasarımdan gelen 0.05 birimlik asimetri
  //  var; kritik olan yuvanın ünitenin BAKTIĞI yönde kalması, o yüzden pay 0.06.)
  const ortaPay = OFS(o.id) === 0.5 ? 0.06 : TOL
  const slot = [o.kayit.slot.x, o.kayit.slot.y]
  const orta = [(gercek[0] + slot[0]) / 2, (gercek[1] + slot[1]) / 2]
  bekle(uzak(orta, [o.cx, o.cy]) <= ortaPay, `${etiket} — gövde+yuva ortası footprint merkezi`,
    `orta (${orta[0].toFixed(2)}, ${orta[1].toFixed(2)})`)
}

console.log(`\nEN BÜYÜK HAYALET↔GERÇEK SAPMASI: ${enBuyukSapma.toFixed(4)} birim (eşik ${TOL})`)
bekle(sayfaHatasi.length === 0, 'sayfa hatası yok', sayfaHatasi.join(' | '))
await b.close()

console.log(hata ? `\n${hata} kontrol başarısız` : '\nYERLEŞİM TEMİZ — hayalet nereye düşerse yapı oraya oturuyor')
process.exit(hata ? 1 : 0)
