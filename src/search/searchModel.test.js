import { describe, it, expect } from "vitest"
import { altitudeForHit, buildSuggestions, matchRank, parseCoords } from "./searchModel.js"

const places = [
    { name: "Kenya", kind: "country", lat: 0.5, lon: 37.9, altitude: 1_200_000 },
    { name: "Berlin", kind: "city", lat: 52.52, lon: 13.4, altitude: 180_000 },
    { name: "Benin", kind: "country", lat: 9.6, lon: 2.3, altitude: 700_000 },
]

describe("matchRank", () => {
    it("ranks exact, prefix, word prefix, contains", () => {
        expect(matchRank("Berlin", "berlin")).toBe(0)
        expect(matchRank("Berlin", "ber")).toBe(1)
        expect(matchRank("Strait of Hormuz", "horm")).toBe(2)
        expect(matchRank("Kenya", "eny")).toBe(3)
        expect(matchRank("Kenya", "xyz")).toBe(-1)
        expect(matchRank("São Tomé", "sao")).toBe(1)
    })
})

describe("buildSuggestions", () => {
    it("answers places first, local instantly, geocoder hits merged without duplicates", () => {
        const remote = [
            { type: "location", name: "Berlin", display_name: "Berlin, Germany", lat: 52.517, lon: 13.395, category: "boundary", osm_type: "relation" },
            { type: "location", name: "Unter den Linden", display_name: "Unter den Linden, Germany", lat: 52.516, lon: 13.38, category: "highway" },
            { type: "airport", name: "Berlin Brandenburg", lat: 52.36, lon: 13.5, country: "Germany", system_id: "A1" },
        ]
        const g = buildSuggestions("ber", { places, remote })
        expect(g[0].group).toBe("Places")
        expect(g[0].items.filter((i) => i.label === "Berlin")).toHaveLength(1)
        expect(g[0].items.map((i) => i.label)).toContain("Unter den Linden")
        expect(g.find((x) => x.group === "On the map").items[0].label).toBe("Berlin Brandenburg")
    })

    it("frames a street close and a geocoded town at town height", () => {
        expect(altitudeForHit({ category: "highway" })).toBe(3_000)
        expect(altitudeForHit({ category: "boundary", osm_type: "relation" })).toBe(150_000)
    })

    it("suggests theaters and modules before anything is typed", () => {
        const g = buildSuggestions("", { theaters: [{ id: "t", name: "Taiwan Strait" }], modules: [{ key: "map", label: "Map" }] })
        expect(g.map((x) => x.group)).toEqual(["Theaters", "Go to"])
    })

    it("finds signals by country as well as headline", () => {
        const g = buildSuggestions("kenya", { places, signals: [{ id: 1, headline: "Floods in Rift Valley", location_country: "Kenya" }] })
        expect(g.find((x) => x.group === "Signals").items[0].label).toBe("Floods in Rift Valley")
    })
})


describe("parseCoords", () => {
    it("reads decimal coordinates with or without hemispheres", () => {
        expect(parseCoords("26.5, 56.4")).toEqual({ lat: 26.5, lon: 56.4 })
        expect(parseCoords("26.5N 56.4E")).toEqual({ lat: 26.5, lon: 56.4 })
        expect(parseCoords("33.9 S, 18.4 E")).toEqual({ lat: -33.9, lon: 18.4 })
        expect(parseCoords("40.7 -74.0")).toEqual({ lat: 40.7, lon: -74 })
        expect(parseCoords("Berlin")).toBeNull()
        expect(parseCoords("95, 10")).toBeNull()
    })
})

describe("geoconfirmed results", () => {
    it("are labelled by what happened, with the date beside it", () => {
        const g = buildSuggestions("hormuz", { remote: [{ type: "geoconfirmed", system_id: "x", name: "30 MAR 2026",
            description: "Area grid - 2 container ships leaving 'Strait of Hormuz'.  \nVessels identified", lat: 26.8, lon: 56.2 }] })
        const it = g.find((x) => x.group === "On the map").items[0]
        expect(it.label).toBe("Area grid - 2 container ships leaving 'Strait of Hormuz'.")
        expect(it.sub).toBe("GeoConfirmed · 30 MAR 2026")
    })
})

describe("ordering and duplicates", () => {
    it("puts the name you are typing first and does not repeat a known country", () => {
        const remote = [
            { type: "location", name: "Berlin State Opera", lat: 52.516, lon: 13.395, category: "amenity" },
            { type: "location", name: "Unter den Linden", lat: 52.516, lon: 13.38, category: "highway" },
            { type: "location", name: "Kenya", lat: 1.44, lon: 38.43, category: "boundary", osm_type: "relation" },
        ]
        expect(buildSuggestions("unter den lin", { remote })[0].items[0].label).toBe("Unter den Linden")
        const k = buildSuggestions("kenya", { places, remote })[0].items.filter((i) => i.label === "Kenya")
        expect(k).toHaveLength(1)
    })
})

describe("the closer match leads", () => {
    it("puts Bab el-Mandeb (chokepoint, prefix) before Al-Bab (town, word)", () => {
        const remote = [
            { type: "location", name: "Al-Bab", lat: 36.37, lon: 37.51, category: "boundary", osm_type: "relation" },
            { type: "chokepoint", name: "Bab el-Mandeb", lat: 12.6, lon: 43.3, system_id: "CHOKE-003" },
        ]
        const g = buildSuggestions("bab el", { remote })
        expect(g[0].group).toBe("On the map")
        expect(g[0].items[0].label).toBe("Bab el-Mandeb")
    })
})
