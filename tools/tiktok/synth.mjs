/**
 * CHIPTUNE SES SENTEZİ — TikTok/Shorts videoları için telifsiz arka müzik.
 *
 * Sıfır bağımlılık: 44.1kHz stereo 16-bit WAV'ı doğrudan yazar.
 * 128 BPM, Am-F-C-G döngüsü: kare dalga arpej (bas), üçgen lead, noise hi-hat,
 * sine kick. Oyunun 8-bit/low-poly kimliğiyle uyumlu, enerjik ama boğmayan.
 *
 *   node tools/tiktok/synth.mjs <saniye> <cikis.wav> [seed]
 */
import { writeFileSync } from 'node:fs'

const SEC = Number(process.argv[2] || 32)
const OUT = process.argv[3] || '/tmp/tiktok-music.wav'
const SEED = Number(process.argv[4] || 7)

const SR = 44100
const BPM = 128
const BEAT = 60 / BPM              // sn/vuruş
const N = Math.floor(SEC * SR)
const L = new Float32Array(N)
const R = new Float32Array(N)

let seed = SEED
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }

// nota → frekans (A4=440), MIDI numarasıyla
const f = m => 440 * Math.pow(2, (m - 69) / 12)
// akor kökleri: Am F C G (MIDI): A2=45, F2=41, C3=48, G2=43
const PROG = [45, 41, 48, 43]
const MINOR = [0, 3, 7, 12]        // arpej aralıkları (Am hissi; majör akorlarda da tatlı duruyor)

const sq = (ph) => (Math.sin(ph) > 0 ? 1 : -1)
const tri = (ph) => 2 * Math.abs(2 * ((ph / (2 * Math.PI)) % 1) - 1) - 1

/** basit nota bas: t0'dan itibaren dur sn, freq Hz, tür + zarf */
function note(t0, dur, freq, kind, gain, pan = 0) {
  const s0 = Math.floor(t0 * SR), s1 = Math.min(N, Math.floor((t0 + dur) * SR))
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR
    const env = Math.exp(-t * 5.5) * Math.min(1, t * 200) // hızlı atak, üstel sönüm
    const ph = 2 * Math.PI * freq * t
    const v = (kind === 'sq' ? sq(ph) * 0.6 : kind === 'tri' ? tri(ph) : Math.sin(ph)) * env * gain
    L[i] += v * (1 - pan * 0.5)
    R[i] += v * (1 + pan * 0.5)
  }
}
function kick(t0) {
  const s0 = Math.floor(t0 * SR), s1 = Math.min(N, s0 + Math.floor(0.14 * SR))
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR
    const fr = 120 * Math.exp(-t * 28) + 42
    const v = Math.sin(2 * Math.PI * fr * t) * Math.exp(-t * 22) * 0.85
    L[i] += v; R[i] += v
  }
}
function hat(t0, open = false) {
  const dur = open ? 0.09 : 0.035
  const s0 = Math.floor(t0 * SR), s1 = Math.min(N, s0 + Math.floor(dur * SR))
  for (let i = s0; i < s1; i++) {
    const t = (i - s0) / SR
    const v = (rnd() * 2 - 1) * Math.exp(-t * (open ? 40 : 90)) * 0.16
    L[i] += v * 0.8; R[i] += v * 1.2
  }
}

// ---- aranjman ----
const bars = Math.ceil(SEC / (BEAT * 4))
for (let bar = 0; bar < bars; bar++) {
  const t0 = bar * BEAT * 4
  const root = PROG[bar % PROG.length]
  // kick: 1 ve 3, hat: sekizlikler (4. sekizlik açık)
  kick(t0); kick(t0 + BEAT * 2)
  for (let e = 0; e < 8; e++) hat(t0 + e * BEAT / 2, e % 4 === 3)
  // bas arpej: onaltılık kare dalga (kök-5-oktav-5)
  const bassPat = [0, 7, 12, 7, 0, 7, 12, 7, 0, 7, 12, 7, 0, 7, 12, 7]
  for (let s = 0; s < 16; s++) {
    note(t0 + s * BEAT / 4, BEAT / 4 * 0.9, f(root + bassPat[s]), 'sq', 0.14, -0.3)
  }
  // lead: 2 barda bir üçgen melodi (pentatonik yürüyüş, hafif rastgele)
  if (bar % 2 === 0) {
    const scale = [0, 3, 5, 7, 10, 12]
    let cur = 12
    for (let s = 0; s < 8; s++) {
      cur = Math.max(7, Math.min(19, cur + (rnd() < 0.5 ? -1 : 1) * (rnd() < 0.3 ? 2 : 1)))
      const deg = scale[cur % scale.length] + 12 * Math.floor(cur / scale.length)
      note(t0 + s * BEAT / 2, BEAT / 2 * 0.85, f(root + 12 + (deg % 24)), 'tri', 0.12, 0.35)
    }
  }
}

// intro/outro yumuşatma + normalize
const FADE = Math.floor(0.8 * SR)
for (let i = 0; i < FADE; i++) { const g = i / FADE; L[i] *= g; R[i] *= g }
for (let i = 0; i < FADE; i++) { const g = i / FADE; L[N - 1 - i] *= g; R[N - 1 - i] *= g }
let peak = 0
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]))
const norm = peak > 0 ? 0.85 / peak : 1

// ---- WAV yaz ----
const data = Buffer.alloc(N * 4)
for (let i = 0; i < N; i++) {
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * norm)) * 32767), i * 4)
  data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * norm)) * 32767), i * 4 + 2)
}
const hdr = Buffer.alloc(44)
hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + data.length, 4); hdr.write('WAVE', 8)
hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(2, 22)
hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 4, 28); hdr.writeUInt16LE(4, 32); hdr.writeUInt16LE(16, 34)
hdr.write('data', 36); hdr.writeUInt32LE(data.length, 40)
writeFileSync(OUT, Buffer.concat([hdr, data]))
console.log(`✓ ${OUT} (${SEC}s, ${(data.length / 1024 / 1024).toFixed(1)}MB)`)
