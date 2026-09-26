import { readFileSync } from "node:fs"
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
        //
        // The state moved to settingsStore.js so it survives a remount —
        // it used to be useState(true), which re-minimised both panes every
        // time the destination mounted. The default it opens with has to
        // stay the same, so the guard now reads the stored default.
        expect(SRC).toContain('useChrome("leftPanel")')
        expect(SRC).toContain('useChrome("rightPanel")')
        const store = readFileSync(
            new URL("../state/settingsStore.js", import.meta.url), "utf8")
        const chrome = /chrome:\s*\{([\s\S]*?)\}/.exec(store)[1]
        expect(chrome).toMatch(/leftPanel:\s*false/)
        expect(chrome).toMatch(/rightPanel:\s*false/)
    })

    it("clears the map selection when the inspector closes", () => {
        // Otherwise a highlighted contact is left on the map with
        // nothing on screen explaining why it is highlighted.
        const close = SRC.slice(SRC.indexOf("inspectorPopup.onClose?.()"))
        expect(close.slice(0, 200)).toContain("setSelected(null)")
    })

    it("does not put a what-changed card on the map", () => {
        // Removed at the user's request: it covered the map and repeated
        // what the inbox already says.
        expect(SRC).not.toContain("<WhatChanged")
    })
})
