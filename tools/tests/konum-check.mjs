/**
 * KONUM SABİTLEME TESTİ — oyuncu raporu: "karşı tuvalet / tır parkı gir-çık yapınca
 * yerine dönüyor". Kurulum sonrası her yapının konumu placedPos'a yazılmalı ki
 * bir dahaki açılışta aynı yerde kalsın.
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
let hata = 0
const bekle = (kosul, ad) => { console.log(`${kosul ? '✅' : '❌'} ${ad}`); if (!kosul) hata++ }

bekle(/function konumlariSabitle\s*\(/.test(src), 'konumlariSabitle() tanımlı')
bekle(/world\.setClosed\(state\.closed\)\s*\n\s*konumlariSabitle\(\)/.test(src),
      'rebuildFromState sonunda çağrılıyor')
bekle(/if \(!id \|\| placedPos\[id\]\) continue/.test(src),
      'zaten konumu olan yapıya dokunmuyor (oyuncunun yerleşimi korunur)')
bekle(/id\.startsWith\('pump-'\) \|\| id\.startsWith\('charger-'\)/.test(src),
      'pompa/şarj birimleri atlanıyor (kendi açı tabloları var)')
bekle(/if \(yazildi\) persist\(\)/.test(src), 'onarım kalıcı yazılıyor')

// karşı yaka tesisleri hem PLACEABLE hem buildVisual'da tanımlı olmalı
for (const id of ['toilet2', 'wash2', 'oil2', 'coffee2', 'restaurant2', 'market2']) {
  bekle(new RegExp(`${id}:\\s*\\(\\)`).test(src), `${id} PLACEABLE listesinde`)
  bekle(new RegExp(`case '${id}':`).test(src), `${id} buildVisual'da kurulabiliyor`)
}
console.log(hata ? `\n${hata} kontrol başarısız` : '\nkonum sabitleme: tüm kontroller geçti')
process.exit(hata ? 1 : 0)
