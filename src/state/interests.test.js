import { describe, it, expect } from "vitest"
import { countriesInView, partition, relevance, watched } from "./interests.js"

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
