import { describe, it, expect } from "vitest"
import { readFileSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const src = readFileSync(path.join(__dirname, "../ImagerySidebar.jsx"), "utf8")

describe("§12 — one icon, three tabs", () => {
    /* These assert the SHAPE, not the markup. The v6 rework turned the tab
       array into [label, key] pairs and moved the icon to the plx6 sprite,
       and the old literals failed while all three tabs and the single
       satellite icon were still exactly where they had always been. A test
       that breaks on a restyle it was never about teaches people to edit
       tests rather than read them. */
    it("offers tasking | detections | areas", () => {
        for (const t of ["tasking", "detections", "areas"]) {
            expect(src, `the ${t} tab`).toMatch(new RegExp(`"${t}"`))
        }
    })

    it("heads with a single satellite control", () => {
        expect(src).toMatch(/href="#[gi]-sat"/)
        expect((src.match(/href="#[gi]-sat"/g) || []).length).toBe(1)
    })
})

describe("§12.1 — geometry first, drawing second", () => {
    it("shows the hint before a shape exists and the metrics after", () => {
        // "The old flow made you draw and then discover which controls the
        // shape had committed you to."
        expect(src).toMatch(/!drawn \?/)
        expect(src).toMatch(/Pick a shape, then drag or click it out on the map/)
        expect(src).toMatch(/km² covered/)
        expect(src).toMatch(/usable passes/)
    })

    it("estimates passes from a real archive search, not a constant", () => {
        expect(src).toMatch(/api\/sentinel\/dates/)
        expect(src).toMatch(/usablePasses\(passes, maxCloud, sensor\)/)
    })

    it("shows an em dash when the archive search returned nothing", () => {
        // A fabricated pass count is worse than an absent one.
        expect(src).toMatch(/passes == null \? "—"/)
    })
})

describe("§12.1 — the cloud control is disabled for SAR, never hidden", () => {
    it("renders the slider regardless of sensor and disables it for radar", () => {
        // A hidden control reads as a missing feature; a disabled one that
        // says why teaches the sensor.
        expect(src).toMatch(/disabled=\{sar\}/)
        expect(src).toMatch(/SAR sees through cloud\. This control does nothing for a radar pass\./)
    })
})

describe("§12.1 — the footer refuses and says so", () => {
    it("explains rather than sitting inert when there is no geometry", () => {
        expect(src).toMatch(/Draw an area first — a pass needs a footprint/)
        // The wording moved from "to save" to "to watch" when the button
        // became "Watch this area"; the refusal is what matters.
        expect(src).toMatch(/Draw an area first — there is nothing to (save|watch)/)
    })

    it("sends the standing-task cadence and active state on save", () => {
        expect(src).toMatch(/CADENCE_HOURS\[cadence\]/)
        expect(src).toMatch(/status: active \? "active" : "paused"/)
    })
})

describe("§12.3 — clicking an area toggles it and names the new state", () => {
    it("toggles active/paused and toasts what it became", () => {
        expect(src).toMatch(/z\.status === "active" \? "paused" : "active"/)
        expect(src).toMatch(/toast\(`\$\{z\.name\} — \$\{next\}`/)
    })
})
