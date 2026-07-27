// ARAYÜZ YAPISI testleri — "sekmeler bozuk görünüyor" sınıfının geri gelmemesi için.
// Kök neden buydu: oyunun ZATEN olan .tabs/.tab bileşeni varken ofise ayrı bir stil
// uydurulmuştu; yabancı duruyordu ve mobil modalda taşıyordu.
// Çalıştır: npm run test:ui
import fs from 'node:fs'
const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }
const all = (re, s = html) => [...s.matchAll(re)].map(m => m[1])

console.log('== 1) Ofis sekmeleri oyunun ORTAK bileşenini kullanıyor ==')
const ofBlock = html.slice(html.indexOf('id="officewrap"'), html.indexOf('<!-- Mağaza (IAP) -->'))
check('sekme şeridi .tabs sınıfını kullanıyor', /<div class="tabs" id="oftabs">/.test(ofBlock))
check('her sekme .tab sınıfını kullanıyor',
  all(/<button class="tab[^"]*" data-oftab="([^"]+)"/g, ofBlock).length === 5)
check('uydurma .oftab stili KALMADI', !/\.oftabs?\s*\{/.test(html) && !/class="oftab/.test(html))
check('mağazayla aynı bileşen (tek kaynak)',
  /<div class="tabs" id="shoptabs">/.test(html) && /<div class="tabs" id="oftabs">/.test(html))

console.log('\n== 2) Sekme ↔ panel bütünlüğü ==')
const tabs = all(/data-oftab="([^"]+)"/g, ofBlock)
const panes = all(/data-ofpane="([^"]+)"/g, ofBlock)
check(`5 sekme / 5 panel (${tabs.length}/${panes.length})`, tabs.length === 5 && panes.length === 5)
check('kimlikler birebir eşleşiyor', JSON.stringify(tabs) === JSON.stringify(panes),
  `sekme=${tabs} panel=${panes}`)
check('tam BİR sekme varsayılan aktif', (ofBlock.match(/class="tab active"/g) || []).length === 1)
check('tam BİR panel varsayılan açık', (ofBlock.match(/class="ofpane is-on"/g) || []).length === 1)
const firstTab = ofBlock.match(/<button class="tab active" data-oftab="([^"]+)"/)?.[1]
const firstPane = ofBlock.match(/<div class="ofpane is-on" data-ofpane="([^"]+)"/)?.[1]
check(`varsayılan sekme ve panel AYNI (${firstTab})`, firstTab === firstPane)

console.log('\n== 3) Her bölüm gerçekten dolduruluyor ==')
const ids = all(/id="(of-[a-z]+)"/g, ofBlock)
const missing = ids.filter(i => !main.includes(`getElementById('${i}')`))
check(`${ids.length} bölümün hepsi main.ts'te dolduruluyor`, missing.length === 0, 'boşta: ' + missing)
check('sekme geçişi bağlı', /#oftabs \.tab/.test(main))
// GÜNCELLENDİ (3 oyuncu raporu): İLK açılış ÖZET; panel AÇIKKEN yeniden çizim
// aktif sekmeyi KORUR (fiyat/devir işlemleri Özet'e fırlatmaz)
check('panel ilk açılış ÖZET + açıkken sekme korunur', /dataset\.oftab === keep/.test(main) && /wasOpen\s*$?/.test(main) && /\?\? 'ozet'/.test(main))

console.log('\n== 4) CSS token bütünlüğü ==')
// tanımsız değişkene fallback ile bağlanmak tema değişince sessizce kopar
const defined = new Set(all(/(--[a-z0-9-]+)\s*:/g))
const cssFiles = { 'index.html': html }
for (const f of ['src/news.ts', 'src/logbook-ui.ts', 'src/traffic-debug.ts'])
  cssFiles[f] = fs.readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const bad = []
for (const [f, src] of Object.entries(cssFiles))
  for (const v of all(/var\((--[a-z0-9-]+)\)/g, src))
    if (!defined.has(v)) bad.push(`${f}: ${v}`)
check('kullanılan tüm CSS değişkenleri TANIMLI', bad.length === 0, bad.slice(0, 5).join(' · '))

console.log('\n== 5) Modal iskeleti bozulmamış ==')
check('sekme şeridi .mhead ile .mbody ARASINDA',
  ofBlock.indexOf('class="mhead"') < ofBlock.indexOf('id="oftabs"')
  && ofBlock.indexOf('id="oftabs"') < ofBlock.indexOf('class="mbody"'))
check('paneller .mbody İÇİNDE', ofBlock.indexOf('class="mbody"') < ofBlock.indexOf('data-ofpane'))
check('modal sabit yükseklikli (sekme değişince zıplamaz)',
  /<div class="backdrop" id="officewrap">\s*<div class="modal">/.test(html))

console.log('\n== 6) CarManager seçenekleri GERÇEKTEN bağlı mı ==')
// Bu testin sebebi: birkaç seçenek (boats/waterOnly/serviceLane/carsPassThrough)
// cars.ts'te tanımlıydı, testlerde kullanılıyordu ama main.ts'te HİÇ verilmiyordu.
// Yük testi kendi opts'unu kurduğu için yeşil kalıyordu; oyunda ölü koddu.
// Belirti: marinada araba doğuyordu, 4 şerit servis şeridi çalışmıyordu.
const cars = fs.readFileSync(new URL('../../src/cars.ts', import.meta.url), 'utf8')
const optsBlock = main.slice(main.indexOf('new CarManager('), main.indexOf('new CarManager(') + 3000)
const declared = [...cars.slice(cars.indexOf('CarManagerOpts'), cars.indexOf('export class CarManager'))
  .matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1])
const KRITIK = ['boats', 'waterOnly', 'serviceLane', 'carsPassThrough', 'segments', 'entryChance', 'trafficPull']
for (const k of KRITIK) {
  check(`opts.${k} main.ts'te veriliyor`, new RegExp(`^\\s*${k}:`, 'm').test(optsBlock),
    'cars.ts\'te tanımlı ama oyuna bağlanmamış → ölü kod')
}
check(`cars.ts'te ${declared.length} seçenek tanımlı, kritik ${KRITIK.length} tanesi bağlı`, true)

console.log('\n== 7) Model kitlerinin DOKUSU var mı ==')
// Belirti: kit modelleri BEYAZ render oluyordu. GLB'ler "Textures/colormap.png"
// referansı taşıyor; klasör yoksa GLTFLoader 404 alıp map=null bırakıyor ve model
// dokusuz (beyaz) çiziliyor. Sessiz: konsola hata düşmüyor, sahne "boş" görünüyor.
import path2 from 'node:path'
const KITS = ['industrial', 'commercial2', 'watercraft']
const kroot = path2.join(new URL('../../', import.meta.url).pathname, 'public/kenney')
for (const k of KITS) {
  const tex = path2.join(kroot, k, 'Textures/colormap.png')
  check(`${k}/Textures/colormap.png var`, fs.existsSync(tex))
}
// her paket KENDİ paletini kullanmalı — kök atlası yanlış renk verir
const rootTex = fs.readFileSync(path2.join(kroot, 'Textures/colormap.png'))
for (const k of KITS) {
  const p2 = path2.join(kroot, k, 'Textures/colormap.png')
  if (!fs.existsSync(p2)) continue
  check(`${k} KENDİ paletini kullanıyor (kök atlası değil)`, !rootTex.equals(fs.readFileSync(p2)))
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
