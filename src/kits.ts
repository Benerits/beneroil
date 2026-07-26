/**
 * ŞUBEYE GÖRE MODEL KİTLERİ — tembel yükleme
 *
 * Üç Kenney paketi geldi (endüstriyel 25, ticari 41, deniz 46 model = ~8 MB).
 * Hepsini açılışta yüklemek KABUL EDİLEMEZ: kasabada oynayan oyuncunun otoyolun
 * fabrikalarını ya da marinanın gemilerini indirmesi için hiçbir sebep yok — üstelik
 * geri bildirimlerin %22'si zaten mobil ısınma/performans.
 *
 * Kural: bir kit YALNIZ o şubeye ilk geçişte iner, sonra bellekte tutulur.
 * Kasaba ve çevre yolu hiçbir ek paket indirmez (bir bayt bile).
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
  // OTOYOL — çevresi sanayi bölgesi: depolar, bacalar, tanklar
  otoyol: {
    dir: 'industrial',
    files: [
      'building-a', 'building-c', 'building-e', 'building-f', 'building-h',
      'building-j', 'building-l', 'building-n', 'building-q', 'building-s',
      'chimney-large', 'chimney-medium', 'chimney-small', 'detail-tank',
    ],
  },
  // METROPOL — ticari doku: ön planda detaylı binalar, arkada düşük detaylı siluet
  metropol: {
    dir: 'commercial2',
    files: [
      'building-b', 'building-e', 'building-h', 'building-k', 'building-n',
      'building-skyscraper-a', 'building-skyscraper-c', 'building-skyscraper-e',
      'low-detail-building-b', 'low-detail-building-f', 'low-detail-building-j',
      'low-detail-building-wide-a', 'detail-awning', 'detail-parasol-a',
    ],
  },
  // MARİNA — segmentlerle birebir eşleşen tekneler + liman detayı
  marina: {
    dir: 'watercraft',
    files: [
      'boat-speed-a',            // jet ski
      'boat-speed-e',            // sürat teknesi
      'boat-fishing-small',      // balıkçı
      'boat-sail-a',             // yelkenli
      'boat-house-b',            // gulet
      'ship-small',              // motor yat
      'ship-large',              // süperyat
      'boat-tug-a',              // römorkör (dekor)
      'ship-cargo-b',            // arka planda geçen kargo
      'buoy', 'buoy-flag',       // seyir kanalı
      'cargo-container-a', 'cargo-container-b', 'cargo-pile-a',
    ],
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

/** Bu şube ek paket ister mi? (kasaba/çevre yolu istemez) */
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
