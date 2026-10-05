import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const token = readFileSync('/tmp/tok.txt','utf8').trim()
const b = await chromium.launch()
const ctx = await b.newContext({ viewport:{width:1440,height:900} })
await ctx.addCookies([{name:'hw_session',value:token,domain:'localhost',path:'/'}])
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e).split('\n')[0].slice(0,100)))
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded',timeout:45000})
await p.waitForTimeout(17000)
await p.evaluate(() => { const b=[...document.querySelectorAll('button')].find(e=>/skip|got it/i.test(e.textContent)); if(b) b.click() })
await p.waitForTimeout(900)

for (const m of ['Inbox','Dossiers','Replay','Imagery','Briefings','Analytics']) {
  const ok = await p.evaluate((name) => {
    const el=[...document.querySelectorAll('button,[role="button"],a')]
      .find(x=>x.textContent.replace(/\d+/g,'').trim()===name)
    if (el) { el.click(); return true } return false }, m)
  await p.waitForTimeout(5500)
  const txt = await p.evaluate(() => document.body.innerText.slice(0,150).replace(/\n/g,' | '))
  const bad = await p.evaluate(() => {
    const t = document.body.innerText
    const m = t.match(/(Failed to [^\n|]{0,70}|Error: [^\n|]{0,60}|aborted[^\n|]{0,40}|undefined|NaN\b)/)
    return m ? m[0] : null
  })
  console.log(`  ${m.padEnd(10)} clicked=${ok}  ${bad ? 'PROBLEM: '+bad : 'ok'}`)
  await p.screenshot({ path: `/tmp/t2-${m}.png` })
}
console.log(errs.length ? `errors: ${[...new Set(errs)].slice(0,3).join(' | ')}` : 'no page errors')
await b.close()
