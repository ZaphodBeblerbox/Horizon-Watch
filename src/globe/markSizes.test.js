import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

// An alert's mark and ring are drawn in screen pixels. A ground-sized ellipse
// (semiMajorAxis in metres) grows as the camera comes down — the alert icons
// "blowing up" — so none may come back into the alert layers.
describe("alert marks keep one screen size", () => {
    for (const f of ["GlobeDerivedAlertsLayer.jsx", "GlobeFindingsLayer.jsx", "GlobeStrikesLayer.jsx"]) {
        it(`${f} draws no ground-sized ellipse`, () => {
            const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
            expect(src).not.toMatch(/semiMajorAxis/)
        })
    }
})
