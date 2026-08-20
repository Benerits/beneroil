/**
 * Meta açılışının SENKRON kısmı — main.ts'ten ÖNCE değerlendirilmesi gereken her şey.
 * Ayrı bir modül olmasının sebebi ES modül semantiği: statik import'lar hoist edilir,
 * yani bu satırları main-meta.ts'in gövdesine yazsaydık main'den SONRA çalışırlardı.
 * Modül sırası = değerlendirme sırası; bu dosya ilk import edilen olmalı.
 */
import { bootInstantSync, webglSupported, showWebglFailure } from './fbinstant'

bootInstantSync()
if (!webglSupported()) showWebglFailure()
