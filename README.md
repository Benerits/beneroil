# ⛽ Benzinlik

Benzin istasyonu işletme oyunu — browser POC (hedef: iOS, Capacitor ile).

## Çalıştırma

```bash
npm install
npm run dev     # http://localhost:5173
```

## Oynanış (v0)

- Araçlar yoldan gelir, pompaya yanaşır; balonda **istek** yazar (örn. `30L DİZEL`).
- Alttaki panelden **doğru tabancayı** seç (Benzin/Dizel), **DOLDUR**'a basılı tut.
- İstenen litreye yakın bırak → 👌 bahşiş. Taşırırsan → 💦 döküntü cezası. Yanlış yakıt → 🚨 büyük ceza.
- Araç üzerindeki bar = sabır. Biterse müşteri sinirle gider, itibar düşer.
- **Ana tank** sınırlı: HUD'daki ⛽ bar. Bitirmeden 🚛 sipariş ver — tanker ~25 sn'de gelir.
- Para birikince ➕ **2. Pompa** al.

## Kamera / koordinat

`z` yukarı, `y` sağa, `x` izleyiciye doğru. Kamera `(1, 2, 1)` yönünden ortografik bakar (LoL tarzı sabit açı). Birimler harita birimi (1 birim ≈ 1 metre).

## Asset pipeline (Gemini / nano banana)

Placeholder'lar şu an kodla çizilen low-poly meshler. Gerçek assetler için:

```bash
GEMINI_API_KEY=xxx npm run assets            # hepsini üret → assets/gen/
GEMINI_API_KEY=xxx npm run assets -- pump_red  # tek asset
```

- Promptlar ve ortak stil bloğu: `tools/prompts.json`. Stil kilidi orada — tüm assetler tutarlı çıkar.
- Görseller düz yeşil (#00FF00) fonla gelir; `rembg` veya chroma-key ile şeffaflaştır.
- Beğenmediğini `npm run assets -- <isim>` ile tek tek yeniden üret.

## Sistemler (v0.3)

- **Trafik:** yoldan iki şeritte sürekli araç akar; tabela seviyesi + itibar + tesisler istasyona girme olasılığını belirler.
- **İnşaat (🏗️):** yan arsalar (kuzey/güney), 4 pompaya kadar, tabela 3 sv., tank 4 kademe, market 2 sv., tuvalet 2 sv.
- **Elektrik zinciri:** altyapı 2 sv. → batarya deposu (konteynerler) → DC şarj üniteleri; üretim: güneş / dizel jeneratör / SMR. EV'ler bataryadan **anında** şarj olur.
- **Riskler:** paneller kirlenir (temizlik ₺), jeneratör gürültüsü EV kaçırır, pompa/şarj arızaları (tamir ₺), **bakımsız reaktör patlar → her şey sıfırlanır**.
- **Memnuniyet:** müşteri ayrılırken emoji bildirir (😍🙂😐😡), itibarı ve dolayısıyla trafiği etkiler. Kamera fare tekerleğiyle kayar.

## Yol haritası

- [ ] Oto yıkama, yağ değişimi, lastik tamiri modülleri + eleman kiralama
- [ ] Gün döngüsü, günlük hedefler, kaydetme (localStorage → bulut)
- [ ] Ses efektleri (pompa, jeneratör gürültüsü, patlama)
- [ ] Capacitor ile iOS paketleme
