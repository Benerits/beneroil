/**
 * ŞUBE GELİRİ TESTİ — "başka şubeye gidince öncekisi çalışmıyor" (21 şikayet).
 *
 * TARİHÇE: önce şube kasası (vault) biriktiriyordu ve erken doluyordu; süreler uzatıldı.
 * Sonra oyuncu talebiyle KASA TEK'e geçildi (commit 9a39ccb): müdür net geliri her gün
 * dönüşünde DOĞRUDAN ortak kasaya yazılıyor, vault birikimi kaldırıldı. Bu test artık
 * yeni davranışı koruyor — vault'a para birikmediğini ve eski bakiyenin göç ettiğini
 * doğruluyor. Anti-cheat sınırı (ALLOW_BURST ₺260.000) her iki yolda da aşılmamalı.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState } = await import('../../src/state.ts')
const ALLOW_BURST = 260_000
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

const kur = (lvl, pumps) => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'cevreyolu']; s.activeLoc = 'kasaba'
  s.locSnapshots['cevreyolu'] = { f: { managerLevel: lvl, staffLevel: 1, pumps, marketLevel: 2,
    hasRestaurant: true, hasWash: true, evChargers: 2 }, autoPumps: [0, 1], autoChargers: [] }
  return s
}

// ── 1) KASA TEK: gelir doğrudan ortak kasaya ──
for (const [lvl, pumps] of [[1, 4], [2, 6], [3, 10]]) {
  const s = kur(lvl, pumps)
  const d = s.branchNetPerDay('cevreyolu')
  const oncePara = s.money
  const sonuc = s.accrueBranchVaults()
  const artis = s.money - oncePara
  bekle(artis > 0, `Sv.${lvl} · ${pumps} pompa → gün dönüşünde kasaya +₺${Math.round(artis).toLocaleString('tr-TR')}`)
  bekle(Math.abs(artis - Math.round(d.net)) <= 1, `Sv.${lvl} · eklenen tutar günlük net ile aynı (₺${Math.round(d.net)})`)
  bekle(Math.round(s.branchVault['cevreyolu'] ?? 0) === 0, `Sv.${lvl} · vault'a BİRİKMİYOR (KASA TEK)`)
  bekle(sonuc.every(x => x.full === false), `Sv.${lvl} · "kasa doldu" durumu artık oluşmuyor`)
  bekle(artis < ALLOW_BURST, `Sv.${lvl} · tek günlük artış ₺${Math.round(artis).toLocaleString('tr-TR')} anti-cheat sınırının altında`)
}

// ── 2) Müdür seviyesi hâlâ anlamlı ──
const g1 = kur(1, 6), g2 = kur(2, 6), g3 = kur(3, 6)
const n1 = g1.branchNetPerDay('cevreyolu').net
const n2 = g2.branchNetPerDay('cevreyolu').net
const n3 = g3.branchNetPerDay('cevreyolu').net
bekle(n1 < n2 && n2 < n3, `yüksek seviye müdür daha çok kazandırıyor: ₺${Math.round(n1)} < ₺${Math.round(n2)} < ₺${Math.round(n3)}`)

// ── 3) Aktif şube İKİ KEZ sayılmıyor (sunucu servet tavanı 409 vermesin) ──
const a = kur(3, 8)
a.locSnapshots['kasaba'] = { f: { managerLevel: 3, pumps: 8 }, autoPumps: [], autoChargers: [] }
const oncePara = a.money
a.accrueBranchVaults()
const tekSube = a.money - oncePara
const b = kur(3, 8)
const oncePara2 = b.money
b.accrueBranchVaults()
bekle(Math.abs(tekSube - (b.money - oncePara2)) <= 1, 'aktif şube gelire eklenmiyor (çift sayım yok)')

// ── 4) ESKİ VAULT BAKİYESİ GÖÇ EDİYOR (eski kayıtlar para kaybetmesin) ──
const eski = kur(2, 6)
eski.branchVault['cevreyolu'] = 123_456
const paraOnce = eski.money
const toplanan = eski.collectBranchVaults()
bekle(toplanan === 123_456, `eski vault bakiyesi toplanabiliyor (₺${toplanan.toLocaleString('tr-TR')})`)
bekle(eski.money - paraOnce === 123_456, 'toplanan tutar kasaya geçti')
bekle(Math.round(eski.branchVault['cevreyolu'] ?? 0) === 0, 'toplama sonrası vault sıfırlandı')

// ── 5) Kurcalanmış vault sunucu sınırını aşamıyor ──
const hile = kur(3, 10)
hile.branchVault['cevreyolu'] = 99_000_000
const { serializeState, hydrateState } = await import('../../src/state.ts')
const geri = new GameState()
hydrateState(geri, JSON.parse(JSON.stringify(serializeState(hile))))
const clamped = Math.round(geri.branchVault['cevreyolu'] ?? 0)
bekle(clamped <= GameState.BRANCH_VAULT_HARD,
  `kurcalanmış vault ₺${GameState.BRANCH_VAULT_HARD.toLocaleString('tr-TR')} ile sınırlanıyor (₺${clamped.toLocaleString('tr-TR')})`)
bekle(GameState.BRANCH_VAULT_HARD < ALLOW_BURST,
  `vault tavanı (₺${GameState.BRANCH_VAULT_HARD.toLocaleString('tr-TR')}) anti-cheat sınırının altında`)

// ── 6) Müdürsüz şube kazandırmıyor ──
const yok = kur(0, 6)
const p0 = yok.money
yok.accrueBranchVaults()
bekle(yok.money === p0, 'müdürsüz şube gelir üretmiyor (müdür tutmanın anlamı korunuyor)')

console.log(hata ? `\n${hata} HATA` : '\nşube geliri: tüm kontroller geçti')
process.exit(hata ? 1 : 0)
