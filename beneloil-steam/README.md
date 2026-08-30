# BenelOil — Steam sürümü (Godot 4.7.1)

Web sürümünün (three.js/TS, repo kökü) Godot portu. Ekonomi sayıları web ile
**birebir** aynı: kaynak gerçeği `../src/state.ts`, aktarım `data/economy.json`.
Denge değişikliği için `.claude/skills/tycoon-economy` ve `godot-port-web`.

## Çalıştırma

```bash
GODOT=/Applications/Godot.app/Contents/MacOS/Godot

$GODOT --editor --path .          # editör (doğrudan binary — `open` translocation'a takılıyor)
$GODOT --path .                   # oyunu çalıştır
./run-tests.sh                    # tüm headless testler
./run-tests.sh wealth             # isim filtresiyle
```

Yeni dosya/asset ekledikten sonra `$GODOT --headless --path . --import` şart.

## Yapı

| Dosya | Sorumluluk |
|---|---|
| `scripts/game.gd` (autoload `Game`) | Durumun TEK otoritesi: kasa, gün döngüsü, inşaat, yovmiye |
| `scripts/econ_data.gd` (`EconData`) | `data/economy.json` tablolarının tek okuma noktası — statik API |
| `scripts/customer_sim.gd` (`CustomerSim`) | Müşterinin SAF mantığı: talep, dolum, durum makinesi. Node bağımsız → headless test edilebilir |
| `scripts/customer.gd` (`Customer`) | Görsel + hareket. Ekonomiyi TANIMAZ, `wants_payment` sinyali yayar |
| `scripts/traffic.gd` | Müşteri havuzu, pompa slot ataması, satışın Game'e işlenmesi |
| `scripts/main.gd` | HUD, giriş, gündüz-gece, pompa görünürlüğü, sim harness |

Oynanış: araç gelir → boş pompa slotuna yaklaşır → 7 L/sn (web `FILL_RATE`)
akar → talep dolunca öder → çıkar. **SPACE** ile pompa alınır; sahnede yalnız
satın alınmış pompalar görünür.

## Headless sim harness

Görsel açmadan ekonomi ölçmek için (ortam değişkenleri):

```bash
BENELOIL_SIM_SECONDS=490 BENELOIL_TIME_SCALE=40 BENELOIL_SIM_PUMPS=2 \
  $GODOT --headless --path .
```

- `BENELOIL_SIM_SECONDS` — kaç OYUN saniyesi simüle edilecek (gün = 160 sn)
- `BENELOIL_TIME_SCALE` — hızlandırma (varsayılan 20×)
- `BENELOIL_SIM_PUMPS` — başlangıç pompa sayısı (yatırım eğrisi ölçümü)

## Ölçümler (2026-07-30, ~3 oyun günü)

| Pompa | Net kâr | Satış | Gün başına |
|---:|---:|---:|---:|
| 1 | ₺4.686 | 40 | ₺1.562 |
| 2 | ₺8.533 | 76 | ₺2.844 |
| 3 | ₺12.386 | 107 | ₺4.129 |
| 4 | ₺13.272 | 118 | ₺4.424 |

### Bu tablodan çıkan iki gerçek sorun

1. **4. pompa neredeyse boş çalışıyor** (+₺886, öncekiler +₺3.850). Darboğaz
   pompa değil **müşteri geliş hızı**: `traffic.gd`'deki `SPAWN_MIN/MAX`
   (2–5.5 sn) günde ~42 gelişe denk, 3 pompa bunu zaten doyuruyor. Maliyet
   tablosu 14 pompaya kadar gidiyor — yani talep modeli portlanmadan pompa
   yatırımı 3'ten sonra anlamsız.
   **Yapılacak:** web'deki talep mantığını (`src/world.ts` — `entryChance`,
   trafik grafiği, fiyat/itibar etkisi) porta al. `SPAWN_MIN/MAX` benim
   uydurduğum geçici sayı, parite sayısı DEĞİL.

2. **Amortisman hedefin gerisinde.** 2. pompa ₺5.000, günde ~₺1.283 katıyor →
   geri dönüş ~3,9 gün ≈ 10,4 dk. `tycoon-economy` erken oyun için 3-5 dk
   diyor. Sebebi eksik gelir kalemleri: bahşiş (%10), pasif gelirler (market,
   tır parkı…), pompa hızı yükseltmeleri henüz portlanmadı.

## Bilinen eksikler

- Yakıt **stoğu/tank** yok: satış deposuz yapılıyor, sipariş döngüsü portlanmadı.
- Bahşiş, itibar, müdür/personel, EV şarj tarafı tablolarda var ama mekanik yok.
- Export templates kurulu değil → hiçbir platforma build alınamaz (bkz. `godot-steam`).
- Sahne ağacındaki `Sun` düğümünde editör uyarısı (⚠) görüldü; sebebi henüz
  tespit edilmedi. `get_configuration_warnings()` runtime'da yok, editör-içi API.
