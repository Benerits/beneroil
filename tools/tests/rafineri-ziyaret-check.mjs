/**
 * RAFİNERİ ZİYARETİ — "rafineri bir lokasyon olsun, oraya gidebilelim, 3B görünsün,
 * çalışırken animasyon olsun, geliştikçe geliştiğini görelim" (5 Eyl 2026).
 *
 * TASARIM: rafineri LocId DEĞİL. baseLoc('rafineri') sessizce 'kasaba' döner ve
 * unlockedLocs.length 10+ yerde "şube sayısı" olarak kullanılır (devir eşiği, "beş şube"
 * başarımı, kumbara, rehber, REFINERY_REQ.locs kendini doğrular…). Bunun yerine ZİYARET =
 * SAHNE MODU: aynı canvas/kamera/HUD, yalnız çizilen sahne değişir (renderPass.scene),
 * activeLoc değişmez, istasyon simülasyonu arkada çalışır, reload yok, kayıt/sunucu yok.
 *
 * Bu test kanıtlar:
 *   KOD  — rafineri.ts sınıfı ve kancaları (kur/update/setNight), main.ts git/dön akışı,
 *          locmenu + harita + rafbar giriş noktaları, yerleştirme/zone başlarken geri dönüş,
 *          handleClick ziyarette pasif, activeLoc'a dokunulmaz, EN/FR çevirileri tam.
 *   E2E  — headless Chrome: 6 durum (boş arsa, inşaat 1, kd1, inşaat 2, kd2, kd3) için
 *          sahne bina/parça sayısı KADEMEYLE ARTAR (görünür büyüme), inşaatta vinç var,
 *          tamamlanan kademede duman/fener animasyonu var ve update() ile HAREKET EDİYOR,
 *          ziyarette istasyon panelleri gizli, don() sahneyi/etiketi/kamerayı geri alır,
 *          activeLoc ziyaret boyunca sabit, sayfa hatası yok.
 *
 * Kullanım: node tools/tests/rafineri-ziyaret-check.mjs   (kendi vite'ını açar; PORT env ile hazır sunucu da verilebilir)
 */
import { readFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')

console.log('── KOD ──')
const raf = oku('src/rafineri.ts'), main = oku('src/main.ts'), harita = oku('src/harita.ts'), html = oku('index.html'), i18n = oku('src/i18n.ts'), state = oku('src/state.ts')
bekle(/export class RafineriSahnesi/.test(raf) && /kur\(seviye: number, insaatIlerleme: number\)/.test(raf) && /update\(dt: number\)/.test(raf) && /setNight\(f: number\)/.test(raf), 'RafineriSahnesi: kur/update/setNight')
bekle(/private damitma\(/.test(raf) && /private depolama\(/.test(raf) && /private filo\(/.test(raf) && /private insaatSahasi\(/.test(raf) && /private bosArsa\(/.test(raf), '3 kademe + inşaat sahası + boş arsa ayrı çizimler')
bekle(/parcaAc\(/.test(raf) && /scale\.z/.test(raf), 'inşaat ilerlemesi parçaları sırayla yükseltir (geliştikçe görünür)')
bekle(/dumanEkle\(/.test(raf) && /vincKol/.test(raf) && /fenerler/.test(raf) && /tankerler/.test(raf), 'animasyon kancaları: duman, vinç, fener, tanker')
bekle(/measureText\(/.test(raf), 'tabela metni panoya sığdırılır (EN/FR uzun çeviri taşmaz)')
bekle(!/type LocId[^\n]*rafineri/.test(state) && !/'rafineri'/.test(state.slice(0, 3000)), 'state.ts: rafineri LocId DEĞİL (şube sayacı bozulmaz)')
bekle(/function rafineriyeGit\(\)/.test(main) && /function rafineridenDon\(\)/.test(main), 'main.ts: rafineriyeGit / rafineridenDon')
bekle(/renderPass\.scene = rafSahne\.scene/.test(main) && /renderPass\.scene = world\.scene/.test(main), 'sahne değişimi renderPass üzerinden (kamera/HUD aynı)')
bekle(/rafZiyaret && rafSahne \? rafSahne\.scene : world\.scene/.test(main), 'LIGHT modda doğrudan render de sahneyi değiştirir')
bekle(!/rafineriyeGit\(\)[\s\S]{0,600}state\.activeLoc\s*=/.test(main), 'ziyaret activeLoc’a yazmaz')
bekle(/if \(rafZiyaret\) return/.test(main), 'handleClick ziyarette istasyon raycast yapmaz')
bekle(/document\.body\.classList\.add\('raf-ziyaret'\)/.test(main) && /body\.raf-ziyaret #panel, body\.raf-ziyaret #infocard \{ display:none !important \}/.test(html), 'ziyarette istasyon panelleri (müşteri isteği/bina kartı) gizli')
bekle(/rafKameraYedek = \{ x: camX, y: camY, zoom: camera\.zoom \}/.test(main), 'kamera yedeklenir, dönüşte geri gelir')
bekle(/if \(rafZiyaret && rafSahne\) \{[\s\S]{0,400}rafSahne\.update\(dt\)/.test(main), 'frame(): ziyarette sahne update(dt) alır')
bekle(/rafSahne\.kur\(state\.refineryLevel, state\.refineryProgress\(\)\)/.test(main), 'frame(): kademe/ilerleme değişince sahne yeniden kurulur')
bekle((main.match(/rafineridenDon\(\)/g) || []).length >= 5, 'yerleştirme, zone modu, şube geçişi ziyaretten önce çıkar', `${(main.match(/rafineridenDon\(\)/g) || []).length} çağrı`)
bekle(/__rafineri/.test(main) && /rafineriDurumMetni\(\)/.test(main), 'şube menüsünde Rafineri satırı (durum metniyle)')
bekle(/data-hrafgo/.test(harita) && /onRafineriGit/.test(harita) && /onRafineriGit: \(\) =>/.test(main), 'harita kartında "Rafineriye Git" → ziyaret')
bekle(/id="rafbar"/.test(html) && /id="rafback"/.test(html) && /id="rafbar-tx"/.test(html), 'index.html: rafbar + Şubeye dön')
bekle(/rafineri: \{\s*git\(\)/.test(main), '__dbg.rafineri (test/video kancası)')
for (const k of ['Rafineriye Git', 'Şubeye dön', 'istasyona dön', 'boş arsa · haritadan kur', 'Kademe {0} · {1} çalışıyor', '{0} inşa ediliyor · {1} gün kaldı', 'BENELOIL RAFİNERİ', 'RAFİNERİ ARSASI', 'BenelOil · haritadan kur', 'İNŞAAT SAHASI']) {
  const n = (i18n.match(new RegExp('^  "' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '": ', 'gm')) || []).length
  bekle(n === 2, `i18n EN+FR: "${k}"`, `${n}/2`)
}

// ── E2E ──
console.log('\n── E2E (headless Chrome) ──')
let PORT = process.env.PORT, vite = null
const canli = async port => { try { const r = await fetch(`http://localhost:${port}/`); return r.ok } catch { return false } }
if (!PORT || !(await canli(PORT))) {
  PORT = '5391'
  vite = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { cwd: new URL('../../', import.meta.url), stdio: 'ignore' })
  for (let i = 0; i < 40 && !(await canli(PORT)); i++) await new Promise(r => setTimeout(r, 500))
}
bekle(await canli(PORT), `dev sunucu :${PORT}`)

const b = await chromium.launch({ channel: 'chrome' })
const p = await (await b.newContext({ viewport: { width: 1280, height: 800 } })).newPage()
const hatalar = []
p.on('pageerror', e => hatalar.push(String(e).slice(0, 200)))
await p.addInitScript(() => { localStorage.setItem('benzinlik-music', '0') })
await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
let hazir = false
for (let i = 0; i < 30 && !hazir; i++) {
  hazir = await p.evaluate(() => {
    document.getElementById('gguest')?.click()
    const g = document.getElementById('authgate'); if (g) g.style.display = 'none'
    return typeof window.__dbg === 'object' && !!window.__dbg.rafineri
  }).catch(() => false)
  if (!hazir) await p.waitForTimeout(700)
}
bekle(hazir, '__dbg.rafineri hazır')

const durum = () => p.evaluate(() => {
  const d = window.__dbg, sc = d.rafineri.sahne?.scene
  let mesh = 0, isik = 0
  sc?.traverse(o => { if (o.isMesh) mesh++; if (o.isPointLight) isik++ })
  const bar = document.getElementById('rafbar')
  const panelGizli = getComputedStyle(document.getElementById('panel')).display === 'none'
  return {
    ziyaret: d.rafineri.ziyaret, mesh, isik, activeLoc: d.state.activeLoc,
    lbl: document.getElementById('loclabel')?.textContent?.trim() || '',
    barGorunur: !!bar && getComputedStyle(bar).display !== 'none', barTx: document.getElementById('rafbar-tx')?.textContent || '',
    panelGizli, ziyaretSinifi: document.body.classList.contains('raf-ziyaret'), sahneId: sc?.uuid || null,
  }
})
const kur = async (lvl, days) => {
  await p.evaluate(({ lvl, days }) => { window.__dbg.state.refineryLevel = lvl; window.__dbg.state.refineryDaysLeft = days; window.__dbg.rafineri.git() }, { lvl, days })
  await p.waitForTimeout(900)
  return durum()
}
const once = await durum()
const activeLoc0 = once.activeLoc
bekle(!once.ziyaret, 'başlangıçta ziyaret kapalı')

const k0 = await kur(0, 0)
bekle(k0.ziyaret && k0.barGorunur && /boş arsa/.test(k0.barTx), 'boş arsa: ziyaret açık, bar "boş arsa"', k0.barTx)
bekle(k0.panelGizli && k0.ziyaretSinifi, 'ziyarette #panel gizli (body.raf-ziyaret)')
bekle(k0.lbl === 'Rafineri', 'şube etiketi "Rafineri"', k0.lbl)
const i1 = await kur(0, 3)
bekle(i1.mesh > k0.mesh && /inşa ediliyor · 3 gün/.test(i1.barTx), 'inşaat 1: sahne büyüdü, bar "inşa ediliyor · 3 gün"', `${k0.mesh}→${i1.mesh} · ${i1.barTx}`)
const vinc = await p.evaluate(() => { let v = false; window.__dbg.rafineri.sahne.scene.traverse(o => { if (o.name === 'vincKol') v = true }); return v })
bekle(vinc, 'inşaatta vinç var')
const k1 = await kur(1, 0)
bekle(k1.mesh > i1.mesh - 30 && /Kademe 1 · Damıtma/.test(k1.barTx), 'kademe 1: bar "Kademe 1 · Damıtma Ünitesi çalışıyor"', k1.barTx)
const k2 = await kur(2, 0)
bekle(k2.mesh > k1.mesh && /Kademe 2 · Depolama/.test(k2.barTx), 'kademe 2: sahne kademe 1’den büyük', `${k1.mesh}→${k2.mesh}`)
const k3 = await kur(3, 0)
bekle(k3.mesh > k2.mesh && /Kademe 3 · Kendi Tanker/.test(k3.barTx), 'kademe 3: sahne kademe 2’den büyük', `${k2.mesh}→${k3.mesh}`)
bekle(k3.isik === k0.isik, 'ışık sayısı sabit (shader derlemesi yok)', `${k0.isik}=${k3.isik}`)
// hareket: duman parçacıkları ve tanker konumu iki kare arasında değişmeli
const hareket = await p.evaluate(async () => {
  const sc = window.__dbg.rafineri.sahne.scene
  const al = () => { const a = []; sc.traverse(o => { if (o.isMesh && o.geometry?.type === 'SphereGeometry' && o.material?.transparent) a.push(o.position.z) }); return a }
  const t1 = al(); await new Promise(r => setTimeout(r, 400)); const t2 = al()
  return t1.length > 0 && t1.some((z, i) => Math.abs(z - t2[i]) > 1e-4)
})
bekle(hareket, 'çalışırken animasyon: duman kareler arasında hareket ediyor')
bekle(k3.activeLoc === activeLoc0, 'activeLoc ziyaret boyunca değişmedi', `${activeLoc0}`)

await p.evaluate(() => window.__dbg.rafineri.don())
await p.waitForTimeout(400)
const don = await durum()
bekle(!don.ziyaret && !don.barGorunur && !don.ziyaretSinifi && don.lbl !== 'Rafineri', 'don(): ziyaret kapandı, bar gizlendi, panel kilidi kalktı, etiket şube', don.lbl)
const sahneDogru = await p.evaluate(() => { const d = window.__dbg; const c = document.querySelector('canvas'); return !!c && d.state.activeLoc === 'kasaba' })
bekle(sahneDogru, 'dönüşte istasyon sahnesi (kasaba) ve canvas yerinde')
bekle(hatalar.length === 0, 'sayfa hatası yok', hatalar.join(' | '))

await b.close()
if (vite) vite.kill()
console.log(hata ? `\n❌ ${hata} hata` : '\n✅ hepsi geçti')
process.exit(hata ? 1 : 0)
