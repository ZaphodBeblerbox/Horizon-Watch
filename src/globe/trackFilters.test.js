import { describe, it, expect } from "vitest"
import { EMPTY_AIRCRAFT_FILTER, EMPTY_VESSEL_FILTER, facet, filterAircraft, filterVessels, isActive, vesselType } from "./trackFilters.js"

const V = [
    { mmsi: 1, ship_type: "cargo", flag: "Panama" }, { mmsi: 2, ship_type: "tanker", flag: "Liberia" },
    { mmsi: 3, ship_type: "military", flag: "Russia" }, { mmsi: 4, ship_type: null, flag: "Panama" },
]
const A = [
    { icao: "aa", military: true }, { icao: "bb", airline: "Air Europa", operator: { country: "Spain" } },
    { icao: "cc", airline: "Emirates", operator: { country: "United Arab Emirates" } }, { icao: "dd" },
]

describe("track filters", () => {
    it("no filter shows everything; an empty set shows nothing", () => {
        expect(filterVessels(V, EMPTY_VESSEL_FILTER)).toHaveLength(4)
        expect(filterVessels(V, { ...EMPTY_VESSEL_FILTER, types: new Set() })).toHaveLength(0)
    })
    it("filters vessels by type, flag and sanction", () => {
        expect(filterVessels(V, { ...EMPTY_VESSEL_FILTER, types: new Set(["tanker", "military"]) }).map((v) => v.mmsi)).toEqual([2, 3])
        expect(filterVessels(V, { ...EMPTY_VESSEL_FILTER, flags: new Set(["Panama"]) }).map((v) => v.mmsi)).toEqual([1, 4])
        expect(filterVessels(V, { ...EMPTY_VESSEL_FILTER, sanctionedOnly: true }, new Set(["3"])).map((v) => v.mmsi)).toEqual([3])
        expect(vesselType(V[3])).toBe("unknown")
    })
    it("filters aircraft by kind, airline and the airline's country", () => {
        expect(filterAircraft(A, { ...EMPTY_AIRCRAFT_FILTER, kinds: new Set(["military"]) }).map((a) => a.icao)).toEqual(["aa"])
        expect(filterAircraft(A, { ...EMPTY_AIRCRAFT_FILTER, kinds: new Set(["commercial"]) }).map((a) => a.icao)).toEqual(["bb", "cc"])
        expect(filterAircraft(A, { ...EMPTY_AIRCRAFT_FILTER, countries: new Set(["Spain"]) }).map((a) => a.icao)).toEqual(["bb"])
        expect(filterAircraft(A, { ...EMPTY_AIRCRAFT_FILTER, airlines: new Set(["Emirates"]) }).map((a) => a.icao)).toEqual(["cc"])
    })
    it("facets count values, commonest first", () => {
        expect(facet(V, (v) => v.flag)).toEqual([["Panama", 2], ["Liberia", 1], ["Russia", 1]])
        expect(isActive(EMPTY_VESSEL_FILTER)).toBe(false)
        expect(isActive({ ...EMPTY_VESSEL_FILTER, flags: new Set(["x"]) })).toBe(true)
    })
})
