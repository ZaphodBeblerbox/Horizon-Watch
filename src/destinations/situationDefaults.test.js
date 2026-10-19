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

describe("default map layers: nothing on (owner, 2026-10-18)", () => {
    // "When a user opens the system for the first time, nothing should be
    // on by default; they have to save to default themselves what they
    // want on by default."
    it("opens with every group off", () => {
        expect(SRC).toMatch(/LAYER_GROUPS\.map\(\(g\) => \[g\.key, false\]\)/)
    })

    it("never shows GDELT as map signals (country risk index only)", () => {
        expect(SRC).toMatch(/const \[gdeltOn, setGdeltOn\] = useState\(false\)/)
        expect(SRC).not.toMatch(/label="Unconfirmed"/)
    })

    it("opens with every context, infrastructure and track switch off", () => {
        const ctx = /const \[contextOn, setContextOn\] = useState\(\{([^}]*)\}\)/.exec(SRC)[1]
        expect(ctx).not.toMatch(/:\s*true/)
        const infra = /const \[infraOn, setInfraOn\] = useState\(\{([^}]*)\}\)/.exec(SRC)[1]
        expect(infra).not.toMatch(/:\s*true/)
        const tracks = /const \[tracksOn, setTracksOn\] = useState\(\{([^}]*)\}\)/.exec(SRC)[1]
        expect(tracks).not.toMatch(/:\s*true/)
        expect(SRC).toContain("const [firesOn, setFiresOn] = useState(false)")
        expect(SRC).toContain("const [theatresOn, setTheatresOn] = useState({})")
    })

    it("opens with the stand-alone layers off (no group gates them)", () => {
        for (const n of ["assetsOn, setAssetsOn", "teamOn, setTeamOn", "safeHousesOn, setSafeHousesOn",
                         "endangeredOn, setEndangeredOn", "airspaceOn, setAirspaceOn", "gfwHeatOn, setGfwHeatOn"]) {
            expect(SRC, n).toContain(`const [${n}] = useState(false)`)
        }
    })

    it("an empty map says where to start", () => {
        expect(SRC).toContain('data-testid="layers-empty-hint"')
        expect(SRC).toContain("save default")
    })

    it("a default saved before then still opens as it did", () => {
        expect(SRC).toContain("saved.v >= 2 ? {} : STANDALONE_BEFORE_2026_10_18()")
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
