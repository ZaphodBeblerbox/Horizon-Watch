import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const layer = readFileSync(path.join(__dirname, "GlobeDerivedAlertsLayer.jsx"), "utf8")
const tips = readFileSync(path.join(__dirname, "DerivedTips.jsx"), "utf8")
const popup = readFileSync(path.join(__dirname, "GlobePopup.jsx"), "utf8")

describe("§A7 — detection is evaluated at the playhead", () => {
    it("passes `at` to both endpoints rather than filtering a fixed answer", () => {
        expect(layer).toMatch(/q\.set\("at", at\)/)
        expect(layer).toMatch(/api\/alerts\/surges/)
        expect(layer).toMatch(/api\/alerts\/fusions/)
    })

    it("debounces at the spec's 180ms, so a scrub fires one query not hundreds", () => {
        expect(layer).toMatch(/\}, 180\)/)
    })

    it("ages records against the playhead, not wall clock", () => {
        // Otherwise scrubbing to August shows every record "1200h ago" and a
        // historic finding reads as stale.
        expect(layer).toMatch(/at \? Date\.parse/)
        expect(layer).toMatch(/nowMs=\{nowMs\}/)
    })
})

describe("§A8 — the pulse never touches `material`", () => {
    it("routes the CallbackProperty through outlineColor", () => {
        // A CallbackProperty on .material has no getType(); Cesium's per-frame
        // visualizer calls it and stops rendering the whole viewer. The
        // threat-heatmap layer documented this at length before removal.
        expect(layer).toMatch(/outlineColor: pulsingOutline/)
        expect(layer).not.toMatch(/material:\s*new CallbackProperty/)
    })

    it("honours prefers-reduced-motion", () => {
        expect(layer).toMatch(/prefersReducedMotion\(\)/)
    })

    it("keeps labels pixel-sized, not ground-sized", () => {
        expect(layer).toMatch(/distanceDisplayCondition: labelCond/)
    })

    it("lets the globe hide marks on the far side of the world", () => {
        // This used to assert Number.POSITIVE_INFINITY, which means
        // "never depth test" — so an alert in the opposite hemisphere
        // drew straight through the planet and sat among the ones you
        // were actually looking at. A finite distance still skips the
        // test up close, where a ground-clamped mark would otherwise
        // flicker against the terrain it sits on.
        expect(layer).not.toMatch(/disableDepthTestDistance: Number\.POSITIVE_INFINITY/)
        expect(layer).toMatch(/disableDepthTestDistance: MARKER_DEPTH_TEST_M/)
    })

    it("draws one radial tick per modality", () => {
        expect(layer).toMatch(/tickBearings\(f\.mods\.length\)/)
    })
})

describe("§A9.1 — the threads are transient", () => {
    it("draws on hover and clears on leave", () => {
        expect(layer).toMatch(/onMouseMove=\{\(_m, mv\) => \{ drawThreads\(f\)/)
        expect(layer).toMatch(/onMouseLeave=\{\(\) => \{ clearThreads\(\); hideTip\(\) \}\}/)
    })

    it("uses a CustomDataSource it can removeAll, with a dashed material", () => {
        expect(layer).toMatch(/new CustomDataSource\("fusionthreads"\)/)
        expect(layer).toMatch(/entities\.removeAll\(\)/)
        expect(layer).toMatch(/PolylineDashMaterialProperty/)
    })
})

describe("§A9 — a derived mark must name its inputs", () => {
    it("lists the records that triggered each finding, with a +N more overflow", () => {
        // "The one usually left out, and the one that decides whether the
        // finding is believed."
        expect(tips).toMatch(/Triggered by \{\(surge\.rows \|\| \[\]\)\.length\} confirmations/)
        // A fusion names each piece of evidence, how far and how long from the event.
        expect(tips).toMatch(/fusion\.explain/)
        expect(tips).toMatch(/more · click to open/)
    })

    it("answers what it is and what makes it true", () => {
        expect(tips).toMatch(/href="#i-surge"/)
        expect(tips).toMatch(/href="#i-fusion"/)
        expect(tips).toMatch(/p, Poisson/)
        expect(tips).toMatch(/kinds of evidence/)
    })
})

describe("§A5 copy discipline — attention, not the ground", () => {
    it("says so on every surge tooltip", () => {
        expect(tips).toMatch(/A change in attention, not a confirmed change on the ground/)
    })

    it("never writes a multiplier against no prior activity", () => {
        // "A multiplier against zero is a lie with a number in it."
        expect(tips).toMatch(/above a cell with no prior activity of this kind/)
        expect(tips).toMatch(/if \(s\.mult\)/)
    })
})

describe("clicking a derived mark opens the inspector", () => {
    it("has surge and fusion registered as inspector types", () => {
        expect(popup).toMatch(/"surge",/)
        expect(popup).toMatch(/"fusion"/)
    })
})

describe("no cluster markers on the track layers", () => {
    it("neither track layer renders a numbered blob", () => {
        // A cluster marker is not a vessel or an aircraft: it cannot be
        // inspected, and at the densities that produced one it covered the
        // very tracks it was summarising.
        const fs = require("fs"), p = require("path")
        for (const f of ["GlobeAISLayer.jsx", "GlobeADSBLayer.jsx"]) {
            const src = fs.readFileSync(p.join(__dirname, f), "utf8")
            expect(src, `${f} must not cluster`).not.toMatch(/clusterTracks/)
            expect(src, `${f} must not render clusters`).not.toMatch(/\{clusters\.map\(/)
        }
    })
})
