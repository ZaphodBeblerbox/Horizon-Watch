// Writes the globe's vessel and aircraft GLBs from the asset models.
//
//   node tools/export_globe_models.mjs      (the dev server must be running on :5173)
//
// Opens dev/export-globe.html in a headless browser, which builds and exports
// each model (see the comment there for the frame and the merging), and
// writes the results to public/models/{vessel,aircraft}/<family>.glb.
// Bump MODEL_VERSION in src/globe/vesselModels.js and aircraftModels.js after.
import { chromium } from "playwright"
import { writeFileSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const b = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] })
const p = await b.newPage()
p.on("pageerror", (e) => console.log("PAGEERROR", e.message))
await p.goto("http://localhost:5173/dev/export-globe.html", { waitUntil: "domcontentloaded" })
await p.waitForSelector('body[data-done="1"]', { timeout: 300000 })
const res = await p.evaluate(() => window.__exported)
for (const [kind, fams] of Object.entries(res)) {
    mkdirSync(join(root, "public", "models", kind), { recursive: true })
    for (const [fam, r] of Object.entries(fams)) {
        writeFileSync(join(root, "public", "models", kind, `${fam}.glb`), Buffer.from(r.b64, "base64"))
        console.log(`${kind}/${fam}.glb  ${Math.round(r.size / 1024)} KB  ${r.meshes} meshes  ${Math.round(r.tris)} triangles`)
    }
}
await b.close()
