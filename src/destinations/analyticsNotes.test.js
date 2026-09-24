/**
 * Every panel explains itself.
 *
 * A chart with no sentence under it is a picture the reader has to guess
 * at, and the guesses are wrong in predictable ways — a dip in arrivals
 * read as calm, a slice that grew because the total shrank.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const SRC = readFileSync("src/destinations/Analytics.jsx", "utf8")

describe("analytics explanations", () => {
    it("has a note for every panel", () => {
        const panels = (SRC.match(/className="panelbox"/g) || []).length
        const notes = (SRC.match(/<PanelNote>/g) || []).length
        expect(panels).toBeGreaterThan(0)
        expect(notes).toBeGreaterThanOrEqual(panels)
    })

    it("warns that a quiet volume chart may be a stopped feed", () => {
        // The one misreading that matters: arrival is not occurrence, and
        // a dead feed and a quiet world are the same shape here.
        expect(SRC).toMatch(/ARRIVAL, not occurrence/)
        expect(SRC).toMatch(/freshness indicator/)
    })

    it("warns that a share can move because the total moved", () => {
        expect(SRC).toMatch(/has not grown/)
    })

    it("tells the reader what is clickable", () => {
        // Whitespace-tolerant: JSX wraps prose across lines, so a
        // literal phrase match is testing the formatter, not the text.
        const flat = SRC.replace(/\s+/g, " ")
        expect(flat).toMatch(/Click a cell to filter/)
        expect(flat).toMatch(/Click a column to sort/)
        expect(flat).toMatch(/a row to open it on the map/)
    })
})
