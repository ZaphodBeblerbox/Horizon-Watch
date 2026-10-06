import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { STEPS } from "./tutorialSteps.js"
import { placeCard } from "./Tutorial.jsx"

// All source text, to check that each hook a step names still exists.
const files = []
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(jsx?)$/.test(f) && !/\.test\./.test(f)) files.push(p) } }
walk("src")
const SRC = files.map((f) => readFileSync(f, "utf8")).join("\n")

describe("walkthrough steps", () => {
    it("every hook a step rings exists in the source", () => {
        for (const s of STEPS.filter((x) => x.target)) {
            const hooks = [...s.target.matchAll(/\[(data-tour|data-testid|data-screen-label|aria-label|title)="([^"]+)"\]/g)]
            const ids = [...s.target.matchAll(/#([A-Za-z][\w-]*)/g)]
            expect(hooks.length + ids.length, s.title).toBeGreaterThan(0)
            for (const [, attr, value] of hooks) {
                const asAttr = SRC.includes(`${attr}="${value}"`)
                const asLiteral = SRC.includes(`"${value}"`)        // titles built from data (rail lists)
                expect(asAttr || asLiteral, `${s.title}: ${attr}="${value}"`).toBe(true)
            }
            for (const [, id] of ids) expect(SRC.includes(`id="${id}"`), `${s.title}: #${id}`).toBe(true)
        }
    })

    it("every step says something", () => {
        for (const s of STEPS) {
            expect(s.title.length).toBeGreaterThan(3)
            expect(s.body.length).toBeGreaterThan(40)
        }
    })
})

describe("placing the card", () => {
    it("beside the ring where there is room, always on screen", () => {
        const right = placeCard({ x: 50, y: 100, w: 40, h: 600 }, 1680, 1000)
        expect(right.left).toBe(50 + 40 + 14)
        const left = placeCard({ x: 1500, y: 100, w: 150, h: 300 }, 1680, 1000)
        expect(left.left).toBe(1500 - 360 - 14)
        const big = placeCard({ x: 0, y: 0, w: 1680, h: 1000 }, 1680, 1000)
        expect(big.left).toBeLessThanOrEqual(1680 - 360 - 16)
        const none = placeCard(null, 1680, 1000)
        expect(none.left).toBe((1680 - 360) / 2)
    })
})
