// Benzinlik sunucusu: statik oyun dosyaları + hesap/kayıt API'si.
// Tabloyu açılışta kendisi kurar (CREATE TABLE IF NOT EXISTS) — elle SQL gerekmez.
import http from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import { WebSocketServer } from 'ws'
import { createReklam } from './reklam.js'

const PORT = Number(process.env.PORT || 80)
const SECRET = process.env.AUTH_SECRET || 'benzinlik-dev-secret'
const DIST = path.resolve(process.cwd(), 'dist')

const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
  : null

async function initDb() {
  if (!pool) {
    console.warn('DATABASE_URL yok — hesap API devre dışı, sadece statik servis.')
    return
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS benzinlik_player (
      id serial PRIMARY KEY,
      email text UNIQUE NOT NULL,
      pass text NOT NULL,
      save jsonb,
      updated_at timestamptz NOT NULL DEFAULT now(),
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS benzinlik_feedback (
      id serial PRIMARY KEY,
      email text NOT NULL,
      message text NOT NULL,
      game jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS last_seen_at timestamptz DEFAULT now()`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS sessions int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS banned_at timestamptz`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS ban_reason text`)
  // e-posta doğrulama + şifre sıfırlama (varsayılan doğrulanmadı = false → herkes doğrulanmadı)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS verify_token text`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS reset_token text`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS session_id text`) // tek-cihaz kilidi
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS save_session text`) // son save'i yazan oturum (self-conflict önleme)
  // izahat sistemi: şüpheli hesap banlanır (ban_reason='izahat'), oyuncunun savunması buraya düşer
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_appeal(
    id serial PRIMARY KEY, email text NOT NULL, message text NOT NULL, created_at timestamptz DEFAULT now())`)
  // HİLE FRENİ KAYDI: eskiden yalnız bellekteydi (son 200 olay) ve sunucu yeniden
  // başlayınca siliniyordu; tek kalıcı iz docker log'uydu. 25 Ağu'da yanlış ban verilen
  // oyuncuyu aklamak için 151 bin satırlık log eşelemek gerekti — bir daha gerekmesin.
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_cheatlog(
    id bigserial PRIMARY KEY, email text NOT NULL, kind text NOT NULL,
    amount bigint, rate int, created_at timestamptz DEFAULT now())`)
  await pool.query(`CREATE INDEX IF NOT EXISTS benzinlik_cheatlog_email_idx ON benzinlik_cheatlog(email, created_at DESC)`)
  // YILDIZ GEÇMİŞİ: brandStars her değişimde loglanır (devir/clamp/anomali izi —
  // "yıldızım silindi" şikâyetleri artık kanıtla incelenebilir)
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_starlog(
    id serial PRIMARY KEY, email text NOT NULL, prev int NOT NULL, next int NOT NULL,
    kind text NOT NULL, at timestamptz DEFAULT now())`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS reset_expires timestamptz`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS signup_ip text`) // abuse/troll tespiti
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS last_ip text`)
  await pool.query(`ALTER TABLE benzinlik_feedback ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'open'`)
  await pool.query(`ALTER TABLE benzinlik_feedback ADD COLUMN IF NOT EXISTS resolved_note text`)
  await pool.query(`ALTER TABLE benzinlik_feedback ADD COLUMN IF NOT EXISTS resolved_at timestamptz`)
  // GODOT SÜRÜMÜNÜN GERİ BİLDİRİMİ: benzinlik_feedback'in klonu, artı ekran
  // görüntüsü (JPEG, satırın içinde) ve sürüm/platform. Godot oyununun hesabı
  // yok, o yüzden e-posta yerine serbest bir "iletişim" alanı ve IP.
  await pool.query(`CREATE TABLE IF NOT EXISTS beneloil_godot_feedback (
    id serial PRIMARY KEY,
    message text NOT NULL,
    contact text,
    version text,
    platform text,
    locale text,
    game jsonb,
    screenshot bytea,
    ip text,
    status text NOT NULL DEFAULT 'open',
    resolved_note text,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`)
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_stat_hourly (
    hour timestamptz PRIMARY KEY, visits int NOT NULL DEFAULT 0,
    signups int NOT NULL DEFAULT 0, logins int NOT NULL DEFAULT 0
  )`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS guests int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS guest_signups int NOT NULL DEFAULT 0`)
  // ÖLÇÜM BORCU (analiz E14-15): huni + oturum + reklam sayaçları
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS gate_shown int NOT NULL DEFAULT 0`)
  // STEAM ANKETİ (Oğuz 17 Ağu): hesap başına 1 kez sorulan "Steam kullanıyor musun?"
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS steam_yes int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS steam_no int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS steam_skip int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS gate_converted int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS ad_views int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS session_minutes int NOT NULL DEFAULT 0`)
  // webgl_fail: 3D bağlamı açılamayan oturum sayısı (istemci showWebGLFailure'da bump'lar).
  // Bu olay ÖLÇÜLMÜYORDU: renderer throw edince modül ölüyor, hiçbir sayaç çalışmıyordu.
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS webgl_fail int NOT NULL DEFAULT 0`)
  // TRAFİK SAYAÇLARI (saatlik trend): olay kaydı TEŞHİS içindir, bu sayaçlar TREND.
  // 5 dakikada bir istemciden tek kompakt istek gelir; burada saatlik toplanır.
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS trafik_icice int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS trafik_sikisan int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS trafik_bekleyen int NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS trafik_ornek int NOT NULL DEFAULT 0`)
  // KURTARILAN: kalıcı sıkışmayı kıran son çare sigortasının kaç kez çektiği (cars.ts
  // bekçisi). SAĞLIKLI SÜRÜMDE 0 OLMALI — sıfırdan farklı bir trend, rota katmanında
  // araçların varamadığı hedefler kaldığının kanıtıdır.
  await pool.query(`ALTER TABLE benzinlik_stat_hourly ADD COLUMN IF NOT EXISTS trafik_kurtarilan int NOT NULL DEFAULT 0`)
  // TRAFİK OLAY KAYDI — anomali ANINDA sahnenin tam durumu. Her satır tek başına
  // yeniden kurulabilir bir hata raporudur (istemci: src/trafik-olay.ts, replay
  // kancası: __dbg.kayit.trafikSahnesi). PII YOK: yalnız oyun durumu.
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_trafficlog (
    id serial PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now(),
    kind text,
    day int,
    loc text,
    payload jsonb
  )`)
  await pool.query(`CREATE INDEX IF NOT EXISTS benzinlik_trafficlog_kind_at ON benzinlik_trafficlog (kind, created_at DESC)`)
  await pool.query(`CREATE TABLE IF NOT EXISTS beneloil_notification (
    id serial PRIMARY KEY, user_id int, title text, body text, created_at timestamptz NOT NULL DEFAULT now()
  )`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS benzinlik_player_email_lower ON benzinlik_player (lower(email))`)
  // IAP: verilmiş satın alma transaction'ları (replay/çift-verme önleme) — transaction_id PK ile idempotent
  await pool.query(`CREATE TABLE IF NOT EXISTS benzinlik_iap_grant (
    transaction_id text PRIMARY KEY, email text NOT NULL, product_id text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`)
  // sosyal giriş (Google/Apple): sağlayıcı kimliği ile hesap eşleştirme
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS google_id text`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS apple_id text`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS benzinlik_player_google ON benzinlik_player (google_id) WHERE google_id IS NOT NULL`)
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS benzinlik_player_apple ON benzinlik_player (apple_id) WHERE apple_id IS NOT NULL`)
  // ÖDÜLLÜ REKLAM KREDİSİ (server/reklam.js): save JSON'unun DIŞINDA tutulur ki uçuştaki
  // eski bir save ödülü ezmesin. Save handler atomik düşer (GREATEST(0, ad_credit - kullanılan)).
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS ad_credit bigint NOT NULL DEFAULT 0`)
  await pool.query(`ALTER TABLE benzinlik_player ADD COLUMN IF NOT EXISTS ad_credit_at timestamptz`)
  if (reklam) await reklam.initDb()
  console.log('DB hazır (benzinlik_player + benzinlik_feedback + reklam).')
}

// ---- şifre & token ----
function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(pass, salt, 32).toString('hex')
  return `${salt}:${h}`
}
function verifyPassword(pass, stored) {
  const [salt, h] = String(stored).split(':')
  if (!salt || !h) return false
  const calc = crypto.scryptSync(pass, salt, 32).toString('hex')
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(calc, 'hex'))
}
const TOKEN_TTL_MS = 90 * 24 * 3600 * 1000
function sign(email) {
  const exp = Date.now() + TOKEN_TTL_MS
  const body = `${email}|${exp}`
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
  return Buffer.from(`${body}|${mac}`).toString('base64url')
}
function verifyToken(token) {
  try {
    const [email, exp, mac] = Buffer.from(token, 'base64url').toString().split('|')
    if (!email || Number(exp) < Date.now()) return null
    const calc = crypto.createHmac('sha256', SECRET).update(`${email}|${exp}`).digest('hex')
    return crypto.timingSafeEqual(Buffer.from(mac, 'hex'), Buffer.from(calc, 'hex')) ? email : null
  } catch {
    return null
  }
}

/**
 * ZOMBİ TOKEN GUARD — token yalnızca e-posta taşır (sign: email|exp|mac), DB'ye bakmaz.
 * Bu yüzden hesap SİLİNİP aynı e-postayla yeniden açıldığında eski token hâlâ doğrulanıyordu:
 * kapalı sanılan bir sekme / başka cihaz / uçuştaki gecikmeli push, YENİ hesabın kaydını
 * ESKİ save ile eziyordu ("hesabı sildim ama eski kaydım geri geliyor" şikâyeti, 15 Ağu).
 * Çözüm şema değiştirmeden: token'ın veriliş anı exp - TTL ile hesaplanır; hesap o andan
 * SONRA açıldıysa token bir önceki hesaba aittir → reddedilir. Mevcut oturumlar etkilenmez.
 */
function tokenIssuedAt(token) {
  try {
    const [, exp] = Buffer.from(String(token), 'base64url').toString().split('|')
    const e = Number(exp)
    return Number.isFinite(e) ? e - TOKEN_TTL_MS : null
  } catch { return null }
}
function staleToken(req, createdAt) {
  if (!createdAt) return false
  const iat = tokenIssuedAt(req.headers['x-auth'] || '')
  if (iat === null) return false
  return new Date(createdAt).getTime() > iat + 60_000 // 60 sn: kayıt anı ile token üretimi arası pay
}

// ---- E-posta doğrulama + şifre sıfırlama altyapısı ----
const BASE_URL = process.env.PUBLIC_URL || 'https://petrol.benerits.com'
function requireVerify() { return process.env.REQUIRE_EMAIL_VERIFY === 'true' } // key gelene dek kapalı
function randToken() { return crypto.randomBytes(24).toString('base64url') }

// ---- Sosyal giriş: Google + Apple (hem web hem Capacitor-iOS) ----
// Kabul edilen audience'lar: web client + iOS client (Capacitor native). Env ile verilir.
const GOOGLE_CLIENT_IDS = String(process.env.GOOGLE_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
const APPLE_CLIENT_IDS = String(process.env.APPLE_CLIENT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)

const _jwksCache = new Map() // url -> { keys, at }
async function fetchJwks(url) {
  const c = _jwksCache.get(url)
  if (c && Date.now() - c.at < 3600_000) return c.keys
  const r = await fetch(url)
  if (!r.ok) throw new Error('jwks ' + r.status)
  const j = await r.json()
  _jwksCache.set(url, { keys: j.keys || [], at: Date.now() })
  return j.keys || []
}
const b64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')

// OIDC id_token doğrula (RS256, JWKS ile) — jsonwebtoken bağımlılığı yok, saf node:crypto.
async function verifyIdToken(idToken, { jwksUrl, issuers, audiences }) {
  const parts = String(idToken || '').split('.')
  if (parts.length !== 3) throw new Error('malformed')
  const [h, p, s] = parts
  const header = JSON.parse(b64u(h).toString())
  const payload = JSON.parse(b64u(p).toString())
  if (header.alg !== 'RS256') throw new Error('alg')
  const keys = await fetchJwks(jwksUrl)
  const jwk = keys.find(k => k.kid === header.kid)
  if (!jwk) throw new Error('kid')
  const pub = crypto.createPublicKey({ key: jwk, format: 'jwk' })
  const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), pub, b64u(s))
  if (!ok) throw new Error('signature')
  if (!issuers.includes(payload.iss)) throw new Error('iss')
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!auds.some(a => audiences.includes(a))) throw new Error('aud')
  if (Number(payload.exp) * 1000 < Date.now() - 5000) throw new Error('expired')
  return payload
}

// Sağlayıcı kimliğinden hesabı bul/oluştur/birleştir. E-posta gizliyse placeholder kullanılır.
async function oauthUpsertPlayer(provider, sub, email) {
  const col = provider === 'google' ? 'google_id' : 'apple_id'
  let r = await pool.query(`SELECT email, banned_at, ban_reason FROM benzinlik_player WHERE ${col}=$1`, [sub])
  if (r.rowCount) return r.rows[0]
  if (email) {
    r = await pool.query('SELECT email, banned_at, ban_reason FROM benzinlik_player WHERE lower(email)=lower($1)', [email])
    if (r.rowCount) {
      await pool.query(`UPDATE benzinlik_player SET ${col}=$1, email_verified=true WHERE lower(email)=lower($2)`, [sub, email])
      return r.rows[0]
    }
  }
  // yeni hesap: e-posta gizliyse benzersiz placeholder; şifre kullanılamaz (rastgele)
  const em = (email && /^\S+@\S+\.\S+$/.test(email)) ? email.toLowerCase() : `${provider}_${sub}@login.beneloil`
  const pass = hashPassword(crypto.randomBytes(24).toString('hex'))
  const ins = await pool.query(
    `INSERT INTO benzinlik_player(email, pass, ${col}, email_verified) VALUES ($1,$2,$3,true)
     ON CONFLICT (email) DO UPDATE SET ${col}=EXCLUDED.${col} RETURNING email, banned_at, ban_reason`,
    [em, pass, sub])
  bumpStat('signups')
  pushSignupNotif() // ekibe "+1 oyuncu" (asla girişi etkilemez)
  return ins.rows[0]
}
async function sendEmail(to, subject, html) {
  const key = process.env.RESEND_API_KEY
  const from = process.env.MAIL_FROM || 'BenelOil <noreply@benerits.com>'
  if (!key) { console.log('[mail] RESEND_API_KEY yok — atlandı:', to, '/', subject); return false }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ from, to, subject, html }),
    })
    if (!r.ok) console.log('[mail] resend hata', r.status, (await r.text()).slice(0, 160))
    return r.ok
  } catch (e) { console.log('[mail] istisna', e.message); return false }
}
function reqLang(req, body) {
  const l = String((body && body.lang) || '').toLowerCase()
  // FR oyuncusu için mail şablonu henüz yok; İngilizceye düşürmek Türkçeden doğru olur.
  if (l === 'fr') return 'en'
  if (l === 'en' || l === 'tr') return l
  const al = String(req.headers['accept-language'] || '').toLowerCase()
  if (al.startsWith('fr')) return 'en'
  return al.startsWith('en') ? 'en' : 'tr' // varsayılan TR
}
function mailTemplate(kind, lang, url) {
  const en = lang === 'en'
  const C = {
    verify: {
      subject: en ? 'BenelOil — Verify your email' : 'BenelOil — E-postanı doğrula',
      title: en ? 'Verify your email' : 'E-postanı doğrula',
      body: en ? 'Welcome to BenelOil! Confirm your email address to keep running your station.'
        : 'BenelOil’e hoş geldin! İstasyonunu işletmeye devam etmek için e-postanı doğrula.',
      btn: en ? 'Verify my email' : 'E-postamı doğrula',
    },
    reset: {
      subject: en ? 'BenelOil — Reset your password' : 'BenelOil — Şifre sıfırlama',
      title: en ? 'Reset your password' : 'Şifreni sıfırla',
      body: en ? 'We received a request to reset your password. Tap below to set a new one — this link is valid for 1 hour.'
        : 'Şifreni sıfırlama isteği aldık. Yeni şifre belirlemek için aşağıya dokun — bağlantı 1 saat geçerli.',
      btn: en ? 'Reset password' : 'Şifremi sıfırla',
    },
  }[kind]
  const ignore = en ? 'If you didn’t request this, you can safely ignore this email.'
    : 'Bu isteği sen yapmadıysan bu e-postayı güvenle yok sayabilirsin.'
  const copy = en ? 'Or copy this link:' : 'Ya da bu bağlantıyı kopyala:'
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#eef1f4">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f4;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 6px 24px rgba(9,9,11,.08);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<tr><td style="background:linear-gradient(135deg,#e8862e,#d64545);padding:26px 28px;text-align:center"><div style="font-size:30px;font-weight:800;color:#fff;letter-spacing:-.5px">BenelOil</div></td></tr>
<tr><td style="padding:34px 30px 10px;text-align:center">
<h1 style="margin:0 0 12px;font-size:22px;color:#1c2530">${C.title}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.55;color:#5a6570">${C.body}</p>
<a href="${url}" style="display:inline-block;padding:14px 32px;background:#27a05a;color:#fff;text-decoration:none;border-radius:12px;font-weight:700;font-size:15px">${C.btn}</a>
</td></tr>
<tr><td style="padding:24px 30px 30px;text-align:center">
<p style="margin:0 0 6px;font-size:12px;color:#9aa4ae;line-height:1.5">${ignore}</p>
<p style="margin:0;font-size:11px;color:#9aa4ae">${copy}<br><span style="color:#7fa8e6;word-break:break-all">${url}</span></p>
<hr style="border:none;border-top:1px solid #eef1f4;margin:18px 0">
<p style="margin:0;font-size:11px;color:#b5bdc5">BenelOil · a Benerits game · operated by Hopsule Inc. (Delaware, USA)</p>
</td></tr></table></td></tr></table></body></html>`
  return { subject: C.subject, html }
}
function sendVerifyEmail(email, token, lang) {
  // path-based token: mailde '=' olmaz → quoted-printable bozulması yaşanmaz
  const { subject, html } = mailTemplate('verify', lang, `${BASE_URL}/api/verify/${token}`)
  return sendEmail(email, subject, html)
}
function sendResetEmail(email, token, lang) {
  const { subject, html } = mailTemplate('reset', lang, `${BASE_URL}/reset/${token}`)
  return sendEmail(email, subject, html)
}
function htmlPage(res, title, msg) {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:system-ui,sans-serif;background:#0d1420;color:#eaf1fb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px"><div style="max-width:400px;text-align:center"><div style="font-size:40px"></div><h2>${title}</h2><p style="color:#b8c6da">${msg}</p><a href="${BASE_URL}" style="display:inline-block;margin-top:12px;padding:12px 22px;background:#27a05a;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">Oyuna dön</a></div></body>`)
}

function json(res, code, data) {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
  res.end(body)
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = ''
    req.on('data', c => { s += c; if (s.length > 1_000_000) reject(new Error('too big')) })
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch (e) { reject(e) } })
  })
}

// İstemciden gelen kaydı makul sınırlara kırp — bariz hileleri SQL'e sokma.
const clamp = (v, lo, hi, dflt = lo) => (typeof v === 'number' && isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)

// ---- Anti-cheat: bina/ilerleme değeri (state.ts maliyet tablolarıyla birebir) ----
// Bina para maliyeti olduğundan "servet = para + bina değeri" birleşik hız-tavanı,
// hem para hem bina/seviye enjeksiyonunu tek seferde kapatır (satın alma servet-nötr).
// UYARI: bu tablolar state.ts (PUMP_COSTS / EV_COSTS ...) ile BİREBİR kalmalı. Endgame
// güncellemesinde istemci pompa 8→14, EV 8→12 oldu ama sunucu 8'de kalınca oyuncunun
// 9+ pompası/şarjı her save'de geri kırpılıyordu (parası gidiyor, ünite kayboluyordu).
const COST = {
  pump: [0, 5000, 8000, 12000, 16000, 21000, 26000, 32000, 40000, 50000, 62000, 76000, 92000, 110000],
  sign: [1500, 4000, 9000], tank: [3000, 7000, 15000], tankAdd: [0, 6000, 12000, 20000],
  market: [7000, 12000, 20000], toilet: [2500, 5000], grid: [8000, 15000],
  battery: [5000, 9000, 16000, 34000, 72000, 155000], ev: [6000, 10000, 14000, 18000, 22000, 27000, 32000, 38000, 46000, 56000, 68000, 82000],
}
const MANAGER_COSTS = [18000, 34000, 60000]      // istemci state.ts ile BİREBİR
const DECOR_COSTS = [15000, 40000, 90000]
const STAFF_TRAIN_COSTS = [12000, 26000, 48000]
// MARİNA (src/marina.ts ile SENKRON — orada değişirse burası da değişmeli)
const MARINA_FAC_COST = { fueldock: 180000, chandlery: 90000, shower: 60000, clubhouse: 220000,
  icebait: 45000, travelift: 900000, pumpout: 120000, wasteoil: 70000, boom: 95000 }
// KAYIT KAYBI FİXİ: 'karsi' (Karşı Kıyı Parkı, ₺90.000) bu tabloda YOKTU. clampMarina
// bilinmeyen anahtarı attığı için oyuncunun aldığı HER karşı kıyı yeri ilk buluta yazımda
// siliniyordu (para gitmiş, yer yok — iade de yok). Canlıda 102 marina oyuncusunun
// HİÇBİRİNDE 'karsi' yoktu; kanıt bu. src/marina.ts BERTH_KINDS ile birebir olmalı.
const BERTH_COST = { buoy: 12000, finger8: 40000, finger12: 75000, finger18: 140000, karsi: 90000, mega: 600000 }
const WINTER_SLOT_COST = 8000
/** Marina alanlarını temizle. Bilinmeyen tesis/bağlama anahtarları ATILIR — uydurma
 *  anahtarla servet şişirme yolu kapalı. Sayılar abuse tavanıyla sınırlanır. */
/** AI rakip durumu — istemci kaynaklı, doğrulanabilir sınırlar içinde tutulur.
 *  Rakip SERVET hesabına girmez (oyuncunun malı değil), yalnız trafik payını etkiler;
 *  yine de uydurma değerle payı şişirmesin diye kırpılır. */
function clampRival(s) {
  if (!('rival' in s)) return
  const r = s.rival
  if (!r || typeof r !== 'object' || Array.isArray(r)) { s.rival = null; return }
  s.rival = {
    price: clamp(r.price, 0.5, 80, 10),
    strength: clamp(r.strength, 0.15, 0.95, 0.3),
    promoDays: clamp(r.promoDays, 0, 30, 0),
    lastDay: clamp(r.lastDay, 0, 100000, 0),
    since: clamp(r.since, 0, 100000, 0),
  }
}

function clampMarina(s) {
  if ('marinaFacs' in s) {
    s.marinaFacs = Array.isArray(s.marinaFacs)
      ? [...new Set(s.marinaFacs.filter(f => typeof f === 'string' && f in MARINA_FAC_COST))].slice(0, 16)
      : []
  }
  if ('berths' in s) {
    const out = {}
    if (s.berths && typeof s.berths === 'object' && !Array.isArray(s.berths)) {
      for (const k of Object.keys(s.berths)) {
        // 60 ÇOK DARDI: istemcide bağlama sayısında sınır YOK (buyItem 'berth_*' sadece
        // artırır). Canlıda 33 bağlama kalemi tam 60'ta çakılıydı — oyuncu ödüyor, sunucu
        // her kayıtta geri kırpıyordu ("marina arsalarımın sayısı düşmüş, iade de olmadı").
        // 2000 = abuse tavanı; meşru oyuncunun ulaşamayacağı kadar yüksek, servet freni
        // (money+bval tavanı) enjeksiyonu zaten kapatıyor.
        if (k in BERTH_COST) out[k] = clamp(s.berths[k], 0, 2000, 0)
      }
    }
    s.berths = out
  }
  // 120 ÇOK DARDI (aynı gerekçe): kışlama kızağında da istemci sınırı yok, canlıda 6 hesap
  // tam 120'de çakılıydı — bir oyuncu 2.500 kızağını kaybettiğini bildirdi.
  if ('winterSlots' in s) s.winterSlots = clamp(s.winterSlots, 0, 20_000, 0)
  if ('marinaViolations' in s) s.marinaViolations = clamp(s.marinaViolations, 0, 999, 0)
  if ('logbookOk' in s) s.logbookOk = clamp(s.logbookOk, 0, 1e6, 0)
  if ('logbookBad' in s) s.logbookBad = clamp(s.logbookBad, 0, 1e6, 0)
}


/**
 * MEŞRU KAZANÇ HIZI — sunucu, istemciye sormadan save'deki EKİPMANDAN türetir.
 *
 * Eski hile freni sabit bir taban veriyordu (100.000/push). Rate limit 3 sn'de 2 push'a
 * izin verdiği için taban her push'ta yeniden alınıyordu: gün-1 oyuncusu bile saatte
 * ~249 milyon, 40 yıldızlı ~2,7 milyar çekebiliyordu. Zaman tabanlı terim sabitin
 * yanında anlamsız kalıyordu.
 *
 * Artık hız OYUNCUNUN GERÇEKTEN SAHİP OLDUĞU şeye bağlı: 1 pompalı hesap milyon
 * iddia edemez. Ölçüm: en gelişmiş istasyon aktif oyunda ~267 ₺/sn kazanıyor;
 * SAFETY=4 ile tavan ~1.070 ₺/sn olur — meşru oyuncu asla değmez, hile 200 kat kısılır.
 */

/** HİLE DENETİM KAYDI — bellekte son 200 olay; /api/metrics ile görülebilir.
 *  Kalıcı tablo AÇMIYOR (oyuncu kaydına dokunmama kuralı). Amaç: kırpmanın
 *  sessiz kalmaması; hangi hesapta ne sıklıkla tavan zorlanıyor görülebilsin. */
const cheatLog = []
// İZAHAT BANI: hesap kilitli ama savunma kanalı açık. appeal:true gören istemci
// izahat formunu açar (metinler istemcide TR/EN lokalize); token'la /api/appeal atılır.
function bannedJson(res, email, reason) {
  if (reason === 'izahat') {
    return json(res, 403, {
      error: 'Hesabınızda şüpheli gelir/gider dengesizliği tespit ettik, lütfen izahat veriniz.',
      appeal: true, token: sign(email),
    })
  }
  return json(res, 403, { error: 'Bu hesap askıya alınmış.' })
}

function auditCheat(email, kind, info) {
  cheatLog.push({ at: new Date().toISOString(), email, kind, ...info })
  if (cheatLog.length > 200) cheatLog.shift()
  console.warn(`[hile-freni] ${kind} ${email}`, info)
  // KALICI KAYIT: inceleme docker log rotasyonuna bağlı kalmasın. Yazım hatası oyun
  // akışını ASLA bozmamalı — bilerek await edilmiyor ve hata yutuluyor.
  const amount = Math.round(Number(info?.clamped ?? info?.excess ?? 0)) || null
  const rate = Math.round(Number(info?.rate ?? 0)) || null
  pool.query('INSERT INTO benzinlik_cheatlog(email, kind, amount, rate) VALUES($1,$2,$3,$4)',
    [String(email || '').slice(0, 200), String(kind).slice(0, 40), amount, rate]).catch(() => {})
}

/** PRESTİJ ÇARPANI — src/state.ts GameState.prestigeStarMult() ile BİREBİR AYNI OLMALI.
 *  İki eksen de geliri çarpar, o yüzden çarpımları alınır:
 *   · GELİR çarpanı (prestigeMultFor): ilk 10★ +%25, 11-20★ +%10, 21★+ +%5
 *   · AKIŞ çarpanı (prestigeFlowFor): ilk 5★ +%5, 6-10★ +%2.5, sonrası +%1, tavan ×1.50
 *  İstemciyle ayrışırsa devretmiş oyuncunun MEŞRU geliri "imkânsız artış" sanılıp
 *  kırpılır. tools/tests/devir-check.mjs bu fonksiyonu söküp 0-40★ için karşılaştırır.
 *  Eskiden aynı ifade İKİ YERE kopyalanmıştı — tek kaynağa indirildi. */
function prestigeStarMult(stars) {
  const s = Math.max(0, stars)
  const gelir = 1 + 0.25 * Math.min(s, 10) + 0.10 * Math.min(Math.max(s - 10, 0), 10) + 0.05 * Math.max(s - 20, 0)
  const akis = Math.min(1.50, 1 + 0.05 * Math.min(s, 5) + 0.025 * Math.min(Math.max(s - 5, 0), 5) + 0.01 * Math.max(s - 10, 0))
  return gelir * akis
}

function maxIncomeRate(s) {
  if (!s) return 20
  const n = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)
  const fac = (n(s.marketLevel) > 0 ? n(s.marketLevel) : 0)
    + (s.hasCoffee ? 1 : 0) + (s.hasRestaurant ? 1 : 0) + (s.hasWash ? 1 : 0)
    + (s.hasOil ? 1 : 0) + (s.hasTruckPark ? 1 : 0) + (s.hasTruckPark2 ? 1 : 0) + n(s.selfWashCount)
    + n(s.airWaterCount) * 0.5 + (s.hasSMR ? 2 : 0)
  // MARİNA: tekne başı ciro yüksek ama frekans 10x düşük → bağlama/tesis başına pay
  const marina = (Array.isArray(s.marinaFacs) ? s.marinaFacs.length : 0) * 2
    + (s.berths && typeof s.berths === 'object'
        ? Object.values(s.berths).reduce((a, v) => a + n(v), 0) * 1.5 : 0)
  const base = 1 + n(s.pumps) * 1.2 + n(s.evChargers) * 0.8 + fac * 0.6 + marina * 0.6
  const stars = Math.max(0, Math.min(40, n(s.brandStars)))
  // base*8 = aktif oyunda meşru tepe kazanç (ölçüm: gelişmiş istasyon ~267 ₺/sn).
  // starMult oyunun KENDİ prestij çarpanıyla aynı (state.ts prestigeMult = 1+0.25*yıldız).
  // SAFETY=3 yanlış alarm payı: bu repoda aşırı sıkı guard'lar "param gitti" şikâyeti
  // üretmişti, o yüzden meşru tepenin 3 katından aşağı inilmiyor.
  const SAFETY = 3
  // ŞUBE MÜDÜRLERİ (pasif şube geliri): oyuncu başka şubedeyken müdürlü şubeler kendi
  // kasalarına yazıyor ve oyuncu bunu TEK SEFERDE topluyor. Bu sıçrama meşrudur; kova
  // hızına şubelerin kapasitesi eklenmezse "param gitti" sınıfı yanlış alarm doğar
  // (bu repoda aşırı sıkı guard'lar tam bunu üretmişti).
  let branch = 0
  if (s.locSnapshots && typeof s.locSnapshots === 'object') {
    for (const sn of Object.values(s.locSnapshots)) {
      if (!sn || typeof sn !== 'object' || !sn.f || typeof sn.f !== 'object') continue
      const lvl = Math.max(0, Math.min(3, Math.round(n(sn.f.managerLevel))))
      if (lvl > 0) branch += 6 + lvl * 4
    }
  }
  // AZALAN VERİM + MARKA AKIŞI (istemci prestigeStarMult ile AYNI) — tek kaynak fonksiyon
  return Math.max(20, (base + branch) * 8 * SAFETY * prestigeStarMult(stars))
}

/** ŞUBE KASASI CLAMP'İ: istemci tavanıyla BİREBİR (state.ts BRANCH_VAULT_HARD).
 *  Kurcalanmış save'de branchVault sonsuz para kapısı olmasın. */
const BRANCH_VAULT_HARD = 240_000
/**
 * GEÇERLİ ŞUBE ID'LERİ — istemci state.ts ALL_LOCS ile BİREBİR olmak ZORUNDA.
 *
 * ŞUBE ÇİFTLEME (aynı türden ikinci şube): '-2' sonekli 4 kopya eklendi. Bu liste
 * eksik kalırsa sanitizeSave kopya şubeyi kayıttan siler → snapshotsValue o şubenin
 * ekipmanını saymaz → meşru oyuncunun serveti sunucuda ÇÖKER ve anti-cheat onu kırpar
 * ("param gitti" sınıfı hata). Yeni şube eklenince İLK güncellenecek yer burasıdır.
 */
const BASE_LOCS_SRV = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'metropol']
const COPY_LOCS_SRV = ['cevreyolu-2', 'otoyol-2', 'marina-2', 'metropol-2']
const VALID_LOCS = [...BASE_LOCS_SRV, ...COPY_LOCS_SRV]
/** kopya id'sini tabanına indirir ('marina-2' → 'marina'); tema limitleri tabandan gelir */
const baseLocSrv = id => {
  const b = String(id ?? '').replace(/-\d+$/, '')
  return BASE_LOCS_SRV.includes(b) ? b : 'kasaba'
}
function clampBranchVault(s) {
  if (!s) return
  if (typeof s.branchVault !== 'object' || !s.branchVault || Array.isArray(s.branchVault)) {
    delete s.branchVault
    return
  }
  const out = {}
  for (const k of Object.keys(s.branchVault)) {
    if (!VALID_LOCS.includes(k)) continue
    const v = Number(s.branchVault[k])
    if (!isFinite(v) || v <= 0) continue
    out[k] = Math.min(BRANCH_VAULT_HARD, Math.round(v))
  }
  s.branchVault = out
}

/** PAYLAŞILAN TEDARİK HATTI (istemci state.ts SUPPLY_LINE_QUOTA ile BİREBİR).
 *  Kopya şube ile tabanı aynı günlük kotadan çeker. Kurcalanmış negatif/NaN değer
 *  kotayı sonsuz yakıta çevirmesin diye 0..kota aralığına kırpılır; anahtarlar yalnız
 *  TABAN şube id'leri olabilir. Servet hesabına GİRMEZ (para değil, gün içi sayaç). */
const SUPPLY_LINE_QUOTA = 9_000
function clampSupplyUsed(s) {
  if (!s || !('supplyUsed' in s)) return
  if (typeof s.supplyUsed !== 'object' || !s.supplyUsed || Array.isArray(s.supplyUsed)) {
    delete s.supplyUsed
    return
  }
  const out = {}
  for (const k of Object.keys(s.supplyUsed)) {
    if (!BASE_LOCS_SRV.includes(k)) continue
    const v = Number(s.supplyUsed[k])
    if (!isFinite(v) || v <= 0) continue
    out[k] = Math.min(SUPPLY_LINE_QUOTA, Math.round(v))
  }
  s.supplyUsed = out
}

/** Jeton kovası tavanı: tek seferlik meşru sıçramayı (gün dönüşü + sözleşme ödemesi) karşılar */
const ALLOW_BURST = 260_000

/**
 * KOVA TAVANI ŞUBE SAYISINA GÖRE BÜYÜR (25 Ağu — canlı hata düzeltmesi).
 *
 * Sabit 260.000'lik tavan çok şubeli oyuncuyu HAKSIZ kırpıyordu: pasif şube kasası
 * başına tavan 240.000 (BRANCH_VAULT_HARD) ve oyuncu hepsini TEK dokunuşta topluyor.
 * 4 pasif şubeli oyuncuda bu ₺960.000 demek → kovaya sığmıyor, her tam toplamada
 * ₺700.000 MEŞRU kazanç yanıyordu. Ardından istemci kendi doğru bakiyesini tutmaya
 * devam ettiği için fark her kayıtta büyüyor ve "enjeksiyon rampası"na benzeyen bir
 * kartopu oluşuyordu (30 günde 151.109 kırpma olayının kaynağı buydu; 1,34 milyar
 * ciro yapmış bir oyuncu bu yüzden yanlışlıkla banlandı).
 *
 * Yeni tavan: taban + pasif şube başına bir kasa dolusu. Hile freni korunuyor —
 * oyuncunun GERÇEKTEN biriktirebileceği en büyük tek seferlik meşru tutar kadar.
 */
function burstCap(s) {
  const locs = Array.isArray(s?.unlockedLocs) ? s.unlockedLocs.length : 1
  // ŞUBE ÇİFTLEME: tavan 5 şubede sabitlenirse 9 şubeli oyuncu HAKSIZ kırpılır
  // (kopya şubelerin kasası da tek dokunuşta toplanıyor). Sınır VALID_LOCS'a bağlandı.
  const pasif = Math.max(0, Math.min(VALID_LOCS.length, locs) - 1)
  return ALLOW_BURST + pasif * BRANCH_VAULT_HARD
}

function marinaValue(s) {
  let v = 0
  if (Array.isArray(s.marinaFacs)) for (const f of s.marinaFacs) v += MARINA_FAC_COST[f] || 0
  if (s.berths && typeof s.berths === 'object') {
    for (const k of Object.keys(s.berths)) v += (BERTH_COST[k] || 0) * (Number(s.berths[k]) || 0)
  }
  v += (Number(s.winterSlots) || 0) * WINTER_SLOT_COST
  return v
}
const FLAT = { solar: 9000, dieselgen: 4000, smr: 40000, wash: 8000, oil: 12000, coffee: 7000, restaurant: 15000, truckpark: 12000, airwater: 1500, selfwash: 6000, parking: 1200, widegate: 6000, lamp: 2500 }
/**
 * KUMBARA SERT TAVANI — istemci state.ts pendingCap() × 3 (addPending'in "hard = cap*3"
 * taşma tavanı) ile senkron olmak ZORUNDA. Aksi hâlde meşru oyuncunun biriken kumbarası
 * kayıtta sessizce kırpılır ("topladım ama para eksik").
 * İstemcideki en yüksek tekil kumbara: self yıkama 400 × SAYAC_KUMBARA_MAX(12) = 4.800
 * → sert tavan 14.400. Eski 8.000 clamp'i hem 6+ üniteli self yıkamayı hem de OTELİ
 * (cap 3.000 → sert tavan 9.000) kırpıyordu. 16.000 = en yüksek meşru değerin üstü,
 * hile freni olarak hâlâ dar (kasa tavanı 10 milyar).
 */
const PENDING_HARD_CAP = 16_000
const sumUpto = (arr, k) => { let t = 0; const n = Math.max(0, Math.min(arr.length, Math.floor(k) || 0)); for (let i = 0; i < n; i++) t += arr[i]; return t }
function buildingValue(s) {
  if (!s || typeof s !== 'object') return 0
  const n = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d)
  let v = 0
  v += sumUpto(COST.pump, n(s.pumps, 1))
  v += sumUpto(COST.sign, n(s.signLevel)) + sumUpto(COST.tank, n(s.tankLevel)) + sumUpto(COST.market, n(s.marketLevel))
  v += sumUpto(COST.market, n(s.market2Level)) // karşı yaka marketi (aynı maliyet tablosu)
  v += sumUpto(COST.toilet, n(s.toilet2Level)) // B8: karşı yaka tesis nüshaları
  if (s.hasWash2) v += FLAT.wash
  if (s.hasOil2) v += FLAT.oil
  if (s.hasCoffee2) v += FLAT.coffee
  if (s.hasRestaurant2) v += FLAT.restaurant
  v += sumUpto(MANAGER_COSTS, n(s.managerLevel))               // müdür kurulumu servete girer
  v += sumUpto(STAFF_TRAIN_COSTS, Math.max(0, n(s.staffLevel, 1) - 1)) // personel eğitimi
  v += sumUpto(DECOR_COSTS, n(s.decorLevel))                            // dekorasyon
  if (s.insurance) v += 5000                                            // sigorta kurulumu
  v += sumUpto(COST.toilet, n(s.toiletLevel)) + sumUpto(COST.grid, n(s.gridLevel)) + sumUpto(COST.battery, n(s.batteryLevel))
  v += sumUpto(COST.ev, n(s.evChargers))
  if (s.tankCounts && typeof s.tankCounts === 'object') for (const k of ['benzin', 'dizel', 'lpg']) v += sumUpto(COST.tankAdd, n(s.tankCounts[k], 1))
  v += FLAT.solar * n(s.solarCount) + FLAT.airwater * n(s.airWaterCount) + FLAT.selfwash * n(s.selfWashCount) + FLAT.parking * n(s.parkingCount)
  v += FLAT.lamp * n(s.lampCount) // sokak lambası (state.ts LAMP_COST ile senkron)
  v += marinaValue(s)             // marina tesisleri + bağlama + kışlama (src/marina.ts senkronu)
  if (s.hasDiesel) v += FLAT.dieselgen
  if (s.hasSMR) v += FLAT.smr
  if (s.hasWash) v += FLAT.wash
  if (s.hasOil) v += FLAT.oil
  if (s.hasCoffee) v += FLAT.coffee
  if (s.hasRestaurant) v += FLAT.restaurant
  if (s.hasTruckPark) v += FLAT.truckpark
  if (s.hasTruckPark2) v += FLAT.truckpark // karşı yaka tır parkı (istemciyle senkron)
  if (s.wideGates) v += FLAT.widegate
  // parseller DÜŞÜK tahmin: gerçek parselCost dinamik (6k-28k); düşük tutmak satın almanın
  // asla "servet artışı" gibi görünmemesini garanti eder (false-positive önlemi).
  if (Array.isArray(s.ownedParcels)) v += s.ownedParcels.length * 5000
  if (Array.isArray(s.pavedParcels)) v += s.pavedParcels.length * 2000
  return v
}
/** ÇOKLU ŞUBE: pasif şubelerin ekipmanı da servete girer — yoksa şube değişimi
 *  "servet çöktü/zıpladı" sanılıp regresyon/hile guard'ını tetikler (409). */
function snapshotsValue(s) {
  if (!s || typeof s.locSnapshots !== 'object' || !s.locSnapshots) return 0
  let v = 0
  for (const sn of Object.values(s.locSnapshots)) {
    if (!sn || typeof sn !== 'object' || !sn.f || typeof sn.f !== 'object') continue
    const flat = { ...sn.f, tankCounts: sn.tankCounts, ownedParcels: sn.ownedParcels, pavedParcels: sn.pavedParcels }
    v += buildingValue(flat)
  }
  return v
}
function sanitizeSave(save) {
  if (save === null) return null
  if (typeof save !== 'object' || Array.isArray(save)) return undefined
  const s = save.s
  if (!s || typeof s !== 'object') return undefined
  s.money = clamp(s.money, 0, 10_000_000_000, 5000) // ileri oyuncular 2M'yi aşabilir — sağlık tavanı yükseltildi
  s.reputation = clamp(s.reputation, 0, 5, 3)
  s.day = clamp(s.day, 1, 100000, 1)
  s.pumps = clamp(s.pumps, 1, 14, 1) // state.ts MAX_PUMPS = 14
  // Bu ünitelerin istemcide sınırı YOK ("sınırsız kurulur"). 30 clamp'i 31. üniteyi
  // save'de siliyordu (para gitti, ünite yok — gir-çık şikâyetinin bir kolu). 200 = abuse
  // tavanı; meşru oyuncunun asla ulaşamayacağı kadar yüksek.
  for (const k of ['parkingCount', 'solarCount', 'selfWashCount', 'airWaterCount', 'lampCount']) {
    if (k in s) s[k] = clamp(s[k], 0, 200, 0)
  }
  s.evChargers = clamp(s.evChargers, 0, 12, 0) // state.ts EV_COSTS = 12 kademe
  s.signLevel = clamp(s.signLevel, 0, 3, 0)
  s.tankLevel = clamp(s.tankLevel, 0, 3, 0)
  s.marketLevel = clamp(s.marketLevel, 0, 3, 0) // market 3 seviye (istemci ile aynı) — 2'ye kırpınca Sv.3 senkronda geri düşüyordu
  if ('market2Level' in s) s.market2Level = clamp(s.market2Level, 0, 3, 0) // karşı market (additive alan — eski save'lerde yok)
  if ('toilet2Level' in s) s.toilet2Level = clamp(s.toilet2Level, 0, 2, 0)  // B8 karşı yaka nüshaları
  if ('managerLevel' in s) s.managerLevel = clamp(s.managerLevel, 0, 3, 0)   // müdür otomasyonu
  if ('staffLevel' in s) s.staffLevel = clamp(s.staffLevel, 1, 4, 1)         // personel eğitimi
  if ('decorLevel' in s) s.decorLevel = clamp(s.decorLevel, 0, 3, 0)         // dekorasyon sink'i
  if ('wear' in s) s.wear = clamp(s.wear, 0, 1, 0)                           // ekipman yaşlanması
  clampMarina(s)                                                            // marina alanları (additive)
  clampBranchVault(s)                                                       // şube müdürü kasaları (additive)
  clampSupplyUsed(s)                                                        // paylaşılan tedarik hattı (additive)
  clampRival(s)                                                             // AI rakip durumu
  // _ab (jeton kovası) SUNUCU-SAHİPLİ: istemci ne yazarsa yazsın sınırlanır.
  if ('_ab' in s) {
    const a = s._ab
    // Üst sınır burstCap ile AYNI olmalı: sabit 260000 kalırsa çok şubeli oyuncunun
    // büyütülmüş kovası her kayıtta buraya takılıp geri kırpılır ve düzeltme etkisiz kalır.
    s._ab = (a && typeof a === 'object' && !Array.isArray(a))
      ? { t: clamp(a.t, 0, 4e12, 0), b: clamp(a.b, 0, burstCap(s), 0) } : null
  }
  if ('licenseDueDay' in s) s.licenseDueDay = clamp(s.licenseDueDay, 0, 100000, 30)
  if ('insurance' in s) s.insurance = !!s.insurance
  if ('marketingBudget' in s) s.marketingBudget = clamp(s.marketingBudget, 0, 8000, 0) // reklam sink'i (additive)
  if ('brandStars' in s) s.brandStars = clamp(s.brandStars, 0, 40, 0)      // prestij (additive)
  if ('handoverCount' in s) s.handoverCount = clamp(s.handoverCount, 0, 40, 0)
  if ('contractsDone' in s) s.contractsDone = clamp(s.contractsDone, 0, 100000, 0)
  if ('contractsFailed' in s) s.contractsFailed = clamp(s.contractsFailed, 0, 100000, 0)
  // aktif B2B sözleşmesi (additive): alanları makul sınırlara kırp, bozuksa düşür
  if (s.contract && typeof s.contract === 'object' && !Array.isArray(s.contract)) {
    const c = s.contract
    if (!['benzin', 'dizel', 'lpg'].includes(c.fuel)) s.contract = null
    else {
      c.name = String(c.name || '-').slice(0, 40)
      c.id = String(c.id || 'c').slice(0, 40)
      // clamp'ler oyunun GERÇEK üretim aralığına yakın: kurcalanmış save ile bedava prim yok
      c.daysTotal = clamp(c.daysTotal, 5, 20, 7)
      c.daysLeft = Math.min(clamp(c.daysLeft, 1, 20, 1), c.daysTotal)
      c.dailyLiters = clamp(c.dailyLiters, 50, 4000, 500)
      c.pricePerL = clamp(c.pricePerL, 1, 20, 8)
      c.bonus = clamp(c.bonus, 0, 120000, 0)
      c.penalty = clamp(c.penalty, 0, 60000, 0)
      c.deliveredToday = clamp(c.deliveredToday, 0, 100000, 0)
      c.missedDays = clamp(c.missedDays, 0, 60, 0)
    }
  } else if ('contract' in s) s.contract = null
  if ('opexStart' in s) s.opexStart = clamp(s.opexStart, 0, 100000, 0) // OPEX rampa başlangıç günü (additive)
  s.toiletLevel = clamp(s.toiletLevel, 0, 2, 0)
  s.gridLevel = clamp(s.gridLevel, 0, 2, 0)
  s.batteryLevel = clamp(s.batteryLevel, 0, 6, 0)   // state.ts BATTERY_CAP = 7 kademe
  s.battery = clamp(s.battery, 0, 4500, 0)          // en yüksek kademe kapasitesi
  s.uranium = clamp(s.uranium, 0, 100, 0)
  s.loginStreak = clamp(s.loginStreak, 0, 3650, 0)
  s.dailyServed = clamp(s.dailyServed, 0, 10000, 0)
  // Tank kapasitesi = seviye hacmi × tank adedi (adet 1-4). Sabit 5000 clamp'i çok-tanklı
  // oyuncunun dolu deposunu (20.000L'ye kadar) durduk yere 5000'e düşürüyordu.
  const TANK_CAP = [800, 1500, 3000, 5000]
  // MARİNA TEMASI FARKI (kayıt kaybı fixi — feedback 703/731/746/747/966): marina
  // yakıt başına 8 tanka ve ×3 kapasiteye izin verir (themes.ts features). Genel 4/çarpansız
  // clamp marina yükseltmelerini ve depodaki yakıtı her save'de SİLİYORDU (para da gitmiş oluyordu).
  const tankMaxFor = loc => (loc === 'marina' ? 8 : 4)
  const tankMultFor = loc => (loc === 'marina' ? 3 : 1)
  if (s.tankCounts && typeof s.tankCounts === 'object') {
    for (const k of ['benzin', 'dizel', 'lpg']) s.tankCounts[k] = clamp(s.tankCounts[k], 1, tankMaxFor(s.activeLoc), 1)
  }
  if (s.tanks && typeof s.tanks === 'object') {
    for (const k of ['benzin', 'dizel', 'lpg']) {
      const cnt = (s.tankCounts && typeof s.tankCounts[k] === 'number') ? clamp(s.tankCounts[k], 1, tankMaxFor(s.activeLoc), 1) : 1
      s.tanks[k] = clamp(s.tanks[k], 0, TANK_CAP[s.tankLevel] * cnt * tankMultFor(s.activeLoc), 0)
    }
  }
  if (s.pendingCash && typeof s.pendingCash === 'object') {
    // kumbara cap'i tesis gelişmişliğine göre 1800'e kadar çıkabilir (istemci pendingCap);
    // sabit 600 clamp'i geliştirilmiş kumbarayı senkronda kırpıyordu → 2500'e (güvenli tavan) çıkarıldı
    for (const k of Object.keys(s.pendingCash)) s.pendingCash[k] = clamp(s.pendingCash[k], 0, PENDING_HARD_CAP, 0)
  }
  if (typeof s.stationName === 'string') s.stationName = s.stationName.slice(0, 14)
  if (s.prices && typeof s.prices === 'object') {
    for (const k of ['benzin', 'dizel', 'lpg']) s.prices[k] = clamp(s.prices[k], 1, 30, 10)
  }
  if ('elecPrice' in s) {
    s.elecPrice = clamp(s.elecPrice, 4, 18, 8)
  }
  // 64 azdı: 14 pompa + 12 şarj + sınırsız otopark/panel/self-yıkama rahat aşıyor; taşan
  // yapıların çakışma dikdörtgenleri sessizce düşüyordu. 512 ≈ 30KB, body limitine uzak.
  if (Array.isArray(save.placedRects) && save.placedRects.length > 512) save.placedRects = save.placedRects.slice(0, 512)
  // muhasebe log'ları: şişmeyi/abuse'ı önlemek için son 40 kayda kırp
  if (Array.isArray(s.fuelLog) && s.fuelLog.length > 40) s.fuelLog = s.fuelLog.slice(-40)
  if (Array.isArray(s.wageLog) && s.wageLog.length > 40) s.wageLog = s.wageLog.slice(-40)
  if (Array.isArray(s.salesLog) && s.salesLog.length > 370) s.salesLog = s.salesLog.slice(-370)
  // parsel koordinatlarını doğrula: sınır dışı (0,4 gibi) key'ler client'ı açılışta crash ettiriyordu
  const validParcelKey = k => {
    const p = String(k).split(','); if (p.length !== 2) return false
    const c = Number(p[0]), r = Number(p[1])
    return Number.isInteger(c) && Number.isInteger(r) && c >= 0 && c < 6 && r >= 0 && r < 3
  }
  if (Array.isArray(s.ownedParcels)) s.ownedParcels = s.ownedParcels.filter(validParcelKey)
  if (Array.isArray(s.pavedParcels)) s.pavedParcels = s.pavedParcels.filter(validParcelKey)
  if (Array.isArray(s.ownedParcels) && s.ownedParcels.length > 18) s.ownedParcels = s.ownedParcels.slice(0, 18)
  if (Array.isArray(s.achievements) && s.achievements.length > 32) s.achievements = s.achievements.slice(0, 32)
  // ---- ÇOKLU ŞUBE (additive) ----
  // ŞUBE ÇİFTLEME: tek geçerli-id kaynağı VALID_LOCS (yukarıda) — iki ayrı liste tutmak
  // birinin unutulmasına ve meşru şubenin silinmesine yol açıyordu.
  const VALID_LOC = VALID_LOCS
  if ('activeLoc' in s && !VALID_LOC.includes(s.activeLoc)) s.activeLoc = 'kasaba'
  if ('unlockedLocs' in s) {
    s.unlockedLocs = Array.isArray(s.unlockedLocs)
      ? [...new Set(s.unlockedLocs.filter(x => VALID_LOC.includes(x)))].slice(0, VALID_LOC.length)
      : ['kasaba']
    if (!s.unlockedLocs.includes('kasaba')) s.unlockedLocs.unshift('kasaba')
    if (s.activeLoc && !s.unlockedLocs.includes(s.activeLoc)) s.activeLoc = 'kasaba'
  }
  if (s.locSnapshots && typeof s.locSnapshots === 'object' && !Array.isArray(s.locSnapshots)) {
    const out = {}
    for (const [k, sn] of Object.entries(s.locSnapshots)) {
      if (!VALID_LOC.includes(k) || !sn || typeof sn !== 'object' || !sn.f) continue
      // snapshot ekipmanına AKTİF şubeyle AYNI clamp'ler uygulanır (hile enjeksiyonu yok)
      const f = sn.f
      f.pumps = clamp(f.pumps, 1, 14, 1)
      f.evChargers = clamp(f.evChargers, 0, 12, 0)
      f.signLevel = clamp(f.signLevel, 0, 3, 0)
      f.tankLevel = clamp(f.tankLevel, 0, 3, 0)
      f.marketLevel = clamp(f.marketLevel, 0, 3, 0)
      if ('market2Level' in f) f.market2Level = clamp(f.market2Level, 0, 3, 0)
      if ('toilet2Level' in f) f.toilet2Level = clamp(f.toilet2Level, 0, 2, 0)
      if ('managerLevel' in f) f.managerLevel = clamp(f.managerLevel, 0, 3, 0)
      if ('staffLevel' in f) f.staffLevel = clamp(f.staffLevel, 1, 4, 1)
      if ('decorLevel' in f) f.decorLevel = clamp(f.decorLevel, 0, 3, 0)
      if ('wear' in f) f.wear = clamp(f.wear, 0, 1, 0)
      f.toiletLevel = clamp(f.toiletLevel, 0, 2, 0)
      f.gridLevel = clamp(f.gridLevel, 0, 2, 0)
      f.batteryLevel = clamp(f.batteryLevel, 0, 6, 0)
      f.battery = clamp(f.battery, 0, 4500, 0)
      f.uranium = clamp(f.uranium, 0, 100, 0)
      for (const key of ['parkingCount', 'solarCount', 'selfWashCount', 'airWaterCount', 'lampCount']) {
        if (key in f) f[key] = clamp(f[key], 0, 200, 0)
      }
      clampMarina(f) // marina şubesi anlık görüntüsü de temizlenir
      clampRival(f)
      // marina snapshot'ı da tema limitleriyle (8 tank, ×3 kapasite) — kayıt kaybı fixi.
      // ŞUBE ÇİFTLEME: limit TABAN şubeden okunur ('marina-2' de bir marinadır). Aksi
      // hâlde ikinci marinanın tankları her kayıtta 4'e kırpılıp oyuncu para kaybederdi.
      // (İstemci Marina II'de 6 tank/×2 kapasiteye izin verir; sunucu tavanı tabanın
      //  ÜSTÜ olduğu için meşru oyuncu asla kırpılmaz, hilekâr yine tavana takılır.)
      const isMarinaLoc = baseLocSrv(k) === 'marina'
      const snMax = isMarinaLoc ? 8 : 4
      const snMult = isMarinaLoc ? 3 : 1
      if (sn.tankCounts && typeof sn.tankCounts === 'object') {
        for (const fu of ['benzin', 'dizel', 'lpg']) sn.tankCounts[fu] = clamp(sn.tankCounts[fu], 1, snMax, 1)
      }
      const TANK_CAP2 = [800, 1500, 3000, 5000]
      if (sn.tanks && typeof sn.tanks === 'object') {
        for (const fu of ['benzin', 'dizel', 'lpg']) {
          const cnt = clamp(sn.tankCounts?.[fu], 1, snMax, 1)
          sn.tanks[fu] = clamp(sn.tanks[fu], 0, TANK_CAP2[f.tankLevel || 0] * cnt * snMult, 0)
        }
      }
      if (sn.pendingCash && typeof sn.pendingCash === 'object') {
        for (const key of Object.keys(sn.pendingCash)) sn.pendingCash[key] = clamp(sn.pendingCash[key], 0, PENDING_HARD_CAP, 0)
      }
      for (const arr of ['ownedParcels', 'pavedParcels']) {
        if (Array.isArray(sn[arr])) sn[arr] = sn[arr].filter(k2 => {
          const pp = String(k2).split(','); if (pp.length !== 2) return false
          const c2 = Number(pp[0]), r2 = Number(pp[1])
          return Number.isInteger(c2) && Number.isInteger(r2) && c2 >= 0 && c2 < 6 && r2 >= 0 && r2 < 3
        }).slice(0, 18)
      }
      if (Array.isArray(sn.placedRects) && sn.placedRects.length > 512) sn.placedRects = sn.placedRects.slice(0, 512)
      out[k] = sn
    }
    s.locSnapshots = out
  }
  return save
}

// ---- hız limitleri (bellek içi; tek konteyner için yeterli) ----
const buckets = new Map() // key -> { n, resetAt }
let metricsCache = { data: null, at: 0 } // §9 ölçüm önbelleği (5 dk)
let statsCache = { data: null, at: 0 }
let lbCache = { data: null, at: 0 } // leaderboard önbelleği (60 sn)
async function bumpStat(kind) {
  if (!pool) return
  try {
    await pool.query(
      `INSERT INTO benzinlik_stat_hourly(hour, ${kind}) VALUES (date_trunc('hour', now()), 1)
       ON CONFLICT (hour) DO UPDATE SET ${kind} = benzinlik_stat_hourly.${kind} + 1`)
  } catch { /* stat kaydı kritik değil */ }
}
/** Saatlik sayaçlara DEĞER ekler (bumpStat 1 artırır; trafik ölçümü toplam gönderir).
 *  Kolon adları SQL'e enterpole edildiği için yalnız BEYAZ LİSTE geçer. */
const STAT_TOPLAM_KOLON = new Set(['trafik_icice', 'trafik_sikisan', 'trafik_bekleyen', 'trafik_kurtarilan', 'trafik_ornek'])
async function bumpStatBy(kolonlar) {
  if (!pool) return
  const alanlar = Object.keys(kolonlar).filter(k => STAT_TOPLAM_KOLON.has(k))
  if (!alanlar.length) return
  try {
    const sut = alanlar.join(', ')
    const deg = alanlar.map((_, i) => `$${i + 1}`).join(', ')
    const upd = alanlar.map((k, i) => `${k} = benzinlik_stat_hourly.${k} + $${i + 1}`).join(', ')
    await pool.query(
      `INSERT INTO benzinlik_stat_hourly(hour, ${sut}) VALUES (date_trunc('hour', now()), ${deg})
       ON CONFLICT (hour) DO UPDATE SET ${upd}`, alanlar.map(k => kolonlar[k]))
  } catch { /* stat kaydı kritik değil */ }
}
/** Ham gövdeyi OKUR ve tavanı aşarsa null döner (413 için — readBody JSON'a çevirir,
 *  ham boyutu göremezdik). */
function readRawLimited(req, max) {
  return new Promise(resolve => {
    let s = '', asti = false
    req.on('data', c => {
      if (asti) return
      s += c
      if (s.length > max) { asti = true; resolve(null) }
    })
    req.on('end', () => { if (!asti) resolve(s) })
    req.on('error', () => { if (!asti) { asti = true; resolve(null) } })
  })
}
function rateLimit(key, max, windowMs) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    buckets.set(key, { n: 1, resetAt: now + windowMs })
    return true
  }
  b.n++
  return b.n <= max
}
// kullanıcı hatası (409 vb.) limit hakkı yememeli — tüketilen hakkı geri ver
function rateRefund(key) {
  const b = buckets.get(key)
  if (b && b.n > 0) b.n--
}
setInterval(() => {
  const now = Date.now()
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k)
}, 60_000).unref()

function clientIp(req) {
  // Cloudflare arkasındayız: XFF'in ilk token'ı CF edge IP'si olabiliyor (tüm oyuncular
  // aynı bucket'ı paylaşır → herkes 429 yer). cf-connecting-ip her zaman gerçek oyuncu IP'si.
  const cf = String(req.headers['cf-connecting-ip'] || '').trim()
  if (cf) return cf
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return xf || req.socket.remoteAddress || '?'
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

async function handleApi(req, res, url) {
  if (!pool) return json(res, 503, { error: 'Sunucuda veritabanı yapılandırılmamış.' })
  const auth = () => {
    const t = req.headers['x-auth'] || ''
    const email = verifyToken(String(t))
    if (!email) { json(res, 401, { error: 'Oturum geçersiz, tekrar giriş yap.' }); return null }
    return email
  }
  try {
    if (url === '/api/healthz') return json(res, 200, { ok: true })
    // ÖDÜLLÜ REKLAM API'si (server/reklam.js): bilet → SSV → claim. Kendi rate limit'leri var.
    if (url.startsWith('/api/ads/')) {
      const handled = await reklam.handle(req, res, url, {
        require: auth,
        peek: () => verifyToken(String(req.headers['x-auth'] || '')) || null,
      })
      if (handled) return
    }
    // MİSAFİR canlı varlık: hesapsız oyuncu 60 sn'de bir ping atar (sid = oturum uuid).
    // WS token istediğinden misafirler orada görünmez — bu hafif nabız anlık misafir sayısını verir.
    if (url === '/api/guest-ping' && req.method === 'POST') {
      if (!rateLimit('gping:' + clientIp(req), 5, 60_000)) return json(res, 200, { ok: true })
      const gb = await readBody(req).catch(() => ({}))
      const sid = String(gb.sid || '').slice(0, 64)
      if (sid) guestSeen.set(sid, Date.now())
      return json(res, 200, { ok: true })
    }
    // LEADERBOARD (Katman 4c): read-only sıralama — istasyon adı + servet + gün.
    // Mevcut save verisinden okunur (yeni tablo yok). 60 sn önbellek.
    // ---- SIRALAMA — TAMAMEN ANONİM (KVKK) ----
    // İstasyon adı oyuncunun yazdığı SERBEST METİN: isim, telefon, e-posta içerebilir.
    // Bu yüzden sunucu ADI HİÇ DÖNDÜRMEZ — dışarı yalnız sıra, tutar ve yıldız çıkar.
    // Oyuncu kendi sırasını görebilsin diye, geçerli oturum jetonu gönderirse O SATIR
    // `me:true` ile işaretlenir; kimse başkasının kim olduğunu öğrenemez.
    if (url === '/api/leaderboard' && req.method === 'GET') {
      const now = Date.now()
      if (!lbCache.data || now - lbCache.at > 60_000) {
        const r = await pool.query(`
          SELECT email,
                 COALESCE((save->'s'->>'money')::numeric, 0) AS money,
                 COALESCE((save->'s'->>'day')::int, 1) AS day,
                 COALESCE((save->'s'->>'brandStars')::int, 0) AS stars
          FROM benzinlik_player
          WHERE save IS NOT NULL AND banned_at IS NULL
          ORDER BY (COALESCE((save->'s'->>'money')::numeric, 0)
                    + COALESCE((save->'s'->>'brandStars')::int, 0) * 250000) DESC
          LIMIT 20`)
        // e-posta YALNIZ "bu satır sensin" eşlemesi için tutulur; asla yanıta yazılmaz.
        lbCache = { data: r.rows.map((x, i) => ({
          rank: i + 1, money: Math.round(Number(x.money)), day: x.day, stars: x.stars,
          _e: String(x.email || '').toLowerCase(),
        })), at: now }
      }
      const me = verifyToken(String(req.headers['x-auth'] || req.headers['authorization'] || '').replace(/^Bearer /, ''))
      const meLc = String(me || '').toLowerCase()
      const top = lbCache.data.map(x => {
        const row = { rank: x.rank, money: x.money, day: x.day, stars: x.stars }
        if (meLc && x._e === meLc) row.me = true
        return row
      })
      // oturum bazlı olduğu için ORTAK ÖNBELLEĞE alınamaz (başkasının "me" işareti sızmasın)
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      return res.end(JSON.stringify({ top }))
    }
    // ---- §9 ÖLÇÜM PLANI (lategame raporu) ----
    // Raporun sorduğu üç soru: (1) oyuncu kaçıncı günde DOYUYOR (para birikmeye başlıyor,
    // harcayacak yer kalmıyor), (2) nakit/varlık oranı — sink'ler işliyor mu, (3) D1/D7/D30.
    // Mevcut save verisinden hesaplanır: YENİ TABLO YOK, oyuncu kaydına DOKUNULMAZ.
    // Yalnız okuma; ADMIN_KEY ile korunur (kişisel veri dönmez, hepsi toplulaştırılmış).
    if (url === '/api/metrics' && req.method === 'GET') {
      const key = process.env.ADMIN_KEY
      if (!key || req.headers['x-admin-key'] !== key) {
        res.writeHead(403, { 'content-type': 'application/json' })
        return res.end(JSON.stringify({ error: 'forbidden' }))
      }
      const now = Date.now()
      if (!metricsCache.data || now - metricsCache.at > 300_000) {
        // Elde tuttuğumuz: her oyuncunun save'i (gün, para, ekipman) + zaman damgaları.
        const r = await pool.query(`SELECT save, created_at, last_seen_at FROM benzinlik_player
          WHERE save IS NOT NULL AND banned_at IS NULL`)
        const buckets = new Map()   // gün aralığı → { n, money[], ratio[] }
        const bucketOf = d => d < 8 ? '1-7' : d < 15 ? '8-14' : d < 31 ? '15-30' : d < 61 ? '31-60' : d < 121 ? '61-120' : '121+'
        let d1 = 0, d7 = 0, d30 = 0, eligible1 = 0, eligible7 = 0, eligible30 = 0
        for (const row of r.rows) {
          const s2 = row.save && row.save.s ? row.save.s : row.save
          if (!s2) continue
          const day = Number(s2.day) || 1
          const money = Number(s2.money) || 0
          const equip = buildingValue(s2) + snapshotsValue(s2) // servet tavanıyla AYNI hesap (şubeler dahil)
          const b = bucketOf(day)
          let e = buckets.get(b)
          if (!e) { e = { n: 0, money: [], ratio: [] }; buckets.set(b, e) }
          e.n++
          e.money.push(money)
          // nakit / (nakit + ekipman): 1'e yaklaşırsa harcayacak yer kalmamış demektir
          e.ratio.push(equip + money > 0 ? money / (equip + money) : 0)
          // tutulma: hesap açıldıktan N gün SONRA hâlâ görülmüş mü
          const age = (Date.now() - new Date(row.created_at).getTime()) / 86400000
          const seen = (new Date(row.last_seen_at).getTime() - new Date(row.created_at).getTime()) / 86400000
          if (age >= 1) { eligible1++; if (seen >= 1) d1++ }
          if (age >= 7) { eligible7++; if (seen >= 7) d7++ }
          if (age >= 30) { eligible30++; if (seen >= 30) d30++ }
        }
        const med = a => { if (!a.length) return 0; const x = [...a].sort((p, q) => p - q); return x[Math.floor(x.length / 2)] }
        const order = ['1-7', '8-14', '15-30', '31-60', '61-120', '121+']
        const progression = order.filter(k => buckets.has(k)).map(k => {
          const e = buckets.get(k)
          return { gun: k, oyuncu: e.n, medyanNakit: Math.round(med(e.money)),
                   nakitOrani: Number(med(e.ratio).toFixed(3)) }
        })
        // DOYGUNLUK: nakit oranının medyanı 0.5'i ilk aştığı gün aralığı — bu noktadan
        // sonra oyuncu parayı harcayamıyor demektir (raporun aradığı "doygunluk günü").
        const sat = progression.find(p => p.nakitOrani > 0.5)
        metricsCache = { at: now, data: {
          toplamOyuncu: r.rows.length,
          ilerleme: progression,
          doygunlukAraligi: sat ? sat.gun : null,
          // HİLE FRENİ: son kırpma/enjeksiyon olayları (bellekte, kalıcı tablo yok)
          hileFreni: {
            olay: cheatLog.length,
            son: cheatLog.slice(-15),
            hesapBasina: Object.entries(cheatLog.reduce((a, x) => {
              a[x.email] = (a[x.email] || 0) + 1; return a
            }, {})).sort((a, b) => b[1] - a[1]).slice(0, 10),
          },
          tutulma: {
            D1: eligible1 ? Number((d1 / eligible1).toFixed(3)) : null,
            D7: eligible7 ? Number((d7 / eligible7).toFixed(3)) : null,
            D30: eligible30 ? Number((d30 / eligible30).toFixed(3)) : null,
          },
        } }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify(metricsCache.data))
    }
    if (url === '/api/stats' && req.method === 'GET') {
      const now = Date.now()
      if (!statsCache.data || now - statsCache.at > 30_000) {
        const r = await pool.query(`SELECT count(*)::int AS players,
          count(*) FILTER (WHERE last_seen_at > now() - interval '5 min')::int AS online
          FROM benzinlik_player`)
        statsCache = { data: r.rows[0], at: now }
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=20' })
      return res.end(JSON.stringify(statsCache.data))
    }
    if (url === '/api/metric' && req.method === 'POST') {
      // Hafif huni/oturum sayacı — yalnız BEYAZ LİSTEDEKİ kolonlar (bumpStat kolon adı
      // enterpolasyonu yapıyor; whitelist dışı girdi ASLA geçmez). IP başına saatlik tavan.
      const mb = await readBody(req).catch(() => ({}))
      const ALLOWED = new Set(['gate_shown', 'gate_converted', 'ad_views', 'session_minutes', 'webgl_fail', 'steam_yes', 'steam_no', 'steam_skip'])
      const k = String((mb && mb.k) || '')
      // TRAFİK SAYACI: 1 değil TOPLAM yazar (istemci 5 dakikalık birikimi tek istekte
      // gönderir). Kolonlar bumpStatBy beyaz listesinden geçer; sayılar kırpılır.
      if (k === 'trafik') {
        if (rateLimit('metric:trafik:' + clientIp(req), 30, 3600_000)) {
          const n = v => Math.max(0, Math.min(1_000_000, Math.round(Number(v) || 0)))
          await bumpStatBy({
            trafik_icice: n(mb.icice), trafik_sikisan: n(mb.sikisan),
            trafik_bekleyen: n(mb.bekleyen), trafik_kurtarilan: n(mb.kurtarilan),
            trafik_ornek: n(mb.ornek),
          })
        }
        return json(res, 200, { ok: true })
      }
      if (ALLOWED.has(k) && rateLimit('metric:' + k + ':' + clientIp(req), 90, 3600_000)) bumpStat(k)
      return json(res, 200, { ok: true })
    }
    /**
     * TRAFİK OLAY KAYDI — anomali ANINDA sahnenin tam durumu (istemci: src/trafik-olay.ts).
     * Sınırlar: gövde > 16 KB → 413 · dakikada IP başına 2 istek → 429.
     * PII YOK: yalnız oyun durumu (kind/day/loc + araç konumları + yuvalar + yerleşim).
     */
    if (url === '/api/trafik-olay' && req.method === 'POST') {
      if (!rateLimit('trafikolay:' + clientIp(req), 2, 60_000)) return json(res, 429, { error: 'rate' })
      const raw = await readRawLimited(req, 16 * 1024)
      if (raw === null) return json(res, 413, { error: 'too big' })
      let o = null
      try { o = raw ? JSON.parse(raw) : null } catch { o = null }
      // 'kurtarma': bekçi bir aracı kilitten çıkardı (istemci: cars.ts BEKCI_*). En ağır
      // kayıt türü — sahne, sigortanın çektiği ANI içerir.
      const KINDS = new Set(['icice', 'sikisma', 'yigilma', 'kuyruk', 'kurtarma'])
      const kind = String((o && o.k) || '')
      if (!o || !KINDS.has(kind)) return json(res, 400, { error: 'kind' })
      const day = Math.max(0, Math.min(1_000_000, Math.round(Number(o.day) || 0)))
      const loc = String(o.loc || '').slice(0, 32)
      if (pool) {
        try {
          await pool.query(
            `INSERT INTO benzinlik_trafficlog(kind, day, loc, payload) VALUES ($1,$2,$3,$4)`,
            [kind, day, loc, JSON.stringify(o)])
        } catch { /* teşhis kaydı kritik değil — oyuncuya asla hata dönmez */ }
      }
      return json(res, 200, { ok: true })
    }
    if (url === '/api/visit' && req.method === 'POST') {
      if (rateLimit('visit:' + clientIp(req), 1, 30_000)) bumpStat('visits')
      // yeni MİSAFİR (client ilk kez oynamaya başladı, localStorage'da dedup'lı) → ekibe ayrı push.
      // IP başına saatte 1 ile spam engellenir (kötü niyetli çağrı da bunu aşamaz).
      const vb = await readBody(req).catch(() => ({}))
      if (vb && vb.guest === true && rateLimit('guestnotif:' + clientIp(req), 1, 3600_000)) {
        await bumpStat('guests') // misafir istatistiği: saatlik sayaç (admin engagement'ta görünür)
        // STACK (Oğuz): misafir push'u HER misafirde değil, her 10.'da bir gider
        // (toplam % 10 === 0). Kayıtlı oyuncu push'ları tekil kalır (aşağıda /register).
        try {
          const gc = await pool.query(`SELECT COALESCE(SUM(guests),0)::int AS n FROM benzinlik_stat_hourly`)
          const n = gc.rows[0]?.n ?? 0
          if (n > 0 && n % 10 === 0) pushSignupNotif('guest', n)
        } catch { /* sayaç okunamazsa push atlanır — kritik değil */ }
      }
      return json(res, 200, { ok: true })
    }
    if (url === '/api/config') {
      // REKLAM: AdMob kaldırıldı (3 Eyl 2026) → AppLovin MAX (native) + AdSense H5 (web).
      // Anahtarlar public: SDK key uygulama paketinde zaten görünür; gizli olan EVENT KEY buraya GİRMEZ.
      return json(res, 200, {
        adsClient: process.env.ADSENSE_PUB || null,
        ads: reklam ? reklam.publicConfig() : null,
        googleClientId: process.env.GOOGLE_WEB_CLIENT_ID || null, // web GIS için (public)
        appleServicesId: process.env.APPLE_SERVICES_ID || null,   // web Apple JS için (public)
        revenuecatIos: process.env.REVENUECAT_IOS_KEY || null,    // RevenueCat public SDK key (iOS) — IAP
      })
    }
    if (url === '/api/register' && req.method === 'POST') {
      const regBody = await readBody(req)
      const { email, password } = regBody
      const e = String(email || '').trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(e)) return json(res, 400, { error: 'Geçerli bir e-posta gir.' })
      if (String(password || '').length < 4) return json(res, 400, { error: 'Şifre en az 4 karakter olmalı.' })
      // limit validasyondan SONRA: yazım hatası deneme hakkı yemesin. CGNAT (mobil) IP'leri
      // yüzlerce kullanıcıyla paylaşıldığından limit gevşek tutuluyor.
      const regKey = 'reg:' + clientIp(req)
      if (!rateLimit(regKey, 20, 3600_000)) return json(res, 429, { error: 'Çok sık kayıt denemesi — biraz sonra tekrar dene.' })
      // atomik: yarış durumunda bile aynı e-posta ikinci kez ASLA açılmaz
      const ins = await pool.query(
        `INSERT INTO benzinlik_player(email, pass) VALUES ($1, $2)
         ON CONFLICT (email) DO NOTHING RETURNING id`,
        [e, hashPassword(String(password))],
      ).catch(err => {
        if (String(err.code) === '23505') return { rowCount: 0 }
        throw err
      })
      if (!ins.rowCount) { rateRefund(regKey); return json(res, 409, { error: 'Bu e-posta zaten kayıtlı — giriş yap.' }) }
      bumpStat('signups')
      if (regBody.guest === true) bumpStat('guest_signups') // misafir→kayıt DÖNÜŞÜMÜ (client: yerel misafir verisi vardı)
      pushSignupNotif() // fire-and-forget: ekibe "+1 oyuncu" push (asla signup'ı etkilemez)
      const vtok = randToken()
      await pool.query('UPDATE benzinlik_player SET verify_token=$2, signup_ip=$3, last_ip=$3 WHERE email=$1', [e, vtok, clientIp(req)]).catch(() => {})
      sendVerifyEmail(e, vtok, reqLang(req, regBody)) // fire-and-forget doğrulama maili
      return json(res, 200, { token: sign(e), email: e, emailVerified: false, verifyRequired: requireVerify() })
    }
    if (url === '/api/login' && req.method === 'POST') {
      const { email, password } = await readBody(req)
      const e = String(email || '').trim().toLowerCase()
      // e-posta+IP bazlı: CGNAT'ta komşunun denemeleri seni kilitlemesin; IP-geneli tavan
      // credential-stuffing'e karşı duruyor.
      if (!rateLimit('login:' + e + ':' + clientIp(req), 10, 900_000) ||
          !rateLimit('loginip:' + clientIp(req), 120, 3600_000)) {
        return json(res, 429, { error: 'Çok fazla deneme — biraz sonra tekrar dene.' })
      }
      const r = await pool.query('SELECT pass, banned_at, ban_reason, email_verified FROM benzinlik_player WHERE email=$1', [e])
      if (r.rowCount === 0 || !verifyPassword(String(password || ''), r.rows[0].pass)) {
        return json(res, 401, { error: 'E-posta veya şifre hatalı.' })
      }
      if (r.rows[0].banned_at) return bannedJson(res, e, r.rows[0].ban_reason)
      await pool.query('UPDATE benzinlik_player SET sessions=sessions+1, last_seen_at=now(), last_ip=$2 WHERE email=$1', [e, clientIp(req)])
      bumpStat('logins')
      return json(res, 200, { token: sign(e), email: e, emailVerified: !!r.rows[0].email_verified, verifyRequired: requireVerify() })
    }
    // Google ile giriş (web GIS id_token VEYA Capacitor-iOS native id_token — ikisi de kabul)
    if (url === '/api/auth/google' && req.method === 'POST') {
      if (!rateLimit('oauth:' + clientIp(req), 40, 3600_000)) return json(res, 429, { error: 'Çok fazla deneme — biraz sonra tekrar dene.' })
      if (!GOOGLE_CLIENT_IDS.length) return json(res, 503, { error: 'Google girişi sunucuda yapılandırılmamış.' })
      const body = await readBody(req)
      let p
      try {
        p = await verifyIdToken(body.idToken || body.credential, {
          jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
          issuers: ['accounts.google.com', 'https://accounts.google.com'],
          audiences: GOOGLE_CLIENT_IDS,
        })
      } catch (e) { console.log('[google] doğrulama hata:', e.message); return json(res, 401, { error: 'Google doğrulaması başarısız.' }) }
      if (p.email && p.email_verified === false) return json(res, 401, { error: 'Google e-postası doğrulanmamış.' })
      const row = await oauthUpsertPlayer('google', String(p.sub), p.email)
      if (row.banned_at) return bannedJson(res, row.email, row.ban_reason)
      if (body.guest === true) bumpStat('guest_signups') // misafir Google'la hesaba geçti → dönüşüm
      await pool.query('UPDATE benzinlik_player SET sessions=sessions+1, last_seen_at=now(), last_ip=$2 WHERE email=$1', [row.email, clientIp(req)])
      bumpStat('logins')
      return json(res, 200, { token: sign(row.email), email: row.email, emailVerified: true, verifyRequired: false })
    }
    // Apple ile giriş (web AppleID JS id_token VEYA Capacitor-iOS native identityToken)
    if (url === '/api/auth/apple' && req.method === 'POST') {
      if (!rateLimit('oauth:' + clientIp(req), 40, 3600_000)) return json(res, 429, { error: 'Çok fazla deneme — biraz sonra tekrar dene.' })
      if (!APPLE_CLIENT_IDS.length) return json(res, 503, { error: 'Apple girişi sunucuda yapılandırılmamış.' })
      const body = await readBody(req)
      let p
      try {
        p = await verifyIdToken(body.idToken || body.identityToken, {
          jwksUrl: 'https://appleid.apple.com/auth/keys',
          issuers: ['https://appleid.apple.com'],
          audiences: APPLE_CLIENT_IDS,
        })
      } catch (e) { console.log('[apple] doğrulama hata:', e.message); return json(res, 401, { error: 'Apple doğrulaması başarısız.' }) }
      // Apple e-postayı sadece ilk girişte gönderir; sonrakilerde sub yeterli
      const email = p.email || (body.email && /^\S+@\S+\.\S+$/.test(body.email) ? body.email : null)
      const row = await oauthUpsertPlayer('apple', String(p.sub), email)
      if (row.banned_at) return bannedJson(res, row.email, row.ban_reason)
      if (body.guest === true) bumpStat('guest_signups') // misafir Apple'la hesaba geçti → dönüşüm
      await pool.query('UPDATE benzinlik_player SET sessions=sessions+1, last_seen_at=now(), last_ip=$2 WHERE email=$1', [row.email, clientIp(req)])
      bumpStat('logins')
      return json(res, 200, { token: sign(row.email), email: row.email, emailVerified: true, verifyRequired: false })
    }
    if (url === '/api/send-verify' && req.method === 'POST') {
      const svBody = await readBody(req)
      const e = String(svBody.email || '').trim().toLowerCase()
      if (!rateLimit('verify:' + (e || clientIp(req)), 5, 3600_000)) return json(res, 429, { error: 'Çok sık deneme — biraz bekle.' })
      const r = await pool.query('SELECT email_verified FROM benzinlik_player WHERE email=$1', [e])
      if (r.rowCount === 0) return json(res, 200, { ok: true }) // e-posta varlığı sızdırılmaz
      if (r.rows[0].email_verified) return json(res, 200, { ok: true, already: true })
      const tok = randToken()
      await pool.query('UPDATE benzinlik_player SET verify_token=$2 WHERE email=$1', [e, tok])
      await sendVerifyEmail(e, tok, reqLang(req, svBody))
      return json(res, 200, { ok: true })
    }
    if ((url === '/api/verify' || url.startsWith('/api/verify/')) && req.method === 'GET') {
      // token path'ten (/api/verify/<token>) ya da geriye-dönük query'den
      const fromPath = url.startsWith('/api/verify/') ? decodeURIComponent(url.slice('/api/verify/'.length)) : ''
      const tok = fromPath || new URL(req.url, 'http://x').searchParams.get('token') || ''
      if (!tok) return htmlPage(res, 'Geçersiz bağlantı', 'Doğrulama kodu eksik.')
      const r = await pool.query('UPDATE benzinlik_player SET email_verified=true, verify_token=NULL WHERE verify_token=$1 RETURNING email', [tok])
      if (!r.rowCount) return htmlPage(res, 'Bağlantı geçersiz', 'Bu doğrulama bağlantısı geçersiz ya da zaten kullanılmış olabilir.')
      return htmlPage(res, 'E-posta doğrulandı ✓', 'Teşekkürler! Artık oyuna dönüp devam edebilirsin.')
    }
    if (url === '/api/change-email' && req.method === 'POST') {
      const email = auth(); if (!email) return
      const ceBody = await readBody(req)
      const ne = String(ceBody.newEmail || '').trim().toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(ne)) return json(res, 400, { error: 'Geçerli bir e-posta gir.' })
      if (ne === email) return json(res, 400, { error: 'Yeni e-posta eskisiyle aynı.' })
      if (!rateLimit('chgmail:' + email, 5, 3600_000)) return json(res, 429, { error: 'Çok sık deneme.' })
      const tok = randToken()
      const upd = await pool.query('UPDATE benzinlik_player SET email=$2, email_verified=false, verify_token=$3 WHERE email=$1', [email, ne, tok])
        .catch(err => { if (String(err.code) === '23505') return null; throw err })
      if (upd === null) return json(res, 409, { error: 'Bu e-posta zaten kullanımda.' })
      await sendVerifyEmail(ne, tok, reqLang(req, ceBody))
      return json(res, 200, { ok: true, token: sign(ne), email: ne, emailVerified: false, verifyRequired: requireVerify() })
    }
    if (url === '/api/request-reset' && req.method === 'POST') {
      const rrBody = await readBody(req)
      const e = String(rrBody.email || '').trim().toLowerCase()
      if (!rateLimit('reset:' + (e || clientIp(req)), 5, 3600_000)) return json(res, 429, { error: 'Çok sık deneme.' })
      const r = await pool.query('SELECT id FROM benzinlik_player WHERE email=$1', [e])
      if (r.rowCount) {
        const tok = randToken()
        await pool.query(`UPDATE benzinlik_player SET reset_token=$2, reset_expires=now()+interval '1 hour' WHERE email=$1`, [e, tok])
        await sendResetEmail(e, tok, reqLang(req, rrBody))
      }
      return json(res, 200, { ok: true }) // her durumda ok — e-posta varlığı sızdırılmaz
    }
    if (url === '/api/reset' && req.method === 'POST') {
      const { token, password } = await readBody(req)
      if (String(password || '').length < 4) return json(res, 400, { error: 'Şifre en az 4 karakter olmalı.' })
      const r = await pool.query('SELECT email FROM benzinlik_player WHERE reset_token=$1 AND reset_expires > now()', [String(token || '')])
      if (!r.rowCount) return json(res, 400, { error: 'Bağlantı geçersiz ya da süresi dolmuş.' })
      await pool.query('UPDATE benzinlik_player SET pass=$2, reset_token=NULL, reset_expires=NULL WHERE email=$1', [r.rows[0].email, hashPassword(String(password))])
      return json(res, 200, { ok: true })
    }
    if (url === '/api/feedback' && req.method === 'POST') {
      const email = auth(); if (!email) return
      if (!rateLimit('fb:' + email, 5, 3600_000)) return json(res, 429, { error: 'Çok sık bildirim — biraz sonra tekrar dene.' })
      const { message, game } = await readBody(req)
      const msg = String(message || '').trim().slice(0, 1000)
      if (msg.length < 3) return json(res, 400, { error: 'Mesaj çok kısa.' })
      const meta = game && typeof game === 'object' && !Array.isArray(game) ? game : null
      await pool.query('INSERT INTO benzinlik_feedback(email, message, game) VALUES ($1, $2, $3)', [email, msg, meta])
      return json(res, 200, { ok: true })
    }
    // İZAHAT: banlı (izahat) hesap savunmasını buraya yazar — admin panelinde listelenir.
    // auth() ban kontrolü yapmaz, bu bilinçli: kilitli hesabın TEK açık kanalı burası.
    if (url === '/api/appeal' && req.method === 'POST') {
      const email = auth(); if (!email) return
      if (!rateLimit('appeal:' + email, 3, 3600_000)) return json(res, 429, { error: 'Çok sık deneme — biraz sonra tekrar dene.' })
      // YALNIZ İZAHAT-BANLI HESAP YAZABİLİR. Ban kontrolünün yokluğu "kilitli hesabın tek
      // kanalı" niyetiyle konmuştu ama yan etkisi şuydu: banlı OLMAYAN herkes admin paneline
      // serbestçe mesaj yazabiliyordu. 2 Ağu'da bir hesap (kisalt8) ban yemeden önce buradan
      // panele "test appeal 123" → <svg onload=…> XSS payload'u → 400 karakter dolgu gönderdi
      // (son ikisi 395 ms arayla — script). Panelin girdi yüzeyi banlı hesaplarla sınırlandı.
      // ban_reason='kalici' de dışarıda: izahatı reddedilen hesap formu bir daha AÇMAZ.
      const st = await pool.query('SELECT banned_at, ban_reason FROM benzinlik_player WHERE email=$1', [email])
      if (!st.rows[0]?.banned_at || st.rows[0].ban_reason !== 'izahat') {
        return json(res, 403, { error: 'Bu hesap için izahat kanalı açık değil.' })
      }
      const { message } = await readBody(req)
      const msg = String(message || '').trim().slice(0, 2000)
      if (msg.length < 10) return json(res, 400, { error: 'İzahat çok kısa — lütfen durumu açıklayın.' })
      await pool.query('INSERT INTO benzinlik_appeal(email, message) VALUES ($1, $2)', [email, msg])
      return json(res, 200, { ok: true })
    }
    if (url === '/api/save' && req.method === 'GET') {
      const email = auth(); if (!email) return
      const r = await pool.query('SELECT save, updated_at, created_at, banned_at, ban_reason, email_verified FROM benzinlik_player WHERE email=$1', [email])
      if (staleToken(req, r.rows[0]?.created_at)) return json(res, 401, { error: 'Oturum geçersiz, tekrar giriş yap.' })
      if (r.rows[0]?.banned_at) return bannedJson(res, email, r.rows[0].ban_reason)
      // tek-cihaz kilidi: yükleyen cihaz oturumu DEVRALIR (session_id claim) → eski cihaz kick olur
      const sess = String(req.headers['x-session'] || '')
      if (sess) await pool.query('UPDATE benzinlik_player SET last_seen_at=now(), session_id=$2 WHERE email=$1', [email, sess])
      else await pool.query('UPDATE benzinlik_player SET last_seen_at=now() WHERE email=$1', [email])
      return json(res, 200, { save: r.rows[0]?.save ?? null, updatedAt: r.rows[0]?.updated_at ?? null, emailVerified: !!r.rows[0]?.email_verified, verifyRequired: requireVerify() })
    }
    if (url === '/api/save' && req.method === 'POST') {
      const email = auth(); if (!email) return
      // 1/3sn çok sıkıydı: otomatik kayıttan hemen sonra gelen ÇIKIŞ kaydı (pagehide) 429 yiyip
      // sessizce düşüyordu → oyuncu "kaydedip çıkamıyorum" diyor. 2/3sn hem abuse'a kapalı hem
      // son durumu garantiler.
      if (!rateLimit('save:' + email, 2, 3_000)) return json(res, 429, { error: 'rate' })
      const { save, baseUpdatedAt } = await readBody(req)
      const clean = sanitizeSave(save)
      if (clean === undefined) return json(res, 400, { error: 'Geçersiz kayıt verisi.' })
      let adCreditUsed = 0 // bu save'de tüketilen reklam kredisi (UPDATE'te atomik düşülür)
      const prev = await pool.query('SELECT save, updated_at, created_at, banned_at, session_id, save_session, ad_credit, ad_credit_at FROM benzinlik_player WHERE email=$1', [email])
      if (staleToken(req, prev.rows[0]?.created_at)) return json(res, 401, { error: 'Oturum geçersiz, tekrar giriş yap.' })
      if (prev.rows[0]?.banned_at) return json(res, 403, { error: 'Bu hesap askıya alınmış.' })
      // tek-cihaz kilidi: başka cihaz oturumu devraldıysa bu (eski) cihaz YAZMASIN → kicked.
      // Bağlantı kopması yanlış kick yapmaz: session yalnız BAŞKA cihaz GET/POST yapınca değişir.
      const sess = String(req.headers['x-session'] || '')
      const dbSess = prev.rows[0]?.session_id
      if (sess && dbSess && dbSess !== sess) return json(res, 200, { kicked: true })
      // çoklu cihaz guard: bu istemci save'i yükledikten SONRA başka cihaz yazdıysa çakışma —
      // clobber etme, istemciye güncel kaydı dön (ilerleme karışmaz, senkronlanır).
      if (baseUpdatedAt && prev.rows[0]?.updated_at) {
        const serverTs = new Date(prev.rows[0].updated_at).getTime()
        const baseTs = new Date(baseUpdatedAt).getTime()
        // SELF-CONFLICT ÖNLEME: son yazan AYNI oturum ise bu eski değil, kendi yazımızdır
        // (pagehide keepalive'ın yanıtı istemciye ulaşmadıysa baseUpdatedAt geride kalıyordu
        //  → sahte 409 → "Başka cihazda oynanmış" reload'u). Farklı oturum yazdıysa gerçek çakışma.
        const sameSession = sess && prev.rows[0]?.save_session === sess
        if (Number.isFinite(serverTs) && Number.isFinite(baseTs) && serverTs > baseTs + 1000 && !sameSession) {
          return json(res, 409, { conflict: true, save: prev.rows[0].save, updatedAt: prev.rows[0].updated_at })
        }
      }
      // makullük (hile freni): SERVET = para + bina değeri, geçen süreye göre imkânsız
      // hızda artamaz. Satın alma servet-nötr (para↓ bina↑) → sadece KAZANÇ serveti
      // artırır. Böylece PARA ve İLERLEME (bina/seviye/day) enjeksiyonu tek tavanla kapanır.
      // Offline kazanç da elapsed×600 payı içinde kaldığından bu tavandan sorunsuz geçer.
      if (clean && clean.s && typeof clean.s === 'object') {
        const START_MONEY = 5000
        const prevSave = prev.rows[0]?.save
        // yeni hesabın İLK save'i (misafirden taşınmış olabilir): elapsed≈0 olur ama oyuncu misafirken
        // gerçekte GUEST_MAX_DAY(5)'e kadar oynamış olabilir → tavanı OYUN GÜNÜNE göre ver, wall-clock'a değil.
        const firstSave = !(prevSave && prevSave.s)
        const sinceTs = prev.rows[0]?.updated_at || prev.rows[0]?.created_at
        const elapsed = sinceTs ? Math.max(1, (Date.now() - new Date(sinceTs).getTime()) / 1000) : 1
        const gameDays = (typeof clean.s.day === 'number') ? Math.min(Math.max(0, clean.s.day), 8) : 0 // misafir eşiği 5 + tampon
        // İlk-save (misafirden taşınan) tavanı SIKI: legit gün-5 misafiri ~50-100k yapar.
        // Eski gün×400k tavanı localStorage'ı elle şişiren hilecinin 1.86M'sini geçirdi (furkan123 vakası).
        // Marka yıldızı (prestij) geliri kalıcı çarpar; tavan da aynı oranda genişlemeli,
        // yoksa devretmiş oyuncunun meşru geliri "imkânsız artış" sanılıp kırpılır.
        // GÜVENLİK: yıldız istemci alanı → DOĞRULANIR, yoksa tavan ×11 yapılıp para enjekte edilir.
        //  • ilk save'de (yeni/misafirden taşınan hesap) prestij YOK sayılır
        //  • yıldız, önceki save'in yıldızından en fazla +1 olabilir (devir tek tek yapılır)
        const prevStars = Math.max(0, Math.min(40, Number(prevSave?.s?.brandStars) || 0))
        let stars = Math.max(0, Math.min(40, Number(clean.s.brandStars) || 0))
        // KAYDEDİLEN DEĞER de düzeltilir — yalnız allowance'ı düzeltmek yetmiyordu: ilk save
        // 40 yıldızı SQL'e yazınca sonraki save'lerde prevStars=40 olup doğrulama anlamsızlaşıyordu.
        if (firstSave) { stars = 0; clean.s.brandStars = 0 }
        else if (stars > prevStars + 1) {
          // artış +1'den büyük olamaz (devir tek tek yapılır) → kırp + LOGLA
          pool.query('INSERT INTO benzinlik_starlog(email, prev, next, kind) VALUES ($1,$2,$3,$4)',
            [email, prevStars, stars, 'clamp-artis']).catch(() => {})
          stars = prevStars; clean.s.brandStars = prevStars
        } else if (stars < prevStars) {
          // YILDIZ MONOTONIK — ASLA AZALMAZ (Oğuz vakası 29 Tem: bayat sekme/kayıt eski
          // stars'ı yazınca yıldızlar siliniyordu; azalış hiç doğrulanmıyordu). Meşru
          // sıfırlama pushSave(null) üzerinden firstSave yolunu kullanır.
          pool.query('INSERT INTO benzinlik_starlog(email, prev, next, kind) VALUES ($1,$2,$3,$4)',
            [email, prevStars, stars, 'azalis-engellendi']).catch(() => {})
          stars = prevStars; clean.s.brandStars = prevStars
          if (typeof clean.s.handoverCount === 'number') clean.s.handoverCount = Math.max(clean.s.handoverCount, prevStars)
        } else if (stars === prevStars + 1) {
          pool.query('INSERT INTO benzinlik_starlog(email, prev, next, kind) VALUES ($1,$2,$3,$4)',
            [email, prevStars, stars, 'devir']).catch(() => {})
        }
        // handoverCount de yıldızla tutarlı olmalı (kurcalanmış save ile eşik atlanmasın)
        if (typeof clean.s.handoverCount === 'number') clean.s.handoverCount = Math.min(clean.s.handoverCount, clean.s.brandStars)
        const starMult = prestigeStarMult(stars) // istemci prestigeStarMult ile BİREBİR (gelir × akış)
        // JETON KOVASI: allowance artık push BAŞINA değil ZAMAN başına birikiyor.
        // Kova save içinde taşınır (_ab, sunucu-sahipli alan); istemci kurcalarsa
        // aşağıda clamp'lenir. Böylece hızlı push spam'i bedava para getirmez —
        // 40 push/dakika ile 1 push/dakika aynı toplam allowance'ı verir.
        const rate = maxIncomeRate(clean.s)
        const prevAb = (prevSave && prevSave.s && prevSave.s._ab) || null
        const abT = prevAb && typeof prevAb.t === 'number' ? prevAb.t : 0
        const kova = burstCap(clean.s)   // şube sayısına göre büyüyen tavan
        const abB = prevAb && typeof prevAb.b === 'number' ? clamp(prevAb.b, 0, kova, 0) : kova
        const nowMs = Date.now()
        const refillSec = abT > 0 ? Math.max(0, (nowMs - abT) / 1000) : elapsed
        let bucket = Math.min(kova, abB + refillSec * rate)
        // REKLAM KREDİSİ: sunucu onaylı ödül (reklam.js grant) benzinlik_player.ad_credit'te bekler.
        // Kovanın ÜSTÜNE eklenir ve kazançtan ÖNCE tüketilir; 48 saatte söner (unutulmuş ödül
        // sonsuza dek hile tamponu olmasın). Kova+kredi tavanı = normal oyunun görebileceği en fazla.
        const creditAt = prev.rows[0]?.ad_credit_at ? new Date(prev.rows[0].ad_credit_at).getTime() : 0
        const credit0 = (!firstSave && creditAt > 0 && nowMs - creditAt < 48 * 3600_000)
          ? clamp(Number(prev.rows[0]?.ad_credit), 0, 50_000_000, 0) : 0
        let creditUsed = 0
        const allowance = firstSave
          ? (60_000 + gameDays * 40_000) * starMult   // misafirden taşınan ilk save: serbest
          : bucket + credit0
        const prevWealth = (prevSave && prevSave.s)
          ? (Number(prevSave.s.money) || 0) + buildingValue(prevSave.s) + snapshotsValue(prevSave.s)
          : START_MONEY
        const bval = buildingValue(clean.s) + snapshotsValue(clean.s)
        let money = Number(clean.s.money) || 0
        // REGRESYON GUARD'ı: İLERLEMİŞ kaydın üstüne "taze başlangıç" save'i YAZILAMAZ.
        // (Misafir Gün-1 state'i taşıyan istemci login sonrası bulut kaydını eziyordu —
        //  baseUpdatedAt=null olduğundan çoklu-cihaz 409 guard'ı bypass oluyordu.)
        // Meşru sıfırlama pushSave(null) kullanır (save=NULL) → sonraki push firstSave sayılır, serbest.
        if (!firstSave) {
          const prevDay = Number(prevSave.s.day) || 1
          const newDay = Number(clean.s.day) || 1
          const newWealth = money + bval
          const prevBval = buildingValue(prevSave.s)
          // (1) TAZE BAŞLANGIÇ hiçbir ilerlemenin üstüne yazılamaz — eski eşik (gün>=5 VE
          //     servet>50k) yeni/erken hesapları korumuyordu: gün-3 / 25k oyuncu gün-1'e
          //     düşüyordu ("baştan başladım" şikâyetinin kökü).
          const freshStart = newDay <= 2 && bval <= 0 && newWealth <= START_MONEY * 1.5
          const hasProgress = prevDay > 1 || prevBval > 0 || prevWealth > START_MONEY
          if (freshStart && hasProgress) {
            return json(res, 409, { conflict: true, save: prevSave, updatedAt: prev.rows[0]?.updated_at || null })
          }
          // (2) GERİ GİDİŞ: gün geriye gidiyor ve servet yarıdan aza düşüyorsa bu eski/donuk
          //     bir sekmenin state'idir (oyunda gün asla azalmaz) → clobber etme.
          if (newDay < prevDay - 1 && newWealth < prevWealth * 0.5) {
            return json(res, 409, { conflict: true, save: prevSave, updatedAt: prev.rows[0]?.updated_at || null })
          }
        }
        // TEŞHİS (feedback 566/900-902 'tesislerim yok oldu'): yıldız değişmeden bina
        // değeri yarıdan fazla düşen save şüphelidir (bayat sekme / bozuk state).
        // BLOKLAMAZ (devir/haciz meşru düşüş yaratır) — sadece denetim kaydına düşer.
        if (!firstSave) {
          const prevBv = buildingValue(prevSave.s)
          if (prevBv > 20_000 && bval < prevBv * 0.5 && stars === prevStars) {
            auditCheat(email, 'bval-drop', { prev: Math.round(prevBv), next: Math.round(bval) })
          }
        }
        let clamped = 0
        if (money + bval > prevWealth + allowance) {
          // fazlalığı önce paradan düş (para enjeksiyonu / hızlı kazanç freni)
          const excess = (money + bval) - (prevWealth + allowance)
          clamped = excess
          money = Math.max(0, money - excess)
          clean.s.money = Math.round(money)
          // bina değeri tek başına tavanı aşıyorsa = bina/seviye ENJEKSİYONU → reddet, öncekini koru.
          if (money + bval > prevWealth + allowance + 250_000) {
            auditCheat(email, 'inject', { excess: Math.round(excess), rate: Math.round(rate) })
            return json(res, 409, { conflict: true, save: prevSave || null, updatedAt: prev.rows[0]?.updated_at || null })
          }
        }
        if (!firstSave) {
          // HARCANAN JETON: kabul edilen servet artışı kovadan düşülür. Kova bittiğinde
          // oyuncu ancak zamanla dolduğu kadar kazanabilir (push sıklığı işe yaramaz).
          const gain = Math.max(0, (money + bval) - prevWealth)
          creditUsed = Math.min(credit0, gain)          // önce reklam kredisi, sonra kova
          bucket = Math.max(0, bucket - (gain - creditUsed))
          if (clamped > 5000) auditCheat(email, 'clamp', { clamped: Math.round(clamped), rate: Math.round(rate) })
          // REKLAM BÜTÇESİ: aktif kazanç (reklam kredisi HARİÇ) UTC gün sayacına işlenir (reklam.js)
          if (reklam) reklam.noteGain(email, gain - creditUsed)
        }
        clean.s._ab = { t: nowMs, b: Math.round(bucket) }
        adCreditUsed = Math.round(creditUsed)
        // day (ilerleme) hız freni: gün ~160sn/oyun-günü hızında ilerler. İlk save'de misafir eşiğine (5+tampon) izin.
        if (typeof clean.s.day === 'number') {
          const prevDay = (prevSave && prevSave.s && typeof prevSave.s.day === 'number') ? prevSave.s.day : 1
          const maxDay = firstSave ? Math.max(prevDay + 3, 8) : prevDay + Math.ceil(elapsed / 160) + 3
          if (clean.s.day > maxDay) clean.s.day = maxDay
        }
      }
      // save yazarken oturumu da bu cihaza sabitle (session_id null'sa claim et)
      // ad_credit ATOMİK düşülür (GREATEST): SELECT ile UPDATE arasında gelen bir grant ezilmez.
      const upd = await pool.query('UPDATE benzinlik_player SET save=$2, updated_at=now(), last_seen_at=now(), session_id=COALESCE($3, session_id), save_session=COALESCE($3, save_session), ad_credit=GREATEST(0, ad_credit - $4) WHERE email=$1 RETURNING updated_at', [email, clean, sess || null, adCreditUsed])
      return json(res, 200, { ok: true, updatedAt: upd.rows[0]?.updated_at })
    }
    // IAP efektini SUNUCU-otoriter uygula (hile-freni cap'ini bypass eder; sonraki save tutarlı olur).
    // TODO(prod): App Store receipt doğrulaması ekle (şu an demo: client bildirimini uygular).
    if (url === '/api/iap' && req.method === 'POST') {
      const email = auth(); if (!email) return
      const { productId, transactionId } = await readBody(req)
      const COINS = { coins_5k: 5000, coins_20k: 20000, coins_75k: 75000 }
      if (productId !== 'remove_ads' && !COINS[productId]) return json(res, 400, { error: 'Geçersiz ürün.' })

      // ---- Güvenlik: satın almayı RevenueCat ile doğrula + transaction dedup (replay önleme) ----
      // REVENUECAT_SECRET_KEY set ise PROD modu: doğrulanmadan asla verilmez (fail-closed).
      // Key yoksa (pre-launch/dev) eski davranış korunur ama uyarı loglanır.
      const RC_SECRET = process.env.REVENUECAT_SECRET_KEY || ''
      if (RC_SECRET) {
        // consumable (coins): transactionId zorunlu + dedup (replay önleme)
        if (productId !== 'remove_ads') {
          if (!transactionId) return json(res, 400, { error: 'transactionId gerekli.' })
          const dup = await pool.query('SELECT 1 FROM benzinlik_iap_grant WHERE transaction_id=$1', [String(transactionId)])
          if (dup.rowCount > 0) {
            const cur = await pool.query('SELECT save FROM benzinlik_player WHERE email=$1', [email])
            const s0 = cur.rows[0]?.save?.s || {}
            return json(res, 200, { ok: true, already: true, money: Math.round(Number(s0.money) || 0), noAds: !!s0.noAds })
          }
        }
        // RevenueCat'te bu app_user_id (= email) altında satın alma gerçekten var mı?
        let sub = null
        try {
          const rcRes = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(email)}`,
            { headers: { Authorization: `Bearer ${RC_SECRET}` } })
          if (rcRes.ok) sub = (await rcRes.json())?.subscriber
        } catch (e) { console.error('RevenueCat doğrulama hatası:', e) }
        if (!sub) return json(res, 502, { error: 'Satın alma doğrulanamadı (RevenueCat).' })
        if (productId === 'remove_ads') {
          const ent = sub.entitlements || {}
          const ok = !!(ent.remove_ads || ent.no_ads || ent.premium) || Array.isArray(sub.non_subscriptions?.remove_ads)
          if (!ok) return json(res, 403, { error: 'Satın alma bulunamadı/doğrulanamadı.' })
          // non-consumable → tekrar vermek zararsız (idempotent), dedup kaydı gerekmez
        } else {
          const arr = sub.non_subscriptions?.[productId]
          const ok = Array.isArray(arr) && arr.some(x => x && (x.store_transaction_id === transactionId || x.id === transactionId))
          if (!ok) return json(res, 403, { error: 'Satın alma bulunamadı/doğrulanamadı.' })
          const ins = await pool.query(
            'INSERT INTO benzinlik_iap_grant(transaction_id, email, product_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
            [String(transactionId), email, String(productId)])
          if (ins.rowCount === 0) return json(res, 200, { ok: true, already: true })
        }
      } else {
        // FAIL-CLOSED (4 Ağu, ID 2432 vakası: gün-5 hesabında ₺70M): anahtar yokken
        // uç DOĞRULAMASIZ para basıyordu — herkes curl ile sınırsız coin alabiliyordu.
        // Artık anahtar yoksa GRANT YOK. Dev/test için IAP_ALLOW_UNVERIFIED=1 gerekir.
        if (process.env.IAP_ALLOW_UNVERIFIED !== '1') {
          console.warn('[IAP] REVENUECAT_SECRET_KEY yok → grant REDDEDİLDİ', email, productId)
          auditCheat(email, 'iap-unverified', { productId: String(productId) })
          return json(res, 503, { error: 'Satın alma doğrulaması yapılandırılmamış — destekle iletişime geç.' })
        }
        console.warn('[IAP] DOĞRULAMASIZ grant açık (IAP_ALLOW_UNVERIFIED=1) — yalnız dev ortamı!')
      }
      // Coin paketlerinde replay freni anahtar olmasa da çalışsın (dev modda bile)
      if (productId !== 'remove_ads' && transactionId) {
        const dup2 = await pool.query('SELECT 1 FROM benzinlik_iap_grant WHERE transaction_id=$1', [String(transactionId)])
        if (dup2.rowCount > 0) return json(res, 200, { ok: true, already: true })
      }
      // hız freni: normal oyuncu saatte 5'ten fazla IAP tamamlamaz
      if (!rateLimit('iap:' + email, 5, 3600_000)) {
        auditCheat(email, 'iap-flood', { productId: String(productId) })
        return json(res, 429, { error: 'Çok fazla satın alma denemesi — biraz sonra tekrar dene.' })
      }

      const r = await pool.query('SELECT save FROM benzinlik_player WHERE email=$1', [email])
      const save = r.rows[0]?.save || { s: {} }; save.s = save.s || {}
      if (productId === 'remove_ads') save.s.noAds = true
      else save.s.money = Math.round((Number(save.s.money) || 0) + COINS[productId])
      await pool.query('UPDATE benzinlik_player SET save=$2, updated_at=now() WHERE email=$1', [email, JSON.stringify(save)])
      return json(res, 200, { ok: true, money: Math.round(Number(save.s.money) || 0), noAds: !!save.s.noAds })
    }
    // App Store 5.1.1(v): kullanıcı kendi hesabını uygulama içinden silebilmeli
    if (url === '/api/account' && req.method === 'DELETE') {
      const email = auth(); if (!email) return
      await pool.query('DELETE FROM benzinlik_player WHERE email=$1', [email])
      return json(res, 200, { ok: true })
    }
    json(res, 404, { error: 'not found' })
  } catch (err) {
    console.error(err)
    json(res, 500, { error: 'Sunucu hatası.' })
  }
}

// ---- VentureStudio paneli (/vs/v1): admin.benerits.com bu uçları Bearer key ile çeker ----
const VS_KEY = process.env.VS_API_KEY || ''

function vsAuth(req, res) {
  const h = String(req.headers.authorization || '')
  if (!VS_KEY || h !== `Bearer ${VS_KEY}`) {
    json(res, 401, { error: { code: 'unauthorized', message: 'Bearer eksik ya da hatalı.' } })
    return false
  }
  return true
}

function userRow(r) {
  const st = r.save?.s ?? {}
  // kayıt kaynağı: google_id/apple_id doluysa sosyal giriş, yoksa e-posta+şifre
  const provider = r.google_id ? 'google' : r.apple_id ? 'apple' : 'password'
  return {
    id: String(r.id),
    email: r.email,
    name: st.stationName || null,
    avatarUrl: null,
    country: null,
    plan: 'free',
    source: r.google_id ? 'gmail' : r.apple_id ? 'apple' : 'email',
    authProvider: provider,
    github: null,
    signedUpAt: r.created_at,
    lastSeenAt: r.last_seen_at ?? null,
    sessions: r.sessions ?? 0,
    ltvCents: 0,
    currency: 'USD',
    bannedAt: r.banned_at ?? null,
    coins: typeof st.money === 'number' ? Math.round(st.money) : 0,
    metadata: {
      day: st.day ?? 1,
      pumps: st.pumps ?? 1,
      reputation: st.reputation ?? 3,
      served: st.stats?.served ?? 0,
      parcels: Array.isArray(st.ownedParcels) ? st.ownedParcels.length : 1,
      paved: Array.isArray(st.pavedParcels) ? st.pavedParcels.length : 1,
    },
  }
}

async function handleVs(req, res, url) {
  if (!pool) return json(res, 503, { error: { code: 'no_db', message: 'DB yok.' } })
  if (!vsAuth(req, res)) return
  const u = new URL(req.url, 'http://x')
  try {
    if (url === '/vs/v1/users/metrics' && req.method === 'GET') {
      const days = { '7d': 7, '30d': 30, '90d': 90 }[u.searchParams.get('window') || '30d'] || 30
      const q = await pool.query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE last_seen_at > now() - $1::interval)::int AS active,
          count(*) FILTER (WHERE last_seen_at > now() - ($1::interval * 2) AND last_seen_at <= now() - $1::interval)::int AS active_prev,
          count(*) FILTER (WHERE created_at > now() - $1::interval)::int AS news,
          count(*) FILTER (WHERE created_at > now() - ($1::interval * 2) AND created_at <= now() - $1::interval)::int AS news_prev
        FROM benzinlik_player`, [`${days} days`])
      const r = q.rows[0]
      const delta = (v, p) => (p > 0 ? Math.round(((v - p) / p) * 1000) / 10 : (v > 0 ? 100 : 0))
      return json(res, 200, {
        window: `${days}d`,
        activeUsers: { value: r.active, previous: r.active_prev, deltaPct: delta(r.active, r.active_prev) },
        newSignups: { value: r.news, previous: r.news_prev, deltaPct: delta(r.news, r.news_prev) },
        paidUsers: { value: 0, previous: 0, deltaPct: 0 },
        totalUsers: r.total,
        asOf: new Date().toISOString(),
      })
    }
    if (url === '/vs/v1/users' && req.method === 'GET') {
      const limit = Math.min(5000, Math.max(10, Number(u.searchParams.get('limit')) || 50))
      const cursor = Number(Buffer.from(u.searchParams.get('cursor') || '', 'base64url').toString() || 0) || 0
      const search = (u.searchParams.get('q') || '').toLowerCase()
      const sort = u.searchParams.get('sort') || 'signed_up_desc'
      const order = sort === 'last_seen_desc' ? 'last_seen_at DESC NULLS LAST' : 'created_at DESC'
      const rows = await pool.query(`
        SELECT id, email, save, created_at, last_seen_at, sessions, banned_at, google_id, apple_id
        FROM benzinlik_player
        WHERE ($1 = '' OR lower(email) LIKE '%' || $1 || '%' OR lower(coalesce(save->'s'->>'stationName','')) LIKE '%' || $1 || '%')
        ORDER BY ${order} OFFSET $2 LIMIT $3`, [search, cursor, limit + 1])
      const page = rows.rows.slice(0, limit).map(userRow)
      const nextCursor = rows.rows.length > limit ? Buffer.from(String(cursor + limit)).toString('base64url') : null
      return json(res, 200, { data: page, nextCursor })
    }
    const m = url.match(/^\/vs\/v1\/users\/(\d+)(?:\/(ban|unban|balance|detail|restore|rawsave|live|verify-email))?$/)
    if (m) {
      const id = Number(m[1])
      const found = await pool.query('SELECT id, email, save, created_at, last_seen_at, sessions, banned_at, ban_reason, signup_ip, last_ip, google_id, apple_id FROM benzinlik_player WHERE id=$1', [id])
      if (found.rowCount === 0) return json(res, 404, { error: { code: 'not_found', message: 'Kullanıcı yok.' } })
      if (m[2] === 'detail' && req.method === 'GET') {
        // record bloğu için {data:{...}} — şemaya uygun kullanıcı detayı
        const r = found.rows[0]; const st = r.save?.s ?? {}
        return json(res, 200, { data: {
          email: r.email,
          source: r.google_id ? 'Gmail (Google ile giriş)' : r.apple_id ? 'Apple ile giriş' : 'E-posta + şifre',
          station: st.stationName || '—',
          balance: Math.round(Number(st.money) || 0),
          day: st.day ?? 1,
          pumps: st.pumps ?? 1,
          evChargers: st.evChargers ?? 0,
          parcels: Array.isArray(st.ownedParcels) ? st.ownedParcels.length : 1,
          paved: Array.isArray(st.pavedParcels) ? st.pavedParcels.length : 1,
          reputation: Math.round((Number(st.reputation) || 0) * 100) / 100,
          served: st.stats?.served ?? 0,
          kwh: Math.round(Number(st.stats?.kwh) || 0),
          revenue: Math.round(Number(st.stats?.revenue) || 0),
          sessions: r.sessions ?? 0,
          signedUp: r.created_at,
          lastSeen: r.last_seen_at ?? null,
          signupIp: r.signup_ip || '—',
          lastIp: r.last_ip || '—',
          status: r.banned_at ? `BANNED${r.ban_reason ? ' · ' + r.ban_reason : ''}` : 'Active',
        } })
      }
      if (m[2] === 'rawsave' && req.method === 'GET') {
        return json(res, 200, { data: found.rows[0].save ?? null }) // tam save (admin okuma)
      }
      if (m[2] === 'verify-email' && req.method === 'POST') {
        // admin: manuel e-posta doğrula (kilitli kalanı kurtarma supabı)
        const { verified } = await readBody(req)
        const val = verified === false ? false : true
        await pool.query('UPDATE benzinlik_player SET email_verified=$2, verify_token=NULL WHERE id=$1', [id, val])
        return json(res, 200, { data: { emailVerified: val } })
      }
      if (m[2] === 'live' && req.method === 'POST') {
        // WebSocket üzerinden anlık: bakiye / bildirim / hot-fix / reload
        const b = await readBody(req)
        const kind = b?.kind
        if (kind === 'balance') {
          const amt = Math.max(0, Math.round(Number(b.amount) || 0))
          const cur = Math.round(Number(found.rows[0].save?.s?.money) || 0)
          const next = b.op === 'set' ? amt : b.op === 'add' ? cur + amt : cur - amt
          if (next < 0 || !['set', 'add', 'subtract'].includes(String(b.op))) return json(res, 400, { error: { code: 'invalid_request', message: 'op: set|add|subtract' } })
          await pool.query(`UPDATE benzinlik_player SET save = jsonb_set(coalesce(save, '{}'::jsonb), '{s,money}', to_jsonb($2::int)) WHERE id=$1`, [id, next])
          const live = pushToUser(id, { type: 'balance', money: next, toast: b.toast || 'Bakiye güncellendi' })
          return json(res, 200, { data: { coins: next, live } })
        }
        if (kind === 'notify') {
          const title = String(b.title || 'BenelOil').slice(0, 80)
          const body = String(b.body || '').slice(0, 300)
          await pool.query('INSERT INTO beneloil_notification(user_id, title, body) VALUES ($1,$2,$3)', [id, title, body]).catch(() => {})
          const live = pushToUser(id, { type: 'notify', title, body })
          return json(res, 200, { data: { live } })
        }
        if (kind === 'patch') {
          const live = pushToUser(id, { type: 'patch', patch: b.patch || {} })
          return json(res, 200, { data: { live } })
        }
        if (kind === 'hotfix-fuel') {
          // tek tık: tankları doldur + takılı siparişleri temizle (hem DB hem canlı)
          const TANK_CAP = [800, 1500, 3000, 5000]
          const save = found.rows[0].save || {}
          save.s = save.s || {}
          const cap = TANK_CAP[Math.min(3, Number(save.s.tankLevel) || 0)]
          save.s.tanks = { ...(save.s.tanks || {}), benzin: cap, dizel: cap, lpg: cap }
          const clear = { pending: false, eta: 0, arrived: false, delivering: false }
          save.s.orders = { benzin: { ...clear }, dizel: { ...clear }, lpg: { ...clear } }
          await pool.query('UPDATE benzinlik_player SET save=$2 WHERE id=$1', [id, JSON.stringify(save)])
          const live = pushToUser(id, { type: 'patch', patch: { tanks: save.s.tanks, orders: save.s.orders } })
          return json(res, 200, { data: { live, tanks: save.s.tanks } })
        }
        if (kind === 'reload') {
          return json(res, 200, { data: { live: pushToUser(id, { type: 'reload' }) } })
        }
        return json(res, 400, { error: { code: 'invalid_request', message: 'kind: balance|notify|patch|reload' } })
      }
      if (m[2] === 'restore' && req.method === 'POST') {
        // yedekten tam save geri yükleme (admin) — override kazası kurtarma
        const body = await readBody(req)
        const save = body?.save
        if (!save || typeof save !== 'object') return json(res, 400, { error: { code: 'invalid_request', message: 'save gerekli.' } })
        await pool.query('UPDATE benzinlik_player SET save=$2 WHERE id=$1', [id, JSON.stringify(save)])
        const s = save.s || {}
        return json(res, 200, { data: { restored: true, day: s.day ?? null, station: s.stationName ?? null } })
      }
      if (m[2] === 'ban' && req.method === 'POST') {
        const { reason } = await readBody(req)
        const rsn = String(reason || '').slice(0, 300) || null
        await pool.query('UPDATE benzinlik_player SET banned_at=now(), ban_reason=$2 WHERE id=$1', [id, rsn])
        // CANLI ban: bağlı oturuma "banlandın" gönder + soketleri kapat
        pushToUser(id, { type: 'ban', reason: rsn || 'Terms of Service violation' })
        const set = liveSockets.get(Number(id))
        if (set) for (const ws of set) { try { ws.close() } catch {} }
      } else if (m[2] === 'unban' && req.method === 'POST') {
        await pool.query('UPDATE benzinlik_player SET banned_at=NULL, ban_reason=NULL WHERE id=$1', [id])
      } else if (m[2] === 'balance' && req.method === 'POST') {
        const { op, amount } = await readBody(req)
        const amt = Math.max(0, Math.round(Number(amount) || 0))
        const cur = Math.round(Number(found.rows[0].save?.s?.money) || 0)
        const next = op === 'set' ? amt : op === 'add' ? cur + amt : cur - amt
        if (next < 0 || !['set', 'add', 'subtract'].includes(String(op))) {
          return json(res, 400, { error: { code: 'invalid_request', message: 'Geçersiz işlem.' } })
        }
        await pool.query(`UPDATE benzinlik_player SET save = jsonb_set(coalesce(save, '{}'::jsonb), '{s,money}', to_jsonb($2::int)) WHERE id=$1`, [id, next])
        return json(res, 200, { data: { coins: next } })
      } else if (req.method === 'DELETE' && !m[2]) {
        await pool.query('DELETE FROM benzinlik_player WHERE id=$1', [id])
        res.writeHead(204)
        return res.end()
      } else if (req.method !== 'GET') {
        return json(res, 404, { error: { code: 'not_found', message: 'yok' } })
      }
      const fresh = await pool.query('SELECT id, email, save, created_at, last_seen_at, sessions, banned_at FROM benzinlik_player WHERE id=$1', [id])
      return json(res, 200, userRow(fresh.rows[0]))
    }
    // izahat kararı (admin satır aksiyonları): reject = KALICI ban (ban_reason='kalici'
    // → izahat formu bir daha AÇILMAZ, jenerik 'askıya alınmış' görür), approve = affet.
    if (url.startsWith('/vs/v1/appeals/') && req.method === 'POST') {
      const m = url.match(/^\/vs\/v1\/appeals\/(\d+)\/(reject|approve)$/)
      if (!m) return json(res, 404, { error: 'Unknown appeal action.' })
      const ap = await pool.query('SELECT email FROM benzinlik_appeal WHERE id=$1', [Number(m[1])])
      if (!ap.rowCount) return json(res, 404, { error: 'Appeal not found.' })
      const em = ap.rows[0].email
      if (m[2] === 'reject') {
        await pool.query(`UPDATE benzinlik_player SET banned_at=COALESCE(banned_at, now()), ban_reason='kalici' WHERE email=$1`, [em])
        return json(res, 200, { ok: true, action: 'PERMANENT BAN', email: em })
      }
      await pool.query('UPDATE benzinlik_player SET banned_at=NULL, ban_reason=NULL WHERE email=$1', [em])
      return json(res, 200, { ok: true, action: 'PARDONED', email: em })
    }
    // yıldız/devir geçmişi (admin Star Log sayfası çeker)
    if (url === '/vs/v1/starlog' && req.method === 'GET') {
      const r = await pool.query(`SELECT l.id, l.email, l.prev, l.next, l.kind, l.at,
          p.id AS player_id, (p.save->'s'->>'day')::int AS day
        FROM benzinlik_starlog l LEFT JOIN benzinlik_player p ON p.email = l.email
        ORDER BY l.at DESC LIMIT 500`)
      return json(res, 200, { data: r.rows })
    }
    // izahatlar: banlı hesapların savunmaları (admin.benerits.com İzahatlar sayfası çeker)
    if (url === '/vs/v1/steam-poll' && req.method === 'GET') {
      // STEAM ANKETİ SONUÇLARI (Oğuz 17 Ağu): admin custom-page bu tabloyu çizer.
      // İlk satır TOPLAM, altı gün gün kırılım.
      const r = await pool.query(`SELECT (hour AT TIME ZONE 'Europe/Istanbul')::date AS d,
          COALESCE(SUM(steam_yes),0)::int AS yes, COALESCE(SUM(steam_no),0)::int AS no,
          COALESCE(SUM(steam_skip),0)::int AS skip
        FROM benzinlik_stat_hourly
        WHERE steam_yes > 0 OR steam_no > 0 OR steam_skip > 0
        GROUP BY 1 ORDER BY 1 DESC LIMIT 60`)
      const pct = (y, n) => (y + n > 0 ? Math.round(100 * y / (y + n)) : 0)
      const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10))
      const tot = r.rows.reduce((a, x) => ({ yes: a.yes + x.yes, no: a.no + x.no, skip: a.skip + x.skip }), { yes: 0, no: 0, skip: 0 })
      const data = [{
        date: 'TOTAL', yes: tot.yes, no: tot.no, skipped: tot.skip,
        answered: tot.yes + tot.no, steam_rate: `${pct(tot.yes, tot.no)}%`,
      }, ...r.rows.map(x => ({
        date: iso(x.d), yes: x.yes, no: x.no, skipped: x.skip,
        answered: x.yes + x.no, steam_rate: `${pct(x.yes, x.no)}%`,
      }))]
      return json(res, 200, { data })
    }
    if (url === '/vs/v1/appeals' && req.method === 'GET') {
      const r = await pool.query(`SELECT a.id, a.email, a.message, a.created_at,
          p.id AS player_id, p.banned_at, p.ban_reason,
          (p.save->'s'->>'money')::numeric::bigint AS money, (p.save->'s'->>'day')::int AS day
        FROM benzinlik_appeal a LEFT JOIN benzinlik_player p ON p.email = a.email
        ORDER BY a.created_at DESC LIMIT 500`)
      return json(res, 200, { data: r.rows })
    }
    if (url === '/vs/v1/feedback' && req.method === 'GET') {
      const limit = Math.min(5000, Math.max(10, Number(u.searchParams.get('limit')) || 1000))
      const rows = await pool.query('SELECT id, email, message, game, created_at, status, resolved_note FROM benzinlik_feedback ORDER BY (status=\'open\') DESC, id DESC LIMIT $1', [limit])
      return json(res, 200, { data: rows.rows.map(r => ({
        id: String(r.id),
        email: r.email,
        message: r.message,
        durum: r.status === 'resolved' ? 'Çözüldü' : r.status === 'wontfix' ? 'Kapatıldı' : 'Açık',
        cozumNotu: r.resolved_note || '',
        gun: r.game?.day ?? null,
        kasa: r.game?.money ?? null,
        cihaz: (r.game?.ua || '').slice(0, 60),
        createdAt: r.created_at,
      })), nextCursor: null })
    }
    // Godot sürümünün geri bildirimleri: aynı üç eylem, artı tek kayıt (detay
    // sayfası) ve ekran görüntüsü bağlantısı.
    if (url === '/vs/v1/godot-feedback' && req.method === 'GET') {
      const limit = Math.min(5000, Math.max(10, Number(u.searchParams.get('limit')) || 1000))
      const durum = u.searchParams.get('durum')
      const where = durum === 'open' || durum === 'resolved' || durum === 'wontfix' ? `WHERE status='${durum}'` : ''
      const rows = await pool.query(`SELECT ${GODOT_FB_COLS} FROM beneloil_godot_feedback ${where} ORDER BY (status='open') DESC, id DESC LIMIT $1`, [limit])
      const base = publicBase(req)
      return json(res, 200, { data: rows.rows.map(r => godotFeedbackRow(r, base)), nextCursor: null })
    }
    const gfOne = url.match(/^\/vs\/v1\/godot-feedback\/(\d+)$/)
    if (gfOne && req.method === 'GET') {
      const r = await pool.query(`SELECT ${GODOT_FB_COLS} FROM beneloil_godot_feedback WHERE id=$1`, [Number(gfOne[1])])
      if (!r.rowCount) return json(res, 404, { error: { code: 'not_found', message: 'Kayıt yok.' } })
      return json(res, 200, { data: godotFeedbackRow(r.rows[0], publicBase(req)) })
    }
    const gfM = url.match(/^\/vs\/v1\/godot-feedback\/(\d+)\/(resolve|reopen|wontfix)$/)
    if (gfM && req.method === 'POST') {
      const id = Number(gfM[1]); const act = gfM[2]
      const body = await readBody(req).catch(() => ({}))
      if (act === 'resolve') {
        await pool.query('UPDATE beneloil_godot_feedback SET status=\'resolved\', resolved_note=$2, resolved_at=now() WHERE id=$1', [id, String(body.note || 'Çözüldü').slice(0, 300)])
      } else if (act === 'wontfix') {
        await pool.query('UPDATE beneloil_godot_feedback SET status=\'wontfix\', resolved_note=$2, resolved_at=now() WHERE id=$1', [id, String(body.note || '').slice(0, 300)])
      } else {
        await pool.query('UPDATE beneloil_godot_feedback SET status=\'open\', resolved_note=NULL, resolved_at=NULL WHERE id=$1', [id])
      }
      const r = await pool.query(`SELECT ${GODOT_FB_COLS} FROM beneloil_godot_feedback WHERE id=$1`, [id])
      return json(res, 200, { data: godotFeedbackRow(r.rows[0], publicBase(req)) })
    }
    const fbM = url.match(/^\/vs\/v1\/feedback\/(\d+)\/(resolve|reopen|wontfix)$/)
    if (fbM && req.method === 'POST') {
      const id = Number(fbM[1]); const act = fbM[2]
      const body = await readBody(req).catch(() => ({}))
      if (act === 'resolve') {
        await pool.query('UPDATE benzinlik_feedback SET status=\'resolved\', resolved_note=$2, resolved_at=now() WHERE id=$1', [id, String(body.note || 'Çözüldü').slice(0, 300)])
      } else if (act === 'wontfix') {
        await pool.query('UPDATE benzinlik_feedback SET status=\'wontfix\', resolved_note=$2, resolved_at=now() WHERE id=$1', [id, String(body.note || '').slice(0, 300)])
      } else {
        await pool.query('UPDATE benzinlik_feedback SET status=\'open\', resolved_note=NULL, resolved_at=NULL WHERE id=$1', [id])
      }
      const r = await pool.query('SELECT id, email, message, game, created_at, status, resolved_note FROM benzinlik_feedback WHERE id=$1', [id])
      const x = r.rows[0]
      return json(res, 200, { data: { id: String(x.id), durum: x.status === 'resolved' ? 'Çözüldü' : x.status === 'wontfix' ? 'Kapatıldı' : 'Açık', cozumNotu: x.resolved_note || '' } })
    }
    if (url === '/vs/v1/hourly-chart' && req.method === 'GET') {
      const metric = ['visits', 'signups', 'logins', 'guests'].includes(u.searchParams.get('y')) ? u.searchParams.get('y') : 'visits'
      const rows = await pool.query(`
        SELECT to_char(hour, 'HH24:00') AS x, ${metric}::int AS y
        FROM benzinlik_stat_hourly WHERE hour > now() - interval '24 hours' ORDER BY hour`)
      return json(res, 200, { data: rows.rows })
    }
    if (url === '/vs/v1/stats-hourly' && req.method === 'GET') {
      const rows = await pool.query(`
        SELECT to_char(hour, 'HH24:00') AS label, visits, signups, logins, guests
        FROM benzinlik_stat_hourly WHERE hour > now() - interval '24 hours' ORDER BY hour`)
      return json(res, 200, { data: rows.rows })
    }
    if (url === '/vs/v1/engagement' && req.method === 'GET') {
      // Sayısal alanlar ::numeric ile okunur: kayıtta kwh gibi alanlar ondalıklı gelebiliyor
      // ("59067.93…"), ::int bunu 22P02 ile patlatıp panelin tamamını 500'e düşürüyordu (2 Eyl).
      const agg = await pool.query(`
        SELECT
          coalesce(avg(sessions), 0)::float AS spu,
          count(*)::int AS total,
          count(*) FILTER (WHERE last_seen_at > now() - interval '5 min')::int AS active5m,
          count(*) FILTER (WHERE last_seen_at > now() - interval '1 hour')::int AS active1h,
          count(*) FILTER (WHERE last_seen_at > now() - interval '1 day')::int AS active1d,
          count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS new1d,
          count(*) FILTER (WHERE last_seen_at > created_at + interval '1 day')::int AS d1,
          count(*) FILTER (WHERE last_seen_at > created_at + interval '7 day')::int AS d7,
          count(*) FILTER (WHERE last_seen_at > created_at + interval '30 day')::int AS d30,
          coalesce(sum((save->'s'->'stats'->>'served')::numeric), 0)::bigint AS served,
          coalesce(sum((save->'s'->'stats'->>'kwh')::numeric), 0)::bigint AS kwh,
          coalesce(sum((save->'s'->'stats'->>'revenue')::numeric), 0)::bigint AS revenue,
          coalesce(round(avg((save->'s'->>'day')::numeric)), 0)::int AS avg_day,
          coalesce(max((save->'s'->>'day')::numeric), 0)::int AS max_day,
          coalesce(sum((save->'s'->'stats'->'liters'->>'benzin')::numeric), 0)::bigint AS l_benzin,
          coalesce(sum((save->'s'->'stats'->'liters'->>'dizel')::numeric), 0)::bigint AS l_dizel,
          coalesce(sum((save->'s'->'stats'->'liters'->>'lpg')::numeric), 0)::bigint AS l_lpg,
          count(*) FILTER (WHERE (save->'s'->>'evChargers')::numeric > 0)::int AS ev_stations,
          count(*) FILTER (WHERE (save->'s'->>'hasSMR')::boolean)::int AS nuclear_stations,
          coalesce(round(avg((save->'s'->>'reputation')::numeric), 2), 0)::float AS avg_rep
        FROM benzinlik_player`)
      const fb = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status='open')::int AS acik FROM benzinlik_feedback")
      const vis = await pool.query(`SELECT
        coalesce(sum(visits),0)::int AS v24, coalesce(sum(signups),0)::int AS s24, coalesce(sum(logins),0)::int AS l24,
        coalesce(sum(guests),0)::int AS g24, coalesce(sum(guest_signups),0)::int AS gs24
        FROM benzinlik_stat_hourly WHERE hour > now() - interval '24 hours'`)
      const gAll = await pool.query(`SELECT coalesce(sum(guests),0)::int AS g, coalesce(sum(guest_signups),0)::int AS gs FROM benzinlik_stat_hourly`)
      const a = agg.rows[0]; const v = vis.rows[0]; const ga = gAll.rows[0]
      const conv = v.v24 > 0 ? Math.round((v.s24 / v.v24) * 100) : 0
      // misafir→kayıt dönüşümü: GERÇEK dönüşüm olayı sayılır (kayıt anında client'ta misafir verisi
      // vardıysa guest_signups artar). Oran = dönüşen misafir / toplam misafir (tüm zamanlar, hizalı).
      const guestConv = ga.g > 0 ? Math.min(100, Math.round((ga.gs / ga.g) * 100)) : 0
      const pct = n => (a.total > 0 ? Math.round((n / a.total) * 100) : 0)
      return json(res, 200, {
        window: '30d',
        sessionsPerUser: Math.round(a.spu * 10) / 10,
        retention: { d1: pct(a.d1), d7: pct(a.d7), d30: pct(a.d30) },
        topEvents: [
          { event: 'AKTIF · su an (5dk)', count: Number(a.active5m) },
          { event: 'AKTIF · son 1 saat', count: Number(a.active1h) },
          { event: 'AKTIF · son 24 saat', count: Number(a.active1d) },
          { event: 'ZIYARET · son 24 saat', count: Number(v.v24) },
          { event: 'MISAFIR · su an oynuyor', count: guestOnlineCount() },
          { event: 'MISAFIR · yeni son 24 saat', count: Number(v.g24) },
          { event: 'MISAFIR · toplam', count: Number(ga.g) },
          { event: 'MISAFIR→KAYIT · son 24 saat', count: Number(v.gs24) },
          { event: 'MISAFIR→KAYIT · toplam', count: Number(ga.gs) },
          { event: 'KAYIT · son 24 saat', count: Number(v.s24) },
          { event: 'GIRIS · son 24 saat', count: Number(v.l24) },
          { event: 'DONUSUM · ziyaret→kayit %', count: conv },
          { event: 'DONUSUM · misafir→kayit %', count: guestConv },
          { event: 'YENI OYUNCU · son 24 saat', count: Number(a.new1d) },
          { event: 'ACIK sorun bildirimi', count: fb.rows[0].acik },
          { event: 'toplam_musteri_servisi', count: Number(a.served) },
          { event: 'satilan_benzin_L', count: Number(a.l_benzin) },
          { event: 'satilan_dizel_L', count: Number(a.l_dizel) },
          { event: 'satilan_lpg_L', count: Number(a.l_lpg) },
          { event: 'satilan_elektrik_kWh', count: Number(a.kwh) },
          { event: 'toplam_ciro_TL', count: Number(a.revenue) },
          { event: 'ortalama_oyun_gunu', count: Number(a.avg_day) },
          { event: 'en_ileri_oyun_gunu', count: Number(a.max_day) },
          { event: 'elektrikli_istasyon_sayisi', count: Number(a.ev_stations) },
          { event: 'nukleer_reaktorlu_istasyon', count: Number(a.nuclear_stations) },
          { event: 'gun_ici_aktif_oyuncu', count: Number(a.active1d) },
          { event: 'ortalama_itibar_x100', count: Math.round(Number(a.avg_rep) * 100) },
          { event: 'sorun_bildirimi', count: fb.rows[0].n },
        ],
        asOf: new Date().toISOString(),
      })
    }
    // ÖDÜLLÜ REKLAM huni özeti (aggregate-only, e-posta yok): ?days=7
    if (url.startsWith('/vs/v1/ads') && req.method === 'GET') {
      return json(res, 200, await reklam.summary(u.searchParams.get('days') || 7))
    }
    if (url === '/vs/v1/kpi' && req.method === 'GET') {
      // tek KPI kartı için sade değer: {data:{value,label,deltaPct?}}
      const k = u.searchParams.get('k') || ''
      const p = await pool.query(`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE last_seen_at > now() - interval '5 min')::int AS active5m,
          count(*) FILTER (WHERE last_seen_at > now() - interval '1 hour')::int AS active1h,
          count(*) FILTER (WHERE last_seen_at > now() - interval '1 day')::int AS active1d,
          count(*) FILTER (WHERE created_at > now() - interval '1 day')::int AS new1d,
          count(*) FILTER (WHERE email_verified)::int AS verified,
          count(*) FILTER (WHERE NOT email_verified)::int AS unverified
        FROM benzinlik_player`)
      const w = await pool.query(`SELECT
        coalesce(sum(visits),0)::int AS v24, coalesce(sum(signups),0)::int AS s24, coalesce(sum(logins),0)::int AS l24
        FROM benzinlik_stat_hourly WHERE hour > now() - interval '24 hours'`)
      const a = p.rows[0], v = w.rows[0]
      const conv = v.v24 > 0 ? Math.round((v.s24 / v.v24) * 100) : 0
      const map = {
        active_now: { value: a.active5m, label: 'playing right now' },
        active_1h: { value: a.active1h, label: 'active last hour' },
        active_24h: { value: a.active1d, label: 'active last 24h' },
        visits_24h: { value: v.v24, label: 'site visits (24h)' },
        signups_24h: { value: v.s24, label: 'new accounts (24h)' },
        logins_24h: { value: v.l24, label: 'logins (24h)' },
        conversion: { value: conv, label: 'visit → signup %' },
        players_total: { value: a.total, label: 'total players' },
        new_players_24h: { value: a.new1d, label: 'first-time players (24h)' },
        verified: { value: a.verified, label: 'email verified' },
        unverified: { value: a.unverified, label: 'email NOT verified' },
      }
      const d = map[k] || { value: 0, label: k }
      return json(res, 200, { data: d })
    }
    if (url === '/vs/v1/broadcast' && req.method === 'POST') {
      // TÜM bağlı oyunculara anlık yayın (bildirim ya da reload)
      const b = await readBody(req)
      if (b?.kind === 'reload') return json(res, 200, { data: { live: broadcastAll({ type: 'reload' }) } })
      if (b?.kind === 'notify') {
        const title = String(b.title || 'BenelOil').slice(0, 80)
        const body = String(b.body || '').slice(0, 300)
        await pool.query('INSERT INTO beneloil_notification(user_id, title, body) VALUES (NULL,$1,$2)', [title, body]).catch(() => {})
        return json(res, 200, { data: { live: broadcastAll({ type: 'notify', title, body }) } })
      }
      return json(res, 400, { error: { code: 'invalid_request', message: 'kind: notify|reload' } })
    }
    if (url === '/vs/v1/notifications' && req.method === 'GET') {
      const rows = await pool.query(`SELECT n.id, n.title, n.body, n.created_at, p.email
        FROM beneloil_notification n LEFT JOIN benzinlik_player p ON p.id = n.user_id
        ORDER BY n.id DESC LIMIT 100`)
      return json(res, 200, { data: rows.rows.map(r => ({
        id: String(r.id), createdAt: r.created_at, kime: r.email || '(herkes)',
        baslik: r.title, mesaj: r.body,
      })) })
    }
    if (url === '/vs/v1/live-status' && req.method === 'GET') {
      return json(res, 200, { data: { onlineSockets: liveOnlineCount(), guestsOnline: guestOnlineCount() } })
    }
    if (url === '/vs/v1/health' && req.method === 'GET') {
      return json(res, 200, {
        ok: true,
        version: process.env.GIT_SHA || '1.0.0',
        status: 'operational',
        uptime: { value: Math.round(process.uptime()), window: 'process-seconds', incidents: 0 },
      })
    }
    json(res, 404, { error: { code: 'not_found', message: 'yok' } })
  } catch (err) {
    console.error('vs api:', err)
    json(res, 500, { error: { code: 'server_error', message: 'Sunucu hatası.' } })
  }
}

// Yeni kayıt/misafir EKİBE push — Cash Sort (yayında değil, sadece ekip cihazlarında) APNs altyapısı.
// Sortubes/tubes-api KULLANILMAZ: orası artık gerçek oyunculu mağaza, segment:all herkese giderdi.
async function pushSignupNotif(kind = 'registered', guestTotal = 0) {
  const key = process.env.CASHSORT_VS_KEY
  if (!key || !pool) return
  try {
    const c = await pool.query(`SELECT count(*)::int AS total,
      count(*) FILTER (WHERE last_seen_at > now() - interval '5 min')::int AS online FROM benzinlik_player`)
    const total = c.rows[0]?.total ?? 0
    const online = c.rows[0]?.online ?? 0
    const body = kind === 'guest'
      ? `Misafir sayısı ${guestTotal} oldu! (toplam ${total} kayıt · şu an ${online} kişi oynuyor)`
      : `Yeni kayıtlı oyuncu katıldı! (toplam ${total} kayıt · şu an ${online} kişi oynuyor)`
    await fetch('https://cashsort-api.benerits.com/vs/v1/notifications/send', {
      method: 'POST',
      headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
      body: JSON.stringify({ segment: { type: 'all' }, title: 'BenelOil', body }),
    })
  } catch {}
}

// ---- Godot (masaüstü + web) sürümünün geri bildirim kanalı ----
// Oyunun hesabı yok: uç herkese açık, IP başına saatte 10 bildirim. Ekran
// görüntüsü JPEG olarak satırın içinde durur ve /shot.jpg ile HERKESE açık
// servis edilir (panel <img> olarak gösterir; içinde oyun karesinden başka bir
// şey yok). Web sürümü benerits.github.io'dan geldiği için CORS açık.
const GODOT_FB_MAX_SHOT = 700_000
function corsGodot(res) {
  res.setHeader('access-control-allow-origin', '*')
  res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
  res.setHeader('access-control-allow-headers', 'content-type')
  res.setHeader('access-control-max-age', '86400')
}
function godotFeedbackRow(r, base) {
  return {
    id: String(r.id),
    durum: r.status === 'resolved' ? 'Çözüldü' : r.status === 'wontfix' ? 'Kapatıldı' : 'Açık',
    createdAt: r.created_at,
    screenshot: r.has_shot ? `${base}/api/godot-feedback/${r.id}/shot.jpg` : null,
    message: r.message,
    contact: r.contact || '',
    cozumNotu: r.resolved_note || '',
    surum: r.version || '',
    platform: r.platform || '',
    dil: r.locale || '',
    gun: r.game?.day ?? null,
    kasa: r.game?.cash ?? null,
    seviye: r.game?.level ?? null,
    mod: r.game?.kind ?? '',
    sure: r.game?.playtime_min ?? null,
  }
}
function publicBase(req) {
  return String(process.env.PUBLIC_URL || ('https://' + (req.headers.host || ''))).replace(/\/$/, '')
}
const GODOT_FB_COLS = 'id, message, contact, version, platform, locale, game, created_at, status, resolved_note, (screenshot IS NOT NULL) AS has_shot'
async function handleGodotFeedback(req, res, url) {
  try {
    const shot = url.match(/^\/api\/godot-feedback\/(\d+)\/shot\.jpg$/)
    if (shot && req.method === 'GET') {
      if (!pool) return json(res, 503, { error: 'db' })
      const r = await pool.query('SELECT screenshot FROM beneloil_godot_feedback WHERE id=$1', [Number(shot[1])])
      const buf = r.rows[0]?.screenshot
      if (!buf) { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': buf.length, 'cache-control': 'public, max-age=31536000, immutable' })
      return res.end(buf)
    }
    if (url !== '/api/godot-feedback') { res.writeHead(404); return res.end() }
    corsGodot(res)
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }
    if (req.method !== 'POST') return json(res, 405, { error: 'POST bekleniyor.' })
    if (!pool) return json(res, 503, { error: 'Sunucuda veritabanı yapılandırılmamış.' })
    const ip = clientIp(req)
    if (!rateLimit('gfb:' + ip, 10, 3600_000)) return json(res, 429, { error: 'Çok sık bildirim — biraz sonra tekrar dene.' })
    let body
    try { body = await readBody(req) } catch { return json(res, 400, { error: 'Gövde okunamadı.' }) }
    // SINIRSIZ DEĞİL AMA GENİŞ: ilk beta raporu (3-4 saatlik oyun) 2000
    // karakterde kesildi ve devamı kayboldu. Gövde tavanı zaten 1 MB.
    const message = String(body.message || '').trim().slice(0, 50_000)
    if (message.length < 3) return json(res, 400, { error: 'Mesaj çok kısa.' })
    const contact = String(body.contact || '').trim().slice(0, 120)
    const version = String(body.version || '').slice(0, 32)
    const platform = String(body.platform || '').slice(0, 32)
    const locale = String(body.locale || '').slice(0, 16)
    const game = body.game && typeof body.game === 'object' && !Array.isArray(body.game) ? body.game : null
    let screenshot = null
    if (typeof body.screenshot === 'string' && body.screenshot) {
      const buf = Buffer.from(body.screenshot, 'base64')
      // Yalnız gerçek bir JPEG (SOI işareti) ve tavanın altında olan tutulur;
      // gerisi mesajı düşürmeden sessizce atılır.
      if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf.length <= GODOT_FB_MAX_SHOT) screenshot = buf
    }
    const r = await pool.query(
      'INSERT INTO beneloil_godot_feedback(message, contact, version, platform, locale, game, screenshot, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [message, contact || null, version || null, platform || null, locale || null, game, screenshot, ip])
    return json(res, 200, { ok: true, id: r.rows[0].id })
  } catch (e) {
    console.error('godot-feedback:', e.message)
    return json(res, 500, { error: 'Sunucu hatası.' })
  }
}

const server = http.createServer(async (req, res) => {
  let url = (req.url || '/').split('?')[0]
  if (url.startsWith('/api/godot-feedback')) return handleGodotFeedback(req, res, url)
  if (url.startsWith('/api/')) return handleApi(req, res, url)
  if (url.startsWith('/vs/v1/')) return handleVs(req, res, url)
  if (url === '/ads.txt' && process.env.ADSENSE_PUB) {
    res.writeHead(200, { 'content-type': 'text/plain' })
    return res.end(`google.com, ${String(process.env.ADSENSE_PUB).replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`)
  }
  if (url === '/reset' || url.startsWith('/reset/')) {
    const tok = url.startsWith('/reset/')
      ? decodeURIComponent(url.slice('/reset/'.length))
      : (new URL(req.url, 'http://x').searchParams.get('token') || '')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>BenelOil — Şifre Sıfırla</title>
<body style="font-family:system-ui,sans-serif;background:#0d1420;color:#eaf1fb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px">
<div style="max-width:380px;width:100%;text-align:center"><div style="font-size:40px"></div><h2>Yeni şifre belirle</h2>
<input id="pw" type="password" placeholder="Yeni şifre (en az 4 karakter)" style="width:100%;box-sizing:border-box;padding:12px;border-radius:10px;border:1px solid #33465f;background:#12233d;color:#fff;font-size:15px;margin:8px 0">
<button id="go" style="width:100%;padding:12px;border:0;border-radius:10px;background:#27a05a;color:#fff;font-weight:700;font-size:15px;cursor:pointer">Şifreyi Değiştir</button>
<p id="msg" style="color:#b8c6da;font-size:13px;margin-top:12px"></p></div>
<script>const t=${JSON.stringify(tok)};document.getElementById('go').onclick=async()=>{const pw=document.getElementById('pw').value;const m=document.getElementById('msg');if(pw.length<4){m.textContent='Şifre en az 4 karakter olmalı.';return}m.textContent='Gönderiliyor...';const r=await fetch('/api/reset',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:t,password:pw})});const d=await r.json().catch(()=>({}));if(r.ok){m.innerHTML='✓ Şifren değişti! <a href="/" style="color:#4fd18a">Giriş yap</a>';}else{m.textContent=d.error||'Hata oluştu.'}}</script></body>`)
  }
  if (url === '/terms') url = '/terms.html'
  if (url === '/privacy') url = '/privacy.html'
  if (url === '/support') url = '/support.html' // ASC Support URL (App Store şartı)
  if (url === '/data-deletion') url = '/data-deletion.html' // Meta Data Deletion Instructions URL
  // statik dosyalar + SPA fallback
  let file = path.join(DIST, path.normalize(url).replace(/^([.][.][/\\])+/, ''))
  if (!file.startsWith(DIST)) file = path.join(DIST, 'index.html')
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=86400',
  })
  createReadStream(file).pipe(res)
})

// ---- WebSocket: anlık bakiye / bildirim / hot-fix / reload (izole, aynı container+port) ----
const wss = new WebSocketServer({ noServer: true })
const liveSockets = new Map() // userId(number) -> Set<ws>

function pushToUser(id, msg) {
  const set = liveSockets.get(Number(id))
  if (!set) return 0
  const data = JSON.stringify(msg)
  let n = 0
  for (const ws of set) { if (ws.readyState === 1) { try { ws.send(data); n++ } catch {} } }
  return n
}
function broadcastAll(msg) {
  const data = JSON.stringify(msg)
  let n = 0
  for (const set of liveSockets.values()) for (const ws of set) { if (ws.readyState === 1) { try { ws.send(data); n++ } catch {} } }
  return n
}
function liveOnlineCount() { return liveSockets.size }
// misafir nabız haritası: sid → son görülme; 2.5 dk sessiz kalan düşer
const guestSeen = new Map()
function guestOnlineCount() {
  const cut = Date.now() - 150_000
  let n = 0
  for (const [k, ts] of guestSeen) { if (ts < cut) guestSeen.delete(k); else n++ }
  return n
}

server.on('upgrade', async (req, socket, head) => {
  try {
    const u = new URL(req.url, 'http://x')
    if (u.pathname !== '/ws') { socket.destroy(); return }
    const email = verifyToken(String(u.searchParams.get('token') || ''))
    if (!email || !pool) { socket.destroy(); return }
    const r = await pool.query('SELECT id, banned_at FROM benzinlik_player WHERE email=$1', [email])
    if (!r.rowCount || r.rows[0].banned_at) { socket.destroy(); return }
    const id = Number(r.rows[0].id)
    wss.handleUpgrade(req, socket, head, ws => {
      ws.userId = id; ws.isAlive = true
      let set = liveSockets.get(id); if (!set) { set = new Set(); liveSockets.set(id, set) }
      set.add(ws)
      ws.on('pong', () => { ws.isAlive = true })
      ws.on('message', () => {}) // client yalnızca dinler
      ws.on('close', () => { const s = liveSockets.get(id); if (s) { s.delete(ws); if (!s.size) liveSockets.delete(id) } })
      ws.on('error', () => {})
      try { ws.send(JSON.stringify({ type: 'hello', ok: true })) } catch {}
    })
  } catch { try { socket.destroy() } catch {} }
})
// heartbeat: ölü bağlantıları temizle
setInterval(() => {
  for (const set of liveSockets.values()) for (const ws of set) {
    if (ws.isAlive === false) { try { ws.terminate() } catch {}; continue }
    ws.isAlive = false; try { ws.ping() } catch {}
  }
}, 30000)

// dirençli boot: DB geç ayaklanırsa bile sunucu ASLA sessizce ölmez
// ÖDÜLLÜ REKLAM katmanı — yardımcılar yukarıda tanımlı olduğu için burada kurulur.
const reklam = pool ? createReklam({ pool, SECRET, json, readBody, rateLimit, clientIp, maxIncomeRate, auditCheat }) : null

async function start() {
  for (let i = 1; i <= 30; i++) {
    try {
      await initDb()
      break
    } catch (err) {
      console.error(`DB hazır değil (deneme ${i}/30):`, err.message)
      await new Promise(r => setTimeout(r, 2000))
    }
  }
  server.listen(PORT, () => console.log(`BenelOil sunucusu :${PORT}`))
}
start()
