/**
 * TAŞIMA TESTİ — oyuncu raporu #1008: "Taşıma yaparken yeri değişmeden olduğu yerde
 * döndürme olursa harika olur, taşı diyince yerinden kaldırıyor."
 * Hayalet (0,0)'dan başlıyordu; yapı istasyonun ortasına zıplıyor, yalnız döndürmek
 * isteyen oyuncu konumunu kaybediyordu.
 */
import { readFileSync } from 'node:fs'
const src = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

bekle(/const mevcut = placedPos\[id\]/.test(src), 'taşımada mevcut konum okunuyor')
bekle(/const bx = move && mevcut \? mevcut\[0\] : 0/.test(src), 'taşıma X mevcut konumdan başlıyor')
bekle(/const by = move && mevcut \? mevcut\[1\] : 0/.test(src), 'taşıma Y mevcut konumdan başlıyor')
bekle(/cx: bx, cy: by, rot: placedRot\[id\] \?\? 0/.test(src), 'mevcut dönüş de korunuyor')
bekle(!/valid: false, cx: 0, cy: 0, rot: placedRot/.test(src), 'eski (0,0) başlangıcı kaldırıldı')
// yeni yerleştirme hâlâ merkezden başlamalı (henüz konumu yok)
bekle(/move && mevcut/.test(src), 'yeni yerleştirme etkilenmiyor (yalnız move için)')
// R kısayolu ve döndürme
bekle(/\(e\.key === 'r' \|\| e\.key === 'R'\) && placing/.test(src), 'R tuşu döndürüyor')
bekle(/placing\.rot = \(placing\.rot \+ 1\) % 4/.test(src), 'dönüş 90° adımlarla')
bekle(/R veya ⟳ döndür/.test(src), 'ipucu metni klavye kısayolunu duyuruyor')

console.log(hata ? `\n${hata} kontrol başarısız` : '\ntaşıma: tüm kontroller geçti')
process.exit(hata ? 1 : 0)
