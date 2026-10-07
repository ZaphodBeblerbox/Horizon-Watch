// render_pdf.mjs — print a briefing's HTML to PDF in headless Chromium.
//
//   node tools/render_pdf.mjs <in.html> <out.pdf>
//
// Called by backend/briefing/render.py. Page size and margins come from the
// document's own @page rule (preferCSSPageSize); headers and footers are not
// drawn here — render.py stamps them afterwards, so the cover can stay clean
// and "page X of Y" counts the cover. Fonts and images must already be inline
// or file:// — the page is loaded offline.
import { chromium } from "playwright"
import { pathToFileURL } from "node:url"

const [, , input, output] = process.argv
if (!input || !output) { console.error("usage: render_pdf.mjs <in.html> <out.pdf>"); process.exit(2) }
const browser = await chromium.launch()
try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(input).href, { waitUntil: "load", timeout: 120_000 })
    await page.emulateMedia({ media: "print" })
    await page.pdf({ path: output, preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false })
} finally {
    await browser.close()
}
