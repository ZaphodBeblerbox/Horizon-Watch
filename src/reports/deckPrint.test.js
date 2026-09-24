/**
 * A printed deck is a document, not a photograph of the screen.
 *
 * The deck has a dark/light toggle for presenting on a projector. Paper is
 * not a projector: printed dark, the browser drops the background fill and
 * the pale ink survives, so the sheet arrives as grey-on-white — or, where
 * a fill does survive, as a screenshot of the UI. The print flow must pin
 * the light palette and must ask for its colours explicitly.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const SRC = readFileSync("src/reports/Deck.jsx", "utf8")

// The JSX between `className="deck-print-flow"` and the end of that block.
const FLOW = SRC.slice(SRC.indexOf('className="deck-print-flow"'))
    .slice(0, 900)

describe("deck pdf export", () => {
    it("prints the light palette, not the on-screen theme", () => {
        expect(SRC).toMatch(/const PRINT_PAL = PALETTES\.light/)
        expect(FLOW).toMatch(/background: PRINT_PAL\.panel/)
        expect(FLOW).toMatch(/pal=\{PRINT_PAL\}/)
    })

    it("never lets the interactive theme reach a printed sheet", () => {
        // `pal` is the themed palette. If it appears anywhere inside the
        // print flow, one more toggle of the on-screen theme silently
        // changes what comes out of the printer.
        expect(FLOW).not.toMatch(/\bpal\b(?!=\{PRINT_PAL\})(?!ETTES)/)
    })

    it("asks for its background colours", () => {
        // Browsers drop background fills when printing unless told not to.
        expect(SRC).toMatch(/\.deck-print-flow \*\{-webkit-print-color-adjust:exact;print-color-adjust:exact\}/)
    })

    it("still starts on the dark theme for presenting", () => {
        // The fix must not quietly take the projector theme away.
        expect(SRC).toMatch(/useState\("dark"\)/)
    })
})
