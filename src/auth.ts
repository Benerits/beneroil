/** Hesap istemcisi: aynı origin'deki /api ile konuşur. */
import { lang } from './i18n'
const TOKEN_KEY = 'benzinlik-token'
const EMAIL_KEY = 'benzinlik-email'

export function loggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY)
}
export function currentEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

// Tek-cihaz kilidi: her açılış (yükleme) benzersiz bir oturum kimliği üretir. Başka cihaz
// açılınca sunucu oturumu ona devreder; eski cihaz bir sonraki save'de "kicked" alır.
const SESSION_ID = (globalThis.crypto?.randomUUID?.() ?? (Date.now().toString(36) + Math.random().toString(36).slice(2)))
export function sessionId(): string { return SESSION_ID }
let _onKicked: (() => void) | null = null
export function onKicked(cb: () => void) { _onKicked = cb }
let _kicked = false
export function isKicked(): boolean { return _kicked }
function triggerKicked() { if (!_kicked) { _kicked = true; _onKicked?.() } }

async function api(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-auth': localStorage.getItem(TOKEN_KEY) ?? '',
      'x-session': SESSION_ID,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Sunucu hatası (${res.status})`)
  return data as Record<string, unknown>
}

export async function register(email: string, password: string) {
  const d = await api('/api/register', 'POST', { email, password, lang })
  localStorage.setItem(TOKEN_KEY, String(d.token))
  localStorage.setItem(EMAIL_KEY, String(d.email))
}

export async function login(email: string, password: string) {
  const d = await api('/api/login', 'POST', { email, password })
  localStorage.setItem(TOKEN_KEY, String(d.token))
  localStorage.setItem(EMAIL_KEY, String(d.email))
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(EMAIL_KEY)
}

/** App Store zorunluluğu: kullanıcı hesabını tamamen siler (kayıt + save), sonra çıkış yapar */
export async function deleteAccount(): Promise<void> {
  await api('/api/account', 'DELETE')
  logout()
}

/** IAP efektini sunucu-otoriter uygula (hile-freni cap'ini bypass). Döner: {money, noAds}. */
export async function iapGrant(productId: string, transactionId?: string): Promise<{ money: number; noAds: boolean }> {
  const d = await api('/api/iap', 'POST', { productId, transactionId })
  return { money: Number(d.money) || 0, noAds: !!d.noAds }
}

let _verifyRequired = false
let _emailVerified = true
/** e-posta doğrulaması gerekli mi (env açık + kullanıcı doğrulanmamış) */
export function needsVerify(): boolean { return _verifyRequired && !_emailVerified }

// çoklu cihaz senkronu: son sunucu zaman damgasını izle
let _lastUpdatedAt: string | null = null
export function lastUpdatedAt(): string | null { return _lastUpdatedAt }
export function setLastUpdatedAt(v: string | null) { _lastUpdatedAt = v }

export async function pullSave(): Promise<unknown | null> {
  const d = await api('/api/save', 'GET')
  _verifyRequired = !!d.verifyRequired
  _emailVerified = !!d.emailVerified
  _lastUpdatedAt = (d.updatedAt as string) ?? _lastUpdatedAt
  return d.save ?? null
}
/** sunucudaki güncel zaman damgasını çek (odakta senkron kontrolü için) */
export async function fetchUpdatedAt(): Promise<string | null> {
  const d = await api('/api/save', 'GET')
  return (d.updatedAt as string) ?? null
}

/** doğrulama mailini (tekrar) gönder */
export async function sendVerify(email?: string): Promise<void> {
  await api('/api/send-verify', 'POST', { email: email ?? currentEmail(), lang })
}
/** e-posta değiştir (yeni adrese doğrulama gider) — token yenilenir */
export async function changeEmail(newEmail: string): Promise<void> {
  const d = await api('/api/change-email', 'POST', { newEmail, lang })
  localStorage.setItem(TOKEN_KEY, String(d.token))
  localStorage.setItem(EMAIL_KEY, String(d.email))
}
/** şifre sıfırlama maili iste */
export async function requestReset(email: string): Promise<void> {
  await api('/api/request-reset', 'POST', { email, lang })
}

/** Save'i sunucuya yaz. Çoklu cihaz guard: yüklediğimizden beri başka cihaz yazmışsa
 *  sunucu 409 + yeni save döner → çağıran yeniyi uygular (clobber yok, ilerleme karışmaz). */
export async function pushSave(save: unknown): Promise<{ conflict: boolean; kicked?: boolean; save?: unknown; updatedAt?: string }> {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-auth': localStorage.getItem(TOKEN_KEY) ?? '', 'x-session': SESSION_ID },
    body: JSON.stringify({ save, baseUpdatedAt: _lastUpdatedAt }),
  })
  const data = await res.json().catch(() => ({}))
  if ((data as { kicked?: boolean }).kicked) { triggerKicked(); return { conflict: false, kicked: true } }
  if (res.status === 409 && (data as { conflict?: boolean }).conflict) {
    _lastUpdatedAt = (data as { updatedAt?: string }).updatedAt ?? _lastUpdatedAt
    return { conflict: true, save: (data as { save?: unknown }).save, updatedAt: _lastUpdatedAt ?? undefined }
  }
  if (res.ok) _lastUpdatedAt = (data as { updatedAt?: string }).updatedAt ?? _lastUpdatedAt
  return { conflict: false }
}

/** sorun bildir: mesaj + küçük oyun bağlamı SQL'e düşer */
export async function sendFeedback(message: string, game?: Record<string, unknown>): Promise<void> {
  await api('/api/feedback', 'POST', { message, game })
}
