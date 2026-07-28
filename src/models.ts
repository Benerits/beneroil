import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js'

// Kenney Car Kit (CC0, kenney.nl) — modeller Y-up ve +Z'ye bakar.
// Bizim dünya: z yukarı, araç ileri yönü +x. Sarmalayıcı gruplarla çeviriyoruz.

export const CAR_FILES = [
  'sedan', 'sedan-sports', 'suv', 'suv-luxury', 'hatchback-sports',
  'van', 'delivery', 'taxi', 'truck',
]

export interface ModelLib {
  cars: THREE.Group[]
  tankerBase: THREE.Group | null
  evCar: THREE.Group | null
}

function convert(scene: THREE.Group): THREE.Group {
  // içteki grup: Y-up -> Z-up; dıştaki grup: +Z ileri -> +x ileri
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

export async function loadModels(): Promise<ModelLib | null> {
  try {
    const loader = new GLTFLoader()
    const load = (name: string) =>
      loader.loadAsync(`/kenney/${name}.glb`).then(g => convert(g.scene as unknown as THREE.Group))

    const cars = await Promise.all(CAR_FILES.map(load))
    const tankerBase = await load('truck-flat').catch(() => null)
    const evCar = await load('race-future').catch(() => null)
    return { cars, tankerBase, evCar }
  } catch (err) {
    console.warn('Kenney modelleri yüklenemedi, prosedürel araçlara dönülüyor:', err)
    return null
  }
}

export function cloneModel(proto: THREE.Group): THREE.Group {
  return proto.clone(true)
}

/** RIGGED karakter klonu + boy/yer ayarı — mini karakterler SkinnedMesh içerir;
 *  normal clone(true) iskeleti kopyalayamadığından model GÖRÜNMEZ kalıyordu
 *  ("sadece şapkası görünüyor" raporu). SkeletonUtils.clone şart. */
export function fitCharacter(proto: THREE.Group, targetH: number): THREE.Group {
  const g = skeletonClone(proto) as THREE.Group
  const box = new THREE.Box3().setFromObject(g)
  const s = targetH / Math.max(0.001, box.max.z - box.min.z)
  g.scale.setScalar(s)
  const b2 = new THREE.Box3().setFromObject(g)
  g.position.x -= (b2.min.x + b2.max.x) / 2
  g.position.y -= (b2.min.y + b2.max.y) / 2
  g.position.z -= b2.min.z
  const wrap = new THREE.Group()
  wrap.add(g)
  return wrap
}

/** KENNEY MİNİ KARAKTERLER (Oğuz: pompacı/müşteriler bunlardan olsun) — TEMBEL yüklenir
 *  (açılışı bloklamaz, inmezse prosedürel figürler devrede kalır). ~250KB × 6. */
export async function loadCharacters(): Promise<THREE.Group[] | null> {
  try {
    const loader = new GLTFLoader()
    const NAMES = ['character-male-a', 'character-male-b', 'character-male-c',
      'character-female-a', 'character-female-b', 'character-female-c']
    const list = await Promise.all(NAMES.map(n =>
      loader.loadAsync(`/kenney/characters/${n}.glb`).then(g => convert(g.scene as unknown as THREE.Group))))
    return list
  } catch (err) {
    console.warn('Mini karakterler yüklenemedi, prosedürel figürler kullanılacak:', err)
    return null
  }
}

// ---- Statik yapılar (Kenney City kitleri) ----

export interface StaticLib {
  market1: THREE.Group | null
  market2: THREE.Group | null
  office: THREE.Group | null
  toilet: THREE.Group | null
  treeLarge: THREE.Group | null
  treeSmall: THREE.Group | null
  lamp: THREE.Group | null
  planter: THREE.Group | null
}

export async function loadStatics(): Promise<StaticLib | null> {
  try {
    const loader = new GLTFLoader()
    const load = (path: string) =>
      loader.loadAsync(`/kenney/city/${path}.glb`)
        .then(g => convert(g.scene as unknown as THREE.Group))
        .catch(() => null)

    const [market1, market2, office, toilet, treeLarge, treeSmall, lamp, planter] = await Promise.all([
      load('commercial/building-d'),
      load('commercial/building-e'),
      load('commercial/building-a'),
      load('suburban/building-type-a'),
      load('suburban/tree-large'),
      load('suburban/tree-small'),
      load('roads/light-curved'),
      load('suburban/planter'),
    ])
    return { market1, market2, office, toilet, treeLarge, treeSmall, lamp, planter }
  } catch (err) {
    console.warn('Şehir modelleri yüklenemedi:', err)
    return null
  }
}

/**
 * Klonu hedef genişliğe (dünya y ekseni) ölçekler, tabanını z=0'a,
 * merkezini x/y=0'a oturtur.
 */
export function fitModel(proto: THREE.Group, targetWidth: number, axis: 'x' | 'y' | 'z' = 'y'): THREE.Group {
  const g = proto.clone(true)
  const box = new THREE.Box3().setFromObject(g)
  const extent = axis === 'x' ? box.max.x - box.min.x
    : axis === 'y' ? box.max.y - box.min.y : box.max.z - box.min.z
  const s = targetWidth / Math.max(0.001, extent)
  g.scale.setScalar(s)
  const box2 = new THREE.Box3().setFromObject(g)
  g.position.x -= (box2.min.x + box2.max.x) / 2
  g.position.y -= (box2.min.y + box2.max.y) / 2
  g.position.z -= box2.min.z
  const wrap = new THREE.Group()
  wrap.add(g)
  return wrap
}
