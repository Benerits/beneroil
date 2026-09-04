// ÖDÜLLÜ REKLAM SUNUCU KATMANI TESTİ (server/reklam.js) — 3 Eyl 2026
//
// Gerçek DB yok: bilet/gün/oyuncu tablolarını bellekte taklit eden sahte bir pool ile
// bilet → SSV → claim akışının PARA kurallarını sınar. Koruduğu iddialar:
//   T1  SSV imzası: sha1(event_id + EVENT_KEY) — yanlış imza 403, anahtar yokken 503 (fail-closed)
//   T2  Native 'reward' claim SSV gelmeden ÖDÜL VERMEZ (pending); SSV sonrası verir; ikinci claim tekrar vermez
//   T3  Aynı event_id ikinci kez (AppLovin retry) → tek ödül
//   T4  Günlük tavan gerçek UTC gününe bağlı: cap dolunca bilet 'cap' ile reddedilir
//   T5  Bütçe: reklam parası ≤ oran × 7 günlük aktif kazanç — tutar KESİLİR, çok küçükse teklif çıkmaz
//   T6  Nofill yolu günde 2 ile sınırlı; 'web' yolu native biletle KULLANILAMAZ (platform sahteciliği)
//   T7  Premium (noAds) claim'i sunucudaki noAds'e bakar, istemci beyanına değil
//   T8  Kurtarma: kasada KURTARMA_MAX üstü para varsa 'not-broke'; oyun-içi haftada 2 (weekCap)
//   T9  Uzaktan ayar: DB 'placements' satırı enabled:false → 'disabled'; ratio DB'den okunur
//   T10 Para ödülü kaydın JSON'una değil benzinlik_player.ad_credit'e yazılır (save yarışına karşı)
import { createReklam, verifyAppLovinToken, moneyCap, mergePlacements, PLACEMENT_DEFAULTS } from '../../server/reklam.js'
import crypto from 'node:crypto'

let fails = 0
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fails++ }

// ---------- sahte pool ----------
function fakePool() {
  const db = { players: {}, tickets: [], day: [], events: [], cfg: {} }
  const today = new Date().toISOString().slice(0, 10)
  const q = async (sql, p = []) => {
    const S = sql.replace(/\s+/g, ' ')
    if (/^(CREATE|ALTER)/i.test(S)) return { rows: [], rowCount: 0 }
    if (S.startsWith('SELECT key, value FROM benzinlik_ad_config')) return { rows: Object.entries(db.cfg).map(([key, value]) => ({ key, value })) }
    if (S.startsWith('INSERT INTO benzinlik_ad_day')) {
      const [email, day, placement, n, amount, nofill] = p
      let r = db.day.find(x => x.email === email && x.day === day && x.placement === placement)
      if (!r) { r = { email, day, placement, n: 0, amount: 0, nofill: 0 }; db.day.push(r) }
      r.n += n; r.amount += amount; r.nofill += nofill
      return { rows: [], rowCount: 1 }
    }
    if (S.startsWith('SELECT placement, day, n, amount, nofill FROM benzinlik_ad_day')) {
      const lim = new Date(Date.now() - 6 * 86400e3).toISOString().slice(0, 10) // SQL: day >= CURRENT_DATE - 6
      return { rows: db.day.filter(x => x.email === p[0] && x.day >= lim) }
    }
    if (S.startsWith('INSERT INTO benzinlik_ad_event')) { db.events.push({ placement: p[0], event: p[1], provider: p[2] }); return { rows: [], rowCount: 1 } }
    if (S.startsWith('SELECT save, updated_at, banned_at FROM benzinlik_player')) { const pl = db.players[p[0]]; return { rows: pl ? [pl] : [] } }
    if (S.startsWith("SELECT (save->'s'->>'noAds')::boolean AS na FROM benzinlik_player")) { const pl = db.players[p[0]]; return { rows: pl ? [{ na: !!pl.save?.s?.noAds }] : [] } }
    if (S.startsWith('SELECT count(*)::int AS n FROM benzinlik_ad_ticket')) {
      const n = db.tickets.filter(t => t.email === p[0] && t.placement === p[1] && t.status === 'claimed' && t.game_day >= p[2]).length
      return { rows: [{ n }] }
    }
    if (S.startsWith('INSERT INTO benzinlik_ad_ticket')) {
      const [id, email, uid, placement, amount, meta, status, provider, platform, game_day] = p
      db.tickets.push({ id, email, uid, placement, amount, meta, status, provider, platform, game_day, event_id: null, created_at: new Date() })
      return { rows: [], rowCount: 1 }
    }
    if (S.startsWith("UPDATE benzinlik_ad_ticket SET status='claimed'")) {
      const t = db.tickets.find(t => t.id === p[0] && t.status !== 'claimed')
      if (!t) return { rows: [], rowCount: 0 }
      t.status = 'claimed'; t.provider = t.provider || p[1]
      return { rows: [{ amount: t.amount }], rowCount: 1 }
    }
    if (S.startsWith('UPDATE benzinlik_player SET ad_credit')) {
      const pl = db.players[p[0]]; pl.ad_credit = Math.min(p[1], (pl.ad_credit || 0) + p[2]); return { rows: [], rowCount: 1 }
    }
    if (S.startsWith('SELECT * FROM benzinlik_ad_ticket WHERE id=$1 AND email=$2')) return { rows: db.tickets.filter(t => t.id === p[0] && t.email === p[1]) }
    if (S.startsWith('SELECT * FROM benzinlik_ad_ticket WHERE id=$1')) return { rows: db.tickets.filter(t => t.id === p[0]) }
    if (S.startsWith('SELECT * FROM benzinlik_ad_ticket WHERE uid=$1')) {
      const r = db.tickets.filter(t => t.uid === p[0] && t.status === 'pending' && (p[1] === '' || t.placement === p[1])).slice(-1)
      return { rows: r }
    }
    if (S.startsWith('SELECT 1 FROM benzinlik_ad_ticket WHERE event_id=$1')) { const n = db.tickets.filter(t => t.event_id === p[0]).length; return { rows: n ? [{}] : [], rowCount: n } }
    if (S.startsWith("UPDATE benzinlik_ad_ticket SET status='verified'")) { const t = db.tickets.find(t => t.id === p[0]); t.status = 'verified'; t.event_id = p[1]; return { rows: [], rowCount: 1 } }
    if (S.startsWith('UPDATE benzinlik_ad_ticket SET event_id=$2')) { const t = db.tickets.find(t => t.id === p[0]); if (t && !t.event_id) t.event_id = p[1]; return { rows: [], rowCount: 1 } }
    if (S.startsWith("UPDATE benzinlik_ad_ticket SET status='expired'")) { const t = db.tickets.find(t => t.id === p[0]); if (t) t.status = 'expired'; return { rows: [], rowCount: 1 } }
    if (S.startsWith('SELECT id, placement, amount, meta FROM benzinlik_ad_ticket')) return { rows: db.tickets.filter(t => t.email === p[0] && t.status === 'verified') }
    if (S.startsWith('SELECT placement, event, count(*)::int AS n')) return { rows: db.events || [] }
    if (S.startsWith('SELECT placement, sum(n)::int AS n, sum(amount)::bigint AS amount')) {
      const g = {}
      for (const r of db.day) { if (r.placement === '_gain') continue; const o = (g[r.placement] ||= { placement: r.placement, n: 0, amount: 0, nofill: 0, emails: new Set() }); o.n += r.n; o.amount += r.amount; o.nofill += r.nofill; o.emails.add(r.email) }
      return { rows: Object.values(g).map(o => ({ ...o, players: o.emails.size })) }
    }
    if (S.startsWith('SELECT count(*)::int AS n FROM benzinlik_player WHERE last_seen_at')) return { rows: [{ n: db.activePlayers ?? 0 }] }
    if (S.startsWith('SELECT count(DISTINCT email)::int AS n FROM benzinlik_ad_day')) return { rows: [{ n: new Set(db.day.filter(r => r.placement !== '_gain' && r.n > 0).map(r => r.email)).size }] }
    throw new Error('sahte pool bilmiyor: ' + S.slice(0, 80))
  }
  return { db, today, query: q }
}

function harness({ eventKey = 'EVKEY', ratio } = {}) {
  const pool = fakePool()
  process.env.APPLOVIN_EVENT_KEY = eventKey
  if (ratio != null) process.env.AD_MAX_RATIO = String(ratio); else delete process.env.AD_MAX_RATIO
  delete process.env.AD_PLACEMENTS_JSON; delete process.env.AD_SSV_ALLOW_UNSIGNED
  const audits = []
  const r = createReklam({
    pool, SECRET: 'test', json: (res, code, data) => { res.code = code; res.data = data }, readBody: async req => req.body,
    rateLimit: () => true, clientIp: () => '1.2.3.4', maxIncomeRate: s => 600 * (1 + (s.branches?.length || 0)),
    auditCheat: (e, kind, info) => audits.push({ kind, info }), log: { log: () => {}, warn: () => {} },
  })
  return { pool, r, audits }
}
function mkReq(method, body, email = 'a@b.c', url = '/api/ads/x') { return { method, body, headers: { 'x-auth': email ? 't' : '' }, url } }
async function call(h, method, path, body, email = 'a@b.c') {
  const req = mkReq(method, body, email, path); const res = { writeHead(c) { res.code = c }, end(t) { res.text = t } }
  await h.r.handle(req, res, path.split('?')[0], { require: () => email, peek: () => email })
  return res
}
const EMAIL = 'a@b.c'
function seed(h, s = {}, extra = {}) { h.pool.db.players[EMAIL] = { save: { s: { money: 3000, day: 10, ...s } }, updated_at: new Date(Date.now() - 3600e3), banned_at: null, ad_credit: 0, ...extra } }
function gain(h, amount, dayOffset = 0) { const d = new Date(Date.now() - dayOffset * 86400e3).toISOString().slice(0, 10); h.pool.db.day.push({ email: EMAIL, day: d, placement: '_gain', n: 0, amount, nofill: 0 }) }
const tok = (id, key) => crypto.createHash('sha1').update(id + key).digest('hex')

console.log('T1 SSV imzası')
{
  ok(verifyAppLovinToken('abc', tok('abc', 'K'), 'K'), 'doğru imza kabul')
  ok(!verifyAppLovinToken('abc', tok('abc', 'X'), 'K'), 'yanlış anahtar red')
  ok(!verifyAppLovinToken('abc', '', 'K'), 'boş token red')
  const h = harness(); seed(h); gain(h, 100_000)
  const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 2000, platform: 'ios' })).data
  ok(t.ok && t.amount === 2000, 'bilet alındı ' + JSON.stringify(t))
  let res = await call(h, 'GET', `/api/ads/ssv/applovin?event_id=E1&event_token=deadbeef&custom_data=${t.ticket}`, null, null)
  ok(res.code === 403, 'yanlış imza → 403 (' + res.code + ')')
  delete process.env.APPLOVIN_EVENT_KEY
  res = await call(h, 'GET', `/api/ads/ssv/applovin?event_id=E1&event_token=x&custom_data=${t.ticket}`, null, null)
  ok(res.code === 503, 'EVENT_KEY yokken fail-closed 503 (' + res.code + ')')
}

console.log('T2 native claim SSV bekler; T3 event_id tekrarı; T10 ad_credit')
{
  const h = harness(); seed(h); gain(h, 100_000)
  const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 2000, platform: 'ios', provider: 'applovin' })).data
  let c = (await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'reward' })).data
  ok(c.pending === true && !c.granted, 'SSV gelmeden claim → pending, ödül yok')
  ok(h.pool.db.players[EMAIL].ad_credit === 0, 'kredi yazılmadı')
  let res = await call(h, 'GET', `/api/ads/ssv/applovin?event_id=E1&event_token=${tok('E1', 'EVKEY')}&custom_data=${t.ticket}&user_id=${h.r.uidOf(EMAIL)}&placement=gun2x`, null, null)
  ok(res.code === 200 && res.text === 'OK', 'SSV kabul 200 OK')
  const st = (await call(h, 'GET', '/api/ads/state')).data
  ok(st.pending.length === 1 && st.pending[0].ticket === t.ticket, 'state.pending doğrulanmış bileti listeler')
  c = (await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'reward' })).data
  ok(c.granted && c.amount === 2000, 'SSV sonrası claim → 2000 ödül')
  ok(h.pool.db.players[EMAIL].ad_credit === 2000, 'T10: ödül ad_credit sütununa gitti')
  ok(h.pool.db.players[EMAIL].save.s.money === 3000, 'T10: save JSON parası DEĞİŞMEDİ')
  c = (await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'reward' })).data
  ok(!c.granted && c.already, 'ikinci claim ödül vermez')
  res = await call(h, 'GET', `/api/ads/ssv/applovin?event_id=E1&event_token=${tok('E1', 'EVKEY')}&custom_data=${t.ticket}`, null, null)
  ok(res.code === 200 && h.pool.db.players[EMAIL].ad_credit === 2000, 'T3: aynı event_id retry → ödül tekrarlanmaz')
  const st2 = (await call(h, 'GET', '/api/ads/state')).data
  ok(st2.placements.gun2x.used === 1 && st2.placements.gun2x.left === 2, 'gün sayacı 1/3')
  ok(h.pool.db.events.some(e => e.event === 'reward'), 'telemetri: reward olayı yazıldı (e-postasız)')
  // custom_data olmadan uid+placement ile bilet eşleşmesi
  const t2 = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 500, platform: 'ios' })).data
  res = await call(h, 'GET', `/api/ads/ssv/applovin?event_id=E2&event_token=${tok('E2', 'EVKEY')}&user_id=${h.r.uidOf(EMAIL)}&placement=gun2x`, null, null)
  c = (await call(h, 'POST', '/api/ads/claim', { ticket: t2.ticket })).data
  ok(c.granted && c.amount === 500, 'custom_data yoksa uid+placement eşleşmesiyle doğrulanır')
}

console.log('T4 günlük tavan (UTC)')
{
  const h = harness(); seed(h, { noAds: true }); gain(h, 1_000_000)
  const got = []
  for (let i = 0; i < 4; i++) {
    const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 100 })).data
    got.push(t.ok ? 'ok' : t.reason)
    if (t.ok) await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'premium' })
  }
  ok(got.join() === 'ok,ok,ok,cap', 'gun2x cap=3: ' + got.join())
  // dünkü sayaç bugünü etkilemez
  h.pool.db.day.filter(d => d.placement === 'gun2x').forEach(d => { d.day = new Date(Date.now() - 86400e3).toISOString().slice(0, 10) })
  const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 100 })).data
  ok(t.ok, 'dünkü kullanım bugünkü tavanı doldurmaz')
}

console.log('T5 bütçe (reklam parası ≤ %30 aktif kazanç)')
{
  const h = harness(); seed(h, { noAds: true }); gain(h, 10_000)  // bütçe 3000
  let t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 5000 })).data
  ok(t.ok && t.amount === 3000, '5000 istendi → 3000 kesildi (' + JSON.stringify(t) + ')')
  await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'premium' })
  t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 5000 })).data
  ok(!t.ok && t.reason === 'budget', 'bütçe bitti → teklif çıkmaz (' + t.reason + ')')
  ok(moneyCap('gun2x', 600, 1e9, 0) === 96_000, 'gun2x sert tavan rate×160')
  ok(moneyCap('offline2x', 600, 1e9, 3600) === 2_160_000, 'offline2x tavan rate×geçen süre')
  ok(moneyCap('kurtarma', 600, 1e9, 0) === 12_000, 'kurtarma tavan 12k')
  ok(moneyCap('tamir', 600, 1e9, 0) === 0, 'efekt yerleşimi para vermez')
  ok(moneyCap('hediye', 600, 1e9, 0) === 24_000, 'hediye tavan rate×40 (çeyrek oyun günü)')
  ok(moneyCap('hediye', 600, 500, 0) === 500, 'hediye: istenen tavanın altındaysa istenen verilir')
  // 8 gün önceki kazanç bütçeye sayılmaz
  const h2 = harness(); seed(h2, { noAds: true }); gain(h2, 1_000_000, 8)
  t = (await call(h2, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 1000 })).data
  ok(!t.ok && t.reason === 'budget', '7 gün penceresi dışındaki kazanç sayılmaz')
}

console.log('T6 nofill tavanı + web sahteciliği')
{
  const h = harness(); seed(h); gain(h, 1_000_000)
  const res = []
  for (let i = 0; i < 3; i++) {
    const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 100, platform: 'ios' })).data
    const c = (await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'nofill' })).data
    res.push(c.granted ? 'ok' : c.reason)
  }
  ok(res.join() === 'ok,ok,nofill-cap', 'nofill günde 2: ' + res.join())
  const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'offline2x', amount: 100, platform: 'ios' })).data
  const c = await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'web' })
  ok(c.code === 403 && h.audits.some(a => a.kind === 'ad-web-fake'), 'ios bileti web yoluyla alınamaz + audit')
  // 4 Eyl 2026 (08d1d2c): tarayıcıda reklam YOK — web bileti premium değilse daha bilet aşamasında reddedilir
  const tw = await call(h, 'POST', '/api/ads/ticket', { placement: 'offline2x', amount: 100, platform: 'web' })
  ok(tw.code === 403 || !tw.data?.ticket, 'web bileti (premium dışı) sunucuda REDDEDİLİR — tarayıcıda reklam yok')
}

console.log('T7 premium sahteciliği')
{
  const h = harness(); seed(h); gain(h, 1_000_000)
  const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 100, platform: 'ios' })).data
  const c = await call(h, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'premium' })
  ok(c.code === 403 && h.audits.some(a => a.kind === 'ad-premium-fake'), 'noAds olmayan hesap premium yoluyla alamaz')
}

console.log('T8 kurtarma')
{
  const h = harness(); seed(h, { money: 50_000 })
  let t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'kurtarma', amount: 3000 })).data
  ok(!t.ok && t.reason === 'not-broke', 'kasada para varken kurtarma yok')
  const h2 = harness(); seed(h2, { money: 12, day: 30, noAds: true })
  const got = []
  for (let i = 0; i < 3; i++) {
    t = (await call(h2, 'POST', '/api/ads/ticket', { placement: 'kurtarma', amount: 3000 })).data
    got.push(t.ok ? 'ok' : t.reason)
    if (t.ok) {
      await call(h2, 'POST', '/api/ads/claim', { ticket: t.ticket, result: 'premium' })
      h2.pool.db.day.filter(d => d.placement === 'kurtarma').forEach(d => { d.day = '2000-01-0' + (i + 1) }) // günlük tavanı aşmak için "dün"
    }
  }
  ok(got.join() === 'ok,ok,weekcap', 'oyun-içi haftada 2: ' + got.join())
  ok(h2.pool.db.players[EMAIL].ad_credit === 6000, 'kurtarma bütçeye bağlı değil, 2×3000 kredi')
}

console.log('T9 uzaktan ayar')
{
  const h = harness(); seed(h, { noAds: true }); gain(h, 1_000_000)
  h.pool.db.cfg = { placements: { gun2x: { enabled: false }, offline2x: { cap: 1 } }, ratio: 0.1 }
  const st = (await call(h, 'GET', '/api/ads/state')).data
  ok(st.placements.gun2x.enabled === false && st.placements.offline2x.cap === 1 && st.ratio === 0.1, 'DB config ezer: ' + JSON.stringify({ g: st.placements.gun2x.enabled, o: st.placements.offline2x.cap, r: st.ratio }))
  const t = (await call(h, 'POST', '/api/ads/ticket', { placement: 'gun2x', amount: 100 })).data
  ok(!t.ok && t.reason === 'disabled', 'kapalı yerleşim bilet vermez')
  const m = mergePlacements({ tamir: { cap: 999 } }, { tamir: { enabled: false } })
  ok(m.tamir.cap === 50 && m.tamir.enabled === false && m.event.cap === PLACEMENT_DEFAULTS.event.cap, 'mergePlacements: cap ≤ 50, katmanlar sırayla ezer')
}

console.log('T12 rapor: KPI + hedefler (strateji v2.1) — yalnız toplam, e-posta yok')
{
  const h = harness(); seed(h); gain(h, 100_000)
  h.pool.db.activePlayers = 10
  h.pool.db.day.push({ email: 'x@y.z', day: h.pool.today, placement: 'gun2x', n: 3, amount: 900, nofill: 0 })
  h.pool.db.day.push({ email: 'q@y.z', day: h.pool.today, placement: 'hediye', n: 1, amount: 500, nofill: 0 })
  h.pool.db.events = [{ placement: 'gun2x', event: 'offer', n: 8, rev: 0 }, { placement: 'gun2x', event: 'complete', n: 4, rev: 0 }, { placement: 'gun2x', event: 'revenue', n: 4, rev: '0.05' }]
  const r = await h.r.summary(7)
  ok(r.targets && r.targets.viewsPerActivePerDay === 2.5 && r.targets.optInRate === 0.35, 'hedefler raporda')
  ok(r.kpi.activePlayers === 10 && r.kpi.optInPlayers === 2 && r.kpi.optInRate === 0.2, 'opt-in = ödül alan tekil / aktif (' + JSON.stringify(r.kpi) + ')')
  ok(r.totals.granted === 4 && r.kpi.viewsPerActive === 0.4 && r.kpi.viewsPerActivePerDay === Math.round(4 / 70 * 1000) / 1000, 'izlenme/aktif ve /gün')
  ok(r.kpi.completeRate === 0.5 && Math.abs(r.totals.revenueUsd - 0.05) < 1e-9, 'tamamlama = complete/offer; gelir toplanır')
  ok(r.placements.hediye && r.placements.hediye.granted === 1 && r.placements.hediye.amount === 500, 'hediye yerleşimi raporda')
  ok(!JSON.stringify(r).includes('@'), 'raporda e-posta YOK')
}

console.log(fails ? `\n${fails} HATA` : '\nTÜM TESTLER GEÇTİ')
process.exit(fails ? 1 : 0)
