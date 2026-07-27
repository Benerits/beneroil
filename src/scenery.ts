/**
 * ŞUBE ÇEVRE PLANLARI — VERİ (Three.js bilmez, testten okunur)
 *
 * NEDEN AYRI DOSYA: çevre yerleşimi eskiden `world.ts` içinde gömülü `put(...)`
 * çağrılarıydı; ne örtme (occlusion) ölçülebiliyordu ne de parsel çakışması. Sonuç:
 * yolun karşısına 13-20 birimlik gri kütleler kondu, kameranın yarısını yediler ve
 * oyuncunun satın alabileceği parselleri kapattılar.
 *
 * Artık yerleşim VERİ. `tools/tests/scene-check.mjs` bu tabloları okuyup şu kuralları
 * ölçüyor (kamera matematiğiyle, tahminle değil):
 *
 *   K1  Yol/kanal koridoru (x 4.0..11.6) boş — hiçbir dekor girmez.
 *   K2  KARŞI YAKA ALÇAK: x > 11.6 ve |y| ≤ 26 ise yükseklik ≤ 5.0.
 *       Sebep matematik: derinlik = 0.408·(x + 2y + z). Karşı yaka kameraya YAKIN
 *       taraftır; oraya konan her yüksek kütle istasyonun ÖNÜNE geçer.
 *   K3  YÜKSEK KÜTLE BATIYA: x ≤ -16'da 22 birime kadar serbest. Batı ekranın SAĞI ve
 *       derinlikte GERİSİ — oradaki kule istasyonu asla örtmez (metropol batı duvarı
 *       ekran görüntülerinde iyi görünen tek şeydi, kural oradan çıkarıldı).
 *   K4  Parsel bandındaki (x -29.5..45.4, |y| ≤ 24) her şey `parcel: true` —
 *       oyuncu o parseli betonlayınca sahneden silinir, arsa gerçekten boşalır.
 *   K5  Ekran-uzayı örtme: her öğenin 3 kamera açısında ekran kutusu hesaplanır;
 *       istasyondan DAHA YAKIN olup istasyon kutusunun %6'sından fazlasını kapatan
 *       öğe testi düşürür.
 *
 * Koordinatlar world.ts ile aynı: x kameraya doğru(+doğu), y sağa(+kuzey), z yukarı.
 */

/** Bir modelin sahnedeki yeri. `h` modelin z ekseninde oturtulacağı yükseklik. */
export interface Placement {
  model: string
  h: number
  x: number
  y: number
  /** z ekseni etrafında dönüş (radyan) */
  rot?: number
  /** parsel bandında mı — true ise oyuncu arsayı betonlayınca silinir */
  parcel?: boolean
  /** ölçek ekseni: model hangi ekseninde `h` birim olacak (varsayılan 'z') */
  axis?: 'x' | 'y' | 'z'
}

const P = Math.PI

// ─────────────────────────────────────────────────────────────────────────────
// OTOYOL — AĞIR SANAYİ KUŞAĞI
//
// Kurgu: batıda (ekranın sağı, derinlikte geri) termik santral silüeti — bacalar,
// soğutma kuleleri, büyük hangarlar. Karşı yakada (kameraya yakın) YALNIZ alçak
// lojistik: depo cepheleri, konteyner istifi, kantar. Böylece otoyol boyunca
// bakınca gözün önü açık kalıyor ama çerçeve boş da durmuyor.
// ─────────────────────────────────────────────────────────────────────────────
export const OTOYOL_PLAN: Placement[] = [
  // ---- BATI: santral kütlesi (yüksek serbest) ----
  { model: 'building-f', h: 11.0, x: -24.60, y: -6.00, parcel: true },
  { model: 'chimney-large', h: 16.0, x: -27.40, y: -13.50, parcel: true },
  { model: 'chimney-large', h: 13.5, x: -24.10, y: -16.80, parcel: true },
  { model: 'building-l', h: 8.0, x: -25.20, y: 4.50, rot: P / 2, parcel: true },
  { model: 'chimney-medium', h: 12.0, x: -28.20, y: 12.00, parcel: true },
  { model: 'building-q', h: 5.5, x: -23.80, y: 17.50, parcel: true },
  { model: 'detail-tank', h: 3.2, x: -19.60, y: -1.20, parcel: true },
  { model: 'detail-tank', h: 3.2, x: -19.60, y: 1.90, parcel: true },
  // ---- BATI-İÇ: istasyonun sırtı, ALÇAK (kendi arsanı gölgelemesin) ----
  { model: 'building-s', h: 3.6, x: -12.90, y: -20.60, rot: P / 2, parcel: true },
  { model: 'building-t', h: 4.0, x: -13.40, y: 15.80, parcel: true },
  // ---- ÇERÇEVE KAPATICI: parsel bandının DIŞI (asla silinmez) ----
  { model: 'chimney-large', h: 18.0, x: -26.00, y: -31.00 },
  { model: 'chimney-medium', h: 14.0, x: -21.00, y: -35.50 },
  { model: 'building-f', h: 12.0, x: -27.50, y: 30.00 },
  { model: 'chimney-medium', h: 15.0, x: -22.50, y: 34.50 },
  // ---- KARŞI YAKA (Oğuz: "yolun karşısına 2. şube açılacak BOŞLUK kalsın") ----
  // Şube arsası x 11.9..22.3, |y| ≤ 23.3 → TAMAMEN BOŞ (stabilize plaka world.ts'te).
  // Alçak lojistik cepheler İKİNCİ kolona (x ≥ 24) ve yan bantlara (|y| ≥ 27) yayıldı:
  // doku duruyor, arsa açık.
  { model: 'building-s', h: 4.2, x: 25.20, y: -18.40, rot: P, parcel: true },
  { model: 'building-s', h: 4.2, x: 25.20, y: -8.90, rot: P, parcel: true },
  { model: 'building-q', h: 4.6, x: 25.60, y: 3.60, rot: P, parcel: true },
  { model: 'building-t', h: 4.0, x: 25.20, y: 14.20, rot: P, parcel: true },
  { model: 'building-c', h: 4.4, x: 31.40, y: -12.00, rot: P, parcel: true },
  { model: 'building-c', h: 4.4, x: 31.40, y: 8.00, rot: P, parcel: true },
  // yan bantlar (|y| > 26): arsanın kuzey/güney komşuları — şube sınırını çerçeveler
  { model: 'building-t', h: 4.2, x: 15.20, y: -29.00, rot: P },
  { model: 'building-s', h: 4.0, x: 15.20, y: 28.60, rot: P },
  // karşı yakanın uzağı: parsel dışı, biraz yükselebilir
  { model: 'building-f', h: 8.0, x: 22.00, y: -33.00, rot: P },
  { model: 'chimney-medium', h: 11.0, x: 27.50, y: -36.50 },
  { model: 'building-l', h: 7.5, x: 24.00, y: 33.50, rot: P },
]

// ─────────────────────────────────────────────────────────────────────────────
// ÇEVRE YOLU — SANAYİ SİTESİ / ŞEHİR ÇEPERİ
//
// Oğuz'un tarifi: "çevre yolunda [industrial paketinden] kenarlara serpiştirilmiş
// evler". Türkiye'de çevre yolu kenarı budur: küçük atölyeler, oto sanayi, tek katlı
// depolar — otoyolun ağır santral kütlesinden ölçekle ayrışır (orada 16 birim baca,
// burada 5 birim atölye). Aynı kit, bambaşka doku.
// ─────────────────────────────────────────────────────────────────────────────
export const CEVREYOLU_PLAN: Placement[] = [
  // ---- BATI (ekranın sağı): sanayi sitesi bloğu, orta boy ----
  { model: 'building-t', h: 5.0, x: -20.80, y: -21.00, parcel: true },
  { model: 'building-s', h: 4.2, x: -20.30, y: -12.60, parcel: true },
  { model: 'building-c', h: 6.5, x: -22.40, y: -3.50, parcel: true },
  { model: 'building-s', h: 4.2, x: -20.30, y: 5.40, parcel: true },
  { model: 'building-t', h: 5.0, x: -20.80, y: 14.00, parcel: true },
  { model: 'building-q', h: 4.6, x: -21.60, y: 21.60, parcel: true },
  { model: 'chimney-medium', h: 8.5, x: -26.80, y: -8.00, parcel: true },
  { model: 'detail-tank', h: 2.6, x: -14.20, y: -22.20, parcel: true },
  // ---- BATI-İÇ: istasyonun arkası, tek sıra alçak atölye ----
  { model: 'building-s', h: 3.4, x: -12.60, y: 18.60, rot: P / 2, parcel: true },
  // ---- ÇERÇEVE: parsel dışı ----
  { model: 'building-c', h: 7.5, x: -23.00, y: -30.50 },
  { model: 'building-f', h: 9.0, x: -27.00, y: -35.00 },
  { model: 'building-c', h: 7.0, x: -22.20, y: 29.80 },
  { model: 'building-t', h: 5.5, x: -16.50, y: 33.00 },
  // ---- KARŞI YAKA (Oğuz: 2. şube arsası BOŞ kalsın — kasaba dinamiği, yol büyük) ----
  // Şube arsası x 11.9..22.3, |y| ≤ 23.3 boşaltıldı; strip mall İKİNCİ kolona (x ≥ 24.4)
  // kaydı, iki dükkân yan bantlara (|y| ≥ 27) "yanlara serpiştirildi".
  { model: 'building-s', h: 4.0, x: 24.60, y: -19.60, rot: P, parcel: true },
  { model: 'building-c', h: 4.8, x: 24.80, y: -9.40, rot: P, parcel: true },
  { model: 'building-q', h: 4.4, x: 24.50, y: 1.80, rot: P, parcel: true },
  { model: 'building-s', h: 4.0, x: 24.60, y: 11.60, rot: P, parcel: true },
  { model: 'building-t', h: 4.6, x: 25.00, y: 20.80, rot: P, parcel: true },
  { model: 'building-c', h: 4.6, x: 31.60, y: -15.00, rot: P, parcel: true },
  { model: 'building-t', h: 4.4, x: 31.80, y: 4.60, rot: P, parcel: true },
  { model: 'building-s', h: 4.0, x: 31.60, y: 18.40, rot: P, parcel: true },
  // yan bantlar: arsanın kuzey/güney çerçevesi
  { model: 'building-q', h: 4.2, x: 15.00, y: -28.40, rot: P },
  { model: 'building-s', h: 4.0, x: 15.00, y: 28.20, rot: P },
  // karşı yakanın uzağı
  { model: 'building-c', h: 7.0, x: 19.40, y: -32.60, rot: P },
  { model: 'building-t', h: 6.0, x: 24.80, y: -36.00 },
  { model: 'building-c', h: 6.5, x: 19.00, y: 32.20, rot: P },
]

// ─────────────────────────────────────────────────────────────────────────────
// METROPOL — TİCARİ MERKEZ
//
// Ekran görüntülerinde İŞE YARAYAN tek şey buranın batı duvarıydı (camlı kuleler,
// ekranın sağında, istasyonu örtmüyor). O duvar korunuyor ve zenginleştiriliyor;
// çöpe giden şey doğudaki 5×5×13.5 düz gri kutu siluetiydi.
// ─────────────────────────────────────────────────────────────────────────────
export const METROPOL_PLAN: Placement[] = [
  // ---- BATI DUVARI: kuzeye yükselen siluet (yüksek serbest, K3) ----
  { model: 'building-k', h: 5.5, x: -9.24, y: -21.00, parcel: true },
  { model: 'building-n', h: 7.0, x: -10.19, y: -14.20, parcel: true },
  { model: 'building-c', h: 6.0, x: -9.60, y: -7.60, parcel: true },
  { model: 'building-h', h: 6.0, x: -9.85, y: -1.40, rot: P / 2, parcel: true },
  { model: 'building-skyscraper-e', h: 11.5, x: -17.40, y: -5.20, parcel: true },
  { model: 'building-skyscraper-b', h: 16.5, x: -18.10, y: 4.60, parcel: true },
  { model: 'building-skyscraper-c', h: 13.5, x: -17.60, y: 14.20, parcel: true },
  { model: 'building-skyscraper-d', h: 21.0, x: -25.20, y: 8.60, parcel: true },
  { model: 'building-k', h: 6.5, x: -9.40, y: 6.80, parcel: true },
  { model: 'building-n', h: 7.5, x: -10.10, y: 15.40, parcel: true },
  { model: 'building-c', h: 5.5, x: -9.55, y: 22.20, parcel: true },
  { model: 'building-skyscraper-e', h: 12.0, x: -25.80, y: -16.00, parcel: true },
  // ---- ÇERÇEVE: parsel dışı, en yüksek kütleler ----
  { model: 'building-skyscraper-d', h: 24.0, x: -24.00, y: -31.00 },
  { model: 'building-skyscraper-b', h: 19.0, x: -17.00, y: -35.50 },
  { model: 'building-skyscraper-c', h: 17.5, x: -23.00, y: 30.00 },
  { model: 'building-skyscraper-e', h: 14.0, x: -19.50, y: 34.50 },
  // ---- KARŞI YAKA (Oğuz: 2. şube arsası BOŞ + istasyon dokusu genelde kullanılmıyor) ----
  // Şube arsası x 11.9..22.3, |y| ≤ 23.3 boşaltıldı; zemin katı dükkânlar İKİNCİ kolona
  // (x ≥ 24.4) kaydı, ikisi yan bantlara. `low-detail-*` ailesi hâlâ BİLEREK yok
  // (ince beyaz dilim sorunu). Kule yakın planda yine YOK (K2).
  { model: 'building-k', h: 4.6, x: 24.60, y: -18.60, rot: P, parcel: true },
  { model: 'building-c', h: 4.8, x: 24.80, y: -7.20, rot: P, parcel: true },
  { model: 'building-h', h: 4.4, x: 24.50, y: 3.40, rot: P, parcel: true },
  { model: 'building-c', h: 4.8, x: 24.80, y: 13.80, rot: P, parcel: true },
  { model: 'building-k', h: 4.6, x: 24.60, y: 22.60, rot: P, parcel: true },
  { model: 'building-h', h: 4.8, x: 31.60, y: -12.60, rot: P, parcel: true },
  { model: 'building-c', h: 4.4, x: 32.00, y: 6.40, rot: P, parcel: true },
  // yan bantlar: arsanın çerçevesi (alçak — kamera hattı temiz)
  { model: 'building-h', h: 4.4, x: 15.10, y: -28.60, rot: P },
  { model: 'building-k', h: 4.2, x: 15.10, y: 28.40, rot: P },
  // karşı yakanın uzağı: burada yükselebilir, çünkü |y| > 26
  { model: 'building-skyscraper-e', h: 11.0, x: 20.00, y: -33.50, rot: P },
  { model: 'building-skyscraper-c', h: 13.0, x: 26.50, y: -37.50, rot: P },
  { model: 'building-skyscraper-b', h: 12.0, x: 20.50, y: 32.50, rot: P },
]

// ─────────────────────────────────────────────────────────────────────────────
// MARİNA — ADA ve LİMAN
//
// Oğuz'un kısıtı net: "adaya yerleşilebilir yapılar yapma, orası çok gelişmesin".
// Bu yüzden adadaki her şey DEKOR — kayalık, çam kuşağı, sahil patikası, güney
// burnundaki fener. Oyuncunun kuracağı tek şey rıhtımdaki tesisler.
// Karşı yaka (x > 11.6) su: orada yalnız şamandıra, ponton, dalgakıran var; bunlar
// zaten alçak olduğu için K2 kendiliğinden sağlanıyor.
// ─────────────────────────────────────────────────────────────────────────────
export const MARINA_PLAN: Placement[] = [
  // ---- LİMAN DOKUSU (HEPSİ SUDA) ----
  // Ada üstünde tekne/yapı YOK: ilk denemede `boat-house-c` ve `boat-tow-a` çimenin
  // ortasına oturuyordu ("çayırda tekne" görüntüsü). Oğuz'un kısıtı da bu: ada
  // gelişmeyecek. Adadaki tek dikey aksan güneybatı kıyısındaki fener (world.ts).
  { model: 'boat-tug-a', h: 3.6, x: 20.60, y: -20.00, rot: P / 2, axis: 'x' },
  { model: 'boat-row-large', h: 2.2, x: 20.20, y: -12.20, rot: P / 2, axis: 'x' },
  { model: 'boat-row-large', h: 2.0, x: 20.20, y: 4.20, rot: P / 2, axis: 'x' },
  { model: 'boat-sail-a', h: 4.6, x: 20.40, y: 12.60, rot: P / 2, axis: 'x' },
  { model: 'boat-house-c', h: 4.8, x: 20.60, y: -4.20, rot: P / 2, axis: 'x' },
  { model: 'boat-tow-a', h: 4.8, x: 23.60, y: 19.60, rot: P / 2, axis: 'x' },
  { model: 'ship-ocean-liner-small', h: 9.0, x: 31.00, y: 33.00, rot: P / 2, axis: 'x' },
  { model: 'ship-cargo-b', h: 13.0, x: 34.00, y: -30.00, rot: P, axis: 'x' },
]

export const SCENE_PLANS: Record<string, Placement[]> = {
  otoyol: OTOYOL_PLAN,
  cevreyolu: CEVREYOLU_PLAN,
  metropol: METROPOL_PLAN,
  marina: MARINA_PLAN,
}

// ─────────────────────────────────────────────────────────────────────────────
// KAMERA MATEMATİĞİ — testin ve tasarımın ortak dili
// ─────────────────────────────────────────────────────────────────────────────

/** main.ts'teki CAM_ANGLES ile BİREBİR aynı üç yön (normalize edilmemiş hâlleri). */
export const CAM_DIRS: [number, number, number][] = [[1, 2, 1], [1.6, 2, 0.5], [0.5, 2.2, 1.6]]

/** Bir kamera yönü için ekran taban vektörleri (sağ, yukarı) — three.js lookAt ile aynı. */
export function camBasis(dir: [number, number, number]) {
  const n = Math.hypot(dir[0], dir[1], dir[2])
  const d: [number, number, number] = [dir[0] / n, dir[1] / n, dir[2] / n]
  const f: [number, number, number] = [-d[0], -d[1], -d[2]]
  // r = normalize(f × up), up = (0,0,1)  →  f × up = (fy, -fx, 0)
  const rn = Math.hypot(f[1], -f[0]) || 1
  const r: [number, number, number] = [f[1] / rn, -f[0] / rn, 0]
  // u = r × f
  const u: [number, number, number] = [
    r[1] * f[2] - r[2] * f[1],
    r[2] * f[0] - r[0] * f[2],
    r[0] * f[1] - r[1] * f[0],
  ]
  return { r, u, d }
}

/** Dünya noktasının ekran koordinatı + kamera derinliği. */
export function project(p: [number, number, number], b: ReturnType<typeof camBasis>) {
  return {
    sx: p[0] * b.r[0] + p[1] * b.r[1] + p[2] * b.r[2],
    sy: p[0] * b.u[0] + p[1] * b.u[1] + p[2] * b.u[2],
    depth: p[0] * b.d[0] + p[1] * b.d[1] + p[2] * b.d[2],
  }
}

/** Eksen hizalı kutunun ekran sınırları (8 köşe projekte edilir). */
export function screenBox(cx: number, cy: number, w: number, d: number, h: number,
                          b: ReturnType<typeof camBasis>) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, dep = -Infinity
  for (const sxg of [-1, 1]) for (const syg of [-1, 1]) for (const z of [0, h]) {
    const q = project([cx + sxg * w / 2, cy + syg * d / 2, z], b)
    x0 = Math.min(x0, q.sx); x1 = Math.max(x1, q.sx)
    y0 = Math.min(y0, q.sy); y1 = Math.max(y1, q.sy)
    dep = Math.max(dep, q.depth)
  }
  return { x0, x1, y0, y1, depth: dep }
}

/** İSTASYON GÖVDESİ — ana arsa + üstündeki en yüksek yapı (kanopi/ofis ≈ 6). */
export const STATION_BOX = { cx: -0.75, cy: 0, w: 11.5, d: 20, h: 6 }

/** Yerleşim kuralları — `world.ts` bunları uygular, `scene-check` bunları ölçer. */
export const RULES = {
  /** yol/kanal koridoru: hiçbir dekor giremez */
  roadCorridor: [4.0, 11.6] as [number, number],
  /** karşı yaka bu x'ten sonra başlar */
  farSideX: 11.6,
  /** karşı yakada |y| ≤ farSideYBand iken izin verilen azami yükseklik */
  farSideMaxH: 5.0,
  farSideYBand: 26,
  /** batıda yükseklik serbestliği bu x'ten sonra başlar */
  westFreeX: -16,
  /** istasyonun sırtındaki bantta (westFreeX .. -6.5) azami yükseklik */
  backyardMaxH: 8.0,
  /** parsel bandı */
  parcelX: [-29.5, 45.4] as [number, number],
  parcelY: [-24, 24] as [number, number],
  /** İzin verilen azami istasyon örtme oranı — KAMERA AÇISINA GÖRE.
   *
   *  Açı 0 (1,2,1) ve açı 2 (0.5,2.2,1.6) yukarıdan bakar; oyuncunun %95'i orada
   *  oynuyor ve orada istasyonun önü TEMİZ olmak zorunda: %6.
   *
   *  Açı 1 (1.6,2,0.5) bilinçli olarak YATIK bir açı — z payı 0.19, yani her kütle
   *  ekranda 5 kat uzuyor. O açıda sx ≈ -0.78x + 0.62y olduğu için karşı yakada
   *  y ≈ 0.8x hattına düşen HER ŞEY istasyonun önüne biner; matematiksel olarak
   *  kaçınılmaz. Oyuncu o açıyı "şehrin içinden bak" diye seçer, bu yüzden orada
   *  eşik gevşek: %20. Kural yumuşatılıyor ama kaldırılmıyor. */
  maxCover: 0.06,
  maxCoverFlat: 0.20,
  /** hangi kamera açısı yatık sayılır (CAM_DIRS indeksi) */
  flatAngle: 1,
}

/** Modelin taban ayak izi (genişlik/derinlik) — `h` yüksekliğine ölçeklenmiş hâli.
 *  Kaba ama tutarlı: Kenney kütleleri yaklaşık kare tabanlı, kuleler ince. */
export function footprint(model: string, h: number): [number, number] {
  if (model.startsWith('chimney')) return [h * 0.16, h * 0.16]
  if (model.startsWith('building-skyscraper')) return [h * 0.24, h * 0.24]
  if (model.startsWith('low-detail-building-wide')) return [h * 1.6, h * 0.9]
  if (model.startsWith('detail-tank')) return [h * 1.4, h * 0.9]
  if (model.startsWith('boat') || model.startsWith('ship')) return [h * 0.34, h]
  return [h * 1.15, h * 1.05]
}
