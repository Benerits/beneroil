import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { chromium } from 'playwright-core'
const DIST = '/Users/benerits/Desktop/benerits/beneroil/dist'
const MIME = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.glb':'model/gltf-binary','.svg':'image/svg+xml'}
const server = createServer(async (req,res)=>{
  let p = decodeURIComponent(new URL(req.url,'http://x').pathname)
  if (p === '/data-deletion') p = '/data-deletion.html'   // server/index.js ile ayni eslesme
  if (p.startsWith('/api/')) { res.writeHead(200,{'content-type':'application/json'}).end('{}'); return }
  if (p === '/') p = '/index.html'
  try { const b = await readFile(join(DIST, normalize(p).replace(/^(\.\.[/\\])+/,''))); res.writeHead(200,{'content-type':MIME[extname(p)]??'application/octet-stream'}).end(b) }
  catch { res.writeHead(404).end('nf') }
})
await new Promise(r=>server.listen(0,r))
const base = `http://localhost:${server.address().port}`
const b = await chromium.launch({ channel: 'chrome' }); const page = await b.newPage({viewport:{width:414,height:896}})
const errs=[], bad=[]
page.on('pageerror', e=>errs.push(e.message))
page.on('console', m=>{ if(m.type()==='error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()) })
page.on('response', r=>{ if(r.status()>=400) bad.push(`${r.status()} ${r.url().replace(base,'')}`) })
await page.goto(base,{waitUntil:'domcontentloaded'})
let ok=true
try { await page.waitForSelector('#app canvas',{timeout:30000}) } catch { ok=false }
await page.waitForTimeout(4000)
console.log('canvas          :', ok?'var ✓':'YOK ✗')
console.log('404             :', bad.length? '\n  '+[...new Set(bad)].join('\n  ') : 'yok ✓')
console.log('js hatasi       :', errs.length? '\n  '+errs.slice(0,6).join('\n  ') : 'yok ✓')
const dd = await page.goto(base+'/data-deletion',{waitUntil:'domcontentloaded'})
console.log('/data-deletion  :', dd.status(), '·', await page.title())
await b.close(); server.close()
process.exit(ok && !bad.length && !errs.length ? 0 : 1)
