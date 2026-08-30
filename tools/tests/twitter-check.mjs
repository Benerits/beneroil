/**
 * TWITTER GERİ BİLDİRİM TESTİ — 29 Ağu, @yenimustafagenc + @oguzthedev listesi.
 *
 *  #2  "ses efektleri ses düzeyi kontrolü (şu an yalnızca müzikte var)"
 *  #3  "2. şubemdeyken 1. şubemden kazanılan paranın komple kesilmesi"
 *      → mekanik doğru çalışıyordu (KASA TEK: gelir gün dönüşünde doğrudan kasaya).
 *        Asıl sorun oyuncunun MÜDÜR TUTMAMIŞ olması ve panelin bunun BEDELİNİ
 *        göstermemesiydi. Artık "Sv.1 müdür tutsan günlük ~₺X gelirdi" yazıyor.
 */
globalThis.localStorage = {
  _d: {}, getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) }, removeItem(k) { delete this._d[k] },
}
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
import { readFileSync } from 'node:fs'
const { GameState } = await import('../../src/state.ts')
let hata = 0
const bekle = (k, ad, ek = '') => { console.log(`${k ? '✅' : '❌'} ${ad}${ek ? ' · ' + ek : ''}`); if (!k) hata++ }
const oku = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
const audio = oku('src/audio.ts'), ui = oku('src/ui.ts'), html = oku('index.html'), main = oku('src/main.ts')

// ── #2 SES EFEKTİ SEVİYESİ ──
bekle(/private sfxGain: GainNode \| null = null/.test(audio), 'efektler için ayrı ses busu var')
bekle(/sfxVolume = Math\.min\(1, Math\.max\(0, parseFloat\(localStorage\.getItem\('benzinlik-sfx-vol'\)/.test(audio),
  'efekt seviyesi kaydediliyor (yeniden açılışta korunuyor)')
bekle(/setSfxVolume\(v: number\): void/.test(audio), 'setSfxVolume() API\'si var')
bekle(/dest = dest \?\? this\.sfxGain \?\? this\.master/.test(audio),
  'tüm efektler sfx busundan geçiyor (tek yerden kısılır)')
bekle(/gain\.connect\(this\.sfxGain \?\? this\.master\)/.test(audio),
  'döngüsel sesler (pompa/jeneratör) de busa bağlı')
bekle(/id="sfxvol"/.test(html) && /id="sfxvolval"/.test(html), 'ayarlarda efekt kaydırıcısı var')
bekle(/sfxVol\.addEventListener\('input'/.test(ui), 'kaydırıcı sese bağlı')
bekle(/this\.sfxOn = this\.sfxVolume > 0\.001/.test(audio), 'sıfıra çekince efektler kapanıyor (müzikle aynı davranış)')

// ── #3 ŞUBE GELİRİ ──
const kur = (mudurLevel) => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'cevreyolu']; s.activeLoc = 'kasaba'
  s.locSnapshots['cevreyolu'] = { f: { managerLevel: mudurLevel, staffLevel: 1, pumps: 6,
    marketLevel: 2, hasRestaurant: true, hasWash: true, evChargers: 2 }, autoPumps: [0], autoChargers: [] }
  return s
}
// mekanik: müdür varsa para GERÇEKTEN geliyor
const varMudur = kur(2)
const p0 = varMudur.money
varMudur.accrueBranchVaults()
bekle(varMudur.money > p0, 'müdürlü şube gün dönüşünde kasaya para yazıyor',
  `+₺${Math.round(varMudur.money - p0).toLocaleString('tr-TR')}`)

// müdürsüzken gelir yok — ama artık NE KAYBETTİĞİ hesaplanabiliyor
const yokMudur = kur(0)
const p1 = yokMudur.money
yokMudur.accrueBranchVaults()
bekle(yokMudur.money === p1, 'müdürsüz şube kazanmıyor (mekanik doğru — şikayetin sebebi buydu)')
const tahmin = yokMudur.branchNetPerDay('cevreyolu', 1)
bekle(tahmin.net > 0, 'müdürsüzken de "tutsan ne kazanırdın" hesaplanabiliyor',
  `Sv.1 ile günlük ₺${Math.round(tahmin.net).toLocaleString('tr-TR')}`)
bekle(yokMudur.branchNetPerDay('cevreyolu').net === 0, 'gerçek gelir yine 0 (tahmin oyunu etkilemiyor)')
bekle(/branchNetPerDay\(loc: LocId, varsayLevel\?: number\)/.test(oku('src/state.ts')),
  'branchNetPerDay tahmin parametresi alıyor')
bekle(/Müdür YOK — bu şube HİÇ kazanmıyor/.test(main),
  'panel müdürsüz şubenin BEDELİNİ sayıyla gösteriyor')

// tahmin gerçekle tutarlı mı: müdür tutulunca vaat edilen gelir gelmeli
const tutuldu = kur(1)
const gercek = tutuldu.branchNetPerDay('cevreyolu').net
bekle(Math.abs(gercek - tahmin.net) < 1, 'vaat edilen tahmin, müdür tutulunca GERÇEKLEŞEN gelirle aynı',
  `tahmin ₺${Math.round(tahmin.net)} = gerçek ₺${Math.round(gercek)}`)

console.log(hata ? `\n${hata} HATA` : '\nTWITTER GERİ BİLDİRİMLERİ TEMİZ')
process.exit(hata ? 1 : 0)
