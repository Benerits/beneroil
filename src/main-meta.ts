/**
 * Meta (Facebook Instant Games) giriş noktası.
 * vite.config.ts mode=meta iken index.html'in module script'i buraya yönlendirilir.
 *
 * DİNAMİK IMPORT YOK — bilerek. Önceki sürüm `await import('./main')` kullanıyordu ve
 * Instant Games ortamında o chunk isteği başarısız oldu:
 *   "kaynak yüklenemedi: .../instant-bundle/.../assets/main-DA7v90_8.js"
 * Oyun hiç açılmadı. Statik import'larla her şey TEK chunk'a giriyor, ayrı dosya isteği
 * kalmıyor. Sıra bu dosyadaki import sırasıyla garanti altında:
 *   1) meta-boot      → token, dil, /api shim, teşhis (senkron)
 *   2) meta-news-off  → sürüm notları modalını kapat
 *   3) main           → oyun
 */
import './meta-boot'
import './meta-news-off'
import './main'
