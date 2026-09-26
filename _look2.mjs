import { chromium } from 'playwright'
import fs from 'fs'
const SP = process.env.SP
const TOK = fs.readFileSync(SP + '/tok.txt', 'utf8').trim()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const b = await chromium.launch({ channel: 'chrome' })
const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } })
await ctx.addCookies([{ name: 'hw_session', value: TOK, domain: 'localhost', path: '/' }])
const p = await ctx.newPage()
const errs = []
p.on('pageerror', e => errs.push(String(e).slice(0, 200)))
await p.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await sleep(9000)
await p.locator('text=Situation').first().click()
await sleep(12000)
await p.waitForFunction(() => !!window.__viewer, null, { timeout: 60000 })
await p.evaluate(() => {
    const row = [...document.querySelectorAll('div')].find(d =>
        d.children.length === 3 && d.children[0]?.textContent?.trim() === 'Aircraft (ADS-B)')
    row?.querySelector('button')?.click()
})
await sleep(22000)

// Double-click an aircraft: the lock-on gives the close oblique view.
const t = await p.evaluate(() => {
    const v = window.__viewer, s = v.scene, now = v.clock.currentTime
    const cands = []
    for (const e of v.entities.values) {
        if (!e.model || !String(e.id).startsWith('adsb-')) continue
        const pos = e.position?.getValue(now); if (!pos) continue
        const c = s.cartesianToCanvasCoordinates(pos); if (!c || !isFinite(c.x)) continue
        if (c.x < 120 || c.y < 120 || c.x > s.canvas.clientWidth - 120 || c.y > s.canvas.clientHeight - 120) continue
        cands.push({ id: e.id, x: Math.round(c.x), y: Math.round(c.y) })
    }
    return cands[0] || null
})
if (!t) { console.log('NO TARGET'); await b.close(); process.exit(0) }
console.log('locking onto', t.id)
await p.mouse.move(t.x, t.y); await sleep(500)
await p.mouse.dblclick(t.x, t.y)
await sleep(12000)
console.log('alt now:', await p.evaluate(() => Math.round(window.__viewer.camera.positionCartographic.height)))
await p.screenshot({ path: SP + '/model_close.png', clip: { x: 380, y: 250, width: 640, height: 520 } })
console.log('errors:', errs.slice(0, 2).join(' | ') || 'none')
await b.close()
