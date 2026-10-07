import { describe, it, expect } from "vitest"
import { countriesInView, partition, relevance, watched, nearestAsset } from "./interests.js"

const C = [
    { name: "Yemen", lat: 15.6, lon: 47.6 }, { name: "Eritrea", lat: 15.4, lon: 38.9 },
    { name: "Djibouti", lat: 11.8, lon: 42.6 }, { name: "Democratic Republic of the Congo", lat: -2.9, lon: 23.6 },
    { name: "Germany", lat: 51.1, lon: 10.4 },
]
const RED_SEA = { name: "Red Sea watch", view: { lat: 13.6, lon: 43.3, height: 2_400_000 } }

describe("interests", () => {
    it("a theater watches the countries its view frames", () => {
        expect(countriesInView(RED_SEA.view, C)).toEqual(["Djibouti", "Yemen", "Eritrea"])
    })

    it("a Congo boat collision is elsewhere for a Red Sea analyst; Yemen is theirs, with the reason", () => {
        const w = watched({}, [RED_SEA], C)
        expect(relevance({ headline: "Boat collision on the Congo River", location_country: "Democratic Republic of the Congo", severity_tier: "critical" }, w).forYou).toBe(false)
        expect(relevance({ headline: "Fighting around Taiz", location_country: "Yemen" }, w)).toEqual({ forYou: true, reason: "Yemen · Red Sea watch" })
    })

    it("regions expand to countries and a watched topic catches a critical anywhere", () => {
        const w = watched({ regions: ["Levant"], topics: ["maritime"] }, [], C)
        expect(relevance({ location_country: "Lebanon" }, w).reason).toBe("Lebanon · Levant")
        expect(relevance({ headline: "Tanker seized off Brazil", location_country: "Brazil", severity_tier: "critical" }, w).forYou).toBe(true)
        expect(relevance({ headline: "Tanker seized off Brazil", location_country: "Brazil", severity_tier: "significant" }, w).forYou).toBe(false)
    })

    it("partitions and reports whether there is anything to go on", () => {
        const p = partition([{ location_country: "Yemen" }, { location_country: "Germany" }], watched({}, [RED_SEA], C))
        expect(p.mine).toHaveLength(1)
        expect(p.mine[0]._why).toBe("Yemen · Red Sea watch")
        expect(p.hasInterests).toBe(true)
        expect(partition([], watched({}, [], C)).hasInterests).toBe(false)
    })
})

describe("your assets decide what is yours", () => {
    const assets = [{ name: "MT Aurora", kind_label: "Tanker", lat: 25.0, lon: 55.06, radius_km: 50 },
                    { name: "Unplaced", kind_label: "Team", radius_km: 30 }]
    it("a signal inside an asset's radius is for you, naming the asset", () => {
        const w = watched({}, [], [], assets)
        const r = relevance({ lat: 25.1, lon: 55.1, location_country: "Oman" }, w)
        expect(r.forYou).toBe(true)
        expect(r.reason).toMatch(/km from MT Aurora/)
    })
    it("outside every radius it is not, and unplaced assets are ignored", () => {
        const w = watched({}, [], [], assets)
        expect(relevance({ lat: 30, lon: 50 }, w).forYou).toBe(false)
        expect(w.assets).toHaveLength(1)
    })
    it("a live position wins over the registered one", () => {
        const w = watched({}, [], [], [{ name: "V", lat: 0, lon: 0, position: { lat: 10, lon: 10 }, radius_km: 20 }])
        expect(nearestAsset({ lat: 10.05, lon: 10 }, w.assets)?.name).toBe("V")
    })
    it("what touches an asset leads the list", () => {
        const w = watched({ countries: ["Oman"] }, [], [], assets)
        const p = partition([{ id: 1, location_country: "Oman", lat: 20, lon: 57 }, { id: 2, lat: 25.02, lon: 55.07 }], w)
        expect(p.mine.map((x) => x.id)).toEqual([2, 1])
    })
})

describe("a signal must be able to reach the asset", () => {
    it("a sanctioned vessel is not for a substation, a protest is", () => {
        const w = watched({}, [], [], [{ name: "UW Mitte", kind: "substation", kind_label: "Electric substation", lat: 52.5, lon: 13.4, radius_km: 20 }])
        expect(relevance({ lat: 52.51, lon: 13.41, type: "Sanctioned vessel", headline: "Sanctioned vessel loitering" }, w).forYou).toBe(false)
        expect(relevance({ lat: 52.51, lon: 13.41, headline: "Protest outside the substation" }, w).forYou).toBe(true)
    })
})
