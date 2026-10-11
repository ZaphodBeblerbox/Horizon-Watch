import { describe, it, expect } from "vitest"
import { icaoCountry, flagEmoji, countryName, trackCountry, _BLOCKS_FOR_TEST } from "./icaoCountry.js"

describe("ICAO24 → state of registry", () => {
    it("finds the country of real airframes", () => {
        expect(icaoCountry("3c6444").iso2).toBe("DE")        // Lufthansa
        expect(icaoCountry("4CA87C").iso2).toBe("IE")        // Ryanair, upper case
        expect(icaoCountry("adsb-43c5e7").iso2).toBe("GB")   // RAF A400M, entity-store id
        expect(icaoCountry("a1b2c3").iso2).toBe("US")
        expect(icaoCountry("505f6a").iso2).toBe("SK")        // inside a 1K block
        expect(icaoCountry("508123").iso2).toBe("UA")
        expect(icaoCountry("155555").iso2).toBe("RU")
        expect(icaoCountry("899012").iso2).toBe("TW")
        expect(icaoCountry("3c6444").name).toBe("Germany")
    })
    it("says nothing for an unallocated or non-ICAO address", () => {
        expect(icaoCountry("~3c6444")).toBeNull()            // TIS-B
        expect(icaoCountry("f80000")).toBeNull()
        expect(icaoCountry("zzzzzz")).toBeNull()
        expect(icaoCountry("")).toBeNull()
        expect(icaoCountry(null)).toBeNull()
    })
    it("blocks are sorted and never overlap (binary search depends on it)", () => {
        for (let i = 1; i < _BLOCKS_FOR_TEST.length; i++) {
            const [, prevEnd] = _BLOCKS_FOR_TEST[i - 1]
            const [start, end] = _BLOCKS_FOR_TEST[i]
            expect(start).toBeGreaterThan(prevEnd)
            expect(end).toBeGreaterThanOrEqual(start)
        }
    })
})

describe("flags", () => {
    it("builds the emoji from the ISO code", () => {
        expect(flagEmoji("de")).toBe("🇩🇪")
        expect(flagEmoji("NL")).toBe("🇳🇱")
        expect(flagEmoji("")).toBe("")
        expect(flagEmoji("XYZ")).toBe("")
    })
    it("names the country", () => {
        expect(countryName("PA")).toBe("Panama")
        expect(countryName("x")).toBeNull()
    })
    it("a vessel's flag is its MID flag, an aircraft's is its registry", () => {
        expect(trackCountry("vessel", { flag_iso2: "NL", flag: "Netherlands" })).toEqual({ iso2: "NL", name: "Netherlands" })
        expect(trackCountry("ship", { flag_iso2: "pa" }).name).toBe("Panama")
        expect(trackCountry("vessel", {})).toBeNull()
        expect(trackCountry("aircraft", { icao: "4ca87c" }).iso2).toBe("IE")
    })
})
