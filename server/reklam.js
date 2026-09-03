/**
 * ÖDÜLLÜ REKLAM — SUNUCU KATMANI (3 Eyl 2026, reklam stratejisi v2)
 *
 * İLKE: istemci "reklamı bitirdim" dedi diye ödül YOK. Ödül yalnız sunucu onayıyla
 * (SSV: sağlayıcının sunucudan sunucuya callback'i) verilir. Web'de (AdSense H5)
 * callback yoktur → web ödülü "doğrulanmamış" olarak işaretlenip yine TAVANLARDAN geçer.
 *
 * AKIŞ (istemci: src/reklam.ts):
 *   1) POST /api/ads/ticket   → yerleşim açık mı, tavan doldu mu, ödül tutarı ne (ÖNCE ve NET)
 *   2) reklam gösterilir; bilet id'si sağlayıcıya customData olarak gider
 *   3) GET  /api/ads/ssv/applovin?...  → AppLovin callback'i bileti 'verified' yapar
 *   4) POST /api/ads/claim    → doğrulanmış bilet ödüle çevrilir (para ise _ab.c kredisi)
 *
 * TAVANLAR gerçek UTC gününe bağlıdır (160 sn'lik oyun günü DEĞİL) — benzinlik_ad_day.
 * REKLAM GELİRİ ≤ aktif gelirin %30'u: son 7 UTC gününde kabul edilen servet artışı
 * (save handler'ın noteGain'i) × oran − verilen reklam parası = kalan bütçe.
 * UZAKTAN AYAR: benzinlik_ad_config('placements' / 'ratio') satırı 60 sn önbellekle okunur;
 * env AD_PLACEMENTS_JSON / AD_MAX_RATIO taban değeri ezer, DB satırı ikisini de ezer.
 *
 * PII: telemetri tablosu e-posta TUTMAZ (uid = HMAC takma ad). Bilet tablosu e-posta tutar
 * (ödülü hesaba bağlamak için) — raporlarda ASLA e-posta çekilmez.
 */
import crypto from 'node:crypto'

/** Yerleşim tanımları — id'ler istemci src/reklam.ts PLACEMENTS ile BİREBİR. */
export const PLACEMENT_DEFAULTS = {
  // A. Ritüel
  gun2x:     { kind: 'money',  cap: 3, premium: 'auto',    desc: 'Gün sonu kârı 2×' },
  offline2x: { kind: 'money',  cap: 4, premium: 'auto',    desc: 'Offline kazanç 2×' },
  // B. Hızlandırıcı
  tamir:     { kind: 'effect', cap: 6, premium: 'auto',    desc: 'Tamiri hızlandır' },
  tanker:    { kind: 'effect', cap: 3, premium: 'auto',    desc: 'Tanker hızlandır' },
  // C. Güçlendirici (izle → kazan)
  event:     { kind: 'effect', cap: 2, premium: 'novideo', desc: 'Event başlat/uzat' },
  premium:   { kind: 'effect', cap: 3, premium: 'novideo', desc: 'Premium müşteri çağır' },
  trafik:    { kind: 'effect', cap: 2, premium: 'novideo', desc: 'Trafiği artır' },
  // D. Kurtarma
  kurtarma:  { kind: 'money',  cap: 1, premium: 'novideo', desc: 'Battın — acil nakit', weekCap: 2 },
  // E. Günlük ritüel (3 Eyl 2026, strateji v2.1): oturum açılışında bir kez "hediye kumbarası".
  // Tycoon'da ödüllü gösterimin en büyük dilimi günlük ritüeldir; bizde ritüel yalnız gün2×/offline2× idi.
  hediye:    { kind: 'money',  cap: 1, premium: 'auto',    desc: 'Günlük hediye kumbarası' },
}
const PLACEMENT_IDS = Object.keys(PLACEMENT_DEFAULTS)
const MONEY_IDS = PLACEMENT_IDS.filter(k => PLACEMENT_DEFAULTS[k].kind === 'money')
const DEFAULT_RATIO = 0.30
const TICKET_TTL_MS = 15 * 60_000     // bilet 15 dk içinde kullanılmazsa ölür
const NOFILL_DAY_CAP = 2              // "reklam yoktu ama ödül ver" yolu — istemci yalanı sınırlı kalsın
const KURTARMA_MAX = 12_000           // en pahalı asgari tanker siparişi ~9.3k (500 L × 14.3 ₺ × 1.3)
const CREDIT_MAX = 50_000_000
/** Strateji v2.1 hedefleri (3 Eyl 2026) — /vs/v1/ads bunları kpi'nin yanında döner ki panel kırmızı/yeşil boyayabilsin. */
export const HEDEFLER = { viewsPerActivePerDay: 2.5, optInRate: 0.35, completeRate: 0.55, softDailyMaxPerPlayer: 8 }
const EVENTS = new Set(['offer', 'skip', 'start', 'complete', 'abort', 'nofill', 'error', 'revenue', 'reward', 'ssv'])

export function mergePlacements(...layers) {
  const out = {}
  for (const id of PLACEMENT_IDS) {
    const d = PLACEMENT_DEFAULTS[id]
    const p = { enabled: true, cap: d.cap, weekCap: d.weekCap ?? null, kind: d.kind, premium: d.premium }
    for (const L of layers) {
      const o = L && L[id]
      if (!o || typeof o !== 'object') continue
      if (typeof o.enabled === 'boolean') p.enabled = o.enabled
      if (Number.isFinite(o.cap)) p.cap = Math.max(0, Math.min(50, Math.round(o.cap)))
      if (Number.isFinite(o.weekCap)) p.weekCap = Math.max(0, Math.min(50, Math.round(o.weekCap)))
    }
    out[id] = p
  }
  return out
}

/** Para ödülünün SUNUCU tavanı — istemcinin istediği tutar buradan geçer (rate = maxIncomeRate(s)). */
export function moneyCap(placement, rate, requested, elapsedSec) {
  const req = Math.max(0, Math.round(Number(requested) || 0))
  if (placement === 'gun2x') return Math.min(req, Math.round(rate * 160))               // en fazla bir oyun günü tepe geliri
  if (placement === 'offline2x') return Math.min(req, Math.round(rate * Math.min(Math.max(60, elapsedSec), 8 * 3600)))
  if (placement === 'kurtarma') return Math.min(req, KURTARMA_MAX)
  if (placement === 'hediye') return Math.min(req, Math.round(rate * 40))                // çeyrek oyun günü tepe geliri (küçük, ritüel)
  return 0
}
/** AppLovin S2S: event_token = sha1(event_id + Event Key). Sabit zamanlı karşılaştırma. */
export function verifyAppLovinToken(eventId, token, key) {
  const calc = crypto.createHash('sha1').update(String(eventId) + String(key)).digest('hex')
  const t = String(token || '').toLowerCase()
  return t.length === calc.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(calc))
}

export function createReklam({ pool, SECRET, json, readBody, rateLimit, clientIp, maxIncomeRate, auditCheat, log = console }) {
  const uidOf = email => crypto.createHmac('sha256', SECRET).update('aduid|' + String(email).toLowerCase()).digest('base64url').slice(0, 20)
  const utcDay = (d = new Date()) => d.toISOString().slice(0, 10)

  async function initDb() {
    await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_ad_ticket (
      id text PRIMARY KEY, email text NOT NULL, uid text NOT NULL, placement text NOT NULL,
      amount bigint NOT NULL DEFAULT 0, meta jsonb, status text NOT NULL DEFAULT 'pending',
      provider text, platform text, event_id text, game_day int,
      created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz, claimed_at timestamptz)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS benzinlik_ad_ticket_email ON benzinlik_ad_ticket (email, created_at DESC)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS benzinlik_ad_ticket_uid ON benzinlik_ad_ticket (uid, created_at DESC)`)
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS benzinlik_ad_ticket_event ON benzinlik_ad_ticket (event_id) WHERE event_id IS NOT NULL`)
    // GÜNLÜK TAVAN SAYAÇLARI — gerçek UTC günü. placement '_gain' = o gün kabul edilen servet artışı.
    await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_ad_day (
      email text NOT NULL, day date NOT NULL, placement text NOT NULL,
      n int NOT NULL DEFAULT 0, amount bigint NOT NULL DEFAULT 0, nofill int NOT NULL DEFAULT 0,
      PRIMARY KEY (email, day, placement))`)
    // TELEMETRİ — e-posta YOK. Yerleşim başına gösterim/tamamlama/ödül/eCPM buradan.
    await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_ad_event (
      id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), placement text, event text NOT NULL,
      provider text, platform text, network text, revenue numeric, uid text)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS benzinlik_ad_event_at ON benzinlik_ad_event (at DESC)`)
    // UZAKTAN AÇ/KAPA + TAVAN (A/B bayrağı): key 'placements' → {gun2x:{enabled:false,cap:2}}, key 'ratio' → 0.25
    await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_ad_config (
      key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`)
  }

  // ---- yapılandırma (env taban + DB ezme, 60 sn önbellek) ----
  let cfgCache = { at: 0, placements: null, ratio: DEFAULT_RATIO }
  function envPlacements() {
    let over = {}
    try { over = process.env.AD_PLACEMENTS_JSON ? JSON.parse(process.env.AD_PLACEMENTS_JSON) : {} } catch { over = {} }
    return over && typeof over === 'object' ? over : {}
  }
  async function config() {
    const now = Date.now()
    if (cfgCache.placements && now - cfgCache.at < 60_000) return cfgCache
    let db = {}, dbRatio = null
    try {
      const r = await pool.query(`SELECT key, value FROM benzinlik_ad_config WHERE key IN ('placements','ratio')`)
      for (const row of r.rows) {
        if (row.key === 'placements') db = row.value || {}
        if (row.key === 'ratio') dbRatio = Number(row.value)
      }
    } catch { /* tablo yoksa taban değerler */ }
    const envRatio = Number(process.env.AD_MAX_RATIO)
    let ratio = Number.isFinite(dbRatio) ? dbRatio : Number.isFinite(envRatio) ? envRatio : DEFAULT_RATIO
    ratio = Math.max(0, Math.min(1, ratio))
    cfgCache = { at: now, placements: mergePlacements(envPlacements(), db), ratio }
    return cfgCache
  }

  /** /api/config'e giden HERKESE AÇIK kısım (SDK anahtarı uygulama içinde zaten görünür). */
  function publicConfig() {
    const sdkKey = process.env.APPLOVIN_SDK_KEY || null
    return {
      provider: sdkKey ? 'applovin' : null,
      applovin: sdkKey ? {
        sdkKey,
        iosRewarded: process.env.APPLOVIN_IOS_REWARDED || null,
        androidRewarded: process.env.APPLOVIN_ANDROID_REWARDED || null,
      } : null,
      ssv: !!process.env.APPLOVIN_EVENT_KEY,
    }
  }

  // ---- sayaçlar ----
  async function bumpDay(email, placement, { n = 0, amount = 0, nofill = 0 } = {}) {
    await pool.query(`INSERT INTO benzinlik_ad_day(email, day, placement, n, amount, nofill) VALUES ($1, $2::date, $3, $4, $5, $6)
      ON CONFLICT (email, day, placement) DO UPDATE SET n = benzinlik_ad_day.n + EXCLUDED.n,
      amount = benzinlik_ad_day.amount + EXCLUDED.amount, nofill = benzinlik_ad_day.nofill + EXCLUDED.nofill`,
      [email, utcDay(), placement, n, Math.round(amount), nofill])
  }
  /** save handler'dan: bugün kabul edilen servet artışı (aktif gelir vekili). await edilmez. */
  function noteGain(email, gain) {
    const g = Math.round(Number(gain) || 0)
    if (g <= 0 || !email) return
    bumpDay(email, '_gain', { amount: g }).catch(() => {})
  }
  async function usage(email) {
    const r = await pool.query(`SELECT placement, day, n, amount, nofill FROM benzinlik_ad_day
      WHERE email = $1 AND day >= (CURRENT_DATE - 6)`, [email])
    const today = utcDay()
    const used = {}, nofill = {}
    let gain7 = 0, ad7 = 0
    for (const row of r.rows) {
      const d = row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10)
      if (row.placement === '_gain') { gain7 += Number(row.amount) || 0; continue }
      if (MONEY_IDS.includes(row.placement)) ad7 += Number(row.amount) || 0
      if (d === today) { used[row.placement] = Number(row.n) || 0; nofill[row.placement] = Number(row.nofill) || 0 }
    }
    return { used, nofill, gain7, ad7 }
  }
  function telemetry(ev) {
    if (!EVENTS.has(ev.event)) return
    pool.query(`INSERT INTO benzinlik_ad_event(placement, event, provider, platform, network, revenue, uid) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [ev.placement ? String(ev.placement).slice(0, 24) : null, ev.event, ev.provider ? String(ev.provider).slice(0, 24) : null,
       ev.platform ? String(ev.platform).slice(0, 16) : null, ev.network ? String(ev.network).slice(0, 48) : null,
       Number.isFinite(ev.revenue) ? ev.revenue : null, ev.uid ? String(ev.uid).slice(0, 32) : null]).catch(() => {})
  }

  /** Bilet üretimi: yerleşim açık mı, tavanlar, tutar. Premium (noAds) davranışı da burada. */
  async function issueTicket(email, body, req) {
    const placement = String(body.placement || '')
    if (!PLACEMENT_IDS.includes(placement)) return { code: 400, data: { error: 'placement' } }
    const cfg = await config()
    const p = cfg.placements[placement]
    if (!p.enabled) return { code: 200, data: { ok: false, reason: 'disabled' } }
    const pr = await pool.query('SELECT save, updated_at, banned_at FROM benzinlik_player WHERE email=$1', [email])
    if (pr.rows[0]?.banned_at) return { code: 403, data: { error: 'Bu hesap askıya alınmış.' } }
    const s = (pr.rows[0]?.save && pr.rows[0].save.s) || {}
    const u = await usage(email)
    const used = u.used[placement] || 0
    if (used >= p.cap) return { code: 200, data: { ok: false, reason: 'cap', used, cap: p.cap } }
    const gameDay = Math.max(0, Math.round(Number(s.day) || 0))
    if (p.weekCap) {
      // oyun-içi hafta: son 7 OYUN GÜNÜ (bilet game_day'i) — kurtarma tekrar tekrar sağılmasın
      const w = await pool.query(`SELECT count(*)::int AS n FROM benzinlik_ad_ticket
        WHERE email=$1 AND placement=$2 AND status='claimed' AND game_day >= $3`, [email, placement, gameDay - 6])
      if ((w.rows[0]?.n || 0) >= p.weekCap) return { code: 200, data: { ok: false, reason: 'weekcap' } }
    }
    let amount = 0
    if (p.kind === 'money') {
      const elapsed = pr.rows[0]?.updated_at ? (Date.now() - new Date(pr.rows[0].updated_at).getTime()) / 1000 : 0
      amount = moneyCap(placement, maxIncomeRate(s), body.amount, elapsed)
      if (placement === 'kurtarma') {
        // KURTARMA KOŞULU sunucu kaydından da doğrulanır: kasada tutarın üstü varsa "batmış" değil.
        if ((Number(s.money) || 0) > KURTARMA_MAX) return { code: 200, data: { ok: false, reason: 'not-broke' } }
      } else {
        // BÜTÇE: son 7 günde reklam parası ≤ oran × aktif kazanç. Teklif ÖNCE ve NET yazılır:
        // bütçe düşükse tutar düşer, ödül %10'un altına inerse teklif hiç çıkmaz.
        const left = Math.max(0, cfg.ratio * u.gain7 - u.ad7)
        const kesik = Math.min(amount, Math.round(left))
        if (kesik < Math.max(50, amount * 0.1)) return { code: 200, data: { ok: false, reason: 'budget', left: Math.round(left) } }
        amount = kesik
      }
      if (amount <= 0) return { code: 200, data: { ok: false, reason: 'zero' } }
    }
    const premium = !!s.noAds
    const id = crypto.randomBytes(12).toString('base64url')
    const meta = body.meta && typeof body.meta === 'object' ? JSON.parse(JSON.stringify(body.meta).slice(0, 2000)) : null
    const platform = String(body.platform || '').slice(0, 16) || null
    await pool.query(`INSERT INTO benzinlik_ad_ticket(id, email, uid, placement, amount, meta, status, provider, platform, game_day)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, email, uidOf(email), placement, amount, meta, premium ? 'premium' : 'pending', String(body.provider || '').slice(0, 24) || null, platform, gameDay])
    return { code: 200, data: { ok: true, ticket: id, amount, premium, premiumMode: p.premium, used, cap: p.cap, ttl: TICKET_TTL_MS } }
  }

  /** Ödül dağıtımı — tek kapı. Para ödülü kaydın _ab.c (sunucu-sahipli kredi) alanına yazılır. */
  async function grant(t, via) {
    const upd = await pool.query(`UPDATE benzinlik_ad_ticket SET status='claimed', claimed_at=now(), provider=COALESCE(provider,$2)
      WHERE id=$1 AND status <> 'claimed' RETURNING amount`, [t.id, via])
    if (upd.rowCount === 0) return { granted: false, already: true }
    const amount = Number(upd.rows[0].amount) || 0
    if (amount > 0) {
      // KREDİ: istemci parayı yerelde ekler; sonraki save'de hile freni (server/index.js /api/save)
      // benzinlik_player.ad_credit'i allowance'a katar ve kullandığı kadarını ATOMİK düşer.
      // Kaydın JSON'una PARA YAZILMAZ — uçuştaki eski bir save ödülü ezmesin (yarış). 48 saatte söner.
      await pool.query(`UPDATE benzinlik_player SET ad_credit = LEAST($2::bigint, ad_credit + $3::bigint), ad_credit_at = now() WHERE email=$1`,
        [t.email, CREDIT_MAX, Math.round(amount)])
    }
    await bumpDay(t.email, t.placement, { n: 1, amount, nofill: via === 'nofill' ? 1 : 0 })
    telemetry({ placement: t.placement, event: 'reward', provider: via, platform: t.platform, uid: t.uid, revenue: null })
    if (via === 'nofill') log.log(`[ad-nofill] reward-granted placement=${t.placement} amount=${amount}`)
    return { granted: true, amount, placement: t.placement, meta: t.meta }
  }

  async function claim(email, body) {
    const id = String(body.ticket || '')
    if (!id) return { code: 400, data: { error: 'ticket' } }
    const r = await pool.query('SELECT * FROM benzinlik_ad_ticket WHERE id=$1 AND email=$2', [id, email])
    const t = r.rows[0]
    if (!t) return { code: 404, data: { error: 'Bilet yok.' } }
    if (t.status === 'claimed') return { code: 200, data: { granted: false, already: true, amount: Number(t.amount) || 0, placement: t.placement } }
    const age = Date.now() - new Date(t.created_at).getTime()
    if (age > TICKET_TTL_MS && t.status !== 'verified') {
      await pool.query(`UPDATE benzinlik_ad_ticket SET status='expired' WHERE id=$1`, [id])
      return { code: 200, data: { granted: false, reason: 'expired' } }
    }
    const result = String(body.result || 'reward')
    // PREMIUM: reklamsız ödül — kaydın noAds'i sunucudan okunur, istemci beyanı yetmez
    if (result === 'premium' || t.status === 'premium') {
      const pr = await pool.query('SELECT (save->\'s\'->>\'noAds\')::boolean AS na FROM benzinlik_player WHERE email=$1', [email])
      if (!pr.rows[0]?.na) { auditCheat(email, 'ad-premium-fake', { placement: t.placement }); return { code: 403, data: { error: 'premium' } } }
      return { code: 200, data: await grant(t, 'premium') }
    }
    if (t.status === 'verified') return { code: 200, data: await grant(t, t.provider || 'ssv') }
    if (result === 'nofill') {
      // FILL YOK → ÖDÜL YİNE VERİLİR (oyuncu cezalandırılmaz) ama günde 2 ile sınırlı:
      // aksi hâlde istemci her reklamı "yoktu" diye bildirip bedava sağar.
      const u = await usage(email)
      const nf = Object.values(u.nofill).reduce((a, b) => a + b, 0)
      if (nf >= NOFILL_DAY_CAP) return { code: 200, data: { granted: false, reason: 'nofill-cap' } }
      return { code: 200, data: await grant(t, 'nofill') }
    }
    if (result === 'web') {
      // WEB (AdSense H5): SSV yok — sağlayıcı callback vermez. Ödül verilir, 'web' damgasıyla
      // ayrı sayılır; tavan/bütçe aynen uygulanır. Native istemci bu yolu KULLANAMAZ.
      if (t.platform && t.platform !== 'web') { auditCheat(email, 'ad-web-fake', { placement: t.placement }); return { code: 403, data: { error: 'platform' } } }
      return { code: 200, data: await grant(t, 'web') }
    }
    // native 'reward': SSV henüz gelmedi → istemci bekler (poll); 15 dk içinde gelirse
    // /api/ads/state 'pending' listesinde görünür ve claim tekrar denenir.
    return { code: 200, data: { granted: false, pending: true } }
  }

  /** AppLovin S2S callback (GET). Doğrulama: event_token = sha1(event_id + EVENT_KEY). */
  async function ssvAppLovin(req, res, url) {
    const q = new URL(req.url || url, 'http://x').searchParams // handleApi'ye gelen url query'siz; ham req.url lazım
    const eventId = String(q.get('event_id') || '').slice(0, 64)
    const token = String(q.get('event_token') || '').slice(0, 64)
    const custom = String(q.get('custom_data') || '').slice(0, 64)
    const uid = String(q.get('user_id') || '').slice(0, 32)
    const placement = String(q.get('placement') || '').slice(0, 24)
    const key = process.env.APPLOVIN_EVENT_KEY || ''
    if (!rateLimit('ssv:' + clientIp(req), 600, 60_000)) { res.writeHead(429); return res.end('rate') }
    if (!eventId) { res.writeHead(400); return res.end('event_id') }
    if (key) {
      if (!verifyAppLovinToken(eventId, token, key)) { log.warn('[ad-ssv] imza tutmadı', { eventId, placement }); res.writeHead(403); return res.end('sig') }
    } else if (process.env.AD_SSV_ALLOW_UNSIGNED !== '1') {
      // FAIL-CLOSED: anahtar yokken herkes curl ile bilet doğrulatabilirdi.
      log.warn('[ad-ssv] APPLOVIN_EVENT_KEY yok → callback REDDEDİLDİ (AD_SSV_ALLOW_UNSIGNED=1 ile dev modu)')
      res.writeHead(503); return res.end('no-key')
    }
    // bilet: önce custom_data (bilet id), yoksa uid+placement'ın son bekleyen bileti
    let t = null
    if (custom) t = (await pool.query(`SELECT * FROM benzinlik_ad_ticket WHERE id=$1`, [custom])).rows[0] || null
    if (!t && uid) {
      t = (await pool.query(`SELECT * FROM benzinlik_ad_ticket WHERE uid=$1 AND status='pending' AND ($2='' OR placement=$2)
        AND created_at > now() - interval '15 minutes' ORDER BY created_at DESC LIMIT 1`, [uid, placement])).rows[0] || null
    }
    // event_id tekilliği: aynı callback iki kez gelirse (retry) ikinci sessizce OK
    const dup = await pool.query(`SELECT 1 FROM benzinlik_ad_ticket WHERE event_id=$1`, [eventId])
    if (dup.rowCount > 0) { res.writeHead(200); return res.end('OK') }
    if (!t) {
      telemetry({ placement, event: 'ssv', provider: 'applovin-orphan', uid })
      log.warn('[ad-ssv] bilet bulunamadı', { eventId, uid, placement })
      res.writeHead(200); return res.end('OK') // AppLovin tekrar denemesin
    }
    if (t.status === 'pending' || t.status === 'expired') {
      await pool.query(`UPDATE benzinlik_ad_ticket SET status='verified', verified_at=now(), event_id=$2, provider='applovin',
        platform=COALESCE(platform, $3) WHERE id=$1`, [t.id, eventId, String(q.get('platform') || '').slice(0, 16) || null])
    } else {
      await pool.query(`UPDATE benzinlik_ad_ticket SET event_id=$2 WHERE id=$1 AND event_id IS NULL`, [t.id, eventId])
    }
    telemetry({ placement: t.placement, event: 'ssv', provider: 'applovin', platform: t.platform, network: q.get('network'), uid: t.uid })
    res.writeHead(200); res.end('OK')
  }

  async function state(email) {
    const cfg = await config()
    const pr = await pool.query('SELECT (save->\'s\'->>\'noAds\')::boolean AS na FROM benzinlik_player WHERE email=$1', [email])
    const u = await usage(email)
    const placements = {}
    for (const id of PLACEMENT_IDS) {
      const p = cfg.placements[id]
      const used = u.used[id] || 0
      placements[id] = { enabled: p.enabled, cap: p.cap, used, left: Math.max(0, p.cap - used), kind: p.kind, premium: p.premium }
    }
    // geç gelen SSV: doğrulanmış ama alınmamış biletler → istemci claim'i tekrar dener
    const pend = await pool.query(`SELECT id, placement, amount, meta FROM benzinlik_ad_ticket
      WHERE email=$1 AND status='verified' AND created_at > now() - interval '2 days' ORDER BY created_at`, [email])
    return {
      uid: uidOf(email), premium: !!pr.rows[0]?.na, day: utcDay(), ratio: cfg.ratio,
      budget: { gain7: Math.round(u.gain7), ad7: Math.round(u.ad7), left: Math.round(Math.max(0, cfg.ratio * u.gain7 - u.ad7)) },
      placements,
      pending: pend.rows.map(r => ({ ticket: r.id, placement: r.placement, amount: Number(r.amount) || 0, meta: r.meta })),
      nofillLeft: Math.max(0, NOFILL_DAY_CAP - Object.values(u.nofill).reduce((a, b) => a + b, 0)),
    }
  }

  /** Yönetim paneli özeti (aggregate-only): son 7 gün yerleşim başına huni + gelir. */
  async function summary(days = 7) {
    const d = Math.max(1, Math.min(90, Math.round(Number(days) || 7)))
    const ev = await pool.query(`SELECT placement, event, count(*)::int AS n, coalesce(sum(revenue),0)::numeric AS rev
      FROM benzinlik_ad_event WHERE at > now() - ($1 || ' days')::interval GROUP BY placement, event`, [String(d)])
    const dayRows = await pool.query(`SELECT placement, sum(n)::int AS n, sum(amount)::bigint AS amount, sum(nofill)::int AS nofill,
      count(DISTINCT email)::int AS players FROM benzinlik_ad_day WHERE day > CURRENT_DATE - $1::int AND placement <> '_gain' GROUP BY placement`, [d])
    const out = {}
    for (const id of PLACEMENT_IDS) out[id] = { offer: 0, start: 0, complete: 0, abort: 0, nofill: 0, error: 0, reward: 0, ssv: 0, revenueUsd: 0, granted: 0, amount: 0, players: 0 }
    for (const r of ev.rows) {
      const o = out[r.placement]; if (!o) continue
      if (r.event === 'revenue') o.revenueUsd += Number(r.rev) || 0
      else if (r.event in o) o[r.event] += r.n
    }
    for (const r of dayRows.rows) {
      const o = out[r.placement]; if (!o) continue
      o.granted = r.n; o.amount = Number(r.amount) || 0; o.players = r.players; o.nofill = Math.max(o.nofill, r.nofill)
    }
    // HEDEF TAKİBİ (strateji v2.1): izlenme/aktif oyuncu, opt-in oranı, ARPDAU. Aktif = pencerede
    // last_seen_at olan kayıtlı oyuncu; opt-in = pencerede ≥1 ödül alan. Hepsi toplam, e-posta yok.
    let activePlayers = 0, optInPlayers = 0
    try {
      const a = await pool.query(`SELECT count(*)::int AS n FROM benzinlik_player WHERE last_seen_at > now() - ($1 || ' days')::interval`, [String(d)])
      activePlayers = a.rows[0]?.n || 0
      const o = await pool.query(`SELECT count(DISTINCT email)::int AS n FROM benzinlik_ad_day WHERE day > CURRENT_DATE - $1::int AND placement <> '_gain' AND n > 0`, [d])
      optInPlayers = o.rows[0]?.n || 0
    } catch { /* tablo yoksa sıfır */ }
    const tot = { offer: 0, start: 0, complete: 0, granted: 0, revenueUsd: 0, amount: 0 }
    for (const o of Object.values(out)) for (const k of Object.keys(tot)) tot[k] += o[k] || 0
    const oran = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null)
    const kpi = {
      activePlayers, optInPlayers,
      optInRate: oran(optInPlayers, activePlayers),                 // hedef ≥ 0.35
      viewsPerActive: oran(tot.granted, activePlayers),             // pencere boyunca; hedef günlük ≥ 2.5 → 7 günde ≥ 17.5
      viewsPerActivePerDay: oran(tot.granted, activePlayers * d),   // hedef ≥ 2.5
      completeRate: oran(tot.complete, tot.offer),                  // hedef ≥ 0.55
      arpdauUsd: oran(tot.revenueUsd, activePlayers * d),
      viewsPerDay: oran(tot.granted, d), revenuePerDayUsd: oran(tot.revenueUsd, d),
    }
    const cfg = await config()
    return { days: d, ratio: cfg.ratio, placements: out, config: cfg.placements, totals: tot, kpi, targets: HEDEFLER }
  }

  /** /api/ads/* yönlendirme. true dönerse istek işlendi. */
  async function handle(req, res, url, auth) {
    if (!url.startsWith('/api/ads/')) return false
    const path = url.split('?')[0] // (handleApi zaten query'siz veriyor; savunma)
    if (path === '/api/ads/ssv/applovin' && req.method === 'GET') { await ssvAppLovin(req, res, url); return true }
    if (path === '/api/ads/telemetry' && req.method === 'POST') {
      // kimliksiz de olur (misafir gösterimi), IP başına dakikada 60
      const b = await readBody(req).catch(() => ({}))
      if (rateLimit('adtel:' + clientIp(req), 60, 60_000) && b && EVENTS.has(String(b.event)) && String(b.event) !== 'reward' && String(b.event) !== 'ssv') {
        const email = req.headers['x-auth'] ? auth.peek() : null
        telemetry({ placement: b.placement, event: String(b.event), provider: b.provider, platform: b.platform, network: b.network,
          revenue: Number.isFinite(Number(b.revenue)) ? Math.max(0, Math.min(100, Number(b.revenue))) : null, uid: email ? uidOf(email) : null })
      }
      json(res, 200, { ok: true }); return true
    }
    const email = auth.require(); if (!email) return true
    if (path === '/api/ads/state' && req.method === 'GET') {
      if (!rateLimit('adstate:' + email, 30, 60_000)) { json(res, 429, { error: 'rate' }); return true }
      json(res, 200, await state(email)); return true
    }
    if (path === '/api/ads/ticket' && req.method === 'POST') {
      if (!rateLimit('adticket:' + email, 20, 60_000)) { json(res, 429, { error: 'rate' }); return true }
      const b = await readBody(req).catch(() => ({}))
      const r = await issueTicket(email, b || {}, req)
      if (r.data.ok) telemetry({ placement: b.placement, event: 'offer', provider: b.provider, platform: b.platform, uid: uidOf(email) })
      json(res, r.code, r.data); return true
    }
    if (path === '/api/ads/claim' && req.method === 'POST') {
      if (!rateLimit('adclaim:' + email, 40, 60_000)) { json(res, 429, { error: 'rate' }); return true }
      const b = await readBody(req).catch(() => ({}))
      const r = await claim(email, b || {})
      json(res, r.code, r.data); return true
    }
    json(res, 404, { error: 'yok' }); return true
  }

  return { initDb, handle, noteGain, publicConfig, summary, config, uidOf, PLACEMENT_IDS, MONEY_IDS }
}
