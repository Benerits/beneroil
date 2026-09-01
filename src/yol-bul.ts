/**
 * ════════════ ENGEL-FARKINDA ROTA BULUCU (A* + ip germe) ════════════
 *
 * NEDEN VAR: eski rota temizliği (cars.ts `rotayiTemizle` → `araNokta`) sezgiseldi —
 * "kesişen bacağın etrafına dirsek koy, 3 tur dene". Bulamazsa SESSİZCE kirli rota
 * dönüyordu; araç engelin dibinde `Car.insideSolid` duvarına çarpıp donuyordu.
 * Canlı telemetride (olay #4403, kasaba) 180° döndürülmüş pompaların yuvası çıkış
 * omurgasının TERS tarafında kaldığı için ~20 `leaving` araç aynı noktada yığılmıştı:
 * düz çıkış bacağı pompa gövdesini kesiyor, sezgisel dirsek de bulunamıyordu.
 *
 * BU MODÜL BİR TAAHHÜT VERİR: dönen rotanın HİÇBİR bacağı, pad ile şişirilmiş hiçbir
 * katı cismi kesmez — ya da `null` döner ("hedefe gidilemiyor"). Sessiz başarısızlık yok.
 *
 * SAFLIK: three.js'e bağlı değil (test edilebilirlik). Girdi/çıktı düz {x,y}.
 */

export interface Pt { x: number; y: number }
export interface Dikdortgen { cx: number; cy: number; w: number; d: number }

/** DÜNYA SINIRLARI: araçlar |y| > 42.5'te yok olur, karşı yaka x ≈ 2*ROAD_X + kenar.
 *  Izgara bu kutunun DIŞINA çıkmaz; dışarıdaki nokta kutuya kırpılır. */
export const DUNYA = { minX: -34, maxX: 48, minY: -46, maxY: 46 }
/** Hücre boyu: 0.5 → ~164×184 = 30k hücre. A* bu boyutta milisaniye altı çalışır. */
export const HUCRE = 0.5
/** Izgara payı, gerçek pad'in üstüne EK: hücre yarı boyu + teğet emniyeti.
 *  GARANTİ ZİNCİRİ: bir hücre, şişirilmiş dikdörtgenle ÇAKIŞIYORSA kapalı sayılır
 *  (yani |dx| < w/2+pad+hücre/2). Komşu iki AÇIK hücrenin merkezleri arasındaki parça
 *  o iki hücrenin birleşiminde kalır → engeli kesemez. Çapraz adımda "köşe kesme yasağı"
 *  (iki dik komşu da açık olmalı) aynı garantiyi çapraza taşır. EPS teğetliği ayırır:
 *  slab testi tam teğet parçayı KESİŞİM sayar, o yüzden 0.02 birim pay bırakılır. */
const IZGARA_EPS = 0.02

const NX = Math.ceil((DUNYA.maxX - DUNYA.minX) / HUCRE)
const NY = Math.ceil((DUNYA.maxY - DUNYA.minY) / HUCRE)

/** Eksen hizalı dikdörtgen ile doğru parçası kesişiyor mu (slab yöntemi).
 *  cars.ts'teki `segmentDikdortgeniKesiyor` ile BİREBİR aynı ölçüt — testler ikisini
 *  aynı fonksiyonla denetleyebilsin diye burada tek kopya tutulur ve dışa açılır. */
export function segmentDikdortgeniKesiyor(
  ax: number, ay: number, bx: number, by: number, r: Dikdortgen, pad: number,
): boolean {
  const minX = r.cx - r.w / 2 - pad, maxX = r.cx + r.w / 2 + pad
  const minY = r.cy - r.d / 2 - pad, maxY = r.cy + r.d / 2 + pad
  if ((ax < minX && bx < minX) || (ax > maxX && bx > maxX)) return false
  if ((ay < minY && by < minY) || (ay > maxY && by > maxY)) return false
  const dx = bx - ax, dy = by - ay
  let t0 = 0, t1 = 1
  const kenar: [number, number][] = [[-dx, ax - minX], [dx, maxX - ax], [-dy, ay - minY], [dy, maxY - ay]]
  for (const [p, q] of kenar) {
    if (p === 0) { if (q < 0) return false; continue }
    const t = q / p
    if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t }
    else { if (t < t0) return false; if (t < t1) t1 = t }
  }
  return true
}

/** Nokta şişirilmiş dikdörtgenin içinde mi. */
export function noktaKutuda(x: number, y: number, r: Dikdortgen, pad: number): boolean {
  return Math.abs(x - r.cx) <= r.w / 2 + pad && Math.abs(y - r.cy) <= r.d / 2 + pad
}

// ─────────────────── ENGEL KAYNAĞI ───────────────────
// Modül kendi engel listesini tutar (cars.ts `Car.solids` setter'ı besler). Böylece
// çağrı yerleri `yolBul(a, b, pad)` diye sade kalır; testler doğrudan ayarlar.
let engeller: Dikdortgen[] = []
let engelSurum = -1

export function engelleriAyarla(v: Dikdortgen[], surum: number) {
  engeller = v
  if (surum !== engelSurum) {
    engelSurum = surum
    izgaralar.clear()
    yolOnbellek.clear()
  }
}
export function engelleriAl(): Dikdortgen[] { return engeller }
export function engelSurumu(): number { return engelSurum }

/** ÖLÇÜM: kaç A* koştu, kaç önbellek isabeti, kaç kez "yol yok" dedi. */
export const yolStats = { arama: 0, isabet: 0, yok: 0, dugum: 0 }

// ─────────────────── IZGARA ───────────────────

interface Izgara {
  blok: Uint8Array
  /** A* çalışma alanları — her aramada yeniden ayırmamak için ızgarayla yaşar */
  g: Float64Array
  gelen: Int32Array
  damga: Int32Array
  tur: number
}

const izgaralar = new Map<string, Izgara>()
const IZGARA_MAX = 6

function izgaraAl(pad: number): Izgara {
  const anahtar = engelSurum + '|' + pad
  const v = izgaralar.get(anahtar)
  if (v) return v
  const n = NX * NY
  const blok = new Uint8Array(n)
  const p = pad + HUCRE / 2 + IZGARA_EPS
  for (const r of engeller) {
    // Yalnız etkilenen hücre aralığını tara (tüm ızgarayı değil).
    const i0 = Math.max(0, Math.floor((r.cx - r.w / 2 - p - DUNYA.minX) / HUCRE))
    const i1 = Math.min(NX - 1, Math.ceil((r.cx + r.w / 2 + p - DUNYA.minX) / HUCRE))
    const j0 = Math.max(0, Math.floor((r.cy - r.d / 2 - p - DUNYA.minY) / HUCRE))
    const j1 = Math.min(NY - 1, Math.ceil((r.cy + r.d / 2 + p - DUNYA.minY) / HUCRE))
    for (let j = j0; j <= j1; j++) {
      const cy = DUNYA.minY + (j + 0.5) * HUCRE
      if (Math.abs(cy - r.cy) >= r.d / 2 + p) continue
      for (let i = i0; i <= i1; i++) {
        const cx = DUNYA.minX + (i + 0.5) * HUCRE
        if (Math.abs(cx - r.cx) < r.w / 2 + p) blok[j * NX + i] = 1
      }
    }
  }
  const gr: Izgara = {
    blok, g: new Float64Array(n), gelen: new Int32Array(n), damga: new Int32Array(n), tur: 0,
  }
  if (izgaralar.size >= IZGARA_MAX) izgaralar.clear()
  izgaralar.set(anahtar, gr)
  return gr
}

const sut = (x: number) => Math.min(NX - 1, Math.max(0, Math.floor((x - DUNYA.minX) / HUCRE)))
const satir = (y: number) => Math.min(NY - 1, Math.max(0, Math.floor((y - DUNYA.minY) / HUCRE)))
const merkezX = (i: number) => DUNYA.minX + (i + 0.5) * HUCRE
const merkezY = (j: number) => DUNYA.minY + (j + 0.5) * HUCRE

/** Bu parça (pad ile) hiçbir engeli kesmiyor mu — ip germe ve doğrulamanın ölçütü. */
export function bacakTemiz(a: Pt, b: Pt, pad: number, liste: Dikdortgen[] = engeller): boolean {
  for (const r of liste) if (segmentDikdortgeniKesiyor(a.x, a.y, b.x, b.y, r, pad)) return false
  return true
}

/**
 * Kapalı hücreye düşen noktayı en yakın AÇIK hücreye kaydır.
 * `yaricap` birim cinsinden (varsayılan 2.5). Kaydırılan noktadan gerçek noktaya giden
 * parça, noktayı İÇİNE ALAN engeller DIŞINDA hiçbir şeyi kesmemeli — yoksa aracı
 * gövdenin öbür yanına ışınlamış oluruz.
 */
function serbestHucre(p: Pt, pad: number, gr: Izgara, yaricap = 2.5): number {
  const i0 = sut(p.x), j0 = satir(p.y)
  if (!gr.blok[j0 * NX + i0]) return j0 * NX + i0
  // noktayı içine alan engeller "kaçınılmaz": kaydırma parçası onları kesebilir
  const kacinilmaz = engeller.filter(r => noktaKutuda(p.x, p.y, r, pad))
  const digerleri = engeller.filter(r => !kacinilmaz.includes(r))
  const R = Math.ceil(yaricap / HUCRE)
  let enIyi = -1, enIyiD = Infinity
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = i0 + di, j = j0 + dj
    if (i < 0 || j < 0 || i >= NX || j >= NY) continue
    const idx = j * NX + i
    if (gr.blok[idx]) continue
    const cx = merkezX(i), cy = merkezY(j)
    const d = Math.hypot(cx - p.x, cy - p.y)
    if (d > yaricap || d >= enIyiD) continue
    if (!bacakTemiz(p, { x: cx, y: cy }, pad, digerleri)) continue
    enIyiD = d; enIyi = idx
  }
  return enIyi
}

// ─────────────────── İKİLİ YIĞIN (A* açık liste) ───────────────────

class Yigin {
  private idx: number[] = []
  private f: number[] = []
  get boy() { return this.idx.length }
  ekle(i: number, f: number) {
    this.idx.push(i); this.f.push(f)
    let c = this.idx.length - 1
    while (c > 0) {
      const p = (c - 1) >> 1
      // EŞİTLİKTE İNDİS: determinizm için — aynı girdi her koşuda aynı rotayı verir
      if (this.f[p] < this.f[c] || (this.f[p] === this.f[c] && this.idx[p] <= this.idx[c])) break
      this.takas(p, c); c = p
    }
  }
  cek(): number {
    const üst = this.idx[0]
    const si = this.idx.pop()!, sf = this.f.pop()!
    if (this.idx.length) {
      this.idx[0] = si; this.f[0] = sf
      let c = 0
      for (;;) {
        const l = c * 2 + 1, r = l + 1
        let m = c
        if (l < this.idx.length && (this.f[l] < this.f[m] || (this.f[l] === this.f[m] && this.idx[l] < this.idx[m]))) m = l
        if (r < this.idx.length && (this.f[r] < this.f[m] || (this.f[r] === this.f[m] && this.idx[r] < this.idx[m]))) m = r
        if (m === c) break
        this.takas(m, c); c = m
      }
    }
    return üst
  }
  private takas(a: number, b: number) {
    const i = this.idx[a]; this.idx[a] = this.idx[b]; this.idx[b] = i
    const f = this.f[a]; this.f[a] = this.f[b]; this.f[b] = f
  }
}

// 8 komşu — SIRA SABİT (determinizm). Çapraz adımlarda köşe kesme yasağı uygulanır.
const KOMSU: [number, number, number][] = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
]

// ─────────────────── YOL ÖNBELLEĞİ (LRU) ───────────────────
const yolOnbellek = new Map<string, Pt[] | null>()
const YOL_ONBELLEK_MAX = 400
const q4 = (v: number) => Math.round(v * 4)

// ─────────────────── ANA API ───────────────────

/**
 * A* + ip germe. `from`'dan `to`'ya, pad ile şişirilmiş engellere HİÇ değmeyen
 * kısa bir waypoint listesi döner (`from` listede YOKTUR; `to` — ya da kapalıysa
 * ona kaydırılmış hâli + gerçek `to` — sonuncudur). Ulaşılamıyorsa null.
 */
export function yolBul(from: Pt, to: Pt, pad: number): Pt[] | null {
  const anahtar = engelSurum + '|' + pad + '|' + q4(from.x) + ',' + q4(from.y) + '|' + q4(to.x) + ',' + q4(to.y)
  if (yolOnbellek.has(anahtar)) {
    yolStats.isabet++
    const v = yolOnbellek.get(anahtar)!
    return v ? v.map(p => ({ x: p.x, y: p.y })) : null
  }
  const sonuc = hesapla(from, to, pad)
  if (yolOnbellek.size >= YOL_ONBELLEK_MAX) {
    // LRU: en eski girdiyi at (Map ekleme sırasını korur)
    const ilk = yolOnbellek.keys().next()
    if (!ilk.done) yolOnbellek.delete(ilk.value)
  }
  yolOnbellek.set(anahtar, sonuc)
  return sonuc ? sonuc.map(p => ({ x: p.x, y: p.y })) : null
}

function hesapla(from: Pt, to: Pt, pad: number): Pt[] | null {
  yolStats.arama++
  // KISA DEVRE: düz çizgi zaten temizse A* koşturmaya gerek yok.
  if (bacakTemiz(from, to, pad)) return [{ x: to.x, y: to.y }]

  const gr = izgaraAl(pad)
  const basIdx = serbestHucre(from, pad, gr)
  const sonIdx = serbestHucre(to, pad, gr)
  if (basIdx < 0 || sonIdx < 0) { yolStats.yok++; return null }

  const hamHedefKapali = gr.blok[satir(to.y) * NX + sut(to.x)] === 1

  const hucreler = astar(gr, basIdx, sonIdx)
  if (!hucreler) { yolStats.yok++; return null }

  // Gerçek uçları ekle: baş NOKTASI (aracın konumu) ve hedef.
  const ham: Pt[] = [{ x: from.x, y: from.y }]
  for (const idx of hucreler) ham.push({ x: merkezX(idx % NX), y: merkezY((idx / NX) | 0) })
  // Hedef hücresi kapalıysa (ör. pompa yuvası kendi gövdesinin zarfında) gerçek hedef
  // AYRI bir son bacak olarak eklenir; kaydırılmış hücre serbestHucre() sayesinde
  // "gerçek hedefe temiz görüş hattı" garantisi taşır.
  ham.push({ x: to.x, y: to.y })

  const gergin = ipGer(ham, pad, hamHedefKapali)
  return gergin.slice(1)
}

/** Ulaşılabilirlik sorgusu (ucuz sarmalayıcı). */
export function erisilebilir(from: Pt, to: Pt, pad: number): boolean {
  return yolBul(from, to, pad) !== null
}

function astar(gr: Izgara, bas: number, son: number): number[] | null {
  gr.tur++
  const tur = gr.tur
  const { blok, g, gelen, damga } = gr
  const sx = son % NX, sy = (son / NX) | 0
  const h = (i: number) => {
    const dx = Math.abs((i % NX) - sx), dy = Math.abs(((i / NX) | 0) - sy)
    return (dx > dy ? dx - dy : dy - dx) + Math.SQRT2 * Math.min(dx, dy)
  }
  const acik = new Yigin()
  g[bas] = 0; gelen[bas] = -1; damga[bas] = tur
  acik.ekle(bas, h(bas))
  let dugum = 0
  while (acik.boy) {
    const cur = acik.cek()
    if (cur === son) {
      const yol: number[] = []
      for (let i: number = son; i >= 0; i = gelen[i]) yol.push(i)
      yol.reverse()
      yolStats.dugum += dugum
      return yol
    }
    dugum++
    const cx = cur % NX, cy = (cur / NX) | 0
    for (const [dx, dy, m] of KOMSU) {
      const nx = cx + dx, ny = cy + dy
      if (nx < 0 || ny < 0 || nx >= NX || ny >= NY) continue
      const ni = ny * NX + nx
      if (blok[ni]) continue
      // KÖŞE KESME YASAĞI: çapraz adım ancak iki dik komşu da açıksa geçerli.
      // Bu kural, "iki açık hücre merkezi arası parça engeli kesmez" garantisinin
      // çapraz ayağıdır — olmazsa araç köşeden kesip gövdeye sürterdi.
      if (dx && dy && (blok[cy * NX + nx] || blok[ny * NX + cx])) continue
      const yeni = g[cur] + m
      if (damga[ni] === tur && g[ni] <= yeni) continue
      damga[ni] = tur; g[ni] = yeni; gelen[ni] = cur
      acik.ekle(ni, yeni + h(ni))
    }
  }
  yolStats.dugum += dugum
  return null
}

/**
 * İP GERME (string pulling): merdiven basamaklarını at, görüş hattı temiz olan en uzak
 * noktaya atla. Çıktı kısa bir kırık çizgi olur — araç zikzak yapmaz.
 * `hedefAyri`: son nokta (gerçek hedef) kapalı hücrede; ona giden SON bacak
 * doğrulanmaz (kaçınılmaz gövde), o yüzden gerginin dışında tutulur.
 */
function ipGer(ham: Pt[], pad: number, hedefAyri: boolean): Pt[] {
  const son = hedefAyri ? ham.length - 1 : ham.length
  const dilim = ham.slice(0, son)
  const cikti: Pt[] = [dilim[0]]
  let i = 0
  while (i < dilim.length - 1) {
    let j = dilim.length - 1
    while (j > i + 1 && !bacakTemiz(dilim[i], dilim[j], pad)) j--
    cikti.push(dilim[j])
    i = j
  }
  if (hedefAyri) cikti.push(ham[ham.length - 1])
  return cikti
}

/** Testler/telemetri: önbellekleri boşalt (yerleşim değişimi dışında gerekmez). */
export function onbellegiBosalt() { izgaralar.clear(); yolOnbellek.clear() }
