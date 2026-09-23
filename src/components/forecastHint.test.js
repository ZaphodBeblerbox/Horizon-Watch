import { describe, it, expect } from "vitest"
import { forecastHint } from "./InspectorPanel.jsx"

describe("scoping the forecast board from a signal", () => {
    it("prefers the most specific place the record carries", () => {
        expect(forecastHint({ country_name: "Sudan", region: "Horn of Africa" })).toBe("Sudan")
        expect(forecastHint({ region: "Horn of Africa" })).toBe("Horn of Africa")
    })

    it("is absent rather than inert when there is nothing to scope by", () => {
        // A button that opens the wrong board is worse than one that is
        // not offered at all.
        expect(forecastHint({})).toBeNull()
        expect(forecastHint(null)).toBeNull()
        expect(forecastHint({ country: "  " })).toBeNull()
        expect(forecastHint({ country: "UA" })).toBeNull()   // too short to match a board name
    })
})
