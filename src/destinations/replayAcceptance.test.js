import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const dir = path.dirname(fileURLToPath(import.meta.url))
const replay = readFileSync(path.join(dir, "Replay.jsx"), "utf8")
const onMap = readFileSync(path.join(dir, "../services/replayOnMap.js"), "utf8")

describe("§S3 — Replay's acceptance items", () => {
    it("states in-product how it differs from the archive scrubber", () => {
        // "Two time scrubbers in one product will be confused for each other
        // unless the difference is stated where they live."
        expect(replay).toMatch(/when you learned things/)
        expect(replay).toMatch(/when they happened/)
        expect(replay).toMatch(/gap between the two is the finding/i)
    })

    it("offsets the playhead by the 128px lane gutter", () => {
        // "A playhead that ignores the sticky column is off by 128px at t=0
        // and correct nowhere."
        expect(replay).toMatch(/calc\(128px \+ \(100% - 128px\) \* \$\{t\}\)/)
    })

    it("renders un-arrived events at 0.22 opacity rather than removing them", () => {
        // "You can see what is about to happen as a shape, which is what makes
        // scrubbing feel like reading a record instead of filtering one."
        expect(replay).toMatch(/opacity: after \? 0\.22 : 1/)
    })

    it("groups by region, domain or severity", () => {
        expect(replay).toMatch(/groupBy === "region"/)
        expect(replay).toMatch(/groupBy === "severity"/)
    })

    it("keeps the lane label column sticky at 128px", () => {
        expect(replay).toMatch(/width: 128/)
        expect(replay).toMatch(/position: "sticky", left: 0/)
    })
})

describe("§S3.6 — replay on map walks the run-up", () => {
    it("walks the preceding 36h within 1600km", () => {
        // "That walk is the feature: it shows the run-up, not just the event."
        expect(onMap).toMatch(/CONTEXT_HOURS = 36/)
        expect(onMap).toMatch(/CONTEXT_KM = 1600/)
    })

    it("is one shared trigger, so the window cannot drift between callers", () => {
        expect(onMap).toMatch(/never\s*\n?\s*\/\/ reimplemented per caller|ONE shared/)
    })
})

describe("§S3.5 — the locator is the shared 2D minimap", () => {
    it("Replay uses the shared component, not a private one", () => {
        expect(replay).toMatch(/import Minimap from "\.\.\/components\/Minimap\.jsx"/)
        expect(replay).not.toMatch(/LocatorMiniMap/)
    })
})
