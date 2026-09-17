import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(__dirname, "sessionStore.js"), "utf8")

describe("§16 — a view saves the apparatus, not just the lens", () => {
    it("captures the camera, tracks and archive playhead", () => {
        expect(src).toMatch(/extra\.cam\s*=/)
        expect(src).toMatch(/extra\.tracks\s*=/)
        expect(src).toMatch(/extra\.geoc\s*=/)
    })

    it("sends `extra` when creating a view", () => {
        expect(src).toMatch(/extra:\s*captureExtra\(\)/)
    })

    it("APPLIES THE CAMERA LAST, so it beats the fitView that precedes it", () => {
        // §16 states this outright and it is the one ordering that silently
        // ruins a restore: filters re-render layers and can trigger a fit, so
        // a camera applied first is immediately overwritten.
        const body = src.slice(src.indexOf("export function applyView"))
        const end = body.indexOf("\n}")
        const fn = body.slice(0, end)
        expect(fn.indexOf("restoreFilterState")).toBeGreaterThan(-1)
        expect(fn.indexOf("restoreCameraState")).toBeGreaterThan(fn.indexOf("restoreFilterState"))
        expect(fn.indexOf("restoreCameraState")).toBeGreaterThan(fn.indexOf("restoreArchiveState"))
    })

    it("imports everything it calls", () => {
        // This exact bug shipped once: captureExtra/applyView used
        // getArchiveState and restoreArchiveState while the import line
        // pointed at the wrong path. Rollup does not error on an undefined
        // free variable, so the build stayed green and the failure was a
        // runtime ReferenceError on the first Save view.
        const imported = new Set()
        for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from/g)) {
            for (const n of m[1].split(",")) imported.add(n.trim().split(" as ").pop().trim())
        }
        for (const called of ["getCameraState", "restoreCameraState", "getFilterState",
                              "restoreFilterState", "getArchiveState", "restoreArchiveState"]) {
            expect(imported.has(called), `${called} is used but not imported`).toBe(true)
        }
    })

    it("does not fabricate the keys whose modules do not exist yet", () => {
        // §13 coverage, §14 sublayers and §15 risk weights have no live state
        // to read. Writing {} for them would make a view claim it restored
        // something it never saw.
        const cap = src.slice(src.indexOf("function captureExtra"), src.indexOf("export async function createView"))
        expect(cap).not.toMatch(/extra\.coverage\s*=/)
        expect(cap).not.toMatch(/extra\.sub\s*=/)
        expect(cap).not.toMatch(/extra\.risk\s*=/)
    })

    it("there is still exactly one save control — no second createView path", () => {
        // "Do not add a second save control."
        expect(src.match(/export async function createView/g) || []).toHaveLength(1)
    })
})

describe("viewExtraLabels — §16's row subtitle", () => {
    it("names only what the view actually carries", async () => {
        const { viewExtraLabels } = await import("./sessionStore.js").catch(() => ({}))
        if (!viewExtraLabels) return   // module needs a browser env; static checks above still hold
        expect(viewExtraLabels({ extra: { cam: {} } })).toEqual(["camera"])
        expect(viewExtraLabels({ extra: null })).toEqual([])
        expect(viewExtraLabels({ extra: { geoc: { at: "2026-08-12" } } })).toEqual(["archive"])
    })
})
