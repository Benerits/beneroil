/**
 * ŞUBEYE GÖRE MODEL KİTLERİ — tembel yükleme
 *
 * Üç Kenney paketi geldi (endüstriyel 25, ticari 41, deniz 46 model = ~8 MB).
 * Hepsini açılışta yüklemek KABUL EDİLEMEZ: kasabada oynayan oyuncunun otoyolun
 * fabrikalarını ya da marinanın gemilerini indirmesi için hiçbir sebep yok — üstelik
 * geri bildirimlerin %22'si zaten mobil ısınma/performans.
 *
 * Kural: bir kit YALNIZ o şubeye ilk geçişte iner, sonra bellekte tutulur.
 * Kasaba hiçbir ek paket indirmez (bir bayt bile).
 *
 * MANİFEST NEDEN VAR: pakette 46 tekne var ama sahnede ~14'ü kullanılıyor. Manifest
 * yalnız kullanılanı indirir; diskte duran fazlalık modeller ÇALIŞMA ANINDA maliyet
 * üretmez. Yeni model gerekince listeye bir satır eklemek yeter.
 */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { LocId } from './state'

/** Kit içeriği: ad → yüklenmiş model (yüklenemeyen null olur, sahne prosedürele düşer) */
export type Kit = Record<string, THREE.Group | null>

/** Hangi şube hangi klasörden hangi modelleri ister */
const MANIFEST: Partial<Record<LocId, { dir: string; files: string[] }>> = {
  // OTOYOL — sanayi çevresi. 9 model / 896 KB (eski 14 modelden 419 KB daha hafif:
  // ölü bölgeye konan küçük depolar çıkarıldı, kalanlar daha büyük ölçekte kullanılıyor).
  otoyol: {
    dir: 'industrial',
    files: ['building-c', 'building-f', 'building-l', 'building-q', 'building-s', 'building-t',
            'chimney-large', 'chimney-medium', 'detail-tank'],
  },
  // METROPOL — ticari doku. 11 model / 1371 KB. building-j (430 KB) ve building-l (284 KB)
  // çıkarıldı: building-k aynı genişliği 241 KB'a veriyor. Yerine iki GERÇEK kule geldi.
  metropol: {
    dir: 'commercial2',
    files: ['building-c', 'building-h', 'building-k', 'building-n',
            'building-skyscraper-b', 'building-skyscraper-c', 'building-skyscraper-d',
            'building-skyscraper-e', 'low-detail-building-c', 'detail-awning', 'detail-parasol-a'],
  },
  // ÇEVRE YOLU — şehir çeperi. 8 model / 496 KB. Eskiden hiç model indirmiyordu ve
  // yolun iki yanı bomboştu; metropolden AYRIŞSIN diye alçak ticari doku seçildi.
  cevreyolu: {
    dir: 'commercial2',
    files: ['building-c', 'building-f', 'building-i',
            'low-detail-building-wide-b', 'low-detail-building-k', 'low-detail-building-e',
            'detail-awning-wide', 'detail-overhang-wide'],
  },
  // MARİNA — deniz. 16 model / 558 KB: 7 müşteri teknesi + dekor + seyir + tersane.
  marina: {
    dir: 'watercraft',
    files: ['boat-speed-f', 'boat-speed-a', 'boat-fishing-small', 'boat-sail-a',
            'boat-house-c', 'boat-tow-a', 'ship-ocean-liner-small',
            'boat-tug-a', 'boat-row-large',
            'buoy', 'buoy-flag',
            'cargo-container-a', 'cargo-container-b', 'cargo-pile-a', 'ramp',
            'ship-cargo-b'],
  },
}

/** Yüklenmiş kitler — aynı şubeye dönünce tekrar inmez */
const cache = new Map<LocId, Kit>()
/** Devam eden yüklemeler — hızlı şube değişiminde çift indirme olmasın */
const inflight = new Map<LocId, Promise<Kit | null>>()

/** Kenney modelleri Y-up ve +Z'ye bakar; bizim dünya z-yukarı. (models.ts ile aynı dönüşüm) */
function convert(scene: THREE.Group): THREE.Group {
  scene.rotation.x = Math.PI / 2
  const mid = new THREE.Group()
  mid.rotation.z = Math.PI / 2
  mid.add(scene)
  const proto = new THREE.Group()
  proto.add(mid)
  proto.traverse(o => {
    if ((o as THREE.Mesh).isMesh) {
      o.castShadow = true
      const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
      if (mat?.map) mat.map.colorSpace = THREE.SRGBColorSpace
    }
  })
  return proto
}

/** Bu şube ek paket ister mi? (yalnız kasaba istemez) */
export function kitNeeded(loc: LocId): boolean { return !!MANIFEST[loc] }
/** Kit zaten bellekte mi (indirme gerekmez) */
export function kitReady(loc: LocId): boolean { return cache.has(loc) }
/** Bu şubenin indireceği model sayısı — arayüzde ilerleme göstermek için */
export function kitSize(loc: LocId): number { return MANIFEST[loc]?.files.length ?? 0 }

/**
 * Şubenin model kitini yükle (bellekte varsa anında döner).
 * Tek tek model hatası sahneyi düşürmez — o model null gelir, sahne prosedürele düşer.
 */
export async function loadKit(loc: LocId, onProgress?: (done: number, total: number) => void): Promise<Kit | null> {
  const spec = MANIFEST[loc]
  if (!spec) return null                       // kasaba / çevre yolu: indirme YOK
  const hit = cache.get(loc)
  if (hit) return hit
  const running = inflight.get(loc)
  if (running) return running

  const job = (async () => {
    const loader = new GLTFLoader()
    let done = 0
    const entries = await Promise.all(spec.files.map(async name => {
      let model: THREE.Group | null = null
      try {
        const g = await loader.loadAsync(`/kenney/${spec.dir}/${name}.glb`)
        model = convert(g.scene as unknown as THREE.Group)
      } catch {
        model = null                            // tek model düşerse sahne yine kurulur
      }
      onProgress?.(++done, spec.files.length)
      return [name, model] as const
    }))
    const kit: Kit = Object.fromEntries(entries)
    const loaded = entries.filter(([, m]) => m).length
    if (loaded === 0) {
      // hiçbiri gelmediyse önbelleğe ALMA — ağ düzelince tekrar denensin
      console.warn(`[kit] ${loc} kiti yüklenemedi, prosedürel sahneye dönülüyor`)
      inflight.delete(loc)
      return null
    }
    cache.set(loc, kit)
    inflight.delete(loc)
    return kit
  })()

  inflight.set(loc, job)
  return job
}

/** Test/teşhis: hangi kitler bellekte */
export function loadedKits(): LocId[] { return [...cache.keys()] }
