---
name: ui-signage-design
description: Benzinlik oyununun arayüz tasarım dili — HUD, modal, kart veya toast'a dokunmadan ÖNCE oku. "Tabela estetiği" temasının token'ları, ikon kuralları ve yasakları.
---

# Benzinlik UI Tasarım Dili: "Tabela Estetiği"

Arayüz, oyun dünyasındaki fiziksel tabelaların uzantısıdır: totem tabela (krem panel + kırmızı başlık bandı), pompa gövdesi (kırmızı/krem), Kenney paleti. UI koyu cam "dashboard" DEĞİL; oyuncak gibi, sıcak, güneşli.

## Token'lar (index.html :root — değerleri oradan kullan, yenisini uydurma)
- Zemin: `--paper #faf6ec` / `--paper-2 #f1ebdb` (panel içi), kenar `--line` (mürekkep %14)
- Mürekkep: `--ink #22303c` (metin), `--muted #7a8290`
- Marka: `--red #d64545` (başlık bantları, tehlike), `--green #27a05a` (onay/benzin), `--orange #e8862e` (uyarı/dizel), `--blue #2f6fed` (bilgi), `--ev #1fa8bc`
- Radius: 10/13/17 — ASLA 999px pill, aşırı yuvarlama yok
- Font: "Baloo 2" — başlık 800, gövde 600-700; CAPS yalnızca küçük etiketlerde (letter-spacing .1em)

## Kurallar
1. **Emoji YASAK** (UI'da). Her sembol `index.html`'deki inline SVG sprite'tan (`<svg class="ic"><use href="#i-..."/></svg>`), stroke-based, 24 viewBox, stroke-width 2, currentColor. Yeni ihtiyaçta yeni symbol çiz, emoji koyma. Toast metinleri `stripEmoji()` süzgecinden geçer.
2. **Modal başlıkları kırmızı bant** — totem tabelanın başlığı gibi: kırmızı zemin + beyaz 800 metin.
3. Kartlar/chip'ler: krem zemin, 1.5px mürekkep-şeffaf kenar, altta 2-3px koyu kenar (fiziksel tabela kalınlığı hissi), yumuşak kısa gölge. Cam blur yok.
4. Butonlar "basılabilir": alt kenar 3px koyu, `:active`'de 2px aşağı iner. Renk anlamı: kırmızı=birincil/tehlike, yeşil=onay/para, turuncu=uyarı, nötr=krem.
5. Sayı öne: değerler tabular-nums 800; açıklama metni muted ve kısa. Rozetler (stat-badge) mavi zeminli küçük kapsül.
6. Scroll: `.mbody` scrollbar gizli (`scrollbar-width:none`); UI üstünde wheel oyuna zoom GEÇİRMEZ (main.ts wheel guard'ı `.closest('.hud, .modal, .backdrop, #panel, #infocard')`).
7. İnşaat menüsü kategorili sekmelerdir: İstasyon / Tesisler / Enerji / Arsa / Bakım. Yeni satın alınabilir eklerken `ui.ts CATEGORY_MAP`'e kategori ver, `state.ts` satırına `icon: 'i-*'` symbol id yaz.
8. Kontrast: krem üstünde mürekkep ≥ 4.5:1; renkli buton üstünde beyaz veya koyu metni kontrasta göre seç.
