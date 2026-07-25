---
name: tycoon-retention
description: Benzinlik retention ve misafir→kayıt dönüşüm hunisi — gate'ler, bonuslar, dönüş kancaları ve ölçüm noktaları. Onboarding, kayıt akışı, günlük döngü veya bildirim/teşvik değişikliği yaparken kullan.
---

# Tycoon Retention & Dönüşüm (Benzinlik)

## Dönüşüm hunisi (mevcut kurulum, 2026-07-25)
1. **Misafir hemen oynar** — gate açılışta görünür ama "Misafir olarak oyna" ile geçilir.
2. **Gate fayda listesi**: +₺2.500 kayıt bonusu, günlük seri (₺500→₺2.000), bulut kaydı (index.html authgate).
3. **Günlük seri bonusu SADECE kayıtlılara** — misafir günde 1 kez kilitli teaser görür (`main.ts` günlük bonus bloğu). Bunu misafire geri açma = teşvik ölür.
4. **Dönüşüm anları**: ilk-₺10.000 başarımında soft gate (oturumda 1 kez, misafir devam edebilir); gün 3-4 sonunda kayıp uyarısı toast'ı; **gün 5 = zorunlu gate** (GUEST_MAX_DAY).
5. **Kayıt bonusu** `REG_BONUS_KEY` localStorage bayrağıyla ilk açılışta uygulanır (register + OAuth-yeni-hesap).

## Veri taşıma kuralları (BOZMA)
- Misafir verisi YALNIZ register'da hesaba taşınır; login'de ASLA (hesap otoriter); OAuth'ta yalnız hesap boşsa.
- Sunucu tarafı: taze-başlangıç save'i ilerlemiş kaydın üstüne YAZILAMAZ (409) — `server/index.js` regresyon guard'ı.

## Dönüş kancaları (return hooks)
- Gün döngüsü 160 sn → "gün" bir dönüş birimi değil; gerçek dönüş kancaları: login serisi (kayıtlı), lapsed dönüş hediyesi (+₺1.000), offline kazanç (2 saat cap), tanker/bakım local notification (iOS).
- Yeni kanca eklerken önce WHY-IT-WORKS §6 kayıp listesine bak — en büyük kaldıraçlar orada sıralı.

## Ölçüm
- Misafir→kayıt dönüşümü: admin engagement panelinde `guest_signups / guests` (`benzinlik_stat_hourly`). Teşvik değişikliklerinin etkisini burada izle; paket 2026-07-25'te yayınlandı → öncesi/sonrası kıyasla.
- Kayıt kaynağı ayrımı (Gmail/Apple/e-posta) admin user detayında.

## İlkeler
- Teşvik SOMUT ₺ vaadi içermeli ("ilerlemen güvende" soyut, "+₺2.500" işliyor).
- Dopamin zirvesinde sor (başarım anı), can sıkıntısında sorma.
- Zorunlu gate tek: gün-5. İkinci bir zorunlu duvar ekleme; soft gate'ler kapatılabilir kalmalı.
- Misafirin kaybedecek şeyi arttıkça mesaj güçlenir: uyarılarda birikimi somut yaz ("{n} günlük ilerlemen").
