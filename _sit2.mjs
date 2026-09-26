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
await p.waitForTimeout(9000)
console.log('body len:', (await p.innerText('body')).length)
await p.screenshot({path:OUT+'sit_load.png'})
await p.locator('text=Situation').first().click({timeout:15000}).catch(e=>console.log('nav click failed:', String(e).slice(0,120)))
await p.waitForTimeout(8000)
const st = await p.evaluate(()=>{
  const el=[...document.querySelectorAll('button,[role="button"]')]
      .find(e=>/^imagery$/i.test((e.innerText||'').trim()) || /imagery/i.test(e.getAttribute('title')||''))
  return el ? { text:(el.innerText||'').trim(), disabled: el.disabled===true || el.getAttribute('aria-disabled')==='true' || el.className.includes('disabled') } : null
})
console.log('imagery toggle:', st)
if (st && !st.disabled) {
  await p.evaluate(()=>{const el=[...document.querySelectorAll('button,[role="button"]')].find(e=>/^imagery$/i.test((e.innerText||'').trim())); el&&el.click()})
  await p.waitForTimeout(3000)
  console.log('sidebar opened:', await p.locator('text=/Sensor/').first().isVisible().catch(()=>false))
  await p.screenshot({path:OUT+'sit_imagery.png'})
}
console.log('--- page errors:',pe.length); pe.slice(0,4).forEach(e=>console.log('  ',e.slice(0,200)))
console.log('--- console errors:',ce.length); ce.slice(0,4).forEach(e=>console.log('  ',e.slice(0,200)))
await b.close()
