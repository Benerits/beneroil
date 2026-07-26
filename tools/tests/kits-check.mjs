// ŞUBE KİTLERİ testleri — asıl iddia: "kasaba oyuncusu tek bayt fazla indirmiyor".
// Çalıştır: npm run test:kits
import fs from 'node:fs'
import path from 'node:path'
const ROOT = new URL('../../', import.meta.url).pathname

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

const src = fs.readFileSync(path.join(ROOT, 'src/kits.ts'), 'utf8')
// MANİFEST'i kaynaktan çıkar (kod ile test aynı listeyi görsün — kopya sürüklenmesi olmasın)
const manifest = {}
const mBlock = src.slice(src.indexOf('const MANIFEST'), src.indexOf('/** Yüklenmiş kitler'))
for (const m of mBlock.matchAll(/(\w+):\s*\{\s*dir:\s*'([^']+)',\s*files:\s*\[([\s\S]*?)\],\s*\}/g)) {
  manifest[m[1]] = { dir: m[2], files: [...m[3].matchAll(/'([^']+)'/g)].map(x => x[1]) }
}

console.log('== 1) Hangi şube ne indiriyor ==')
check('kasaba HİÇBİR ek paket indirmiyor', !manifest.kasaba)
check('çevre yolu artık şehir dokusu indiriyor (eskiden yolun iki yanı boştu)', !!manifest.cevreyolu)
check('otoyol sanayi kiti istiyor', manifest.otoyol?.dir === 'industrial')
// KORUNAN VAAT: kasaba oyuncusu tek bayt fazla indirmez
check('kasaba manifestte HİÇ YOK', !('kasaba' in manifest))
check('metropol ticari kit istiyor', manifest.metropol?.dir === 'commercial2')
check('marina deniz kiti istiyor', manifest.marina?.dir === 'watercraft')

console.log('\n== 2) Manifestteki her model DİSKTE var mı ==')
let missing = [], bytes = {}
for (const [loc, spec] of Object.entries(manifest)) {
  let total = 0
  for (const f of spec.files) {
    const p = path.join(ROOT, 'public/kenney', spec.dir, f + '.glb')
    if (!fs.existsSync(p)) missing.push(`${loc}/${f}`)
    else total += fs.statSync(p).size
  }
  bytes[loc] = total
}
check(`manifestteki ${Object.values(manifest).reduce((a, s) => a + s.files.length, 0)} modelin hepsi diskte`,
  missing.length === 0, missing.slice(0, 6).join(' · '))

console.log('\n== 3) İndirme boyutu makul mü ==')
for (const [loc, b] of Object.entries(bytes)) {
  const kb = Math.round(b / 1024)
  check(`${loc}: ${kb} KB (${manifest[loc].files.length} model) · 1.5 MB altında`, kb < 1536, `${kb} KB`)
}
// paketin TAMAMI ile karşılaştır: manifest gerçekten kısıtlıyor mu
for (const [loc, spec] of Object.entries(manifest)) {
  const dir = path.join(ROOT, 'public/kenney', spec.dir)
  const all = fs.readdirSync(dir).filter(f => f.endsWith('.glb'))
  const allBytes = all.reduce((a, f) => a + fs.statSync(path.join(dir, f)).size, 0)
  const saved = Math.round((1 - bytes[loc] / allBytes) * 100)
  check(`${loc}: paketin tamamı yerine seçili alt küme (${spec.files.length}/${all.length} model, %${saved} tasarruf)`,
    spec.files.length < all.length)
}

console.log('\n== 4) Tembellik gerçekten kurulmuş mu ==')
const main = fs.readFileSync(path.join(ROOT, 'src/main.ts'), 'utf8')
check('açılışta YALNIZ aktif şubenin kiti yükleniyor', /loadKit\(locHint\)/.test(main))
check('şube değişiminde hedef kit reload ÖNCESİ indiriliyor', /kitNeeded\(id\)[\s\S]{0,200}loadKit\(id\)/.test(main))
check('ağ takılırsa oyuncu bekletilmiyor (zaman aşımı var)', /setTimeout\(goReload,\s*\d{4,}\)/.test(main))
check('kit önbelleğe alınıyor (aynı şubeye dönünce tekrar inmez)', /cache\.set\(loc, kit\)/.test(src))
check('eşzamanlı çift indirme engelli', /inflight/.test(src))
check('tek model hatası sahneyi düşürmez', /model = null/.test(src) && /catch\s*\{/.test(src))
check('hiçbiri gelmezse önbelleğe ALINMIYOR (ağ düzelince tekrar denenir)',
  /loaded === 0[\s\S]{0,200}return null/.test(src))

console.log('\n== 5) Kasaba oyuncusunun maliyeti ==')
check('kasaba için indirilecek model sayısı: 0', (manifest.kasaba?.files.length ?? 0) === 0)
check(`çevre yolu kiti KÜÇÜK tutuldu (${manifest.cevreyolu?.files.length ?? 0} model ≤ 10)`,
  (manifest.cevreyolu?.files.length ?? 0) <= 10)
const boot = main.slice(main.indexOf('const [modelLib, staticLib, branchKit]'), main.indexOf('const world = new World'))
check('açılış yüklemesi TÜM kitleri çekmiyor', !/industrial|commercial2|watercraft/.test(boot))

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
