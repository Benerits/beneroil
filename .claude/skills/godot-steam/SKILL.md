---
name: godot-steam
description: Benzinlik'in Steam sürümü için Godot export ve Steamworks entegrasyonu — export templates, platform preset'leri, GodotSteam kurulumu, başarımlar/Steam Cloud, steamcmd depo yüklemesi ve web sürümünden farklı kayıt/anti-cheat modeli. Build alırken, Steam SDK bağlarken veya mağaza sayfası çıkarken kullan.
---

# Godot → Steam (Benzinlik)

## 0. Ön koşul: export templates
`~/Library/Application Support/Godot/export_templates/` **şu an boş → build alınamaz.** Motorla **birebir aynı sürümün** (`4.7.1.stable`) templates paketi kurulmalı. Sürüm uyuşmazlığı export'u ya patlatır ya sessizce eski motorla paketler. Kurulum kullanıcının editöründen yapılır (Editor → Manage Export Templates); ajan olarak indirmeye kalkma, kullanıcıya söyle.

## 1. Platform preset'leri
- Steam için hedef: **Windows Desktop (x86_64)** birincil, **Linux/X11 (x86_64)** (Steam Deck/Proton için de değerli), **macOS** opsiyonel.
- Preset'ler `export_presets.cfg`'de yaşar; isimleri CLI'da birebir geçer:
  `"$GODOT" --headless --path . --export-release "Windows Desktop" build/win/BenelOil.exe`
- Steam Deck hedefliyorsan: Forward+ yerine **Mobile** renderer'ı ölç, gamepad navigasyonu ve 1280×800 UI ölçeğini test et. Deck doğrulaması UI/kontrol şartlarına takılır, grafiklere değil.
- macOS dağıtımı imza/notarization ister; Steam bunu atlamaz. Windows/Linux ile aynı sprint'e koymayı planlama.

## 2. GodotSteam (GDExtension)
- Steamworks'e GDScript'ten erişim **GodotSteam** eklentisiyle olur; `addons/godotsteam/` altına GDExtension olarak kurulur. Motor **4.7.1** ve mimari (arm64 mac / x86_64 win-linux) ile eşleşen sürümü seç.
- ⚠️ **Sürüm ve API adlarını kurulum anında doğrula, hafızadan yazma.** GodotSteam sürümler arası isim değiştirdi (camelCase → snake_case). Kurduktan sonra gerçek yüzeyi grep'le:
  `grep -rn "func \(init\|run_callbacks\|set_achievement\)" addons/godotsteam/ 2>/dev/null` ve eklentinin kendi dokümanı.
- Değişmeyen iskelet — hangi isimlendirme olursa olsun akış şu:
  1. Oyun açılışında **tek** init çağrısı, dönüş kodunu logla (başarısızsa Steam'siz moda düş, çökme yok).
  2. **Her karede callback pompası** çağrılmalı (`run_callbacks` muadili) — yoksa başarımlar/overlay sessizce ölür.
  3. Geliştirme sırasında binary'nin yanında `steam_appid.txt` (içinde AppID) olmalı; **release paketine koymayın.**
- Overlay'in çalışması için pencere yönetimi standart olmalı; egzotik borderless/fullscreen hackleri overlay'i bozar.

## 3. Başarımlar ve Cloud
- Başarımları tycoon dönüm noktalarından türet (ilk şube, X pompa kademesi, devir/prestij, ilk milyon). Steam'e yazmadan önce **oyun içi durumu tek kaynaktan** oku — çift kaynak "başarım gelmedi" bug'ının klasiği.
- Başarım tetikleyicileri **idempotent** olsun; oyuncu save'i yeniden yükleyince tekrar tetiklenmesi zararsız kalmalı.
- **Steam Cloud**: kayıt dosyası `user://` altında tutulur, Cloud eşleşmesi ACF/UFS ayarıyla mağaza tarafında tanımlanır. Kayıt formatını versiyonla (`save_version` alanı) — sürüm atlayan oyuncunun kaydını migrate edebilmelisin.

## 4. Web sürümünden en büyük fark: sunucu yok
- Web/iOS tarafında otorite `server/index.js` (`sanitizeSave` + COST/FLAT clamp'leri). Steam sürümü tek oyunculu ve **offline**: o sunucu katmanı yok.
- Bunun sonucu: **anti-cheat kovalamayın** — yerel tek oyunculu oyunda anlamsız. Ama `sanitizeSave` mantığının **sağlık kontrolü** kısmını (NaN, negatif kasa, imkânsız kademe) koruyun; amaç hile değil **bozuk kayıt kurtarma**.
- Ekonomi sayıları web'le aynı kalmalı; `tycoon-economy` skill'i tek denge kaynağıdır.

## 5. Depoya yükleme
- Steamworks SDK'nın `steamcmd` + Content Builder'ı kullanılır: `app_build_<appid>.vdf` + depo `.vdf` dosyaları, `steamcmd +login <user> +run_app_build <path>`.
- Build klasörüne **sadece export çıktısı** girsin (`build/win/` vb.); `.godot/`, kaynak asset ve `steam_appid.txt` sızmasın.
- İlk yüklemeden önce `default` branch'e değil bir **beta branch**'e it, orada doğrula.
