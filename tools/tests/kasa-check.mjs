/**
 * ŞUBE KASASI TESTİ — 21 şikayet: "başka şubeye gidince öncekisi çalışmıyor".
 * Kök neden kasanın erken dolmasıydı. Bu test hem sürelerin arttığını hem de
 * toplamanın sunucu anti-cheat sınırının (ALLOW_BURST ₺260.000) altında kaldığını doğrular.
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })
const { GameState } = await import('../../src/state.ts')
const ALLOW_BURST = 260_000
let hata = 0
const bekle = (k, ad) => { console.log(`${k ? '✅' : '❌'} ${ad}`); if (!k) hata++ }

bekle(GameState.BRANCH_VAULT_HARD < ALLOW_BURST,
  `mutlak tavan (₺${GameState.BRANCH_VAULT_HARD.toLocaleString('tr-TR')}) anti-cheat sınırının altında`)
const g = GameState.BRANCH_VAULT_DAYS
bekle(g[1] >= 5 && g[2] >= 8 && g[3] >= 12, `kasa süreleri yeterli: ${g.join('/')} gün`)
bekle(g[1] < g[2] && g[2] < g[3], 'müdür seviyesi hâlâ anlamlı (süre artıyor)')

const kur = (lvl, pumps) => {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'cevreyolu']; s.activeLoc = 'kasaba'
  s.locSnapshots['cevreyolu'] = { f: { managerLevel: lvl, staffLevel: 1, pumps, marketLevel: 2,
    hasRestaurant: true, hasWash: true, evChargers: 2 }, autoPumps: [0, 1], autoChargers: [] }
  return s
}
for (const [lvl, pumps] of [[1, 4], [2, 6], [3, 10]]) {
  const s = kur(lvl, pumps)
  const d = s.branchNetPerDay('cevreyolu'), cap = s.branchVaultCap('cevreyolu')
  let gun = 0
  while (s.branchVaultFill('cevreyolu') < 0.999 && gun < 60) { s.accrueBranchVaults(); gun++ }
  bekle(gun >= 4, `Sv.${lvl} müdür ${pumps} pompa → kasa ${gun} günde doluyor (≥4 olmalı)`)
  bekle(cap < ALLOW_BURST, `Sv.${lvl} tek toplama ₺${cap.toLocaleString('tr-TR')} güvenli`)
  const t = s.collectBranchVaults()
  bekle(t > 0 && s.branchVaultTotal() === 0, `Sv.${lvl} toplama kasayı sıfırlıyor`)
}
// doluluk ve dolu şube tespiti
const s = kur(2, 6)
bekle(s.branchVaultFill('cevreyolu') === 0, 'yeni şube kasası boş başlar')
for (let i = 0; i < 3; i++) s.accrueBranchVaults()
const f = s.branchVaultFill('cevreyolu')
bekle(f > 0 && f < 1, `3 gün sonra kasa kısmen dolu (%${Math.round(f * 100)}) — eskiden dolmuştu`)
bekle(s.fullBranchVaults().length === 0, '3 günde henüz dolmuyor')
while (s.branchVaultFill('cevreyolu') < 0.999) s.accrueBranchVaults()
bekle(s.fullBranchVaults().includes('cevreyolu'), 'dolunca fullBranchVaults bildiriyor')
// aktif şube kasaya yazmaz (çift sayım = 409)
const a = kur(3, 8); a.activeLoc = 'cevreyolu'; a.locSnapshots['kasaba'] = a.locSnapshots['cevreyolu']
delete a.locSnapshots['cevreyolu']
a.accrueBranchVaults()
bekle((a.branchVault['cevreyolu'] ?? 0) === 0, 'aktif şube kasaya yazmıyor (anti-cheat)')

console.log(hata ? `\n${hata} kontrol başarısız` : '\nşube kasası: tüm kontroller geçti')
process.exit(hata ? 1 : 0)
