import { describe, it, expect } from "vitest"
import fs from "node:fs"
import { FRAME, SIZE, TPL, AFFILIATIONS, TEMPLATE_KEYS, TEMPLATE_LABEL,
         isMoving, positionAt, chevron, elapsedLabel } from "./forecastTemplate.js"
import { DOMAINS, ICONS } from "./forecastSymbols.js"

describe("the doctrinal template", () => {
    it("draws every APP-6 affiliation rather than approximating one", () => {
        // An approximately-right frame is a claim about affiliation the
        // reader will believe.
        expect(AFFILIATIONS.sort()).toEqual(["friendly", "hostile", "neutral", "unknown"])
        for (const a of AFFILIATIONS) expect(FRAME[a]).toMatch(/^M/)
    })

    it("carries the full echelon ladder", () => {
        expect(Object.values(SIZE)).toEqual(["I", "II", "III", "X", "XX", "XXX"])
    })

    it("every template names the doctrine it comes from", () => {
        // So the reader can disagree with the doctrine rather than with
        // the picture.
        for (const k of TEMPLATE_KEYS) {
            expect(TPL[k].doctrine, k).toBeTruthy()
            expect(TPL[k].doctrine.length, k).toBeGreaterThan(30)
            expect(TPL[k].units.length, k).toBeGreaterThan(0)
        }
    })

    it("every unit has a valid affiliation and echelon", () => {
        for (const k of TEMPLATE_KEYS) {
            for (const u of TPL[k].units) {
                expect(AFFILIATIONS, `${k}/${u.id}`).toContain(u.aff)
                expect(Object.keys(SIZE), `${k}/${u.id}`).toContain(u.size)
            }
        }
    })

    it("a static unit is not given an axis or a chevron", () => {
        const still = { x: 10, y: 10, to: [10, 10] }
        expect(isMoving(still)).toBe(false)
        expect(chevron(still, 0.5)).toBeNull()
    })

    it("interpolates linearly, because a template is not a track", () => {
        const u = { x: 0, y: 0, to: [100, 50] }
        expect(positionAt(u, 0)).toEqual({ x: 0, y: 0 })
        expect(positionAt(u, 0.5)).toEqual({ x: 50, y: 25 })
        expect(positionAt(u, 1)).toEqual({ x: 100, y: 50 })
    })

    it("clamps t so a runaway clock cannot march units off the frame", () => {
        const u = { x: 0, y: 0, to: [100, 0] }
        expect(positionAt(u, 4).x).toBe(100)
        expect(positionAt(u, -3).x).toBe(0)
        expect(positionAt(u, NaN).x).toBe(0)
    })

    it("shows no chevron at the very start, when there is no direction yet", () => {
        expect(chevron({ x: 0, y: 0, to: [100, 0] }, 0)).toBeNull()
        expect(chevron({ x: 0, y: 0, to: [100, 0] }, 0.5)).toContain("M")
    })

    it("counts in the scenario's own window, not an arbitrary six seconds", () => {
        expect(elapsedLabel(1, "30-90 days")).toBe("T+90d")
        expect(elapsedLabel(0, "30-90 days")).toBe("T+0d")
        expect(elapsedLabel(1, "0-3 months")).toBe("T+90d")
        expect(elapsedLabel(0.5, "0-45 days")).toBe("T+23d")
    })

    it("names every template, so the chooser has no blank row", () => {
        expect(Object.keys(TEMPLATE_LABEL).sort()).toEqual([...TEMPLATE_KEYS].sort())
        for (const k of TEMPLATE_KEYS) expect(TEMPLATE_LABEL[k], k).toBeTruthy()
    })

    it("agrees with the backend's allow-list", () => {
        // The two lists are in different languages and drift silently:
        // a key added here and not there is refused on save, and a key
        // added there and not here renders an empty frame, which reads
        // as "no doctrine" rather than "typo".
        const py = fs.readFileSync("backend/forecast_board.py", "utf8")
        const m = /^TEMPLATES = \(([^)]*)\)/m.exec(py)
        expect(m, "TEMPLATES not found in forecast_board.py").toBeTruthy()
        const backend = m[1].match(/"([a-z_]+)"/g).map((q) => q.slice(1, -1))
        expect(backend.sort()).toEqual([...TEMPLATE_KEYS].sort())
    })

    it("gives every unit a battle dimension", () => {
        // Without one every formation is drawn in a ground frame, which
        // says every movement is a march — and an air axis that looks
        // like a march is the specific thing this is meant to prevent.
        for (const k of TEMPLATE_KEYS) {
            for (const u of TPL[k].units) {
                expect(DOMAINS, `${k}/${u.id}`).toContain(u.domain)
            }
        }
    })

    it("gives every unit a function glyph the symbol set knows", () => {
        for (const k of TEMPLATE_KEYS) {
            for (const u of TPL[k].units) {
                expect(Object.keys(ICONS), `${k}/${u.id}`).toContain(u.icon)
            }
        }
    })

    it("puts sea units only in the maritime template", () => {
        // A naval symbol in a land incursion would be drawn, checked
        // against the coastline, and refused — which is right, but it
        // should not be authored in the first place.
        for (const k of TEMPLATE_KEYS) {
            const sea = TPL[k].units.filter((u) => u.domain === "sea")
            if (sea.length) expect(k).toBe("reroute")
        }
    })
})
