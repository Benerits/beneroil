/**
 * Meta'da sürüm notları modalı gösterilmez.
 * Instant Games'te her oyuncu yeni oyuncu; değişiklik günlüğü ilk açılışta onboarding'in
 * üstünü kapatıyor ve hiçbir anlam ifade etmiyor.
 *
 * Ayrı modül: meta-boot.ts'ten SONRA, main.ts'ten ÖNCE değerlendirilmeli. news.ts → i18n.ts
 * zinciri burada evaluate olur; meta-boot dili çoktan yazmış olduğu için dil doğru kilitlenir.
 */
import { markNewsSeen } from './news'

markNewsSeen()
