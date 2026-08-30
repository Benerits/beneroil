/**
 * SES DIŞA AKTARICI (geliştirici aracı — oyuna dahil değil)
 *
 * BenelOil'de ses DOSYASI yok: her şey src/audio.ts içinde Web Audio ile sentezleniyor.
 * Bu araç aynı düğüm grafiğini birebir OfflineAudioContext'te kurup WAV'a yazar, yani
 * çıkan dosyalar "oyundakine benzer" değil, oyunda duyulanın TA KENDİSİ.
 *
 * İki sürüm üretir:
 *   oyun-seviyesi/ — bütün dosyalara AYNI kazanç uygulanır; sesler arası denge oyundaki
 *                    gibi kalır (jeneratör kısık, para sesi baskın…). Oyuna geri koyacaksan
 *                    ya da mix'i duymak istiyorsan bu klasör.
 *   normalize/     — her dosya kendi içinde -1 dBFS'e çekilir; tek tek dinlemek, kütüphaneye
 *                    atmak, video/kısa içerikte kullanmak için.
 *
 * Kullanım: node tools/ses-export.mjs [hedef-klasör]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const HEDEF = process.argv[2] || join(homedir(), 'Desktop', 'beneloil-sesler')
const SR = 48_000

// ─────────────────────────────────────────────────────────────────────────────
// Tarayıcı içinde çalışacak render fonksiyonu: src/audio.ts'in AYNISI.
// (audio.ts'i import edemiyoruz — DOM/localStorage'a bağlı bir sınıf; grafiği burada
//  birebir kuruyoruz. Değerler değişirse bu dosya da güncellenmeli.)
// ─────────────────────────────────────────────────────────────────────────────
const RENDER = async ({ ad, sure, sr }) => {
  const ctx = new OfflineAudioContext(1, Math.ceil(sure * sr), sr)
  const master = ctx.createGain()
  master.gain.value = 0.9                       // audio.ts: master 0.9
  master.connect(ctx.destination)

  // audio.ts › tone()
  const tone = (freq, dur, type, vol, when = 0, dest = master) => {
    const t0 = when
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = type
    osc.frequency.value = freq
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(vol, t0 + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0008, t0 + dur)
    osc.connect(g); g.connect(dest)
    osc.start(t0); osc.stop(t0 + dur + 0.05)
  }
  // audio.ts › gürültü tamponu (1 sn, loop'lu)
  const noiseBuf = (amp) => {
    const b = ctx.createBuffer(1, sr, sr)
    const d = b.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * amp
    return b
  }

  switch (ad) {
    case 'ui-tik':                              // click()
      tone(660, 0.07, 'triangle', 0.12); break

    case 'para':                                // cash()
      tone(880, 0.09, 'sine', 0.16)
      tone(1320, 0.14, 'sine', 0.14, 0.07); break

    case 'hata':                                // bad()
      tone(180, 0.16, 'sawtooth', 0.055)
      tone(140, 0.2, 'sawtooth', 0.05, 0.07); break

    case 'kacan-musteri':                       // miss()
      tone(330, 0.12, 'sine', 0.05)
      tone(262, 0.18, 'sine', 0.045, 0.1); break

    case 'basarim':                             // achieve()
      ;[523.3, 659.3, 784.0, 1046.5].forEach((n, i) => tone(n, 0.28, 'triangle', 0.12, i * 0.09))
      break

    case 'insaat':                              // build()
      tone(200, 0.1, 'square', 0.1)
      tone(320, 0.12, 'triangle', 0.12, 0.09)
      tone(420, 0.16, 'triangle', 0.1, 0.18); break

    case 'tabanca-klik':                        // clunk()
      tone(220, 0.04, 'square', 0.12)
      tone(90, 0.09, 'square', 0.18, 0.045); break

    case 'patlama': {                           // boom()
      const len = Math.floor(sr * 1.4)
      const buf = ctx.createBuffer(1, len, sr)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2)
      const src = ctx.createBufferSource(); src.buffer = buf
      const g = ctx.createGain(); g.gain.value = 0.5
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'
      lp.frequency.setValueAtTime(900, 0)
      lp.frequency.exponentialRampToValueAtTime(90, 1.2)
      src.connect(lp); lp.connect(g); g.connect(master)
      src.start(0); break
    }

    case 'pompa-akis-loop': {                   // setPump(true)
      const gain = ctx.createGain()
      gain.gain.value = 0.035                   // oyunda 0.4 sn fade-in; loop dosyası için sabit
      gain.connect(master)
      const noise = ctx.createBufferSource(); noise.buffer = noiseBuf(0.5); noise.loop = true
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 0.7
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2.1
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 180
      lfo.connect(lfoGain); lfoGain.connect(bp.frequency)
      noise.connect(bp); bp.connect(gain)
      noise.start(0); lfo.start(0); break
    }

    case 'dizel-jenerator-loop': {               // setDiesel(true)
      const gain = ctx.createGain()
      gain.gain.value = 0.018                   // #1057 sonrası seviye
      gain.connect(master)
      const osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 52
      const osc2 = ctx.createOscillator(); osc2.type = 'square'; osc2.frequency.value = 104.7
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 320; lp.Q.value = 1.2
      const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 13
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.35
      const vGain = ctx.createGain(); vGain.gain.value = 0.7
      lfo.connect(lfoGain); lfoGain.connect(vGain.gain)
      const noise = ctx.createBufferSource(); noise.buffer = noiseBuf(0.4); noise.loop = true
      const nlp = ctx.createBiquadFilter(); nlp.type = 'bandpass'; nlp.frequency.value = 190; nlp.Q.value = 0.8
      const nGain = ctx.createGain(); nGain.gain.value = 0.5
      osc1.connect(lp); osc2.connect(lp); lp.connect(vGain); vGain.connect(gain)
      noise.connect(nlp); nlp.connect(nGain); nGain.connect(gain)
      osc1.start(0); osc2.start(0); lfo.start(0); noise.start(0); break
    }

    default: {
      // ---- ARKA PLAN MÜZİĞİ ---- (startMusic)
      // ad: 'muzik-tam' | 'muzik-1-pentatonik' | 'muzik-2-hicaz' | 'muzik-3-nihavend' | 'muzik-4-major'
      const musicGain = ctx.createGain()
      musicGain.gain.value = 0.7                // varsayılan musicVolume
      musicGain.connect(master)
      const hat = (when, vol) => {
        const len = Math.floor(sr * 0.05)
        const b = ctx.createBuffer(1, len, sr)
        const d = b.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
        const src = ctx.createBufferSource(); src.buffer = b
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 6000
        const g = ctx.createGain(); g.gain.value = vol
        src.connect(hp); hp.connect(g); g.connect(musicGain)
        src.start(when)
      }
      const stepDur = 60 / 100 / 2
      const ROOTS = [130.8, 98.0, 110.0, 87.3]
      const st = (root, semi) => root * Math.pow(2, semi / 12)
      const DIZILER = [
        [0, 3, 5, 7, 10, 12],
        [0, 1, 4, 5, 7, 8, 11],
        [0, 2, 3, 5, 7, 8, 10],
        [0, 2, 4, 5, 7, 9, 11],
      ]
      const dizi = (bar) => DIZILER[Math.floor(bar / 8) % DIZILER.length]
      // tek bölüm isteniyorsa o dizinin bar aralığından başla (bar 0/8/16/24)
      const bolum = { 'muzik-1-pentatonik': 0, 'muzik-2-hicaz': 8, 'muzik-3-nihavend': 16, 'muzik-4-major': 24 }[ad] ?? 0
      const toplamAdim = Math.floor(sure / stepDur)
      for (let i = 0; i < toplamAdim; i++) {
        const step = i % 8
        const bar = bolum + Math.floor(i / 8)
        const root = ROOTS[bar % 4]
        const when = i * stepDur
        if (step === 0) tone(root / 2, 0.6, 'sine', 0.06, when, musicGain)
        if (step === 4) tone(root, 0.45, 'sine', 0.045, when, musicGain)
        if (step === 2 || step === 6) {
          tone(st(root, 4) * 2, 0.5, 'triangle', 0.016, when, musicGain)
          tone(st(root, 7) * 2, 0.5, 'triangle', 0.014, when, musicGain)
        }
        if (bar % 2 === 0 && (step === 1 || step === 5 || (step === 7 && bar % 4 === 0))) {
          const d = dizi(bar)
          const n = d[(bar * 3 + step * 5) % d.length]
          tone(st(root, 12 + n) * 2, 0.55, 'sine', 0.026, when, musicGain)
        }
        if (step === 3 || step === 7) hat(when, 0.008)
      }
    }
  }

  const rendered = await ctx.startRendering()
  return Array.from(rendered.getChannelData(0))
}

// ─────────────────────────────────────────────────────────────────────────────
const BARDUR = (60 / 100 / 2) * 8   // bir bar = 2.4 sn · dizi 8 barda değişir = 19.2 sn
const SESLER = [
  { ad: 'ui-tik',                sure: 0.4,  not: 'arayüz tıklaması' },
  { ad: 'para',                  sure: 0.6,  not: 'kumbara/satış — para geldi' },
  { ad: 'hata',                  sure: 0.6,  not: 'olumsuz bildirim' },
  { ad: 'kacan-musteri',         sure: 0.7,  not: 'müşteri kaçtı ("of ya")' },
  { ad: 'basarim',               sure: 1.2,  not: 'başarım fanfarı' },
  { ad: 'insaat',                sure: 0.8,  not: 'yapı kuruldu / satın alma' },
  { ad: 'tabanca-klik',          sure: 0.4,  not: 'tabanca takıldı' },
  { ad: 'patlama',               sure: 2.0,  not: 'reaktör patlaması' },
  { ad: 'pompa-akis-loop',       sure: 8.0,  not: 'yakıt akışı (döngü)' },
  { ad: 'dizel-jenerator-loop',  sure: 8.0,  not: 'dizel jeneratör (döngü)' },
  { ad: 'muzik-tam',             sure: BARDUR * 32, not: 'arka plan müziği — dört dizinin tamamı' },
  { ad: 'muzik-1-pentatonik',    sure: BARDUR * 8,  not: 'müzik bölüm 1 — pentatonik' },
  { ad: 'muzik-2-hicaz',         sure: BARDUR * 8,  not: 'müzik bölüm 2 — hicaz' },
  { ad: 'muzik-3-nihavend',      sure: BARDUR * 8,  not: 'müzik bölüm 3 — nihavend' },
  { ad: 'muzik-4-major',         sure: BARDUR * 8,  not: 'müzik bölüm 4 — majör' },
]

/** Float32 PCM → 16-bit mono WAV */
function wav(samples, sr) {
  const n = samples.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2)
  }
  return buf
}
const tepe = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
const HEDEF_TEPE = Math.pow(10, -1 / 20)   // -1 dBFS

const tarayici = await chromium.launch({ channel: 'chrome' })
const sayfa = await tarayici.newPage()
mkdirSync(join(HEDEF, 'oyun-seviyesi'), { recursive: true })
mkdirSync(join(HEDEF, 'normalize'), { recursive: true })

const sonuc = []
for (const s of SESLER) {
  const veri = await sayfa.evaluate(RENDER, { ad: s.ad, sure: s.sure, sr: SR })
  sonuc.push({ ...s, veri, tepe: tepe(veri) })
  console.log(`  ✓ ${s.ad.padEnd(22)} ${s.sure.toFixed(1).padStart(5)} sn · tepe ${tepe(veri).toFixed(4)}`)
}
await tarayici.close()

// Oyun seviyesi: TEK ortak kazanç → sesler arası denge oyundaki gibi kalır
const enYuksek = Math.max(...sonuc.map(s => s.tepe))
const ortak = HEDEF_TEPE / enYuksek
console.log(`\nortak kazanç ×${ortak.toFixed(2)} (en yüksek tepe: ${enYuksek.toFixed(4)})`)

for (const s of sonuc) {
  writeFileSync(join(HEDEF, 'oyun-seviyesi', `${s.ad}.wav`), wav(s.veri.map(v => v * ortak), SR))
  const k = s.tepe > 0 ? HEDEF_TEPE / s.tepe : 1
  writeFileSync(join(HEDEF, 'normalize', `${s.ad}.wav`), wav(s.veri.map(v => v * k), SR))
}

const dbfs = v => (20 * Math.log10(v)).toFixed(1)
writeFileSync(join(HEDEF, 'OKUBENI.txt'),
  `BENELOIL — SES DOSYALARI\n` +
  `${'='.repeat(60)}\n\n` +
  `Oyunda ses DOSYASI yok: her şey src/audio.ts içinde Web Audio ile sentezleniyor.\n` +
  `Bu dosyalar aynı düğüm grafiği OfflineAudioContext'te çalıştırılarak üretildi —\n` +
  `yani oyunda duyduğunun taklidi değil, birebir kendisi.\n\n` +
  `48 kHz · 16 bit · mono WAV\n\n` +
  `KLASÖRLER\n` +
  `  oyun-seviyesi/  Hepsine AYNI kazanç uygulandı (×${ortak.toFixed(2)}). Sesler arası denge\n` +
  `                  oyundaki gibi: jeneratör kısık, para sesi baskın. Mix'i duymak ya da\n` +
  `                  oyuna geri koymak için bunu kullan.\n` +
  `  normalize/      Her dosya kendi içinde -1 dBFS'e çekildi. Tek tek dinlemek, kütüphaneye\n` +
  `                  atmak, video/kısa içerikte kullanmak için.\n\n` +
  `DOSYALAR\n` +
  sonuc.map(s => `  ${(s.ad + '.wav').padEnd(28)} ${s.sure.toFixed(1).padStart(5)} sn  ` +
    `oyun içi tepe ${dbfs(s.tepe).padStart(6)} dBFS   ${s.not}`).join('\n') +
  `\n\nNOTLAR\n` +
  `  · Döngü dosyaları (…-loop) oyunda 0.4-0.8 sn'lik fade-in ile açılır; burada dosyanın\n` +
  `    baştan itibaren döngüye girebilmesi için kazanç sabit tutuldu.\n` +
  `  · pompa-akis-loop kusursuz döner (gürültü tamponu 1 sn'de bir tekrarlıyor).\n` +
  `    dizel-jenerator-loop'ta 52 Hz / 104.7 Hz / 13 Hz bileşenler ortak bir periyotta\n` +
  `    buluşmuyor; kesintisiz döngü istiyorsan sıfır geçişinden kırpman gerekir.\n` +
  `  · muzik-tam dört dizinin tamamını içerir (pentatonik → hicaz → nihavend → majör),\n` +
  `    her biri 8 bar. Bölümler ayrıca tek tek de dışa aktarıldı.\n` +
  `  · Müzik 100 BPM, akor döngüsü C3-G2-A2-F2.\n` +
  `  · Üreten araç: tools/ses-export.mjs · audio.ts değişirse yeniden çalıştır.\n`)

console.log(`\n${sonuc.length * 2} WAV + OKUBENI.txt → ${HEDEF}`)
