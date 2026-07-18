// Gemini (nano banana) ile oyun assetlerini toplu üretir.
// Kullanım: GEMINI_API_KEY=xxx npm run assets  [-- asset_adi]  (tek asset için)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const KEY = process.env.GEMINI_API_KEY
if (!KEY) {
  console.error('GEMINI_API_KEY env değişkenini ver. Örn: GEMINI_API_KEY=xxx npm run assets')
  process.exit(1)
}

const here = dirname(fileURLToPath(import.meta.url))
const { style, assets } = JSON.parse(readFileSync(join(here, 'prompts.json'), 'utf8'))
// public/gen: Vite doğrudan servis eder, oyun /gen/<isim>.png diye yükler
const outDir = join(here, '..', 'public', 'gen')
mkdirSync(outDir, { recursive: true })

const only = process.argv[2]
const list = only ? assets.filter(a => a.name === only) : assets
if (list.length === 0) {
  console.error(`'${only}' bulunamadı. Mevcutlar: ${assets.map(a => a.name).join(', ')}`)
  process.exit(1)
}

const MODEL = 'gemini-2.5-flash-image'
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`

for (const asset of list) {
  process.stdout.write(`→ ${asset.name} ... `)
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: asset.noStyle ? asset.prompt : `${asset.prompt}\n\n${style}` }] }],
      }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json()
    const part = json.candidates?.[0]?.content?.parts?.find(p => p.inlineData)
    if (!part) throw new Error('görsel dönmedi: ' + JSON.stringify(json).slice(0, 200))
    const ext = part.inlineData.mimeType?.includes('jpeg') ? 'jpg' : 'png'
    const file = join(outDir, `${asset.name}.${ext}`)
    writeFileSync(file, Buffer.from(part.inlineData.data, 'base64'))
    console.log(`OK → ${file}`)
  } catch (err) {
    console.log(`HATA: ${err.message}`)
  }
}
console.log('\nNot: yeşil (#00FF00) arka planları kaldırmak için: https://github.com/danielgatis/rembg veya herhangi bir chroma-key aracı.')
