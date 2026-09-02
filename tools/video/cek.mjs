/**
 * TANITIM VİDEOSU ÇEKİCİ — headless tarayıcıda gerçek oyunu kaydeder.
 *
 * Twitter analitiği (30 Ağu): ortalama izleme 12.8 sn, tamamlama %9.7, en iyi gün %21.8.
 * → Videolar 12-15 saniye. Hook ilk 2 saniyede. Tek net mesaj.
 *
 * Her senaryo: sahneyi kurar, kamerayı yerleştirir, overlay yazıyı basar, kaydeder.
 * Çıktı webm; ses ekleme ve mp4'e çevirme tools/video/tamamla.swift ile yapılır.
 *
 * Kullanım: npm run dev -- --port 5311  →  node tools/video/cek.mjs [senaryo]
 */
import { chromium } from 'playwright-core'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = process.env.PORT ?? '5311'
const OUT = process.env.OUT ?? '/tmp/beneloil-video'
mkdirSync(OUT, { recursive: true })

// ── marka: krem zemin, kırmızı vurgu, Baloo 2 (oyunun fontu) ──
const OVERLAY_CSS = `
#vo { position:fixed; inset:0; z-index:2147483647; pointer-events:none;
      font-family:'Baloo 2',system-ui,sans-serif; }
#vo .band { position:absolute; left:0; right:0; padding:26px 40px; box-sizing:border-box; }
#vo .top { top:206px; background:linear-gradient(180deg, rgba(34,48,60,.82) 0%, rgba(34,48,60,.55) 62%, rgba(34,48,60,0) 100%); }
#vo .bot { bottom:44px; background:linear-gradient(0deg, rgba(34,48,60,.9) 0%, rgba(34,48,60,0) 100%);
           padding-bottom:40px; }
#vo h1 { margin:0; color:#fff; font-size:48px; font-weight:800; line-height:1.08;
         letter-spacing:-.5px; text-shadow:0 3px 14px rgba(0,0,0,.5); opacity:0; }
#vo h2 { margin:10px 0 0; color:#ffd9d9; font-size:27px; font-weight:700; opacity:0;
         text-shadow:0 2px 10px rgba(0,0,0,.5); }
#vo .bot h1 { font-size:42px; margin-bottom:4px }
/* KAYIT DÜZENİ: bina kartı seçilen binaya yapışık konumlanıyor, yani odaktaki binayı
   kapatıyordu. Kayıt boyunca sol üste sabitliyoruz; kamera binayı sağ yarıya alıyor. */
#infocard.show { left:34px !important; right:auto !important; top:232px !important;
                 bottom:auto !important; transform:none !important; margin:0 !important; }
/* toast'lar sol-altta alt bant yazısının üstüne biniyordu → sağ üste al (kanıt olarak kalsın) */
#toasts { left:auto !important; right:26px !important; bottom:auto !important; top:232px !important;
          transform:none !important; align-items:flex-end !important; }
/* KAYIT DÜZENİ: bina kartı ekranın ortasında; odaktaki binayı ve yazıyı kapatmasın diye
   sola çekiliyor, kamera da binayı sağ yarıya alıyor. */

#vo .tag { display:inline-block; background:#d64545; color:#fff; font-size:22px; font-weight:800;
           padding:7px 16px; border-radius:99px; margin-bottom:14px; opacity:0;
           box-shadow:0 4px 16px rgba(214,69,69,.5); }
#vo .in { animation:vin .45s cubic-bezier(.2,.9,.3,1) forwards; }
@keyframes vin { from { opacity:0; transform:translateY(14px) } to { opacity:1; transform:none } }
#vo .out { animation:vout .3s ease forwards }
@keyframes vout { to { opacity:0; transform:translateY(-10px) } }
#vo .pulse { position:absolute; border:4px solid #d64545; border-radius:14px; opacity:0;
             box-shadow:0 0 0 4px rgba(214,69,69,.25); }
#vo .pulse.on { animation:vp 1.1s ease-out infinite }
@keyframes vp { 0%{opacity:1;transform:scale(1)} 70%{opacity:.5;transform:scale(1.06)} 100%{opacity:0;transform:scale(1.1)} }
`

async function kurOverlay(p) {
  await p.addStyleTag({ content: OVERLAY_CSS })
  await p.evaluate(() => {
    const d = document.createElement('div')
    d.id = 'vo'
    d.innerHTML = `<div class="band top"><span class="tag" id="vo-tag"></span><h1 id="vo-h1"></h1></div>
                   <div class="band bot"><h1 id="vo-b1"></h1><h2 id="vo-h2"></h2></div>`
    document.body.appendChild(d)
    window.__vo = {
      yaz(tag, h1, h2) {
        for (const [id, v] of [['vo-tag', tag], ['vo-h1', h1], ['vo-h2', h2]]) {
          const e = document.getElementById(id)
          e.textContent = v || ''
          e.className = id === 'vo-tag' ? 'tag' : ''
          if (v) { void e.offsetWidth; e.classList.add('in') }
        }
      },
      // alt bantta büyük yazı — bina kartı açıkken üst bant kartın altında kalıyor
      yazAlt(h1, h2) {
        for (const [id, v] of [['vo-b1', h1], ['vo-h2', h2]]) {
          const e = document.getElementById(id)
          e.textContent = v || ''
          e.className = ''
          if (v) { void e.offsetWidth; e.classList.add('in') }
        }
      },
      sil() { for (const id of ['vo-tag', 'vo-h1', 'vo-b1', 'vo-h2']) document.getElementById(id).classList.add('out') },
      isaret(sel) {
        document.querySelectorAll('#vo .pulse').forEach(x => x.remove())
        const t = document.querySelector(sel); if (!t) return false
        const r = t.getBoundingClientRect()
        const k = document.createElement('div')
        k.className = 'pulse on'
        Object.assign(k.style, { left: (r.left - 8) + 'px', top: (r.top - 8) + 'px',
                                 width: (r.width + 16) + 'px', height: (r.height + 16) + 'px' })
        document.getElementById('vo').appendChild(k)
        return true
      },
      isaretSil() { document.querySelectorAll('#vo .pulse').forEach(x => x.remove()) },
    }
  })
}

/** oyunu misafir olarak açar, kapıları geçer, sahneyi kurar */
async function oyunuAc(p, save) {
  await p.addInitScript(s => {
    localStorage.setItem('benzinlik-guest', JSON.stringify(s))
    localStorage.setItem('beneloil-loc', s.activeLoc || 'kasaba')
    localStorage.setItem('benzinlik-guest-joined', '1')
    localStorage.setItem('benzinlik-music', '0')     // kayıtta oyun sesi olmasın, müziği sonra ekliyoruz
    localStorage.setItem('benzinlik-sfx', '0')
  }, save)
  await p.goto(`http://localhost:${PORT}/?full=1`, { waitUntil: 'domcontentloaded' })
  await p.waitForTimeout(9500)
  // KAPIYI DÜZGÜN GEÇ: authgate'i DOM'dan silmek yetmiyordu — donmayı `guestPaused`
  // bayrağı tutuyor ve yalnız "Misafir olarak oyna" butonu indiriyor. Silince sahne
  // donuk kalıyor, ui.sync hiç çalışmıyor, HUD "0 ₺ / GÜN 1"de takılıyordu.
  await p.evaluate(() => {
    document.getElementById('gguest')?.click()
    document.querySelectorAll('.backdrop.show').forEach(x => x.classList.remove('show'))
    document.getElementById('boot')?.remove()
    document.getElementById('authgate')?.remove()
    // promo kaydında oyun-içi CTA'lar görünmesin (video temiz kalsın)
    for (const id of ['guestcta', 'fbbtn', 'farhint']) {
      const el = document.getElementById(id)
      if (el) el.style.display = 'none'
    }
  })
  await p.waitForTimeout(700)
  // ?full=1 vitrin modu kendi state'ini kuruyor ve guest save'i eziyor → değerleri
  // sahne kurulduktan SONRA dayatıyoruz (kasa/gün/itibar videoda gerçekçi görünsün).
  // YALNIZ HUD ALANLARI: yapı sayılarını (pumps/parkingCount/solarCount…) state'e dayatmak
  // sahnedeki gerçek nesnelerle uyuşmuyor ve trafik "undefined.x" ile her karede çöküyordu.
  // ?full=1 zaten her yapıyı kuruyor; buradan sadece kasa/gün/itibar/depo düzeltiliyor.
  await p.evaluate(sv => {
    const st = window.__dbg?.state
    if (!st) return
    for (const k of ['money', 'day', 'reputation']) if (sv[k] != null) st[k] = sv[k]
    if (sv.tanks) for (const [f, v] of Object.entries(sv.tanks)) st.tanks[f] = v
  }, save)
  await p.waitForTimeout(1400)
  await kurOverlay(p)
}

const bekle = (p, ms) => p.waitForTimeout(ms)

// ─────────────────────────── SENARYOLAR ───────────────────────────
const SENARYOLAR = {
  // 1) MÜDÜR TALİMATLARI — ofis binası → modal → talimat düğmeleri
  mudur: {
    ad: '01-mudur-talimatlari',
    save: { money: 4_000_000, day: 92, reputation: 4.8, pumps: 8, evChargers: 4, marketLevel: 3,
            managerLevel: 3, hasWash: true, hasOil: true, hasCoffee: true, hasRestaurant: true,
            hasTruckPark: true, solarCount: 3, unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol'],
            activeLoc: 'kasaba', tanks: { benzin: 5000, dizel: 5000, lpg: 5000 } },
    async oyna(p) {
      // HOOK: ofis binasına yaklaş
      await p.evaluate(() => {
        const d = window.__dbg
        d.cine?.setCam?.(-5, 4.5, 2.4)
        window.__vo.yaz('YENİ', 'Müdürünüz artık\nsizi dinliyor', '')
      })
      await bekle(p, 2600)
      await p.evaluate(() => {
        window.__vo.yaz('', '', '"Müdürün ne yapacağına BİZ karar vermeliyiz"')
      })
      await bekle(p, 2200)
      // Ofis › Şubeler → talimat paneli
      await p.evaluate(() => {
        window.__vo.sil()
        document.getElementById('officebtn')?.click()
        document.querySelector('#oftabs .tab[data-oftab="buyume"]')?.click()
      })
      await bekle(p, 1400)
      await p.evaluate(() => window.__vo.yaz('', 'Artık talimat veriyorsunuz', ''))
      await bekle(p, 1600)
      // düğmeleri tek tek işaretle
      for (const [sel, yazi] of [['[data-mpol="orderFuel"]', 'Yakıt sipariş etsin mi?'],
                                 ['[data-mpfuel="0.35"]', 'Hangi seviyede sipariş versin?'],
                                 ['[data-mpol="cleanSolar"]', 'Panelleri temizlesin mi?']]) {
        await p.evaluate(([s, y]) => { window.__vo.isaret(s); window.__vo.yaz('', '', y) }, [sel, yazi])
        await bekle(p, 1500)
      }
      await p.evaluate(() => { window.__vo.isaretSil(); window.__vo.yaz('BENELOIL', '8 ayrı talimat', 'beneloil.com') })
      await bekle(p, 2200)
    },
  },

  // 2) DÖNDÜR — 40 kayıtlık grup
  dondur: {
    ad: '02-dondur',
    save: { money: 2_000_000, day: 60, pumps: 6, marketLevel: 3, hasCoffee: true, hasRestaurant: true,
            hasWash: true, parkingCount: 2, activeLoc: 'kasaba', unlockedLocs: ['kasaba'],
            tanks: { benzin: 4000, dizel: 4000, lpg: 4000 } },
    async oyna(p) {
      await p.evaluate(() => {
        window.__dbg.cine?.setCam?.(-2.6, 15.4, 2.0)
        window.__vo.yaz('40 KİŞİ İSTEDİ', '"Marketi nasıl\ndöndüreceğim?"', '')
      })
      await bekle(p, 3000)
      await p.evaluate(() => { window.__vo.yaz('', '', 'Özellik vardı — kimse bulamıyordu.') })
      await bekle(p, 2200)
      await p.evaluate(() => { window.__vo.sil(); window.__dbg.sec('market') })
      await bekle(p, 900)
      await p.evaluate(() => { window.__vo.isaret('#binfo-rot'); window.__vo.yazAlt('Artık tek dokunuş', '') })
      await bekle(p, 1700)
      for (let i = 0; i < 3; i++) {
        await p.evaluate(() => document.getElementById('binfo-rot')?.click())
        await bekle(p, 950)
      }
      await p.evaluate(() => { window.__vo.isaretSil(); window.__vo.yazAlt('Yerinden kalkmadan döner', 'beneloil.com') })
      await bekle(p, 2200)
    },
  },

  // 3) OTOPARK — ölçüyle anlatılan bug
  otopark: {
    ad: '03-otopark',
    isinma: 55_000,          // araçlar gelip park edene dek bekle (kayıt dışı)
    save: { money: 3_000_000, day: 70, pumps: 6, parkingCount: 3, marketLevel: 2, hasCoffee: true,
            hasRestaurant: true, activeLoc: 'kasaba', unlockedLocs: ['kasaba'],
            tanks: { benzin: 5000, dizel: 5000, lpg: 5000 } },
    async oyna(p) {
      await p.evaluate(() => {
        window.__dbg.cine?.setCam?.(0.4, -0.2, 2.35)   // otoparkın ölçülmüş dünya konumu
        window.__vo.yaz('BUG AVI', 'Araçlar üst üste\nbiniyordu', '')
      })
      await bekle(p, 2800)
      await p.evaluate(() => window.__vo.yaz('', '', 'Park yeri: 1.02 birim'))
      await bekle(p, 1900)
      await p.evaluate(() => window.__vo.yaz('', '', 'Araç genişliği: 1.20 birim'))
      await bekle(p, 2100)
      await p.evaluate(() => window.__vo.yaz('', 'Sığmıyorlarmış.', ''))
      await bekle(p, 2000)
      await p.evaluate(() => window.__vo.yaz('DÜZELDİ', 'Aralık 1.25', 'beneloil.com'))
      await bekle(p, 2400)
    },
  },

  // 4) PERFORMANS — mobil ısınma
  performans: {
    ad: '04-performans',
    save: { money: 8_000_000, day: 120, reputation: 4.7, activeLoc: 'kasaba',
            tanks: { benzin: 8000, dizel: 8000, lpg: 8000 } },
    async oyna(p) {
      await p.evaluate(() => {
        window.__dbg.cine?.setCam?.(-2, 2, 1.5)
        window.__vo.yaz('ŞİKAYET', '"Telefonum\ninanılmaz ısınıyor"', '')
      })
      await bekle(p, 2900)
      await p.evaluate(() => window.__vo.yaz('', '', 'Ölçtük: sahne her karede İKİ KEZ çiziliyordu'))
      await bekle(p, 2400)
      await p.evaluate(() => window.__vo.yaz('', 'Gölgeyi dondurduk', '621 materyal → 187'))
      await bekle(p, 2200)
      await p.evaluate(() => window.__vo.yaz('MOBİLDE', '9 kat az piksel', '2.9M → 329K'))
      await bekle(p, 2400)
      await p.evaluate(() => window.__vo.yaz('BENELOIL', 'Aynı oyun, serin telefon', 'beneloil.com'))
      await bekle(p, 2000)
    },
  },

  // 5) HUD BİLGİ KUTULARI
  bilgi: {
    ad: '05-bilgi-kutulari',
    save: { money: 1_500_000, day: 45, pumps: 5, evChargers: 2, marketLevel: 2, reputation: 4.6,
            activeLoc: 'kasaba', unlockedLocs: ['kasaba'], tanks: { benzin: 3000, dizel: 2000, lpg: 1500 } },
    async oyna(p) {
      await p.evaluate(() => {
        window.__dbg.cine?.setCam?.(-3, 6, 1.9)
        window.__vo.yaz('SORU', '"İtibarım neden\ndeğişmiyor?"', '')
      })
      await bekle(p, 2900)
      await p.evaluate(() => { window.__vo.sil(); window.__vo.isaret('.chip[data-bilgi="itibar"]') })
      await bekle(p, 1200)
      await p.evaluate(() => {
        document.querySelector('.chip[data-bilgi="itibar"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        window.__vo.yazAlt('Artık dokunun, anlatsın', '')
      })
      await bekle(p, 2600)
      await p.evaluate(() => {
        window.__vo.isaret('.chip[data-bilgi="kasa"]')
        document.querySelector('.chip[data-bilgi="kasa"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        window.__vo.yaz('', '', '9 gösterge · hepsi açıklamalı')
      })
      await bekle(p, 2400)
      await p.evaluate(() => { window.__vo.isaretSil(); window.__vo.yazAlt('Tahmin etmeyin', 'beneloil.com') })
      await bekle(p, 2200)
    },
  },

  // 6) ŞUBE AĞI HARİTASI — GÜNCELLEME DUYURUSU (major update, erişim odaklı).
  //
  //    SÜRE 14 sn. Kurgu bu dosyanın başındaki kendi ölçümümüze dayanıyor: ortalama
  //    izleme 12,8 sn. İlk kurguda 4 saniye istasyonda "hazırlık" yapılıyordu ve
  //    monotondu — asıl yeni şey olan harita geç geliyordu.
  //
  //    ŞİMDİ: SOĞUK AÇILIŞ doğrudan haritayla (alışılmadık görüntü = durdurucu),
  //    ardından 0,8 sn'lik SERT KESMELERLE şube şube gezinti. Her kesmede sağ panel
  //    gerçekten değişiyor (.hn[data-hloc] düğümüne tıklanıyor), yani hareket sahte
  //    değil — oyunun kendi ekranı.
  //
  //    NEDEN CANLI ŞUBE GEÇİŞİ YOK: subeyeGec() push-confirmed RELOAD ile bitiyor,
  //    vitrin state'i sıfırlanıp hep kasabaya düşüyor; ?full=1 ayrıca `beneloil-loc`
  //    ipucunu yok sayıyor. Ölçüldü (4 şube, 20 sn timeout, activeLoc hep 'kasaba').
  harita: {
    ad: '06-sube-agi-haritasi',
    save: { money: 8_400_000, day: 140, reputation: 4.9, pumps: 8, evChargers: 4,
            marketLevel: 3, managerLevel: 3, hasWash: true, hasOil: true, hasCoffee: true,
            hasRestaurant: true, hasTruckPark: true, solarCount: 3,
            unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol'], activeLoc: 'kasaba',
            tanks: { benzin: 5000, dizel: 5000, lpg: 5000 } },
    isinma: 22000,   // araçların pompaya VARMASI için (18 sn'de 4, 28 sn'de 6 araç)
    async oyna(p) {
      // ── 0,0 → 1,4: SOĞUK AÇILIŞ — perde açılır açılmaz HARİTA ──
      await p.evaluate(() => {
        const d = window.__dbg
        if (d?.state) {
          d.state.unlockedLocs = ['kasaba', 'cevreyolu', 'otoyol']
          d.state.brandStars = 6
        }
        // Toast + müşteri paneli kapalı: çekimde kimse servis yapmadığı için
        // "Müşteri beklemekten sıkıldı ve gitti!" gibi NEGATİF mesajlar çıkıyordu.
        const s = document.createElement('style')
        s.textContent = '#panel{display:none !important}#infocard{display:none !important}#toasts{display:none !important}'
        document.head.appendChild(s)
        // TAM EKRAN HARİTA (soğuk açılış): HUD, navbar ve modal çerçevesi iner, harita
        // kareyi baştan sona doldurur. Gerekçe: ilk kare DURDURUCU olmalı; modal
        // çerçevesi + arkada yarı görünen istasyon + iki sıra HUD dikkati bölüyordu.
        // Ayrı style etiketi, çünkü oyun akışına dönerken bunu TEK BAŞINA kaldıracağız.
        const tam = document.createElement('style')
        tam.id = 'vo-tamekran'
        // NOT: harita YATAY bir panel, video ise DİKEY (1080x1350). Paneli 100vh'ye
        // germek altını boş krem bırakıyordu. Onun yerine koyu zeminde DİKEYDE
        // ORTALANIYOR; kalan alt boşluk zaten alt bant yazısının yeri. Üst bant da
        // kapatılıyor: bu beat'te yalnız yazAlt kullanılıyor ama bandın gradyanı
        // haritanın ortasından gri bir şerit gibi geçiyordu.
        tam.textContent = `
          .hud, #navbar, #sheettabs { display:none !important }
          #vo .top { display:none !important }
          #mapwrap { background:#0d1420 !important; padding:0 !important;
                     display:flex !important; align-items:center !important;
                     justify-content:center !important }
          #mapwrap .modal { width:100vw !important; max-width:100vw !important;
                            height:auto !important; max-height:100vh !important;
                            border-radius:0 !important; border:0 !important }
          #mapwrap .mclose { display:none !important }`
        document.head.appendChild(tam)
        document.getElementById('locbtn')?.click()
        document.querySelector('#locmenu button[data-qloc="__harita"]')?.click()
      })
      await bekle(p, 500)
      await p.evaluate(() => window.__vo.yazAlt('9 ŞUBE', ''))
      await bekle(p, 900)

      // ── 1,4 → 6,2: SERT KESMELER — şube şube, her kesmede panel değişir ──
      const duraklar = await p.evaluate(() =>
        [...document.querySelectorAll('#mapwrap .hn[data-hloc]')]
          .map(n => n.getAttribute('data-hloc')).filter(Boolean).slice(0, 6))
      for (const id of duraklar) {
        // ETİKET PANELDEN OKUNUR, SVG DÜĞÜMÜNDEN DEĞİL: düğümün textContent'i
        // isim + yıldız + not metnini iç içe veriyor ve ilk kelime anlamsız bir
        // glif olarak basılıyordu. Panel başlığı tek doğru kaynak.
        await p.evaluate(x => {
          document.querySelector(`#mapwrap .hn[data-hloc="${x}"]`)
            ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
        }, id)
        await bekle(p, 120)
        // İSİM DÜĞÜMÜN KENDİ <text>'İNDEN: haritada oyuncunun GÖRDÜĞÜ yazı bu.
        // (Panel başlığını seçmeyi denedim, seçici tutmadı ve etiket boş kaldı;
        //  düğümün textContent'ini bütün almak da yıldız/not metnini karıştırıp
        //  anlamsız bir glif basıyordu.)
        const ad = await p.evaluate(x => {
          const n = document.querySelector(`#mapwrap .hn[data-hloc="${x}"]`)
          const t = [...(n?.querySelectorAll('text') ?? [])]
            .map(e => (e.textContent || '').trim())
            .find(v => v && !/^[₺%\d★·.,]+$/.test(v))
          return t || ''
        }, id)
        await p.evaluate(a => window.__vo.yazAlt(a ? a.toLocaleUpperCase('tr') : '', ''), ad)
        await bekle(p, 680)
      }

      // ── 6,2 → 8,6: OYUN GERÇEK — harita kapanır, dolu istasyon ──
      await p.evaluate(() => {
        // OYUN AKIŞINA DÖN: tam ekran kalkar, HUD geri gelir, harita kapanır.
        // Hook haritaydı; burada "bu ne oyunu?" sorusunu oynanış cevaplıyor.
        document.getElementById('vo-tamekran')?.remove()
        document.getElementById('mapwrap')?.classList.remove('show')
        window.__dbg.cine?.setCam?.(0, 4, 1.25)
        window.__vo.yaz('', 'Her şubenin\nkendi ekonomisi', 'kira · trafik · arsa')
      })
      await bekle(p, 2400)

      // ── 8,6 → 11,0: haritaya dönüş — ortak tedarik hattı ──
      await p.evaluate(() => {
        window.__vo.sil()
        document.getElementById('locbtn')?.click()
        document.querySelector('#locmenu button[data-qloc="__harita"]')?.click()
      })
      await bekle(p, 600)
      await p.evaluate(() => window.__vo.yazAlt('Komşu şubeler tedarik hattı paylaşır', ''))
      await bekle(p, 1800)

      // ── 11,0 → 14,0: kapanış ──
      await p.evaluate(() => { window.__vo.sil() })
      await bekle(p, 300)
      await p.evaluate(() => window.__vo.yaz('BENELOIL', 'Şube Ağı', 'beneloil.com'))
      await bekle(p, 2700)
    },
  },
  // 6b) ŞUBE AĞI HARİTASI — v3 "HARİTA KAMERASI" (2 Eyl, Oğuz: "daha önce yapmıştık
  //     ama hoşuma gitmedi… haritayı ön planda güzel şekilde göstererek").
  //
  //    v2'NİN SORUNU (kareler ölçüldü): harita YATAY bir modal, video DİKEY; harita
  //    karenin ortasında ufak bir şerit, düğümler 40 px, sağ panel karenin üçte birini
  //    yiyor, üst/alt koyu boşluk. "Ön planda" değildi — ekranın %30'uydu.
  //
  //    v3: modal yok, panel yok, HUD yok. SVG haritanın KENDİSİ kadrajı doldurur ve
  //    viewBox ile üstünde GERÇEK bir kamera gezer: tek düğüme yakın plan → geri
  //    çekilip ağın açılması (düğümler sırayla belirir, hatlar çizilir) → 4 sert
  //    kesmeyle şube şube yakın plan → tam ağ + soru → 1,8 sn oynanış → marka.
  //
  //    HOOK (kendi Twitter verimizden): lansman tweet'ini sattıran şey "tek pompadan
  //    imparatorluğa" büyüme kurgusuydu (330 beğeni → %31,5 kayıt). Aynı kurgu haritaya
  //    taşındı: "Tek istasyon." → geri çekil → "9 şubelik ağ." Ortalama izleme 12,8 sn;
  //    ilk 1,2 sn'de ekranda tek şey var: senin istasyonun, kocaman. Kapanıştaki soru
  //    ("Sıradaki parayı hangi şubeye koyarsın?") yanıt çağrısıdır — algoritma yanıtı sever.
  //
  //    ALTYAZILAR GERÇEK: şube kesmelerindeki metin düğümün kendi <text>'inden okunur
  //    (etiket + alt satır), yani "₺… mn", "6★", "₺…/gün" oyunun hesapladığı sayılardır.
  harita2: {
    ad: '06-sube-agi-haritasi-v3',
    save: { money: 8_400_000, day: 140, reputation: 4.9, pumps: 8, evChargers: 4,
            marketLevel: 3, managerLevel: 3, hasWash: true, hasOil: true, hasCoffee: true,
            hasRestaurant: true, hasTruckPark: true, solarCount: 3,
            unlockedLocs: ['kasaba', 'cevreyolu', 'otoyol'], activeLoc: 'kasaba',
            tanks: { benzin: 5000, dizel: 5000, lpg: 5000 } },
    isinma: 22000,
    async oyna(p) {
      // ── sahne: 5 açık şube (bir ORTAK HAT kurulu olsun: otoyol↔otoyol-2), müdürlü
      //    şubeler ("müdür yok" yerine ₺/gün yazsın), marka 6★ (metropol "açılabilir") ──
      await p.evaluate(() => {
        const d = window.__dbg
        const st = d?.state
        if (st) {
          st.unlockedLocs = ['kasaba', 'cevreyolu', 'otoyol', 'marina', 'otoyol-2']
          st.brandStars = 6
          const sn = (f) => ({ f, tanks: {}, tankCounts: {}, prices: {}, pendingCash: {} })
          st.locSnapshots['cevreyolu'] = sn({ managerLevel: 2, pumps: 6, evChargers: 2, marketLevel: 2, hasWash: true, hasCoffee: true })
          st.locSnapshots['otoyol'] = sn({ managerLevel: 3, pumps: 8, evChargers: 4, marketLevel: 3, hasRestaurant: true, hasTruckPark: true })
          st.locSnapshots['otoyol-2'] = sn({ managerLevel: 2, pumps: 6, evChargers: 2, marketLevel: 2, hasCoffee: true })
          st.locSnapshots['marina'] = sn({ managerLevel: 2, pumps: 4, marketLevel: 2, hasRestaurant: true })
        }
        const s = document.createElement('style')
        s.textContent = '#panel{display:none !important}#infocard{display:none !important}#toasts{display:none !important}'
        document.head.appendChild(s)
        // "müşteri kaçtı" kenar flaşı (ekranFlasi) harita üstüne pembe vinyet basıyordu →
        // var olanı söndür, sonradan yaratılırsa da söndür
        const flasSondur = () => [...document.body.children].forEach(e =>
          { if (e instanceof HTMLElement && e.style.boxShadow.includes('90px')) e.style.display = 'none' })
        flasSondur()
        new MutationObserver(flasSondur).observe(document.body, { childList: true })
      })

      // ── HARİTA KAMERASI: modal/HUD iner, SVG kadrajı doldurur, viewBox'ı biz sürüyoruz ──
      const kameraKur = async () => p.evaluate(() => {
        document.getElementById('locbtn')?.click()
        document.querySelector('#locmenu button[data-qloc="__harita"]')?.click()
        const tam = document.createElement('style')
        tam.id = 'vo-sinema'
        tam.textContent = `
          .hud, #navbar, #sheettabs, #h-side, #h-chips, #h-legend, #mapwrap .mhead { display:none !important }
          #vo .top { top:70px !important; background:linear-gradient(180deg, rgba(34,48,60,.86) 0%, rgba(34,48,60,.6) 60%, rgba(34,48,60,0) 100%) !important }
          #mapwrap { position:fixed !important; inset:0 !important; padding:0 !important; background:#f1ebdb !important }
          #mapwrap .modal { position:fixed !important; inset:0 !important; width:100vw !important; max-width:100vw !important;
                            height:100vh !important; max-height:100vh !important; border-radius:0 !important; border:0 !important; overflow:hidden !important }
          #mapwrap .mbody, #mapwrap .hleft, #mapwrap .hboard { position:absolute !important; inset:0 !important; padding:0 !important;
                            margin:0 !important; border:0 !important; border-radius:0 !important; display:block !important; overflow:hidden !important }
          #hmap { position:absolute !important; inset:0 !important; width:100vw !important; height:100vh !important; aspect-ratio:auto !important }
          #vo h1 { white-space:pre-line }
          #hmap .hn { transform-box:fill-box; transform-origin:center; transition:opacity .28s ease, transform .5s cubic-bezier(.2,1.4,.4,1) }
          #hmap .hn.vo-gizli { opacity:0; transform:scale(.55) }
          #hmap .hl { transition:opacity .6s ease } #hmap .hl.vo-gizli { opacity:0 }`
        document.head.appendChild(tam)
        const svg = document.getElementById('hmap')
        svg.setAttribute('preserveAspectRatio', 'xMidYMid slice')
        // kâğıt kadrajın dışına da uzasın (geri çekilince boşluk/karanlık görünmesin)
        const NS = 'http://www.w3.org/2000/svg'
        const arkaKur = () => {
          if (svg.querySelector('.vo-arka')) return
          const arka = document.createElementNS(NS, 'g')
          arka.setAttribute('class', 'vo-arka')
          arka.innerHTML = '<rect x="-3000" y="-3000" width="7000" height="7000" class="hz-paper"/>'
            + '<rect x="-3000" y="-3000" width="7000" height="7000" fill="url(#hz-dots)"/>'
          const zemin = svg.querySelector('.hz')
          if (zemin) svg.insertBefore(arka, zemin); else svg.prepend(arka)
        }
        arkaKur()
        // kamera: hedefe yumuşak geçiş (ease-in-out) ya da anında kesme
        const K = { x: 0, y: 0, w: 1000, hedef: null }
        const uygula = () => svg.setAttribute('viewBox', `${K.x} ${K.y} ${K.w} ${K.w * 1.25}`)
        const ease = (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
        const tik = () => {
          if (K.hedef) {
            const h = K.hedef, t = Math.min(1, (performance.now() - h.t0) / h.ms), e = ease(t)
            K.x = h.x0 + (h.x - h.x0) * e; K.y = h.y0 + (h.y - h.y0) * e; K.w = h.w0 + (h.w - h.w0) * e
            if (t >= 1) K.hedef = null
          }
          uygula(); arkaKur(); requestAnimationFrame(tik)   // gün dönerse SVG yeniden kurulur; kâğıt geri gelsin
        }
        requestAnimationFrame(tik)
        window.__hk = {
          // merkez (cx,cy) + genişlik w → viewBox
          kes(cx, cy, w) { K.hedef = null; K.x = cx - w / 2; K.y = cy - w * 1.25 / 2; K.w = w; uygula() },
          git(cx, cy, w, ms) { K.hedef = { x0: K.x, y0: K.y, w0: K.w, x: cx - w / 2, y: cy - w * 1.25 / 2, w, t0: performance.now(), ms } },
          dugum(id) {
            const n = svg.querySelector(`.hn[data-hloc="${id}"]`)
            const et = [...(n?.querySelectorAll('text') ?? [])].map(e => (e.textContent || '').trim())
            return { label: et[et.length - 2] || '', sub: et[et.length - 1] || '' }
          },
        }
      })

      await kameraKur()
      // 0,0 → 1,2  YAKIN PLAN: senin istasyonun, kocaman. Diğer her şey gizli.
      await p.evaluate(() => {
        const svg = document.getElementById('hmap')
        svg.querySelectorAll('.hn').forEach(n => { if (n.getAttribute('data-hloc') !== 'kasaba') n.classList.add('vo-gizli') })
        svg.querySelectorAll('.hl').forEach(l => l.classList.add('vo-gizli'))
        window.__hk.kes(198, 262, 250)
        window.__vo.yaz('ŞUBE AĞI', 'Tek istasyon.', '')
      })
      await bekle(p, 1200)

      // 1,2 → 4,2  GERİ ÇEKİL: ağ açılır — düğümler kasabaya uzaklık sırasıyla belirir
      await p.evaluate(() => {
        window.__hk.git(500, 330, 900, 2400)
        const sira = ['cevreyolu', 'marina', 'cevreyolu-2', 'metropol', 'marina-2', 'otoyol', 'otoyol-2', 'metropol-2']
        sira.forEach((id, i) => setTimeout(() => {
          document.querySelector(`#hmap .hn[data-hloc="${id}"]`)?.classList.remove('vo-gizli')
        }, 350 + i * 210))
        setTimeout(() => document.querySelectorAll('#hmap .hl').forEach(l => l.classList.remove('vo-gizli')), 1500)
      })
      await bekle(p, 1300)
      await p.evaluate(() => window.__vo.yaz('ŞUBE AĞI', '…şimdi 9 şubelik\nbir ağ.', ''))
      await bekle(p, 1700)

      // 4,2 → 8,2  SERT KESMELER: şube şube yakın plan, altyazı düğümün KENDİ yazısı
      const kesmeler = [
        ['marina',   128, 452, 'Yakıt buraya gemiyle gelir'],
        ['otoyol-2', 822, 213, 'Otoyol ile ORTAK tedarik hattı'],
        ['metropol', 606, 398, 'Marka yıldızıyla açılır'],
        ['cevreyolu', 404, 158, 'Müdür senin yerine işletir'],
      ]
      for (const [id, cx, cy, not] of kesmeler) {
        await p.evaluate(([id, cx, cy, not]) => {
          window.__hk.kes(cx, cy + 20, 300)
          const d = window.__hk.dugum(id)
          window.__vo.sil()
          window.__vo.yazAlt(d.label.toLocaleUpperCase('tr') + (d.sub ? ' · ' + d.sub : ''), not)
        }, [id, cx, cy, not])
        await bekle(p, 1000)
      }

      // 8,2 → 10,6  TAM AĞ + SORU (yanıt çağrısı)
      await p.evaluate(() => {
        window.__hk.kes(500, 330, 900)
        window.__vo.sil()
      })
      await bekle(p, 250)
      await p.evaluate(() => window.__vo.yaz('', 'Sıradaki parayı\nhangi şubeye koyarsın?', ''))
      await bekle(p, 2150)

      // 10,6 → 12,4  OYNANIŞ: harita kapanır, dolu istasyon — "bu ne oyunu?" cevabı
      await p.evaluate(() => {
        document.getElementById('vo-sinema')?.remove()
        document.getElementById('mapwrap')?.classList.remove('show')
        window.__dbg.cine?.setCam?.(0, 4, 1.25)
        window.__vo.yaz('', 'Her şube gerçek\nbir istasyon', '')
      })
      await bekle(p, 1800)

      // 12,4 → 14,4  MARKA: tam ağ
      await kameraKur()
      await p.evaluate(() => { window.__hk.kes(500, 330, 900); window.__vo.yaz('BENELOIL', 'Şube Ağı', 'beneloil.com') })
      await bekle(p, 2000)
    },
  },
  // 7b) RÜZGÂR GÜLÜ v2 — ÇIKIŞ SONRASI PROMO (2 Eyl, Oğuz: "rüzgar gülü için de promo, videosunu isterim")
  //
  //    v1 (31 Ağu) çıkış DUYURUSUYDU: tek türbin, sabit kamera, HUD açık, bina kartı CSS'le
  //    gizlendiği için hiç görünmedi. v2'de elimizde GERÇEK SAYI var: 36 saatte 94 istasyon
  //    371 türbin dikti (prod, toplam). Kurgu: gece → uyuyan panel / dönen türbin karşıtlığı
  //    (2 sn hook) → geri çekilince 4 türbinlik tarla + sayı → bina kartı (gerçek üretim)
  //    → "Sen kaç tane diktin?" (yanıt çağrısı) → marka. HUD kapalı, 13,6 sn.
  ruzgar2: {
    ad: '07-ruzgar-gulu-v2',
    save: { money: 9_500_000, day: 118, reputation: 4.9, pumps: 8, evChargers: 4,
            marketLevel: 3, managerLevel: 3, hasWash: true, hasOil: true,
            activeLoc: 'kasaba', unlockedLocs: ['kasaba'],
            tanks: { benzin: 5000, dizel: 5000, lpg: 5000 } },
    isinma: 20000,
    async oyna(p) {
      // ── sahne: gece, HUD yok, 3 türbin (ilki vitrinden; 2'si oyunun kendi yerleştirme
      //    akışıyla dikilir — hayalet yeşilse onaylanır, yani gerçekten kurulabilir yerler) ──
      const kurulan = await p.evaluate(() => {
        const s = document.createElement('style')
        s.id = 'vo-sahne'
        s.textContent = '#panel{display:none !important}#toasts{display:none !important}.hud,#navbar,#sheettabs{display:none !important}#vo h1{white-space:pre-line}'
        document.head.appendChild(s)
        const d = window.__dbg
        d.saat(0.75)
        const w0 = d.world.buildings.find(b => b.id === 'wind')
        if (!w0) return -1
        const bx = w0.group.position.x, by = w0.group.position.y
        // vitrin türbini kuzeybatı parselde (col 1,row 0); batıdaki parsel (2,0) alınıp
        // iki türbin daha dikilir. Sayılabilir yapı N'inci örnek 'wind#N' ile başlatılır.
        d.kayit.arsaAl(2, 0, false)
        let n = 0
        for (const [x, y] of [[bx - 5.5, by], [bx - 12.5, by], [bx - 12.5, by + 6], [bx - 5.5, by + 6]]) {
          if (n >= 2) break
          const once = d.state.windCount
          d.place.start(`wind#${once}`); d.place.at(x, y)
          const r = d.place.neden()
          if (r && !r.arazi.length && !r.sabit.length && !r.yapi.length) d.place.confirm(); else d.place.cancel()
          if (d.state.windCount > once) n++
        }
        d.state.windWear = 0.08
        // KADRAJ ÖLÇEREK: ortografik kamerada ekran ofseti dünya ofsetinin doğrusal
        // fonksiyonu → iki sonda ile 2×2 çöz, hedef nokta istenen NDC'ye otursun.
        const hedefKam = (P, nx, ny, zoom) => {
          const c = d.cine.getCam()
          d.cine.setCam(c.x, c.y, zoom)
          const p0 = d.cine.proj(P.x, P.y, P.z)
          d.cine.setCam(c.x + 1, c.y, zoom); const p1 = d.cine.proj(P.x, P.y, P.z)
          d.cine.setCam(c.x, c.y + 1, zoom); const p2 = d.cine.proj(P.x, P.y, P.z)
          d.cine.setCam(c.x, c.y, c.zoom)
          const a = p1.x - p0.x, b = p2.x - p0.x, cc = p1.y - p0.y, dd = p2.y - p0.y
          const det = a * dd - b * cc
          const ex = nx - p0.x, ey = ny - p0.y
          return { x: c.x + (ex * dd - b * ey) / det, y: c.y + (a * ey - cc * ex) / det, zoom }
        }
        const turbinler = d.world.buildings.filter(b => /^wind/.test(b.id)).map(b => b.group.position)
        const orta = { x: turbinler.reduce((t, q) => t + q.x, 0) / turbinler.length, y: turbinler.reduce((t, q) => t + q.y, 0) / turbinler.length }
        window.__rk = {
          hub: { x: bx, y: by, z: 6.4 },      // ilk türbinin göbeği (direk 8,4 birim)
          tarla: { x: orta.x, y: orta.y, z: 3 },
          hedefKam,
          kes(P, nx, ny, zoom) { const k = hedefKam(P, nx, ny, zoom); d.cine.setCam(k.x, k.y, k.zoom) },
          git(P, nx, ny, zoom, ms) {
            const k = hedefKam(P, nx, ny, zoom), c = d.cine.getCam(), t0 = performance.now()
            const e = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
            const tik = () => {
              const f = e(Math.min(1, (performance.now() - t0) / ms))
              d.cine.setCam(c.x + (k.x - c.x) * f, c.y + (k.y - c.y) * f, c.zoom + (k.zoom - c.zoom) * f)
              if (f < 1) requestAnimationFrame(tik)
            }
            tik()
          },
        }
        return n
      })
      if (kurulan < 0) throw new Error('vitrinde türbin yok')
      console.log(`   ek türbin dikildi: ${kurulan}`)

      // 0,0 → 2,4  HOOK: dönen türbin göbeği kadrajın ortasında, gerçek sayı
      await p.evaluate(() => {
        window.__rk.kes(window.__rk.hub, 0, 0.05, 1.3)
        window.__vo.yaz('GERÇEK SAYI', '36 saatte 94 istasyon\n371 türbin dikti.', '')
      })
      await bekle(p, 2400)

      // 2,4 → 4,8  NEDEN: güneş gece üretmez, türbin üretir (gece sahnesi kanıt)
      await p.evaluate(() => window.__vo.yaz('GECE 02:30', 'Güneş uyur.\nTürbin uyumaz.', ''))
      await bekle(p, 2400)

      // 4,8 → 8,0  GERİ ÇEKİL: türbin tarlası + istasyon
      await p.evaluate(() => { window.__rk.git(window.__rk.tarla, 0, 0.1, 0.62, 2200); window.__vo.sil() })
      await bekle(p, 800)
      await p.evaluate(() => window.__vo.yazAlt('Gece vardiyasının faturasını\nartık türbin öder', ''))
      await bekle(p, 2400)

      // 8,0 → 10,4  BİNA KARTI: gerçek üretim/rüzgâr/yıpranma
      await p.evaluate(() => { window.__dbg.sec('wind'); window.__vo.sil() })
      await bekle(p, 500)
      await p.evaluate(() => window.__vo.yazAlt('Rüzgâr değişken —\nbazen tam güç, bazen yarım', ''))
      await bekle(p, 1900)

      // 10,4 → 12,0  SORU (yanıt çağrısı)
      await p.evaluate(() => {
        window.__dbg.sec(''); document.getElementById('infocard')?.classList.remove('show')
        window.__rk.git(window.__rk.hub, 0, 0.05, 1.0, 1400)
        window.__vo.sil()
      })
      await bekle(p, 300)
      await p.evaluate(() => window.__vo.yaz('', 'Sen kaç tane diktin?', ''))
      await bekle(p, 1500)

      // 12,0 → 13,6  MARKA
      await p.evaluate(() => window.__vo.yaz('BENELOIL', 'Rüzgâr Gülü', 'beneloil.com'))
      await bekle(p, 1600)
    },
  },
  // 7) RÜZGÂR TÜRBİNİ — YENİ ÖZELLİK DUYURUSU ("Rüzgâr enerjisi çağı!")
  //
  //    Hook, türbinin OYUNDAKİ FARKI: güneş gece üretmiyor, türbin üretiyor.
  //    Bunu anlatmak yerine GÖSTERİYORUZ — gece sahnesinde dönen kanatlar.
  //    Süre 13 sn (ortalama izleme 12,8 sn), hook ilk 2 saniyede.
  ruzgar: {
    ad: '07-ruzgar-turbini',
    save: { money: 6_200_000, day: 96, reputation: 4.8, pumps: 8, evChargers: 4,
            marketLevel: 3, managerLevel: 2, hasWash: true, hasOil: true,
            activeLoc: 'kasaba', unlockedLocs: ['kasaba'],
            tanks: { benzin: 5000, dizel: 5000, lpg: 5000 } },
    isinma: 20000,
    async oyna(p) {
      await p.evaluate(() => {
        const s = document.createElement('style')
        // çekimde kimse servis yapmıyor → "müşteri sıkıldı gitti" gibi NEGATİF
        // toast'lar reklama giriyordu; panel de kadrajı kapatıyor.
        s.textContent = '#panel{display:none !important}#infocard{display:none !important}#toasts{display:none !important}'
        document.head.appendChild(s)
        const d = window.__dbg
        // GECE: türbinin güneşten farkı ancak geceleyin görünür.
        // state.sunFactor'ı ELLE YAZMAK İŞE YARAMIYOR — gün döngüsü her karede
        // üzerine yazıyor (ilk denemede sahne pırıl pırıl gündüz çıktı). Saatin
        // KENDİSİ değişmeli: __dbg.saat(0,75) = tam gece.
        d.saat(0.75)
        // KADRAJ ÖLÇÜLDÜ: türbin 8,4 birim yüksekliğinde; yakın planda kanatlar
        // kadrajın üstünden taşıyordu. dy=-4/zoom=1.0 tamamını alıyor ve altında
        // istasyon kalıyor — "bu bir benzin istasyonu oyunu" bilgisi kaybolmuyor.
        const w = d.world.buildings.find(b => b.id === 'wind')
        if (w) d.cine.setCam(w.group.position.x, w.group.position.y - 4, 1.0)
        window.__vo.yaz('YENİ', 'Rüzgâr enerjisi\nçağı!', '')
      })
      await bekle(p, 2400)

      // güneş paneli gece SIFIR — karşıtlık kurulur
      await p.evaluate(() => window.__vo.yaz('YENİ', 'Rüzgâr enerjisi\nçağı!', 'Güneş gece üretmez.'))
      await bekle(p, 1900)

      // türbine yaklaş: kanatlar dönüyor
      await p.evaluate(() => {
        const d = window.__dbg
        d.saat(0.78)
        const w = d.world.buildings.find(b => b.id === 'wind')
        if (w) d.cine.setCam(w.group.position.x, w.group.position.y - 3, 1.25)
        window.__vo.sil()
      })
      await bekle(p, 400)
      await p.evaluate(() => window.__vo.yazAlt('Türbin geceleyin de döner', ''))
      await bekle(p, 2400)

      // bina kartı: gerçek sayılar (üretim / rüzgâr / yıpranma)
      await p.evaluate(() => { window.__dbg.sec('wind') })
      await bekle(p, 900)
      await p.evaluate(() => window.__vo.yazAlt('Rüzgâr değişken — bazen tam güç', ''))
      await bekle(p, 2200)

      // bakım: bedeli de göster (dürüst duyuru)
      await p.evaluate(() => window.__vo.yazAlt('Yıprandıkça bakım ister', ''))
      await bekle(p, 1800)

      await p.evaluate(() => { window.__vo.sil(); window.__vo.yaz('BENELOIL', 'Rüzgâr Türbini', 'beneloil.com') })
      await bekle(p, 2100)
    },
  },
}

// ─────────────────────────── ÇEKİM ───────────────────────────
const istenen = process.argv.slice(2)
const liste = istenen.length ? istenen : Object.keys(SENARYOLAR)
const b = await chromium.launch({ channel: 'chrome' })
for (const ad of liste) {
  const s = SENARYOLAR[ad]
  if (!s) { console.log(`  ? bilinmeyen senaryo: ${ad}`); continue }
  const klasor = join(OUT, ad)
  mkdirSync(klasor, { recursive: true })
  const ctx = await b.newContext({
    viewport: { width: 1080, height: 1350 },       // Twitter dikey-kare: akışta en çok yer kaplar
    deviceScaleFactor: 1,
  })
  const p = await ctx.newPage()
  // KARE YAKALAYICI — CDP screencast.
  // p.screenshot() saniyede ancak ~1 kare veriyordu (PNG encode yavaş). Page.startScreencast
  // tarayıcının kendi kare akışını JPEG olarak veriyor: gerçek zamanlı, ~15-30 fps.
  // (recordVideo webm üretiyor; AVFoundation webm okuyamıyor, playwright'ın ffmpeg'i de
  //  mp4 yazamıyor — bu yüzden kareleri toplayıp kareler-mp4.swift ile birleştiriyoruz.)
  let kareNo = 0
  const cdp = await ctx.newCDPSession(p)
  cdp.on('Page.screencastFrame', ev => {
    writeFileSync(join(klasor, `k${String(kareNo++).padStart(5, '0')}.jpg`), Buffer.from(ev.data, 'base64'))
    cdp.send('Page.screencastFrameAck', { sessionId: ev.sessionId }).catch(() => {})
  })
  p.on('pageerror', e => console.log('   HATA:', String(e.stack || e).slice(0, 700)))
  await oyunuAc(p, s.save)
  // ISINMA (kayıt DIŞI): otopark gibi sahneler boş başlıyor — araçlar gelip park edene
  // kadar beklenmezse video "araçlar sığıyor" derken bomboş beton gösteriyordu.
  if (s.isinma) {
    console.log(`   ısınma ${s.isinma / 1000} sn (trafik otursun)`)
    await p.waitForTimeout(s.isinma)
  }
  // ikinci dayatma: vitrin kurulumu gecikmeli bittiği için ilk override eziliyordu
  await p.evaluate(sv => {
    const st = window.__dbg?.state
    if (!st) return
    for (const k of ['money', 'day', 'reputation']) if (sv[k] != null) st[k] = sv[k]
    if (sv.tanks) for (const [f, v] of Object.entries(sv.tanks)) st.tanks[f] = v
  }, s.save)
  await p.waitForTimeout(600)
  // KAYIT BOYUNCA SABİT TUT: vitrin modu FULL_ORDER ile alışveriş yapıp kasayı sıfırlıyor,
  // HUD'da "0 ₺" görünüyordu. Videoda gerçekçi rakam dursun diye periyodik dayatma.
  const sabitle = setInterval(() => {
    p.evaluate(sv => {
      const st = window.__dbg?.state
      if (!st) return
      st.money = sv.money ?? st.money
      if (sv.day) st.day = sv.day
      if (sv.reputation) st.reputation = sv.reputation
      if (sv.tanks) for (const [f, v] of Object.entries(sv.tanks)) st.tanks[f] = v
    }, s.save).catch(() => {})
  }, 500)
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, everyNthFrame: 1 })
  const t0 = Date.now()
  await s.oyna(p)
  const gercekSn = (Date.now() - t0) / 1000
  clearInterval(sabitle)
  await cdp.send('Page.stopScreencast').catch(() => {})
  await p.waitForTimeout(300)
  await p.close()
  await ctx.close()
  const n = readdirSync(klasor).filter(f => f.endsWith('.jpg')).length
  // GERÇEK YAKALAMA HIZI RAPORLANIR. Eski satır sabit 15 fps varsayıp süreyi yazıyordu
  // ama uret.sh videoyu 60 fps'te birleştiriyor — 842 kare "56,1 sn" diye raporlanıyor,
  // video ise 14,0 sn çıkıyordu. Daha kötüsü: makine yavaşlayıp yakalama hızı düşerse
  // sabit 60 fps'te birleştirme videoyu HIZLI oynatır ve bu log'dan anlaşılmaz.
  // Artık ölçülen fps yazılıyor; 60'tan belirgin saparsa uyarı basılıyor.
  const fps = n / Math.max(0.001, gercekSn)
  const sure60 = n / 60
  console.log(`  ✓ ${s.ad}: ${n} kare · ölçülen ${fps.toFixed(1)} fps · gerçek ${gercekSn.toFixed(1)} sn`
    + ` → 60 fps'te ${sure60.toFixed(1)} sn video → ${klasor}`)
  if (Math.abs(fps - 60) > 6) {
    console.log(`  ⚠ yakalama hızı 60 fps'ten saptı (${fps.toFixed(1)}). uret.sh 60 fps'te birleştiriyor,`)
    console.log(`    yani video ${(60 / fps).toFixed(2)}× hızlı oynar. Birleştirmeyi ${Math.round(fps)} fps ile yap.`)
  }
}
await b.close()
console.log(`\nçıktı: ${OUT}`)
