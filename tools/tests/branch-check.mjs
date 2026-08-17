/**
 * ŞUBE MÜDÜRÜ testleri — pasif şubenin gerçekten çalıştığını DAVRANIŞLA doğrular.
 *
 * Bu dosyanın varlık sebebi: bu repoda daha önce "ölçtüm" denilen şey sabitin kendisiydi
 * (marina bileti testi tabloyu okuyup tabloya bakıyordu, oyuna hiç bağlanmamıştı).
 * Buradaki testler state üzerinden GÜN DÖNDÜRÜP kasanın doldugunu okuyor.
 *
 * Çalıştır: npm run test:branch
 */
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
Object.defineProperty(globalThis, 'navigator', { value: { language: 'tr' }, configurable: true })

const { GameState, hydrateState, serializeState } = await import('../../src/state.ts')

let pass = 0, fail = 0
const check = (n, c, d = '') => { c ? (pass++, console.log('  ✓ ' + n)) : (fail++, console.log(`  ✗ ${n}${d ? ' — ' + d : ''}`)) }

/** İki şubeli oyuncu: aktif kasaba, pasif otoyol (müdür seviyesi parametrik) */
function twoBranch(level, extra = {}) {
  const s = new GameState()
  s.unlockedLocs = ['kasaba', 'otoyol']
  s.activeLoc = 'kasaba'
  s.locSnapshots = {
    otoyol: {
      f: { pumps: 6, evChargers: 2, marketLevel: 2, hasRestaurant: true, managerLevel: level, staffLevel: 1, ...extra },
      tanks: { benzin: 500, dizel: 500, lpg: 300 }, tankCounts: {}, prices: {}, pendingCash: {},
      ownedParcels: [], pavedParcels: [], autoPumps: [0, 1], autoChargers: [],
      brokenPumps: [], brokenChargers: [], placedPos: {}, placedRot: {}, placedRects: [],
    },
  }
  return s
}

console.log('== 1) Müdürsüz şube hiçbir şey kazanmaz ==')
{
  const s = twoBranch(0)
  const d = s.branchNetPerDay('otoyol')
  check('müdürsüz günlük net = 0', d.net === 0, String(d.net))
  check('müdürsüz kasa tavanı = 0', s.branchVaultCap('otoyol') === 0)
  s.accrueBranchVaults()
  check('gün dönüşünde kasa boş kalır', (s.branchVault.otoyol ?? 0) === 0)
}

console.log('\n== 2) Müdür varsa şube kazanır ve seviye arttıkça artar ==')
{
  const n1 = twoBranch(1).branchNetPerDay('otoyol')
  const n2 = twoBranch(2).branchNetPerDay('otoyol')
  const n3 = twoBranch(3).branchNetPerDay('otoyol')
  check('Sv.1 pozitif net üretir', n1.net > 0, String(n1.net))
  check('Sv.2 > Sv.1', n2.net > n1.net, `${n1.net} → ${n2.net}`)
  check('Sv.3 > Sv.2', n3.net > n2.net, `${n2.net} → ${n3.net}`)
  check('yovmiye gider olarak düşülüyor', n3.gross > n3.net, `brüt ${n3.gross} net ${n3.net}`)
  console.log(`      ↳ otoyol (6 pompa, 2 EV, market 2, restoran): Sv.1 ₺${n1.net}/gün · Sv.3 ₺${n3.net}/gün`)
}

console.log('\n== 3) Kasa gün gün dolar ve TAVANDA DURUR ==')
{
  const s = twoBranch(2)
  const per = s.branchNetPerDay('otoyol').net
  const cap = s.branchVaultCap('otoyol')
  const m0 = s.money
  s.accrueBranchVaults()
  // 17 Ağu (Oğuz — "kasa tek olsun"): birikim ŞUBE KASASINA değil DOĞRUDAN ortak kasaya
  check('bir gün sonra günlük net DOĞRUDAN kasada', s.money === m0 + per, `${s.money - m0} vs ${per}`)
  check('şube kasası artık birikmez', (s.branchVault.otoyol ?? 0) === 0)
  for (let i = 0; i < 40; i++) s.accrueBranchVaults()
  check('40 gün sonra 41 günlük net kasada (tavansız — sunucu kovası günlük akışı zaten kapsar)',
    s.money === m0 + per * 41, `${s.money - m0} vs ${per * 41}`)
  check('mutlak tavan sabiti duruyor (eski kayıt göçü için)', cap <= GameState.BRANCH_VAULT_HARD, `${cap}`)
}

console.log('\n== 4) AKTİF şube kasaya yazmaz (çift sayım = anti-cheat 409) ==')
{
  const s = twoBranch(3)
  s.managerLevel = 3           // aktif şubede de müdür var
  const res = s.accrueBranchVaults()
  check('aktif şube (kasaba) akıtmadı (çift sayım yok)', !res.some(r => r.loc === 'kasaba'))
  check('yalnız pasif şube (otoyol) kasaya aktı', res.length === 1 && res[0].loc === 'otoyol' && res[0].added > 0)
}

console.log('\n== 5) Toplama parayı kasaya geçirir ve kasayı sıfırlar ==')
{
  // ESKİ birikmiş şube kasası (göç senaryosu): collect hâlâ çalışır ve tek seferliktir
  const s = twoBranch(2)
  s.branchVault.otoyol = 12_345 // eski kayıttan gelmiş bakiye
  const before = s.money
  const got = s.collectBranchVaults()
  check('eski bakiye toplandı', got === 12_345, `${got}`)
  check('para kasaya eklendi', s.money === before + 12_345)
  check('şube kasası sıfırlandı', (s.branchVault.otoyol ?? 0) === 0)
  check('tekrar toplamak para vermez (çift tahsilat yok)', s.collectBranchVaults() === 0)
}

console.log('\n== 6) Tek şube toplama diğerine dokunmaz ==')
{
  const s = twoBranch(2)
  s.branchVault.otoyol = 5000; s.branchVault.marina = 7000 // eski bakiyeler
  s.collectBranchVaults('otoyol')
  check('otoyol boşaldı', (s.branchVault.otoyol ?? 0) === 0)
  check('marina dokunulmadı', s.branchVault.marina === 7000, `${s.branchVault.marina}`)
}

console.log('\n== 7) Save ADDITIVE: alan yoksa çöker mi, varsa kırpılıyor mu ==')
{
  const s = twoBranch(2)
  s.branchVault.otoyol = 4321 // eski bakiye — göç tamamlanana dek save'de taşınmalı
  const ser = serializeState(s)
  check('branchVault serialize ediliyor', !!ser.branchVault && ser.branchVault.otoyol === 4321)
  // ESKİ SAVE (alan yok) → varsayılan boş, çökme yok
  const old = new GameState()
  hydrateState(old, { day: 12, money: 5000 })
  check('eski save (branchVault yok) sorunsuz yüklenir', old.branchVaultTotal() === 0)
  // KURCALANMIŞ SAVE → tavanla kırpılır
  const hacked = new GameState()
  hydrateState(hacked, { branchVault: { otoyol: 9_999_999_999, sahte: 500, marina: -5 } })
  check('kurcalanmış tutar mutlak tavana kırpılıyor',
    hacked.branchVault.otoyol === GameState.BRANCH_VAULT_HARD, String(hacked.branchVault.otoyol))
  check('geçersiz şube adı atılıyor', !('sahte' in hacked.branchVault))
  check('negatif tutar atılıyor', !('marina' in hacked.branchVault))
}

console.log('\n== 8) Aktif oynamak müdürden HER ZAMAN kârlı (müdür oyunun yerine geçmez) ==')
{
  check('en yüksek verim %85 (asla 1.0 değil)',
    GameState.BRANCH_MANAGER_EFF[3] === 0.85, String(GameState.BRANCH_MANAGER_EFF[3]))
  check('Sv.1 verimi yarının altında', GameState.BRANCH_MANAGER_EFF[1] < 0.5)
}

console.log('\n== 9) Sunucu clampleri istemciyle BİREBİR ==')
{
  const fs = await import('node:fs')
  const srv = fs.readFileSync(new URL('../../server/index.js', import.meta.url), 'utf8')
  const m = srv.match(/const BRANCH_VAULT_HARD = ([\d_]+)/)
  check('sunucuda BRANCH_VAULT_HARD tanımlı', !!m)
  check('sunucu tavanı istemciyle aynı',
    m && Number(m[1].replace(/_/g, '')) === GameState.BRANCH_VAULT_HARD,
    m ? `${m[1]} vs ${GameState.BRANCH_VAULT_HARD}` : '')
  check('sanitizeSave clampBranchVault çağırıyor', /\n\s*clampBranchVault\(s\)/.test(srv))
  check('maxIncomeRate müdürlü şubeleri kova hızına ekliyor',
    /managerLevel[\s\S]{0,200}branch \+=/.test(srv))
}

console.log(`\nSONUÇ: ${pass} geçti, ${fail} kaldı`)
process.exit(fail ? 1 : 0)
