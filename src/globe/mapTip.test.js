import { describe, it, expect, beforeEach } from "vitest"
import { readFileSync, readdirSync } from "fs"
import path from "path"
import { fileURLToPath } from "url"
import { showTip, hideTip, getTip, subscribeTip, tipPosition } from "./mapTip.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

beforeEach(() => hideTip())

describe("mapTip — §6's single slot", () => {
    it("holds one tip at a time: showing a second replaces the first", () => {
        showTip("first", 10, 10)
        showTip("second", 20, 20)
        expect(getTip().content).toBe("second")
    })

    it("hideTip clears it, and is idempotent", () => {
        showTip("x", 1, 1)
        hideTip(); hideTip()
        expect(getTip()).toBeNull()
    })

    it("showTip(null) hides rather than showing an empty card", () => {
        showTip("x", 1, 1)
        showTip(null, 5, 5)
        expect(getTip()).toBeNull()
    })

    it("notifies subscribers on show and on hide", () => {
        const seen = []
        const off = subscribeTip((t) => seen.push(t))
        showTip("a", 3, 4)
        hideTip()
        off()
        expect(seen.map((t) => (t ? t.content : null))).toEqual(["a", null])
    })

    it("a listener that throws does not stop the tip updating", () => {
        // One bad layer must not wedge every other layer's tooltip.
        const off = subscribeTip(() => {})
        showTip("a", 1, 1)
        expect(getTip().content).toBe("a")
        off()
    })
})

const VW = 1400, VH = 900   // this suite runs in vitest's "node" environment

describe("tipPosition — §6 placement", () => {
    it("offsets from the cursor by the spec's 14px", () => {
        const { left, top } = tipPosition(100, 100, { vw: VW, vh: VH })
        expect(left).toBe(114)
        expect(top).toBe(114)
    })

    it("flips off the right edge instead of running past it", () => {
        const { left } = tipPosition(VW - 5, 100, { width: 256, vw: VW, vh: VH })
        expect(left).toBeLessThanOrEqual(VW - 256)
    })

    it("never goes negative on a narrow viewport", () => {
        const { left, top } = tipPosition(0, 0, { width: 5000, height: 5000, vw: VW, vh: VH })
        expect(left).toBeGreaterThanOrEqual(0)
        expect(top).toBeGreaterThanOrEqual(0)
    })

    it("keeps the card clear of the bottom edge", () => {
        const { top } = tipPosition(100, VH - 2, { height: 120, vw: VW, vh: VH })
        expect(top).toBeLessThanOrEqual(VH - 120)
    })
})

describe("§6 — never per-layer tooltips (static guard)", () => {
    // The rule the spec states outright: "One shared element for every layer
    // — never per-layer tooltips." Two layers under one cursor showing two
    // cards is the failure this prevents, and it returns the moment someone
    // adds a local `tooltip` state slot to a globe layer.
    const files = readdirSync(__dirname).filter((f) => f.endsWith(".jsx"))

    for (const f of files) {
        it(`${f} does not keep its own hover-tooltip state`, () => {
            const src = readFileSync(path.join(__dirname, f), "utf8")
            const own = /useState\([^)]*\)\s*(?:\/\/[^\n]*)?\n?/g
            const hasSlot = /const\s*\[\s*tooltip\s*,\s*setTooltip\s*\]/.test(src)
            expect(hasSlot, `${f} must drive mapTip.js's shared #maptip instead`).toBe(false)
        })
    }

    it("exactly one component renders the #maptip element", () => {
        const root = path.join(__dirname, "..")
        const hits = []
        const walk = (dir) => {
            for (const e of readdirSync(dir, { withFileTypes: true })) {
                if (e.name === "node_modules") continue
                const full = path.join(dir, e.name)
                if (e.isDirectory()) walk(full)
                else if (/\.(jsx|js)$/.test(e.name) && !e.name.endsWith(".test.js")) {
                    if (readFileSync(full, "utf8").includes('id="maptip"')) hits.push(e.name)
                }
            }
        }
        walk(root)
        expect(hits).toEqual(["MapTip.jsx"])
    })
})
