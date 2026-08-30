/**
 * MARİNA GELİŞİM TESTİ — F grubu (7 şikayet).
 *
 *  #1037 "yat klübü sahil rest açtım ama gözükmüyor"
 *  #1017 "neredeyse bina yok yakıt istasyonu basit kalmış"
 *  #1074 "yat klübü yok gözükmüyor · iskeleler büyümüyor · pompa artırılmıyor"
 *   → satın alınan her marina tesisinin SAHNEDE yapısı olmalı, bağlama yerleri iskeleyi
 *     büyütmeli. Tesisler yalnız bir string listesinde duruyordu.
 *  #1033 "Marinada wc yok müşteri şikayet ediyo"      → mağazada tuvalet satırı
 *  #1034 "marinanın tabela geliştirilmiyo"            → mağazada tabela satırı
 *  #997  "marina'ya pompa koyabilelim artık"          → pompa tavanı 2 → 4
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState, getShopItems, buyItem } = await import('../../src/state.ts')
const { MARINA_FACILITIES, BERTH_KINDS } = await import('../../src/marina.ts')
import { readFileSync } from 'node:fs'
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

const marina = () => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'marina']
  s.activeLoc = 'marina'
  s.money = 10_000_000
  return s
}
const s = marina()
bekle(s.isMarina === true, 'marina şubesi kuruldu')
const satirlar = getShopItems(s)
const bul = id => satirlar.find(r => r.id === id)

// ── #1033 / #1034: eksik mağaza satırları ──
bekle(!!bul('toilet'), 'marina mağazasında TUVALET satırı var (#1033)')
bekle(bul('toilet')?.status === 'buy', 'tuvalet satın alınabilir durumda')
bekle(!!bul('sign'), 'marina mağazasında TABELA satırı var (#1034)')
bekle(bul('sign')?.status === 'buy', 'tabela satın alınabilir durumda')
const m2 = marina()
buyItem(m2, 'sign'); buyItem(m2, 'sign'); buyItem(m2, 'sign')
bekle(m2.signLevel === 3, `tabela 3 kez yükseltilebiliyor (Sv.${m2.signLevel})`)
bekle(getShopItems(m2).find(r => r.id === 'sign')?.status === 'maxed', 'tabela Sv.3\'te MAKS oluyor')

// ── #997 / #1074: pompa tavanı ──
const m3 = marina()
buyItem(m3, 'fueldock')
bekle(buyItem(m3, 'pump') && m3.pumps === 2, '2. iskele pompası alınabiliyor')
const kilit = getShopItems(m3).find(r => r.id === 'pump')
bekle(kilit?.status === 'locked', '3. pompa iskele büyümeden KİLİTLİ (sınır kalkmadı, koşula bağlandı)')
for (let i = 0; i < 4; i++) buyItem(m3, 'berth_finger8')
bekle(buyItem(m3, 'pump') && m3.pumps === 3, 'iskele büyüyünce 3. pompa açılıyor')
bekle(buyItem(m3, 'pump') && m3.pumps === 4, '4. pompa da alınabiliyor')
bekle(getShopItems(m3).find(r => r.id === 'pump')?.status === 'maxed', 'tavan 4 pompada duruyor')

// ── #1037 / #1017: her tesisin SAHNE görseli var mı ──
const dunya = readFileSync(new URL('../../src/world.ts', import.meta.url), 'utf8')
const yuvaBlok = dunya.slice(dunya.indexOf('MARINA_FAC_SLOTS'), dunya.indexOf('buildMarinaFac'))
for (const id of Object.keys(MARINA_FACILITIES)) {
  bekle(yuvaBlok.includes(id + ':'), `${id} tesisinin sahnede yuvası tanımlı`)
  bekle(new RegExp(`case '${id}':`).test(dunya), `${id} tesisinin çizim gövdesi var`)
}
bekle(/buildMarinaFac\(id: string/.test(dunya), 'buildMarinaFac(id) dünya API\'si mevcut')
bekle(/this\.register\('mfac-' \+ id/.test(dunya), 'tesisler tıklanabilir bina olarak kaydediliyor (isim etiketi)')

// ── #1074: bağlama yerleri iskeleyi büyütüyor mu ──
bekle(/updateBerthVisual\(berths: Record<string, number>\)/.test(dunya), 'updateBerthVisual(berths) mevcut')
for (const k of Object.keys(BERTH_KINDS)) {
  bekle(dunya.includes(`n('${k}')`), `${k} bağlama türü sahnede çiziliyor`)
}

// ── main.ts kancaları: satın alma + yeniden yükleme ──
const ana = readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8')
bekle(/hasMarinaFac\(base as MarinaFacId\)\) world\.buildMarinaFac/.test(ana),
  'tesis satın alınınca görseli ANINDA kuruluyor')
bekle(/for \(const fid of state\.marinaFacs\) world\.buildMarinaFac/.test(ana),
  'kayıt yüklenince tesisler geri geliyor (refreshte kaybolmuyor)')
bekle(/world\.updateBerthVisual\(state\.berths\)/.test(ana), 'bağlama görselleri kayıttan kuruluyor')

// ── kara şubesi ETKİLENMEDİ mi (regresyon) ──
const kara = new GameState()
const karaSatir = getShopItems(kara)
bekle(karaSatir.find(r => r.id === 'pump')?.title?.includes('Pompa'), 'kara şubesi pompa satırı bozulmadı')
bekle(!karaSatir.some(r => r.id in MARINA_FACILITIES), 'kara şubesinde marina tesisi görünmüyor')

console.log(hata ? `\n${hata} HATA` : '\nMARİNA GELİŞİM TEMİZ')
process.exit(hata ? 1 : 0)
