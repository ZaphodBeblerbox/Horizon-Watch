import { chromium } from 'playwright'
import fs from 'fs'
const TOK = fs.readFileSync('/private/tmp/claude-501/-Users-marcamaylunau-NAGINI-2-0/47f82523-bbad-4f53-9968-7d778a749ac0/scratchpad/tok.txt','utf8').trim()
const OUT='/private/tmp/claude-501/-Users-marcamaylunau-NAGINI-2-0/47f82523-bbad-4f53-9968-7d778a749ac0/scratchpad/'
const pe=[], reqs=[]
const b=await chromium.launch({channel:'chrome'})
const ctx=await b.newContext({viewport:{width:1600,height:1000}})
await ctx.addCookies([{name:'hw_session',value:TOK,domain:'localhost',path:'/'}])
const p=await ctx.newPage()
p.on('pageerror',e=>pe.push(String(e)))
p.on('request',r=>{const u=r.url(); if(/history\/(vessels|aircraft)/.test(u)) reqs.push(u.split('/api/')[1].slice(0,54))})
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded',timeout:60000})
await p.waitForTimeout(9000)
await p.locator('text=Situation').first().click()
await p.waitForTimeout(9000)
const t = await p.evaluate(()=>{
  const row=[...document.querySelectorAll('div')].find(d=>
    d.children.length===3 && d.children[0]?.textContent?.trim()==='Aircraft (ADS-B)')
  if(!row) return 'no-row'
  row.querySelector('button')?.click(); return 'clicked'
})
await p.waitForTimeout(6000)
// Fly somewhere dense and click an aircraft.
await p.evaluate(()=>window.dispatchEvent(new CustomEvent('akili:fly-to',{detail:{lat:51.5,lon:5.0,name:''}})))
await p.waitForTimeout(14000)
const box=await p.locator('canvas').first().boundingBox()
// Click around the centre to hit something.
for (const [dx,dy] of [[0,0],[40,-30],[-50,20],[80,60],[-90,-70]]) {
  await p.mouse.click(box.x+box.width/2+dx, box.y+box.height/2+dy)
  await p.waitForTimeout(1800)
  const got = await p.evaluate(()=>window.__lastSel||null)
  if (reqs.some(r=>r.includes('per_vessel=400'))) break
}
await p.waitForTimeout(6000)
await p.screenshot({path:OUT+'adsb.png'})
console.log('adsb toggle:', t)
console.log('history reqs:', JSON.stringify(reqs.slice(-3)))
console.log('PAGE ERRORS:', pe.length, JSON.stringify(pe.slice(0,2)))
await b.close()
