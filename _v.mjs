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
console.log('logged in, body len:', (await p.innerText('body')).length)

// --- Situation imagery toggle ---
await p.locator('text=Situation').first().click()
await p.waitForTimeout(8000)
const tog = await p.evaluate(()=>{
  const el=[...document.querySelectorAll('button,[role="button"]')].find(e=>/^imagery$/i.test((e.innerText||'').trim()))
  return el?{disabled: el.disabled===true||el.getAttribute('aria-disabled')==='true', cls: el.className}:null
})
console.log('Situation imagery toggle:', tog)
if (tog && !tog.disabled) {
  await p.evaluate(()=>{const el=[...document.querySelectorAll('button,[role="button"]')].find(e=>/^imagery$/i.test((e.innerText||'').trim())); el&&el.click()})
  await p.waitForTimeout(3500)
  console.log('  imagery sidebar opened:', await p.locator('text=Sensor').first().isVisible().catch(()=>false))
  await p.screenshot({path:OUT+'sit_imagery.png'})
}

// --- Imagery page defaults ---
await p.locator('text=Imagery').first().click()
await p.waitForTimeout(9000)
const st = await p.evaluate(()=>{
  const img=document.querySelector('img[alt="current scene"]')
  const readout=[...document.querySelectorAll('span')].find(e=>/^\d+\.\d×$/.test((e.textContent||'').trim()))
  return { bigImageDefault: !!img, zoomReadout: readout?readout.textContent.trim():null,
           whereHeading: !!([...document.querySelectorAll('*')].find(e=>e.children.length===0&&/^Where$/.test((e.textContent||'').trim()))) }
})
console.log('Imagery defaults:', st)
await p.screenshot({path:OUT+'imagery_default.png'})
console.log('--- page errors:',pe.length); pe.slice(0,5).forEach(e=>console.log('  ',e.slice(0,200)))
console.log('--- console errors:',ce.length); ce.slice(0,5).forEach(e=>console.log('  ',e.slice(0,200)))
await b.close()
