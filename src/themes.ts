/**
 * LOKASYON TEMALARI (lategame raporu §6.1)
 *
 * Amaç: yeni lokasyon eklemek = yeni bir TEMA NESNESİ yazmak. Sahne kurulumu bu veriyi
 * okur; zemin dokusu, palet, ışık, yol topolojisi ve EKONOMİK KISITLAR temadan gelir.
 * Rapor uyarısı: lokasyon bir "skin" değil, bir KISIT SETİ — görsel + topoloji + ekonomi
 * üçünde de ayrışmalı. Bu dosya o üç ekseni tek yerde tanımlar.
 *
 * Bu adım GÖRÜNÜR DEĞİŞİKLİK GETİRMEZ: mevcut kasaba sahnesi temaya taşındı (aynı
 * dokular/renkler), böylece çoklu lokasyon için güvenli temel atıldı.
 */

export interface LocationTheme {
  id: 'kasaba' | 'cevreyolu' | 'otoyol' | 'marina' | 'metropol'
  name: string

  /** zemin dokuları (public/ altındaki yollar) + yedek prosedürel renk */
  ground: { grass: string; concrete: string; road: string; grassTint: string; concreteTint: string; roadTint: string }
  /** gökyüzü: gündüz/gece rengi (hex) */
  sky: { day: number; night: number }
  /** palet: yol çizgisi, aksan, bitki örtüsü */
  palette: { line: number; accent: number; vegetation: number }

  /** yol/seyir topolojisi — trafik grafiği ve spawn bunu okur */
  lane: {
    kind: 'road' | 'water'
    count: number          // tek yöndeki şerit sayısı
    median: boolean        // orta refüj (karşıya geçiş yok)
    barrier: boolean       // fiziksel bariyer → karşı istasyon AYRI yatırım
    rampLength: number     // 0 = doğrudan sapma; >0 = yavaşlama/hızlanma şeridi
    speed: number          // taban hız çarpanı
    /** ÇOK ŞERİTLİ YOL (çevre yolu): istasyona girecek araçların kullandığı SERVİS şeridi.
     *  Geçiş trafiği bugünkü şeritlerinde kalır (LANE_NEAR/LANE_FAR); servis şeridi
     *  hedefe daha yakın olan dış şerittir. Tanımsızsa yol tek şeritlidir (mevcut davranış). */
    service?: { near: number; far: number }
  }

  /** ekonomik kısıt: hangi kaldıraç işe yarar (raporun "kısıt seti" ilkesi) */
  econ: {
    entryBase: number      // taban çekicilik
    priceElasticity: number// fiyat esnekliği çarpanı (otoyolda ~0: alternatif yok)
    repWeight: number      // itibarın ağırlığı (kasabada yüksek: müdavim)
    signWeight: number     // tabelanın ağırlığı (otoyolda yüksek: erken sapma kararı)
    tipRate: number        // bahşiş oranı
    /** günlük yovmiye çarpanı (varsayılan 1) — marinada > 1: defter incelemesi vb.
     *  yetkinlik isteyen kadro daha pahalı, şubeyi çevirmek kolay olmasın (Oğuz) */
    wageMult?: number
  }

  /** açılış koşulu (çoklu lokasyon): nakit + marka yıldızı */
  unlock: { cash: number; stars: number }

  /** şubeye özgü sahne/mekanik öğeleri — kasabada hepsi kapalı (davranış birebir korunur) */
  features?: {
    /** OTOYOL: yavaşlama/hızlanma şeridi + erken sapma kararı (rapor §6.4).
     *  decisionDist: tesisten kaç birim önce sapma kararı verilmeli (tabela bunu uzatır)
     *  rampCap: yavaşlama şeridinde bekleyebilecek araç sayısı (dolunca müşteri KAÇAR)
     *  mergeHard: hızlanma şeridinde birleşme zorluğu (yol verme süresi çarpanı) */
    highway?: { decisionDist: number; rampCap: number; mergeHard: number; signReach: number }
    /** trafik ışığı: kırmızıda istasyon önünde kuyruk → giriş şansı ×boost (çevre yolu imzası) */
    trafficLight?: { greenSec: number; redSec: number; boost: number; y: number }
    /** yaya müşteri: yaya geçidinden gelip araçsız market/kafe cirosu bırakır */
    walkIns?: { everySec: number; min: number; max: number }
    /** görsel: orta refüj bandı + kaldırım + kentsel siluet */
    urban?: boolean
    /** METROPOL İMZASI (rapor §6.6): ALAN KITLIĞI. Şehirde arsa hem AZ hem PAHALI;
     *  oyuncu "her şeyi kur" yerine "neyi kurmayacağım" kararını vermek zorunda kalır.
     *  maxParcels: satın alınabilecek toplam parsel · priceMult: arsa fiyat çarpanı */
    land?: { maxParcels: number; priceMult: number }
    /** KASABA İMZASI (rapor §6.2): MÜDAVİM MÜŞTERİ. Küçük yerde herkes birbirini tanır;
     *  itibarını yükselten oyuncu, fiyattan BAĞIMSIZ sadık bir taban kazanır.
     *  repFloor: müdavimlerin oluşmaya başladığı itibar · share: 5.0 itibarda akışın kaç
     *  katı sadık taban · tip: müdavim bahşiş çarpanı (tanıdık esnafa cömert davranılır) */
    regulars?: { repFloor: number; share: number; tip: number }
    /** MARİNA (Oğuz): tekneler araçların 10-50 katı litre çeker — aynı tank
     *  seviyeleri yetmiyordu. Kapasite çarpanı + yakıt başına daha çok ek tank. */
    tankCapMult?: number
    maxTanksPerFuel?: number
  }
}

/** Lokasyon 1 — Kasaba (MEVCUT sahne; değerler bugünkü davranışla birebir) */
export const KASABA: LocationTheme = {
  id: 'kasaba',
  name: 'Kasaba',
  ground: {
    grass: '/gen/ground_grass.png', concrete: '/gen/ground_concrete.png', road: '/gen/ground_asphalt.png',
    grassTint: '#86b06a', concreteTint: '#9aa1a9', roadTint: '#4a5058',
  },
  sky: { day: 0xbfe0ee, night: 0x1a2a44 }, // gece: mevcut sahneyle BİREBİR
  palette: { line: 0xe0b13e, accent: 0xd64545, vegetation: 0x6d9454 },
  lane: { kind: 'road', count: 1, median: false, barrier: false, rampLength: 0, speed: 1 },
  econ: { entryBase: 0.32, priceElasticity: 1, repWeight: 1, signWeight: 1, tipRate: 0.1 },
  unlock: { cash: 0, stars: 0 },
  // Kasabanın kendine has kaldıracı: müdavim. 4.0 itibarın ÜSTÜNDE sadık taban oluşur ve
  // bu taban fiyat zammından etkilenmez — kasabada "itibar biriktir, fiyatı sonra düşün"
  // stratejisi anlamlı olur. 5.0 itibarda akışın %28'i müdavimdir.
  features: { regulars: { repFloor: 4.0, share: 0.28, tip: 1.6 } },
}

/** Lokasyon 2 — Çevre Yolu */
export const CEVREYOLU: LocationTheme = {
  id: 'cevreyolu',
  name: 'Çevre Yolu',
  ground: {
    grass: '/gen/ground_pavers.png', concrete: '/gen/ground_concrete.png', road: '/gen/ground_asphalt.png',
    grassTint: '#a8a49a', concreteTint: '#9aa1a9', roadTint: '#41474e',
  },
  sky: { day: 0xb9c6d4, night: 0x151d29 },
  palette: { line: 0xf0f0ec, accent: 0x2f6fed, vegetation: 0x5f8f57 },
  // 2×2 ŞERİT: geçiş trafiği içteki (median'a yakın) şeritte, istasyona girenler dışta.
  // Servis şeridi hedefe daha yakın → giren araç geçiş trafiğini kesmez.
  lane: { kind: 'road', count: 2, median: true, barrier: false, rampLength: 0, speed: 1.1,
          service: { near: 5.58, far: 10.23 } },
  // şehirde market/kafe cirosu baskın: fiyat esnekliği yüksek (alternatif çok), tabela zayıf
  econ: { entryBase: 0.33, priceElasticity: 1.35, repWeight: 0.8, signWeight: 0.6, tipRate: 0.12 },
  unlock: { cash: 500_000, stars: 2 },
  // ÇEVRE YOLU İMZASI (rapor §6.3): ışık ~40 sn yeşil / 15 sn kırmızı; kırmızıda sıkışan
  // sürücü "hazır durmuşken" giriyor → giriş şansı ×2.2. Oyuncu bu pencereleri yakalamayı
  // öğrenir (kapasite planlaması). Yaya müşteri: araçsız market/kafe cirosu.
  features: {
    // TRAFİK IŞIĞI KALDIRILDI (Oğuz: "dümdüz flow olsun, kafa karıştırıyor") —
    // kırmızı-boost ortalaması entryBase'e gömüldü (0.30 → 0.33)
    walkIns: { everySec: 22, min: 25, max: 70 },
    urban: true,
  },
}

/** Lokasyon 3 — Otoyol (ramp/merge topolojisi) */
export const OTOYOL: LocationTheme = {
  id: 'otoyol',
  name: 'Otoyol',
  ground: {
    grass: '/gen/ground_gravel.png', concrete: '/gen/ground_concrete.png', road: '/gen/ground_asphalt.png',
    grassTint: '#ab9d84', concreteTint: '#a5aab0', roadTint: '#3f454c',
  },
  sky: { day: 0xc7d3dd, night: 0x121a26 },
  palette: { line: 0xf5f5f0, accent: 0xe8862e, vegetation: 0x7d8a5e },
  lane: { kind: 'road', count: 3, median: true, barrier: true, rampLength: 20, speed: 1.5 },
  // otoyolda fiyat esnekliği ~0 (60 km alternatif yok), itibar önemsiz, TABELA kritik
  econ: { entryBase: 0.26, priceElasticity: 0.25, repWeight: 0.3, signWeight: 2.2, tipRate: 0.08 },
  unlock: { cash: 2_000_000, stars: 6 },
  features: {
    // Sapma kararı 34 birim önce verilir; her tabela seviyesi bunu 9 birim UZATIR
    // (tabela burada birinci kaldıraç). Yavaşlama şeridi 3 araç alır; dolunca gelen
    // otobana geri döner = KAÇAN MÜŞTERİ. Birleşme zor: yüksek hızlı akışa katılmak sürer.
    highway: { decisionDist: 34, rampCap: 3, mergeHard: 1.6, signReach: 9 },
    urban: false,
  },
}

export const THEMES: Record<LocationTheme['id'], LocationTheme> = {
  kasaba: KASABA,
  cevreyolu: CEVREYOLU,
  otoyol: OTOYOL,
  /** Lokasyon 4 — MARİNA (rapor §6.5): 10× AZ müşteri, 19× YÜKSEK ₺/müşteri.
   *  Mobil ısınmayı düşürürken geliri artırır; itibar (Mavi Bayrak → süperyat kilidi) kritik,
   *  tabela önemsiz (tekneler zaten limanı bilir), yatçı fiyata duyarsız. */
  marina: {
    id: 'marina', name: 'Marina',
    ground: {
      grass: '/gen/ground_concrete.png', concrete: '/gen/ground_concrete.png', road: '/gen/ground_asphalt.png',
      grassTint: '#3f7f96', concreteTint: '#b9bfc4', roadTint: '#2f6f88',
    },
    sky: { day: 0xa8dcea, night: 0x0f2436 },
    palette: { line: 0xffffff, accent: 0x1fa8bc, vegetation: 0x4f8f6a },
    // SEYİR KANALI (Oğuz: yanaşma bölgesi x 6.6..10.4 TRAFİKSİZ; şamandıra hattı
    // 17.8 orta ayırıcı — gelen 15.2 ada tarafı, çıkan 20.4 açık deniz tarafı,
    // "ferah ferah" ayrık; transit de bu şeritleri kullanır, iskele önünden geçmez).
    lane: { kind: 'water', count: 1, median: false, barrier: false, rampLength: 6, speed: 0.55,
            service: { near: 15.20, far: 20.40 } },
    econ: { entryBase: 0.09, priceElasticity: 0.45, repWeight: 1.9, signWeight: 0.25, tipRate: 0.2, wageMult: 1.6 },
    // tekne talebi devasa: tank kapasitesi ×3, yakıt başına 8 ek tanka kadar
    features: { tankCapMult: 3, maxTanksPerFuel: 8 },
    unlock: { cash: 5_000_000, stars: 9 },
  },
  /** Lokasyon 5 — METROPOL (rapor §6.6): alan kıtlığı, EV ağırlıklı, çok alternatif
   *  (fiyat esnekliği en yüksek), tabela etkisiz, market cirosu baskın. */
  metropol: {
    id: 'metropol', name: 'Metropol',
    ground: {
      grass: '/gen/ground_pavers.png', concrete: '/gen/ground_concrete.png', road: '/gen/ground_asphalt.png',
      grassTint: '#aeaaa2', concreteTint: '#9ba1a8', roadTint: '#33383e',
    },
    sky: { day: 0xa9b6c6, night: 0x0d1420 },
    palette: { line: 0xffe08a, accent: 0x7f5af0, vegetation: 0x4d7a52 },
    lane: { kind: 'road', count: 3, median: true, barrier: false, rampLength: 0, speed: 1.25 },
    econ: { entryBase: 0.37, priceElasticity: 1.6, repWeight: 0.65, signWeight: 0.35, tipRate: 0.14 },
    unlock: { cash: 12_000_000, stars: 14 },
    features: {
      // trafik ışığı kaldırıldı (Oğuz) — boost ortalaması entryBase'e gömüldü (0.34 → 0.37)
      walkIns: { everySec: 14, min: 40, max: 110 },                   // yoğun yaya trafiği
      urban: true,
      // Metropol'ün asıl kısıtı yer: 18 parsel yerine 6, üstelik 3.2 katı fiyata.
      // Tesis seçimi burada gerçek bir ödünleşim olur (rapor §6.6).
      land: { maxParcels: 6, priceMult: 3.2 },
    },
  },
}

/** Aktif tema — çoklu lokasyon gelene kadar her zaman kasaba (davranış değişmez). */
export function activeTheme(id: LocationTheme['id'] = 'kasaba'): LocationTheme {
  return THEMES[id] ?? KASABA
}
