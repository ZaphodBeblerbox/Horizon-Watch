import { describe, it, expect } from "vitest"
import { rankCountries, why } from "./riskRanking.js"

const AFG = {
    iso_code: "AFG", score: 39.94, band: 2,
    components: { tone: { mean_tone: -4.37, n_events: 203 }, gold: { share_below_threshold: 0.256, n_events: 203 }, conf: { count: 0 } },
    contributions: { tone: 30.79, gold: 9.15, conf: 0 },
}
const SDN = {
    iso_code: "SDN", score: 66.14, band: 4,
    components: { tone: { mean_tone: -6.1, n_events: 3 }, conf: { count: 2 } },
    contributions: { tone: 20, conf: 46.1 },
}

describe("risk ranking", () => {
    it("ranks by the risk index, not by how many signals a region produced", () => {
        const names = new Map([["AFG", "Afghanistan"], ["SDN", "Sudan"]])
        const rows = rankCountries([AFG, { ...SDN, components: { ...SDN.components, tone: { mean_tone: -6.1, n_events: 40 } } }], names,
            [{ location_country: "Afghanistan" }, { location_country: "Afghanistan" }])
        expect(rows.map((r) => r.name)).toEqual(["Sudan", "Afghanistan"])
        expect(rows[1].signals).toBe(2)
    })

    it("says why in words, strongest component first", () => {
        expect(why(AFG)).toBe("coverage tone -4.4 · 26% of events conflictual")
        expect(why(SDN)).toBe("2 confirmed incidents · coverage tone -6.1")
    })

    it("puts a high score resting on 3 events below a lower one resting on 203", () => {
        const rows = rankCountries([SDN, AFG], new Map([["AFG", "Afghanistan"], ["SDN", "Sudan"]]))
        expect(rows.map((r) => r.name)).toEqual(["Afghanistan", "Sudan"])
    })

    it("flags a score resting on little observation", () => {
        const rows = rankCountries([SDN], new Map([["SDN", "Sudan"]]))
        expect(rows[0].thin).toBe(true)
        expect(rows[0].evidence).toBe(3)
    })
})
