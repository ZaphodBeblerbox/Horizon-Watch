import { describe, it, expect } from "vitest"
import { attributesOf, graphIdFor } from "./EntityLinksPanel.jsx"

describe("the ontology node in the sidebar", () => {
    it("shows only attributes that are populated, never plumbing", () => {
        const rows = attributesOf({ country: "SA", risk: 0.4, props: { flag: "Panama", imo: "9312456", owner: "", aliases: [], id: "x", raw: { a: 1 }, built_year: 2004 } })
        expect(rows).toEqual([["Country", "SA"], ["Risk", "0.4"], ["Flag", "Panama"], ["Imo", "9312456"], ["Built year", "2004"]])
        expect(attributesOf(null)).toEqual([])
    })
    it("builds a graph id where it can rather than searching", () => {
        expect(graphIdFor("vessel", { mmsi: 256843000 })).toBe("vessel:256843000")
        expect(graphIdFor("country", { iso2: "sd" })).toBe("country:SD")
    })
})
