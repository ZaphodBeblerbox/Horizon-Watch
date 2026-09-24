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
