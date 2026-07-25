---
name: tycoon-feedback-ops
description: Benzinlik oyuncu feedback'ini çekme, semantik kümeleme, kanıta dayalı triage ve canlı doğrulama operasyonu. Feedback analizi, bug önceliklendirme veya "şu şikâyet çözüldü mü" sorusu için kullan.
---

# Tycoon Feedback Operasyonu (Benzinlik)

## Veri çekme
- Kaynak: prod DB `benzinlik_feedback` (email, message, game jsonb {day,money}, status open/resolved, resolved_note).
- Erişim: SSH `ubuntu@5.135.142.214` → `sudo docker exec $(sudo docker ps -q -f name=benzinlik-db) psql -U benzinlik -d benzinlik`. JSONL export için `json_build_object` + `-At` kullan (çok satırlı mesajlara dikkat — toleranslı parse et).
- Admin paneli: admin.benerits.com/apps/beneloil/feedback (aynı tablo).

## Triage yöntemi (sıra önemli)
1. **Önce semantik kümele** — aynı sorunun 30 varyantını tek tek inceleme. Küme = (belirti + bağlam), kelime değil: "para gitti ürün yok" + "gir-çık sonrası" aynı küme.
2. **Frekans × yenilik ile sırala**: 30 kayıtlık küme > 2 kayıtlık; son 24 saatte hâlâ gelen küme "çözülmüş" sayılmaz.
3. **Koda eşle**: her küme için kök adayı dosya:satır bul. git log'da ilgili fix commit'i var mı bak — fix TARİHİ ile şikâyet tarihlerini kıyasla (fix sonrası şikâyet = çözülmemiş/kısmi).
4. **Canlıda kanıtla**: sunucu davranışıysa prod/dev API'ye test hesabıyla reprodüksiyon yap (kayıt→save→oku; testten sonra `DELETE /api/account` ile temizle). Tahminle "çözüldü" deme.
5. **Çöz ve işaretle**: fix deploy edilince ilgili kayıtları `status='resolved'` + Türkçe `resolved_note` (ne yapıldığı, tarihli) yap — panel açık listesi sinyal kaybetmesin.

## Bilinen büyük kümeler (2026-07-25 anlık görüntüsü, 481 açık)
1. Müşteri isteği pop-up'ı (~35) — pompacı/oto modda açılmasın, kenara alınsın. AÇIK.
2. Yol karşısı istasyon (~30) — kapı UX'i bilinmiyor + karşıda tıkanma + karşıya market kurulamıyor. AÇIK.
3. Kısmi yakıt siparişi (~25) — özellik geldi; +/- butonları mobilde bozuk (~7, yeni). AÇIK regresyon.
4. Trafik/pathfinding (~20) — kronik. Otopark yönü (~18) — kısmi fix, izle.
5. Çoklu tesis tek kumbara (~13) — pendingCash tip-bazlı, adet çarpanı yok. AÇIK.
6. Arsa fiyat tutarsızlığı (~11) — menü min gösteriyor, parsel 28k çekiyor. AÇIK.
7. Save silinmesi (~11) — 2026-07-25 wipe-guard + clamp fixleriyle kapandı. İZLE.

## KVKK/GDPR
Silme talebi görürsen: `benzinlik_player` satırını sil, feedback e-postasını anonimleştir (`(silindi - KVKK talebi)`), status=resolved + not. Talepler bekletilmez.
