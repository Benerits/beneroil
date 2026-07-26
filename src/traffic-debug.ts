/**
 * TRAFİK HATA AYIKLAMA KATMANI (trafik raporu §6.1) — `?traffic=1`
 *
 * Rapordaki gerekçe: trafik hataları "gözle bakınca anlaşılmıyor". Araç neden durdu —
 * fiziksel engel mi, yol verme mi, rezervasyon kuyruğu mu? Bu üçü ekranda ayırt
 * edilemediği için her hata sınıfı yeniden keşfediliyordu.
 *
 * Katman şunu gösterir:
 *  · rezervasyon BÖLGELERİ (yeşil = boş, sarı = dolu, kırmızı = kuyrukta bekleyen var)
 *  · her aracın DURUM ETİKETİ (faz + neden durduğu)
 *  · canlı sayaçlar: buharlaşma, verilen/reddedilen rezervasyon, kalıcı sıkışan
 *
 * Yalnız `?traffic=1` ile yüklenir; normal oyunda tek satır kod çalışmaz (kurulum
 * bile yapılmaz), dolayısıyla oyuncu performansına etkisi YOKTUR.
 */
import * as THREE from 'three'

interface ZoneInfo { id: string; used: number; capacity: number; queued: number }
interface CarLike {
  group: THREE.Group
  phase: string
  hold: boolean
  waitingForToken?: boolean
  hardStuckT: number
  station: string
}
export interface TrafficDebugSource {
  zones: { id: string; cx: number; cy: number; w: number; d: number; capacity: number }[]
  snapshot: () => ZoneInfo[]
  cars: Iterable<CarLike>
  evap: { total: number; near: number; far: number }
  reserve: { granted: number; denied: number }
}

export const trafficDebugOn = new URLSearchParams(location.search).has('traffic')

const FREE = 0x3ea55f, BUSY = 0xe8a33d, BLOCKED = 0xd4544a

export class TrafficDebug {
  private root = new THREE.Group()
  private zoneMeshes = new Map<string, THREE.Mesh>()
  private hud: HTMLDivElement
  private t = 0

  constructor(private scene: THREE.Scene) {
    this.root.renderOrder = 40
    scene.add(this.root)
    this.hud = document.createElement('div')
    this.hud.style.cssText = 'position:fixed; left:8px; bottom:8px; z-index:60; pointer-events:none;'
      + 'font:700 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace; color:#eafff2;'
      + 'background:rgba(12,22,18,.82); padding:8px 10px; border-radius:9px; white-space:pre;'
      + 'border:1px solid rgba(120,220,170,.35); max-width:46vw;'
    document.body.appendChild(this.hud)
  }

  /** bölge dikdörtgenlerini (yeniden) çiz — kapı taşınınca çağrılır */
  private syncZones(src: TrafficDebugSource) {
    const live = new Set(src.zones.map(z => z.id))
    for (const [id, m] of this.zoneMeshes) {
      if (!live.has(id)) { this.root.remove(m); this.zoneMeshes.delete(id) }
    }
    for (const z of src.zones) {
      let m = this.zoneMeshes.get(z.id)
      if (!m) {
        m = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ color: FREE, transparent: true, opacity: 0.22, depthWrite: false }))
        m.renderOrder = 40
        this.root.add(m)
        this.zoneMeshes.set(z.id, m)
      }
      m.position.set(z.cx, z.cy, 0.06)
      m.scale.set(z.w, z.d, 1)
    }
  }

  update(src: TrafficDebugSource, dt: number) {
    this.syncZones(src)
    const snap = src.snapshot()
    for (const s of snap) {
      const m = this.zoneMeshes.get(s.id)
      if (!m) continue
      const mat = m.material as THREE.MeshBasicMaterial
      // kuyrukta bekleyen varsa KIRMIZI: darboğaz burada. Doluysa sarı, boşsa yeşil.
      mat.color.setHex(s.queued > 0 ? BLOCKED : s.used >= s.capacity ? BUSY : FREE)
      mat.opacity = s.queued > 0 ? 0.42 : 0.22
    }

    // HUD sayaçları — 4 kare/sn yeter (metin güncellemesi pahalı)
    this.t += dt
    if (this.t < 0.25) return
    this.t = 0
    let hold = 0, token = 0, stuck = 0, n = 0
    const byPhase: Record<string, number> = {}
    for (const c of src.cars) {
      n++
      byPhase[c.phase] = (byPhase[c.phase] ?? 0) + 1
      if (c.waitingForToken) token++
      else if (c.hold) hold++
      if (c.hardStuckT > 3 && !c.waitingForToken) stuck++
    }
    const phases = Object.entries(byPhase).sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}:${v}`).join(' ')
    const zl = snap.map(s => `${s.id.replace('gate-', '').replace('-near', '·N').replace('-far', '·F')} `
      + `${s.used}/${s.capacity}${s.queued ? '+' + s.queued : ''}`).join('  ')
    const ratio = src.reserve.granted ? (src.reserve.denied / src.reserve.granted).toFixed(1) : '—'
    this.hud.textContent =
      `TRAFİK · ?traffic=1\n`
      + `araç ${n}  ${phases}\n`
      + `duran: fiziksel ${hold} · rezervasyon ${token} · KALICI SIKIŞAN ${stuck}\n`
      + `buharlaşma ${src.evap.total} (near ${src.evap.near} / far ${src.evap.far})\n`
      + `rezervasyon ${src.reserve.granted} verildi / ${src.reserve.denied} beklendi (${ratio}× bekleme)\n`
      + `bölgeler ${zl || '—'}`
  }

  dispose() {
    this.scene.remove(this.root)
    this.hud.remove()
  }
}
