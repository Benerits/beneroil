/** Hesap istemcisi: aynı origin'deki /api ile konuşur. */
const TOKEN_KEY = 'benzinlik-token'
const EMAIL_KEY = 'benzinlik-email'

export function loggedIn(): boolean {
  return !!localStorage.getItem(TOKEN_KEY)
}
export function currentEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY)
}

async function api(path: string, method: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(path, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-auth': localStorage.getItem(TOKEN_KEY) ?? '',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Sunucu hatası (${res.status})`)
  return data as Record<string, unknown>
}

export async function register(email: string, password: string) {
  const d = await api('/api/register', 'POST', { email, password })
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

let _verifyRequired = false
let _emailVerified = true
/** e-posta doğrulaması gerekli mi (env açık + kullanıcı doğrulanmamış) */
export function needsVerify(): boolean { return _verifyRequired && !_emailVerified }

export async function pullSave(): Promise<unknown | null> {
  const d = await api('/api/save', 'GET')
  _verifyRequired = !!d.verifyRequired
  _emailVerified = !!d.emailVerified
  return d.save ?? null
}

/** doğrulama mailini (tekrar) gönder */
export async function sendVerify(email?: string): Promise<void> {
  await api('/api/send-verify', 'POST', { email: email ?? currentEmail() })
}
/** e-posta değiştir (yeni adrese doğrulama gider) — token yenilenir */
export async function changeEmail(newEmail: string): Promise<void> {
  const d = await api('/api/change-email', 'POST', { newEmail })
  localStorage.setItem(TOKEN_KEY, String(d.token))
  localStorage.setItem(EMAIL_KEY, String(d.email))
}
/** şifre sıfırlama maili iste */
export async function requestReset(email: string): Promise<void> {
  await api('/api/request-reset', 'POST', { email })
}

export async function pushSave(save: unknown): Promise<void> {
  await api('/api/save', 'POST', { save })
}

/** sorun bildir: mesaj + küçük oyun bağlamı SQL'e düşer */
export async function sendFeedback(message: string, game?: Record<string, unknown>): Promise<void> {
  await api('/api/feedback', 'POST', { message, game })
}
