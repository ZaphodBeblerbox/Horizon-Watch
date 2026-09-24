/**
 * The map's opening state.
 *
 * A globe that opens with every layer lit is not a map of anything: the
 * reader has to turn things OFF to find the picture, which is backwards.
 * These are asserted against the source because the defaults are the
 * whole behaviour — there is nothing else to test about an initial value.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"

const SRC = readFileSync("src/destinations/Situation.jsx", "utf8")

describe("default map layers", () => {
    it("opens with news on", () => {
        expect(SRC).toContain('g.key === "news"')
    })

    it("opens with GDELT on", () => {
        expect(SRC).toContain("const [gdeltOn, setGdeltOn] = useState(true)")
    })

    it("opens with country risk on", () => {
        expect(SRC).toMatch(/useState\(\{ risk: true,/)
    })

    it("opens with everything else off", () => {
        expect(SRC).toContain("const [firesOn, setFiresOn] = useState(false)")
        expect(SRC).toContain("const [theatresOn, setTheatresOn] = useState({})")
        // No other context layer may default on.
        const ctx = /useState\(\{ risk: true,([^}]*)\}\)/.exec(SRC)[1]
        expect(ctx).not.toMatch(/:\s*true/)
    })
})

describe("v4.3 shell defaults", () => {
    it("opens with both side panes closed", () => {
        // The map is the product. Two panes open on load leave a strip of
        // it visible and make the reader's first action "close things".
        expect(SRC).toContain("const [leftMin, setLeftMin] = useState(true)")
        expect(SRC).toContain("const [rightMin, setRightMin] = useState(true)")
    })

    it("clears the map selection when the inspector closes", () => {
        // Otherwise a highlighted contact is left on the map with
        // nothing on screen explaining why it is highlighted.
        const close = SRC.slice(SRC.indexOf("inspectorPopup.onClose?.()"))
        expect(close.slice(0, 200)).toContain("setSelected(null)")
    })

    it("shows the what-changed card on the map", () => {
        expect(SRC).toContain("<WhatChanged")
    })

    it("lets CSS place the card, not a prop", () => {
        // The card insets itself with the map's own --map-inset-l, so it
        // tracks the pane token instead of a literal copied into JSX that
        // drifts the moment the token changes.
        expect(SRC).not.toMatch(/offsetLeft=/)
    })
})
