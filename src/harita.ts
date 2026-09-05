/**
 * ŞUBE AĞI HARİTASI — "yatırım tahtası"
 *
 * NE DEĞİL: şehir kurma ekranı. Burada hiçbir şey İNŞA EDİLMEZ, hiçbir kare
 * boyanmaz. Tek soru şu: SIRADAKİ PARAYI HANGİ ŞUBEYE KOYACAĞIM?
 *
 * NEDEN AYRI BİR EKRAN: şube kararı bugün Ofis › Şubeler'de dikey bir LİSTE.
 * Liste bir şeyi gizliyor — şubeler birbirine BAĞLI. Taban ile kopyası aynı
 * bölge deposundan çekiyor (supplyLine); yani "Otoyol II'yi açayım mı" sorusu
 * aslında "Otoyol'un kotasını bölmeye değer mi" sorusu. Bir liste bunu
 * gösteremez, bir GRAF gösterir. Harita bu yüzden var.
 *
 * ═══ VERİ SÖZLEŞMESİ — BURADA HİÇBİR SAYI UYDURULMAZ ═══
 * Ekranda görünen her değerin tek bir kaynağı vardır:
 *   düğüm sayısı ............ state.ts ALL_LOCS (5 taban + 4 kopya = 9)
 *   düğüm adı/kişiliği ...... themes.ts econ (entryBase, priceElasticity,
 *                             repWeight, signWeight, tipRate, wageMult)
 *   açık/kilitli ............ state.unlockedLocs + state.canUnlockLoc()
 *   açılış bedeli ........... state.branchUnlockCost() (artan çarpanlı GERÇEK bedel)
 *   yıldız şartı ............ themeFor(id).unlock.stars
 *   kısıt rozetleri ......... BRANCH_COPIES (opexMult, land, tank, rampCap, rivalStrength)
 *   günlük net .............. state.branchNetPerDay()
 *   hatlar (kenarlar) ....... state.supplyLine() — taban↔kopya ORTAK TEDARİK HATTI
 *   kota doluluğu ........... state.supplyFill() / supplyRemaining()
 *
 * ═══ PROTOTİPTE OLUP BURADA OLMAYANLAR (bilerek çıkarıldı) ═══
 * Kavram prototipinde 14 düğüm, rakip yayılması, bölge kontrol bonusu (+%12),
 * ikmal depoları ve km-bazlı nakliye maliyeti vardı. HİÇBİRİNİN oyunda mekanik
 * karşılığı yok. Oyun sahibinin kuralı: uydurma. Ya gerçek mekanik ekle ya da
 * gösterme. Bunlar GÖSTERİLMİYOR — haritada boş vaat yok.
 *   · rakip: oyunda ŞUBEYE AİT bir alan (LOC_FIELDS 'rival'), haritada gezen bir
 *     aktör değil. Düğüm "rakibe geçmez". Kopyanın doğuş gücü (rivalStrength)
 *     gerçek olduğu için YALNIZ o, detay kartında rozet olarak duruyor.
 *   · bölge bonusu: yok. Yerine GERÇEK olan gösteriliyor — ortak tedarik hattı.
 *
 * Bu dosya Three.js bilmez; saf DOM + state okur. Aksiyonlar (şube aç / şubeye git)
 * main.ts'teki MEVCUT akışa geri çağrılır — ikinci bir ekonomi yolu AÇILMAZ.
 */
import { t } from './i18n'
import {
  ALL_LOCS, BASE_LOCS, BRANCH_COPIES, GameState, SUPPLY_LINE_QUOTA,
  REFINERY_MAX, REFINERY_NAMES, REFINERY_OPEX, REFINERY_DISCOUNT, REFINERY_ETA_MULT,
  baseLoc, isCopyLoc, themeFor,
  type BaseLocId, type CopyLocId, type LocId,
} from './state'
import type { LocationTheme } from './themes'

/* ══════════════════════════════════════════════════════════════════════════
   1) YERLEŞİM — düğümlerin tahtadaki yeri
   ══════════════════════════════════════════════════════════════════════════
   Coğrafya UYDURULMUŞ değil, temanın KİMLİĞİNDEN türetilmiş: marina kıyıda,
   kasaba iç kesimde, otoyol kuzey sırtında, metropol güneydoğu havzasında.
   Kopya her zaman tabanının hemen ötesinde durur — aralarındaki çizgi
   (ortak tedarik hattı) kısa ve okunur olsun diye. */
export const HARITA_VIEWBOX = '0 0 1000 660'
export const HARITA_KONUM: Record<LocId, readonly [number, number]> = {
  kasaba: [198, 232],
  marina: [128, 452],
  'marina-2': [288, 566],
  cevreyolu: [404, 158],
  'cevreyolu-2': [568, 96],
  otoyol: [746, 162],
  'otoyol-2': [898, 264],
  metropol: [606, 398],
  'metropol-2': [802, 508],
}
/** RAFİNERİ: şube değil, ŞİRKET tesisi — tahtanın ortasında, tüm tabanlara eşit uzaklıkta.
 *  Devirde sıfırlanmaz; konumu da şubeler gibi hikâyeden değil işlevinden gelir. */
export const RAFINERI_ID = 'rafineri' as const
export const RAFINERI_KONUM: readonly [number, number] = [470, 300]

/** Taban şube → sprite sembolü (index.html'deki #i-loc-* symbol'leri). */
const IKON: Record<BaseLocId, string> = {
  kasaba: 'i-loc-kasaba',
  cevreyolu: 'i-loc-cevreyolu',
  otoyol: 'i-loc-otoyol',
  marina: 'i-loc-marina',
  metropol: 'i-loc-metropol',
}

/** themes.ts palette.accent (0x1fa8bc) → '#1fa8bc'. Tema aksanı düğümün sağ üst noktası. */
function aksanHex(th: LocationTheme): string {
  return '#' + (th.palette.accent >>> 0).toString(16).padStart(6, '0')
}

/* ══════════════════════════════════════════════════════════════════════════
   2) VERİ — saf, DOM'suz. Test bu fonksiyonları doğrudan çağırır.
   ══════════════════════════════════════════════════════════════════════════ */

/** Düğümün oyuncu açısından durumu. 'firsat' = ŞU AN açılabilir (para+yıldız yeterli). */
export type HaritaDurum = 'aktif' | 'acik' | 'firsat' | 'kilit'

export interface HaritaDugum {
  id: LocId
  ad: string
  taban: BaseLocId
  kopya: boolean
  x: number
  y: number
  durum: HaritaDurum
  /** kilitliyse neden: 'taban' (önce taban şube) · 'yildiz' · 'para' */
  sebep: '' | 'taban' | 'yildiz' | 'para'
  /** GERÇEK açılış bedeli — state.branchUnlockCost (artan çarpan dahil) */
  bedel: number
  /** themes.ts unlock.stars (kopyada +starsAdd ile türetilmiş) */
  yildizSart: number
  /** themes.ts econ — düğümün "kişiliği" */
  econ: LocationTheme['econ']
  /** themes.ts features — arsa/tank/rampa kısıtları */
  features: LocationTheme['features']
  /** BRANCH_COPIES.opexMult (taban şubede 1) */
  opexMult: number
  /** BRANCH_COPIES.note — kopyanın kısıt gerekçesi (taban şubede boş) */
  not: string
  /** BRANCH_COPIES.rivalStrength — rakip bu güçle DOĞAR (yalnız otoyol-2'de tanımlı) */
  rakipGucu: number | null
  /** state.branchNetPerDay — müdür seviyesi ve günlük net (açık şubelerde) */
  mudurSv: number
  mudurNet: number
  /** müdür YOKSA "Sv.1 tutsan ne gelirdi" — panelin mevcut kalıbıyla aynı */
  mudurTahmin: number
  /** state.branchVault — toplanmayı bekleyen eski birikim */
  kasa: number
  aksan: string
  ikon: string
}

/**
 * Haritanın düğümleri. Sayı = GERÇEK şube sayısı (ALL_LOCS), hayali düğüm YOK.
 * Kilitli tabanın kopyası da listelenir ama 'taban' sebebiyle kilitli görünür —
 * oyuncu zincirin nereye gittiğini görsün diye (Ofis listesi bunu gizliyordu).
 */
export function haritaDugumleri(s: GameState): HaritaDugum[] {
  return ALL_LOCS.map((id): HaritaDugum => {
    const th = themeFor(id)
    const acik = s.unlockedLocs.includes(id)
    const c = s.canUnlockLoc(id)
    const kopya = isCopyLoc(id)
    const sp = kopya ? BRANCH_COPIES[id as CopyLocId] : null
    // aktif şubede branchNetPerDay ANLAMSIZ (gelir anlık işliyor, snapshot yok) — 0 bırakılır
    const d = acik && id !== s.activeLoc ? s.branchNetPerDay(id) : { net: 0, level: 0 }
    const tahmin = acik && id !== s.activeLoc && d.level === 0 ? s.branchNetPerDay(id, 1).net : 0
    const konum = HARITA_KONUM[id] ?? ([500, 330] as const)
    return {
      id,
      ad: th.name,
      taban: baseLoc(id),
      kopya,
      x: konum[0],
      y: konum[1],
      durum: id === s.activeLoc ? 'aktif' : acik ? 'acik' : c.ok ? 'firsat' : 'kilit',
      sebep: acik ? '' : c.ok ? '' : (c.reason as 'taban' | 'yildiz' | 'para'),
      bedel: c.cash,
      yildizSart: th.unlock.stars,
      econ: th.econ,
      features: th.features,
      opexMult: s.branchOpexMult(id),
      not: sp?.note ?? '',
      rakipGucu: sp?.rivalStrength ?? null,
      mudurSv: d.level,
      mudurNet: d.net,
      mudurTahmin: tahmin,
      kasa: Math.round(s.branchVault[id] ?? 0),
      aksan: aksanHex(th),
      ikon: IKON[baseLoc(id)],
    }
  })
}

/** Rafineri düğümünün TEK veri kaynağı — test ve çizim aynı fonksiyondan okur. */
export interface RafineriDugum {
  x: number; y: number
  seviye: number          // 0..REFINERY_MAX
  insaat: boolean         // inşaat sürüyor mu
  gunKaldi: number
  ilerleme: number        // 0..1 (inşaat yoksa 0)
  /** state.canBuildRefinery() — sonraki kademe alınabilir mi, neden değil */
  sonraki: ReturnType<GameState['canBuildRefinery']>
  opex: number
  indirim: number         // aktif alış indirimi (0 veya REFINERY_DISCOUNT)
  kotasiz: boolean        // kademe 2+: ortak hat kotası kalktı
  filo: boolean           // kademe 3: Rafineri Filosu tedarikçisi açık
}
export function rafineriDugumu(s: GameState): RafineriDugum {
  const sonraki = s.canBuildRefinery()
  return {
    x: RAFINERI_KONUM[0], y: RAFINERI_KONUM[1],
    seviye: s.refineryLevel,
    insaat: s.refineryDaysLeft > 0,
    gunKaldi: s.refineryDaysLeft,
    ilerleme: s.refineryProgress(),
    sonraki,
    opex: s.refineryOpex(),
    indirim: s.refineryDiscount(),
    kotasiz: s.refineryLevel >= 2,
    filo: s.refineryLevel >= REFINERY_MAX,
  }
}

export interface HaritaHat {
  taban: BaseLocId
  kopya: CopyLocId
  /** hat GERÇEKTEN kurulu mu — state.supplyLine(): hem taban hem kopya açık */
  aktif: boolean
  /** bugün kotanın ne kadarı kullanıldı (0..1) — state.supplyFill() */
  doluluk: number
  /** bugün kalan litre — state.supplyRemaining(); rafineri kademe 2+ ile Infinity */
  kalan: number
  /** kota kalktı (rafineri kademe 2+) — metinlerde "sınırsız" yazılır */
  kotasiz: boolean
}

/**
 * Haritanın KENARLARI. Prototipteki "komşuluk grafiği" kavramdı; oyunda hatların
 * TEK gerçek karşılığı taban↔kopya ortak tedarik hattıdır (state.supplyLine).
 * Kasabanın kopyası olmadığı için kasaba hatsızdır — tahtada da öyle görünür.
 */
export function haritaHatlari(s: GameState): HaritaHat[] {
  const out: HaritaHat[] = []
  for (const b of BASE_LOCS) {
    const kopya = `${b}-2`
    if (!isCopyLoc(kopya)) continue // kasaba: kopyası yok → hat yok
    const aktif = s.supplyLine(b) === b
    out.push({
      taban: b,
      kopya: kopya as CopyLocId,
      aktif,
      doluluk: aktif ? s.supplyFill(b) : 0,
      kalan: aktif ? Math.round(s.supplyRemaining(b)) : s.supplyQuota(b), // kurulu değilken taban kota gösterilir
      kotasiz: s.refineryLevel >= 2,
    })
  }
  return out
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BİÇİMLEME
   ══════════════════════════════════════════════════════════════════════════ */
const tl = (n: number) => Math.round(n).toLocaleString('tr-TR')
/** litre metni — rafineri kademe 2+ kotayı kaldırır (Infinity) → "∞" */
const lt = (n: number) => Number.isFinite(n) ? tl(n) : '∞'
/** kompakt para — düğüm altındaki iki satırlık alana ₺22.000.000 sığmaz */
function para(v: number): string {
  const a = Math.abs(v), im = v < 0 ? '−' : ''
  if (a >= 1e6) return `${im}₺${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace('.', ',')} mn`
  if (a >= 1e3) return `${im}₺${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace('.', ',')} b`
  return `${im}₺${tl(a)}`
}
const esc = (s: string) => s.replace(/[<>&]/g, ch => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[ch]!))
const vir = (n: number, b = 2) => n.toFixed(b).replace('.', ',')
/** Tahta etiketi: kopyaların uzun adı ("Otoyol II · Rakip Çıkışı") komşu düğümün
 *  üstüne taşıyordu. Haritada ayırt edici ilk parça yeter; TAM ad detay kartında. */
const kisaAd = (ad: string) => ad.split('·')[0].trim()

/* ══════════════════════════════════════════════════════════════════════════
   4) ARKA PLAN — oyun sahibinin tek görsel notu ("arkaplanı da çözersen")
   ══════════════════════════════════════════════════════════════════════════
   Düz krem zemin tahtayı bir Excel çizelgesi gibi gösteriyordu. Buraya oyunun
   izometrik/tabela diliyle uyumlu bir KÂĞIT HARİTA dokusu kondu:
     · kıyı şeridi + şamandıra dalgaları (marina ailesi suyun içinde durur)
     · topografya eğrileri (otoyol kuzey sırtı, kasaba tepeleri)
     · yol izleri: kılıf + iç şerit — oyunun asfalt/çizgi dili
     · kent bloğu taraması (metropol havzası) + kâğıt nokta dokusu
   HEPSİ token + opaklık üzerinden boyanır: --ink koyu temada AÇIK olduğu için
   aynı kural iki temada da doğru çalışır (ayrı koyu-tema kuralı YAZILMADI).
   YOL İZLERİ VERİ DEĞİLDİR — bilerek düşük kontrastlı; veri taşıyan tek çizgi
   kırmızı akan tedarik hattıdır (legend bunu yazar). */
function zemin(): string {
  const yol = (d: string) =>
    `<path class="hz-road-case" d="${d}"/><path class="hz-road-core" d="${d}"/>`
  return `
  <g class="hz" aria-hidden="true">
    <rect x="0" y="0" width="1000" height="660" class="hz-paper"/>
    <rect x="0" y="0" width="1000" height="660" fill="url(#hz-dots)"/>

    <!-- KÖRFEZ: marina ailesi bu suyun içindedir -->
    <path class="hz-water" d="M0 300 C 110 318, 190 372, 250 452 C 310 532, 372 590, 470 660 L 0 660 Z"/>
    <path class="hz-shore" d="M0 300 C 110 318, 190 372, 250 452 C 310 532, 372 590, 470 660"/>
    <path class="hz-wave" d="M0 352 C 96 370, 168 420, 224 494 C 274 560, 322 606, 396 660"/>
    <path class="hz-wave" d="M0 406 C 78 424, 140 466, 190 530 C 232 584, 268 620, 322 660"/>
    <path class="hz-wave" d="M0 462 C 62 480, 108 512, 148 562 C 180 602, 206 632, 244 660"/>

    <!-- TOPOGRAFYA: kuzey sırtı (otoyol) ve batı tepeleri (kasaba) -->
    <ellipse class="hz-contour" cx="832" cy="146" rx="196" ry="104" transform="rotate(-13 832 146)"/>
    <ellipse class="hz-contour" cx="832" cy="146" rx="146" ry="74" transform="rotate(-13 832 146)"/>
    <ellipse class="hz-contour" cx="832" cy="146" rx="96" ry="46" transform="rotate(-13 832 146)"/>
    <ellipse class="hz-contour" cx="268" cy="128" rx="164" ry="84" transform="rotate(9 268 128)"/>
    <ellipse class="hz-contour" cx="268" cy="128" rx="110" ry="54" transform="rotate(9 268 128)"/>

    <!-- KENT BLOĞU TARAMASI: metropol havzası -->
    <g class="hz-block">
      <rect x="638" y="440" width="44" height="30" rx="6"/><rect x="692" y="448" width="34" height="26" rx="6"/>
      <rect x="640" y="480" width="30" height="34" rx="6"/><rect x="680" y="486" width="46" height="28" rx="6"/>
      <rect x="736" y="446" width="28" height="44" rx="6"/><rect x="736" y="500" width="42" height="26" rx="6"/>
      <rect x="852" y="452" width="36" height="30" rx="6"/><rect x="856" y="492" width="28" height="38" rx="6"/>
      <rect x="900" y="456" width="26" height="26" rx="6"/>
    </g>

    <!-- YOL İZLERİ (dekor): kuzey otoyolu · çevre yolu · sahil yolu · kent bağlantısı -->
    ${yol('M238 262 C 316 200, 352 170, 404 158 S 522 110, 568 96 C 652 82, 702 128, 746 162 C 802 206, 856 234, 898 264 L 1000 322')}
    ${yol('M198 232 C 262 300, 332 350, 432 372 C 512 390, 562 392, 606 398 C 692 410, 752 460, 802 508 L 882 582')}
    ${yol('M198 232 C 150 300, 124 380, 128 452 C 132 512, 202 542, 288 566')}
    ${yol('M606 398 C 582 302, 524 214, 456 174')}
  </g>`
}

/** defs: nokta dokusu + plaka gölgesi. Tekrar üretilmesin diye render başında bir kez. */
function tanimlar(): string {
  return `<defs>
    <pattern id="hz-dots" width="28" height="28" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" class="hz-dot"/>
    </pattern>
    <filter id="hz-soft" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#22303c" flood-opacity=".20"/>
    </filter>
  </defs>`
}

/* ══════════════════════════════════════════════════════════════════════════
   5) TAHTA ÇİZİMİ
   ══════════════════════════════════════════════════════════════════════════ */
const R = 30 // düğüm plakasının yarı boyu

function hatCiz(h: HaritaHat, dg: Map<LocId, HaritaDugum>): string {
  const a = dg.get(h.taban), b = dg.get(h.kopya)
  if (!a || !b) return ''
  const d = `M${a.x} ${a.y} L${b.x} ${b.y}`
  if (!h.aktif) {
    // hat HENÜZ YOK (bir uç kapalı) — kesikli, sessiz: "burada bir hat OLABİLİR"
    return `<path class="hl hl-off" d="${d}"/>`
  }
  const dolu = h.doluluk >= 0.5 ? ' hl-hot' : ''
  return `<path class="hl hl-base${dolu}" d="${d}"/><path class="hl hl-flow${dolu}" d="${d}"/>`
}

/** Rafineri → açık TABAN şubeler: kademe 1+ iken ince turuncu besleme hatları.
 *  Kademe 0'da hiç çizilmez (tesis yokken hat da yok). */
function rafineriHatlariCiz(r: RafineriDugum, s: GameState, dg: Map<LocId, HaritaDugum>): string {
  if (r.seviye < 1) return ''
  let out = ''
  for (const b of BASE_LOCS) {
    if (!s.unlockedLocs.includes(b)) continue
    const n = dg.get(b); if (!n) continue
    const d = `M${r.x} ${r.y} L${n.x} ${n.y}`
    out += `<path class="hl hl-raf-base" d="${d}"/><path class="hl hl-raf" d="${d}"/>`
  }
  return out
}

function rafineriCiz(r: RafineriDugum, secili: boolean): string {
  const alt = r.insaat ? t('{0} gün kaldı', String(r.gunKaldi))
    : r.seviye >= REFINERY_MAX ? t('Kademe {0} · FİLO', String(r.seviye))
    : r.seviye > 0 ? t('Kademe {0}', String(r.seviye))
    : r.sonraki.ok ? para(r.sonraki.cost)
    : r.sonraki.reason === 'yildiz' ? `${r.sonraki.stars}★`
    : r.sonraki.reason === 'sube' ? t('{0} şube', String(r.sonraki.locs))
    : para(r.sonraki.cost)
  const durum = r.seviye > 0 ? 'raf-on' : r.sonraki.ok ? 'firsat' : 'kilit'
  const RR = R + 4
  const halka = secili
    ? `<rect class="hn-ring" x="${r.x - RR - 9}" y="${r.y - RR - 9}" width="${(RR + 9) * 2}" height="${(RR + 9) * 2}" rx="26"/>`
      + `<rect class="hn-ring hn-ring-pulse" x="${r.x - RR - 9}" y="${r.y - RR - 9}" width="${(RR + 9) * 2}" height="${(RR + 9) * 2}" rx="26"/>`
    : ''
  // inşaat ilerlemesi: plakanın altında ince turuncu şerit
  const bar = r.insaat
    ? `<rect class="hn-raf-track" x="${r.x - RR + 6}" y="${r.y + RR - 9}" width="${(RR - 6) * 2}" height="4" rx="2"/>`
      + `<rect class="hn-raf-fill" x="${r.x - RR + 6}" y="${r.y + RR - 9}" width="${Math.max(2, (RR - 6) * 2 * r.ilerleme)}" height="4" rx="2"/>`
    : ''
  return `<g class="hn hn-raf hn-${durum}${secili ? ' is-sel' : ''}" data-hloc="${RAFINERI_ID}" tabindex="0"
    role="button" aria-label="${t('Rafineri')}">
    ${halka}
    <rect class="hn-lip" x="${r.x - RR}" y="${r.y - RR + 5}" width="${RR * 2}" height="${RR * 2}" rx="20"/>
    <rect class="hn-plate" x="${r.x - RR}" y="${r.y - RR}" width="${RR * 2}" height="${RR * 2}" rx="20" filter="url(#hz-soft)"/>
    <use class="hn-icon" href="#i-loc-rafineri" x="${r.x - 16}" y="${r.y - 17}" width="32" height="32"/>
    ${bar}
    ${r.seviye > 0 ? `<text class="hn-tag hn-raf-tag" x="${r.x + RR - 13}" y="${r.y - RR + 13}">${r.seviye}</text>` : ''}
    <text class="hn-label" x="${r.x}" y="${r.y + RR + 19}" text-anchor="middle">${t('Rafineri')}</text>
    <text class="hn-sub" x="${r.x}" y="${r.y + RR + 34}" text-anchor="middle">${esc(alt)}</text>
    <rect class="hn-hit" x="${r.x - RR - 8}" y="${r.y - RR - 8}" width="${(RR + 8) * 2}" height="${(RR + 8) * 2 + 32}" rx="24"/>
  </g>`
}

function dugumCiz(n: HaritaDugum, secili: boolean): string {
  const alt = n.durum === 'aktif' ? t('BURADASIN')
    : n.durum === 'acik' ? (n.mudurSv > 0 ? `${para(n.mudurNet)}/${t('gün')}` : t('müdür yok'))
    : n.durum === 'firsat' ? para(n.bedel)
    : n.sebep === 'yildiz' ? `${n.yildizSart}★`
    : n.sebep === 'taban' ? t('önce {0}', kisaAd(themeFor(n.taban).name))
    : para(n.bedel)
  const halka = secili
    ? `<rect class="hn-ring" x="${n.x - R - 9}" y="${n.y - R - 9}" width="${(R + 9) * 2}" height="${(R + 9) * 2}" rx="24"/>`
      + `<rect class="hn-ring hn-ring-pulse" x="${n.x - R - 9}" y="${n.y - R - 9}" width="${(R + 9) * 2}" height="${(R + 9) * 2}" rx="24"/>`
    : ''
  return `<g class="hn hn-${n.durum}${secili ? ' is-sel' : ''}" data-hloc="${n.id}" tabindex="0"
    role="button" aria-label="${esc(n.ad)}">
    ${halka}
    <rect class="hn-lip" x="${n.x - R}" y="${n.y - R + 5}" width="${R * 2}" height="${R * 2}" rx="18"/>
    <rect class="hn-plate" x="${n.x - R}" y="${n.y - R}" width="${R * 2}" height="${R * 2}" rx="18" filter="url(#hz-soft)"/>
    <use class="hn-icon" href="#${n.ikon}" x="${n.x - 14}" y="${n.y - 14}" width="28" height="28"/>
    <circle class="hn-accent" cx="${n.x + R - 7}" cy="${n.y - R + 7}" r="5" style="fill:${n.aksan}"/>
    ${n.kopya ? `<text class="hn-tag" x="${n.x - R + 1}" y="${n.y + R - 3}">II</text>` : ''}
    <text class="hn-label" x="${n.x}" y="${n.y + R + 19}" text-anchor="middle">${esc(kisaAd(n.ad))}</text>
    <text class="hn-sub" x="${n.x}" y="${n.y + R + 34}" text-anchor="middle">${esc(alt)}</text>
    <rect class="hn-hit" x="${n.x - R - 8}" y="${n.y - R - 8}" width="${(R + 8) * 2}" height="${(R + 8) * 2 + 32}" rx="22"/>
  </g>`
}

/* ══════════════════════════════════════════════════════════════════════════
   6) DETAY KARTI
   ══════════════════════════════════════════════════════════════════════════ */
function kisiBar(ad: string, oran: number, deger: string, renk: string): string {
  const p = Math.max(4, Math.min(100, Math.round(oran * 100)))
  return `<div class="hp"><div class="hp-l"><span>${ad}</span><b>${deger}</b></div>`
    + `<div class="hp-bar"><i style="width:${p}%;background:${renk}"></i></div></div>`
}
const satir = (k: string, v: string, cls = '') =>
  `<div class="hrow"><span>${k}</span><span class="hnum ${cls}">${v}</span></div>`

function detayKarti(n: HaritaDugum, s: GameState, hat: HaritaHat | undefined): string {
  const e = n.econ
  const durumEtiket = n.durum === 'aktif' ? t('AKTİF ŞUBE')
    : n.durum === 'acik' ? t('ŞUBEN')
    : n.durum === 'firsat' ? t('AÇILABİLİR')
    : t('KİLİTLİ')

  let s1 = `<div class="hcard hdetail">
    <div class="hd-head">
      <span class="hd-icon" style="color:${n.aksan}"><svg class="ic"><use href="#${n.ikon}"/></svg></span>
      <span class="hd-t">
        <b>${esc(n.ad)}</b>
        <span class="hd-meta">${n.kopya ? t('KOPYA ŞUBE') : t('TABAN ŞUBE')} · ${esc(themeFor(n.taban).name.toLocaleUpperCase('tr'))}</span>
      </span>
      <span class="hd-pill hd-${n.durum}">${durumEtiket}</span>
    </div>

    <div class="hd-pers">
      ${kisiBar(t('TABAN ÇEKİCİLİK'), e.entryBase / 0.45, '%' + vir(e.entryBase * 100, 1), n.aksan)}
      ${kisiBar(t('FİYAT GÜCÜ'), (1.7 - e.priceElasticity) / 1.7, vir(e.priceElasticity), n.aksan)}
      ${kisiBar(t('İTİBAR AĞIRLIĞI'), e.repWeight / 2, vir(e.repWeight), n.aksan)}
      ${kisiBar(t('TABELA ETKİSİ'), e.signWeight / 2.2, vir(e.signWeight), n.aksan)}
    </div>
    <div class="hd-src">${t('Kişilik değerleri şubenin kendi temasından okunur (themes.ts) — bu ekranda hesaplanmaz.')}</div>

    <div class="hrows">`

  // — kişiliğin sayısal ayrıntısı (hepsi themes.ts) —
  s1 += satir(t('Bahşiş oranı'), '%' + vir(e.tipRate * 100, 0))
  if (e.wageMult && e.wageMult !== 1) s1 += satir(t('Yovmiye çarpanı'), '×' + vir(e.wageMult), 'bad')
  if (n.opexMult !== 1) s1 += satir(t('İşletme gideri (kira)'), '×' + vir(n.opexMult), 'bad')
  const land = n.features?.land
  if (land) s1 += satir(t('Arsa'), t('{0} parsel · fiyat ×{1}', String(land.maxParcels), vir(land.priceMult, 1)))
  if (n.features?.tankCapMult) {
    s1 += satir(t('Tank kapasitesi'), `×${n.features.tankCapMult} · ${t('yakıt başına {0} tank', String(n.features.maxTanksPerFuel ?? 0))}`)
  }
  if (n.features?.highway) s1 += satir(t('Yavaşlama şeridi'), t('{0} araç', String(n.features.highway.rampCap)))
  if (n.features?.regulars) s1 += satir(t('Müdavim tabanı'), '%' + vir(n.features.regulars.share * 100, 0))
  if (n.features?.walkIns) s1 += satir(t('Yaya müşteri'), t('{0} sn’de bir', String(n.features.walkIns.everySec)))
  if (n.rakipGucu !== null) s1 += satir(t('Rakip DOĞUŞ gücü'), vir(n.rakipGucu), 'bad')

  // — durum/bedel —
  if (n.durum === 'firsat' || n.durum === 'kilit') {
    s1 += satir(t('Açılış bedeli'), `₺${tl(n.bedel)}`)
    s1 += satir(t('Marka yıldızı şartı'), `${n.yildizSart}★ · ${t('sende {0}★', String(s.brandStars))}`,
      s.brandStars >= n.yildizSart ? 'good' : 'bad')
    if (n.sebep === 'para') {
      const pct = Math.min(100, Math.round((s.money / Math.max(1, n.bedel)) * 100))
      s1 += `<div class="hprog"><div class="pz-bar" style="margin:6px 0 3px"><div class="pz-fill" style="width:${pct}%"></div></div>`
        + `<span>${t('₺{0} kaldı (%{1})', tl(Math.max(0, n.bedel - s.money)), String(pct))}</span></div>`
    }
  } else if (n.durum === 'acik') {
    s1 += n.mudurSv > 0
      ? satir(t('Müdür Sv.{0} · günlük net', String(n.mudurSv)), `₺${tl(n.mudurNet)}`, 'good')
      : satir(t('Müdür YOK'), n.mudurTahmin > 0
          ? t('Sv.1 tutsan ~₺{0}/gün', tl(n.mudurTahmin))
          : t('şube kapalı duruyor'), 'bad')
    if (n.kasa > 0) s1 += satir(t('Kasada bekleyen'), `₺${tl(n.kasa)}`, 'good')
  } else {
    s1 += satir(t('Durum'), t('şu an bu şubedesin — gelir anlık işliyor'), 'good')
  }
  s1 += `</div>`

  // — kopyanın kısıt gerekçesi —
  if (n.not) s1 += `<div class="hnote">${esc(n.not)}</div>`

  // — ortak tedarik hattı: GERÇEK mekanik, bu düğümün kararına doğrudan giriyor —
  if (hat) {
    const kardes = hat.taban === n.id ? hat.kopya : hat.taban
    if (hat.aktif && hat.kotasiz) {
      s1 += `<div class="hnote hnote-line"><b>${t('Ortak tedarik hattı kurulu')}</b><br>
        ${t('Rafineri Depolama Terminali sayesinde kota yok: {0} ile {1} sınırsız çekiyor.', esc(themeFor(hat.taban).name), esc(themeFor(hat.kopya).name))}</div>`
    } else if (hat.aktif) {
      const pct = Math.round(hat.doluluk * 100)
      s1 += `<div class="hnote hnote-line">
        <b>${t('Ortak tedarik hattı kurulu')}</b><br>
        ${t('{0} ile {1} AYNI bölge deposundan çekiyor. Bugün kotanın %{2}’si kullanıldı — kalan {3} L. Hepsini bir şubede harcarsan kardeş şube yarın aç kalır.',
          esc(themeFor(hat.taban).name), esc(themeFor(hat.kopya).name), String(pct), lt(hat.kalan))}
        <div class="pz-bar" style="margin:6px 0 0"><div class="pz-fill${pct >= 50 ? ' hot' : ''}" style="width:${Math.min(100, pct)}%"></div></div>
      </div>`
    } else if (hat.kotasiz) {
      s1 += `<div class="hnote">${t('Bu şube açılırsa {0} ile ORTAK tedarik hattına girer — rafineri sayesinde kota yok.', esc(themeFor(kardes).name))}</div>`
    } else {
      s1 += `<div class="hnote">${t('Bu şube açılırsa {0} ile ORTAK tedarik hattına girer: günlük kota (en az {1} L, tank kapasiten kadar) ikiye bölünür.',
        esc(themeFor(kardes).name), tl(SUPPLY_LINE_QUOTA))}</div>`
    }
  }

  // — aksiyon: MEVCUT akışa bağlanır, ikinci ekonomi yolu yok —
  if (n.durum === 'firsat') {
    s1 += `<button class="btn good hact" data-hunlock="${n.id}">${t('Şube Aç · ₺{0}', tl(n.bedel))}</button>`
  } else if (n.durum === 'acik') {
    s1 += `<button class="btn hact" data-hgo="${n.id}">${t('Şubeye Git')}</button>`
  } else if (n.durum === 'aktif') {
    s1 += `<button class="btn hact" disabled>${t('Şu an buradasın')}</button>`
  } else {
    const neden = n.sebep === 'taban' ? t('Önce {0} şubesini aç', esc(themeFor(n.taban).name))
      : n.sebep === 'yildiz' ? t('{0} marka yıldızı gerekir', String(n.yildizSart))
      : t('Kasa yetmiyor · ₺{0}', tl(n.bedel))
    s1 += `<button class="btn hact" disabled>${neden}</button>`
  }
  return s1 + `</div>`
}

/** RAFİNERİ KARTI: kademe merdiveni + etkisi + inşaat + satın alma. Şube kartından
 *  farkı: burada müdür/kasa yok, bu bir ŞİRKET tesisidir — devirde de kalır. */
function rafineriKarti(r: RafineriDugum, s: GameState): string {
  const c = r.sonraki
  const etiket = r.insaat ? t('İNŞAAT') : r.seviye >= REFINERY_MAX ? t('TAM KAPASİTE')
    : r.seviye > 0 ? t('KADEME {0}', String(r.seviye)) : c.ok ? t('KURULABİLİR') : t('KİLİTLİ')
  const pill = r.insaat ? 'hd-insaat' : r.seviye > 0 ? 'hd-aktif' : c.ok ? 'hd-firsat' : ''

  let h = `<div class="hcard hdetail hdetail-raf">
    <div class="hd-head">
      <span class="hd-icon" style="color:var(--orange)"><svg class="ic"><use href="#i-loc-rafineri"/></svg></span>
      <span class="hd-t"><b>${t('Rafineri')}</b>
        <span class="hd-meta">${t('ŞİRKET TESİSİ · DEVİRDE KALIR')}</span></span>
      <span class="hd-pill ${pill}">${etiket}</span>
    </div>`

  // — kademe merdiveni: her satır ne verdiğini söyler; alınmış olan işaretli —
  const etki = [
    t('alış −%{0} · ortak hat kotası ×2', String(Math.round(REFINERY_DISCOUNT * 100))),
    t('kota kalkar · tanker {0}× hızlı', vir(REFINERY_ETA_MULT, 2)),
    t('“Rafineri Filosu” tedarikçisi: ham petrol fiyatından'),
  ]
  h += `<div class="hraf-lad">`
  for (let i = 0; i < REFINERY_MAX; i++) {
    const st = i < r.seviye ? 'on' : (i === r.seviye && r.insaat) ? 'wip' : (i === r.seviye) ? 'next' : ''
    h += `<div class="hraf-step ${st}"><i>${i < r.seviye ? '✓' : i + 1}</i>
      <span><b>${esc(REFINERY_NAMES[i])}</b><small>${etki[i]}</small></span>
      <em>₺${tl(REFINERY_OPEX[i + 1])}/${t('gün')}</em></div>`
  }
  h += `</div>`

  // — şu anki etki —
  if (r.seviye > 0) {
    if (r.indirim > 0) h += satir(t('Alış fiyatı'), t('−%{0}', String(Math.round(r.indirim * 100))), 'good')
    if (r.filo) h += satir(t('Tedarikçi'), t('Rafineri Filosu açık'), 'good')
    h += satir(t('Ortak hat kotası'), r.kotasiz ? t('sınırsız') : t('×2'), 'good')
    h += satir(t('İşletme gideri'), `₺${tl(r.opex)}/${t('gün')}`, 'bad')
  }

  // — inşaat —
  if (r.insaat) {
    const pct = Math.round(r.ilerleme * 100)
    h += `<div class="hnote hnote-line"><b>${t('{0} inşa ediliyor', esc(REFINERY_NAMES[r.seviye]))}</b><br>
      ${t('{0} gün kaldı · para peşin ödendi, bedel bugün varlığına yazıldı.', String(r.gunKaldi))}
      <div class="pz-bar" style="margin:6px 0 0"><div class="pz-fill" style="width:${Math.max(3, pct)}%"></div></div></div>`
  }

  // — aksiyon —
  if (c.ok) {
    h += `<div class="hd-src">${t('İnşaat {0} gün sürer; kademe tamamlanınca etkisi anında başlar.', String(c.days))}</div>`
    h += `<button class="btn good hact" data-hraf="1">${t('Kademe {0} Kur · ₺{1}', String(c.level), tl(c.cost))}</button>`
  } else if (c.reason === 'insaat') {
    h += `<button class="btn hact" disabled>${t('İnşaat sürüyor · {0} gün', String(r.gunKaldi))}</button>`
  } else if (c.reason === 'max') {
    h += `<button class="btn hact" disabled>${t('Tam kapasite')}</button>`
  } else {
    const neden = c.reason === 'yildiz' ? t('{0} marka yıldızı gerekir', String(c.stars))
      : c.reason === 'sube' ? t('{0} açık şube gerekir', String(c.locs))
      : t('Kasa yetmiyor · ₺{0}', tl(c.cost))
    h += `<div class="hd-src">${t('Kademe {0} · ₺{1} · {2}★ · {3} şube', String(c.level), tl(c.cost), String(c.stars), String(c.locs))}</div>`
    h += `<button class="btn hact" disabled>${neden}</button>`
  }
  return h + `</div>`
}

/* ══════════════════════════════════════════════════════════════════════════
   7) BAĞLAMA — main.ts buradan kurar
   ══════════════════════════════════════════════════════════════════════════ */
export interface HaritaCtx {
  state: GameState
  /** MEVCUT şube açma akışı (main.ts) — harita ikinci bir yol açmaz */
  onAc: (id: LocId) => void
  /** MEVCUT şube geçiş akışı (main.ts subeyeGec) */
  onGit: (id: LocId) => void
  /** Rafineri kademesi satın al — state.startRefinery + toast main.ts'te */
  onRafineri?: () => void
}

let ctx: HaritaCtx | null = null
let secili: LocId | typeof RAFINERI_ID | null = null
let kuruldu = false

/** Modalın açık olup olmadığı — main.ts döngüsü canlı tazeleme için sorar */
export function haritaAcikMi(): boolean {
  return document.getElementById('mapwrap')?.classList.contains('show') ?? false
}

export function haritaCiz(): void {
  if (!ctx) return
  const s = ctx.state
  const svg = document.getElementById('hmap')
  const yan = document.getElementById('h-side')
  const cip = document.getElementById('h-chips')
  const efsane = document.getElementById('h-legend')
  if (!svg || !yan || !cip || !efsane) return

  const list = haritaDugumleri(s)
  const dg = new Map(list.map(n => [n.id, n]))
  const hatlar = haritaHatlari(s)
  const raf = rafineriDugumu(s)
  // seçili düğüm hep geçerli kalsın (şube açıldı/değişti → aktif şubeye düş)
  if (!secili || (secili !== RAFINERI_ID && !dg.has(secili))) secili = s.activeLoc
  const rafSecili = secili === RAFINERI_ID

  svg.innerHTML = tanimlar() + zemin()
    + `<g class="hlines">${rafineriHatlariCiz(raf, s, dg)}${hatlar.map(h => hatCiz(h, dg)).join('')}</g>`
    + `<g class="hnodes">${rafineriCiz(raf, rafSecili)}${list.map(n => dugumCiz(n, n.id === secili)).join('')}</g>`

  // ── üst şerit: kasa · şube · yıldız · aktif hat ──
  const acikSayi = s.unlockedLocs.length
  const aktifHat = hatlar.find(h => h.aktif)
  cip.innerHTML =
    // KASA kompakt biçimde ("₺40 mn"): dar ekranda dört göstergeden biri olarak
    // tam sayı ("₺40.000.000") kutuya sığmayıp kırpılıyordu.
    `<div class="hchip acc"><span class="hcl">${t('KASA')}</span><span class="hcv">${para(s.money)}</span></div>`
    + `<div class="hchip"><span class="hcl">${t('ŞUBE')}</span><span class="hcv">${acikSayi}<i>/${ALL_LOCS.length}</i></span></div>`
    + `<div class="hchip"><span class="hcl">${t('MARKA')}</span><span class="hcv">${s.brandStars}★</span></div>`
    + `<div class="hchip"><span class="hcl">${t('ORTAK HAT')}</span><span class="hcv${aktifHat && aktifHat.doluluk >= 0.5 && !aktifHat.kotasiz ? ' bad' : ''}">`
    + (aktifHat ? (aktifHat.kotasiz ? `∞<i> ${t('rafineri')}</i>` : `${tl(aktifHat.kalan)}<i> L</i>`) : `<i>${t('yok')}</i>`) + `</span></div>`
    + `<div class="hchip${raf.seviye > 0 ? ' acc-raf' : ''}"><span class="hcl">${t('RAFİNERİ')}</span><span class="hcv">`
    + (raf.insaat ? `${raf.gunKaldi}<i> ${t('gün')}</i>` : raf.seviye > 0 ? `${t('Kd.')}${raf.seviye}` : `<i>${t('yok')}</i>`) + `</span></div>`

  // ── yan panel: açıklama + detay + hat listesi ──
  const n = rafSecili ? undefined : dg.get(secili as LocId)!
  const hat = n ? hatlar.find(h => h.taban === n.id || h.kopya === n.id) : undefined

  // Efsane tahtanın ALTINDA durur (açıkladığı şeyin yanında). Son madde kritik:
  // haritadaki soluk yol izleri DEKORDUR, veri taşıyan tek çizgi kırmızı hattır.
  efsane.innerHTML = `
    <span><i class="hk hk-aktif"></i>${t('aktif')}</span>
    <span><i class="hk hk-acik"></i>${t('şuben')}</span>
    <span><i class="hk hk-firsat"></i>${t('açılabilir')}</span>
    <span><i class="hk hk-kilit"></i>${t('kilitli')}</span>
    <span><i class="hk hk-hat"></i>${t('ortak tedarik hattı')}</span>
    <span><i class="hk hk-raf"></i>${t('rafineri beslemesi')}</span>
    <span class="hlg-note">${t('soluk yollar dekordur — veri taşıyan tek çizgi kırmızı hattır')}</span>`

  let yanHtml = n ? detayKarti(n, s, hat) : rafineriKarti(raf, s)

  // ── HATLAR KARTI: 4 taban↔kopya çifti, gerçek durumlarıyla ──
  yanHtml += `<div class="hcard"><h4>${t('ORTAK TEDARİK HATLARI')}<span>${raf.kotasiz ? t('kota kalktı · rafineri kademe {0}', String(raf.seviye)) : t('en az {0} L/gün · tank kapasitesi kadar', tl(SUPPLY_LINE_QUOTA))}</span></h4>`
  for (const h of hatlar) {
    const pct = Math.round(h.doluluk * 100)
    const ad = `${kisaAd(themeFor(h.taban).name)} + ${kisaAd(themeFor(h.kopya).name)}`
    const durum = h.aktif ? (h.kotasiz ? t('kurulu · sınırsız') : t('kurulu · %{0} kullanıldı', String(pct))) : t('henüz kurulmadı')
    yanHtml += `<button class="hline${h.aktif ? ' on' : ''}" data-hsel="${h.aktif || dg.get(h.kopya)?.durum !== 'kilit' ? h.kopya : h.taban}">
      <span class="hline-t">${esc(ad)}</span><span class="hline-s">${durum}</span>
      <span class="pz-bar"><span class="pz-fill${pct >= 50 ? ' hot' : ''}" style="width:${h.aktif ? Math.min(100, pct) : 0}%"></span></span>
    </button>`
  }
  yanHtml += `<div class="hd-src">${t('Kasabanın kopyası yoktur — hatsız çalışır, kotayı kimseyle paylaşmaz.')}</div></div>`
  yan.innerHTML = yanHtml
}

export function haritaKur(c: HaritaCtx): void {
  ctx = c
  if (kuruldu) return
  kuruldu = true
  const wrap = document.getElementById('mapwrap')
  const svg = document.getElementById('hmap')
  const yan = document.getElementById('h-side')

  const sec = (id: string | undefined) => {
    if (!id) return
    if (id !== RAFINERI_ID && !ALL_LOCS.includes(id as LocId)) return
    secili = id as LocId | typeof RAFINERI_ID
    haritaCiz()
  }
  svg?.addEventListener('click', e => sec((e.target as Element).closest('.hn')?.getAttribute('data-hloc') ?? undefined))
  svg?.addEventListener('keydown', e => {
    if ((e as KeyboardEvent).key !== 'Enter' && (e as KeyboardEvent).key !== ' ') return
    e.preventDefault()
    sec((e.target as Element).closest('.hn')?.getAttribute('data-hloc') ?? undefined)
  })
  yan?.addEventListener('click', e => {
    const el = e.target as HTMLElement
    const s2 = el.closest('[data-hsel]') as HTMLElement | null
    if (s2) return sec(s2.dataset.hsel)
    const ac = el.closest('[data-hunlock]') as HTMLElement | null
    if (ac) { ctx?.onAc(ac.dataset.hunlock as LocId); return }
    const git = el.closest('[data-hgo]') as HTMLElement | null
    if (git) { ctx?.onGit(git.dataset.hgo as LocId); return }
    if (el.closest('[data-hraf]')) { ctx?.onRafineri?.(); return }
  })
  wrap?.addEventListener('pointerdown', e => {
    if (e.target === wrap) wrap.classList.remove('show')
  })
}

/** Haritayı aç. Seçili düğüm oyuncunun BULUNDUĞU şubeye kilitlenir (bağlam kaybolmasın). */
export function haritaAc(): void {
  if (!ctx) return
  secili = ctx.state.activeLoc
  haritaCiz()
  document.getElementById('mapwrap')?.classList.add('show')
  const body = document.querySelector('#mapwrap .mbody')
  if (body) body.scrollTop = 0
}
