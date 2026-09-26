import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const token = readFileSync('/tmp/tok.txt','utf8').trim()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:900} })
await ctx.addCookies([{name:'hw_session',value:token,domain:'localhost',path:'/'}])
const p = await ctx.newPage()
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded',timeout:45000})
await p.waitForTimeout(15000)
const probe = () => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null
    const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height) } }
  const cs = getComputedStyle(document.documentElement)
  return { vh: window.innerHeight,
    tok: { top: cs.getPropertyValue('--top').trim(), status: cs.getPropertyValue('--status').trim(), strip: cs.getPropertyValue('--strip-h').trim() },
    visible: [...document.querySelectorAll('[data-testid^="view-root"]')].filter(e=>getComputedStyle(e.parentElement).display!=='none').map(e=>e.getAttribute('data-testid')),
    situation: r('[data-testid="view-root-situation"]'),
    statusbar: r('#statusbar'), timestrip: r('#timestrip'),
    left: r('[data-testid="glass-layers-pane"]'), right: r('[data-testid="glass-inspector-pane"]'),
    tabs: document.querySelectorAll('.panetab').length }
}
console.log('closed:', JSON.stringify(await p.evaluate(probe)))
for (const t of await p.$$('.panetab')) { try { await t.click({timeout:2500}) } catch {} }
await p.waitForTimeout(1500)
console.log('open  :', JSON.stringify(await p.evaluate(probe)))
await b.close()
