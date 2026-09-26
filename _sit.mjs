import { chromium } from 'playwright'
import fs from 'fs'
const TOK=fs.readFileSync('/private/tmp/claude-501/-Users-marcamaylunau-NAGINI-2-0/47f82523-bbad-4f53-9968-7d778a749ac0/scratchpad/tok.txt','utf8').trim()
const OUT='/private/tmp/claude-501/-Users-marcamaylunau-NAGINI-2-0/47f82523-bbad-4f53-9968-7d778a749ac0/scratchpad/'
const pe=[],ce=[]
const b=await chromium.launch({channel:'chrome'})
const ctx=await b.newContext({viewport:{width:1600,height:1000}})
await ctx.addCookies([{name:'hw_session',value:TOK,domain:'localhost',path:'/'}])
const p=await ctx.newPage()
p.on('pageerror',e=>pe.push(String(e))); p.on('console',m=>{if(m.type()==='error')ce.push(m.text())})
await p.goto('http://localhost:5173/',{waitUntil:'domcontentloaded',timeout:45000})
await p.waitForTimeout(6000)
await p.locator('text=Situation').first().click()
await p.waitForTimeout(7000)
await p.screenshot({path:OUT+'sit1.png'})
// find anything imagery-ish in the top bar
const bits = await p.evaluate(()=>[...document.querySelectorAll('button,[role="button"],a')]
  .map(e=>(e.innerText||e.getAttribute('title')||'').trim())
  .filter(t=>t && /imag|scan|detect|sat/i.test(t)).slice(0,20))
console.log('imagery-related controls in Situation:', bits)
await b.close()
