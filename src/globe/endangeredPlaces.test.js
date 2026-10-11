import { describe, it, expect } from "vitest"
import { placeIconUri, clusterIconUri, placeDetail, defaultOnNow, worstAlarm } from "./endangeredPlaces.js"
import { clusterPlaces, PHONE_LAYERS } from "../mobile/mapLayers.js"
import { normalizeEntity } from "../inspector/adapters.js"

const refinery = {
    id: "gj:806103973", kind: "refinery", kind_label: "Refinery", name: "Raffinerie de Feyzin",
    operator: "TotalEnergies (TotalEnergies Raffinage France)", city: "Feyzin", dept: "69", lat: 45.67, lon: 4.85,
    status: "upcoming", alarm: "red", source: "17octobregiletjaune.net",
    source_url: "https://17octobregiletjaune.net/carte/#lieu=806103973",
    calls: [{ kind: "barrage_filtrant", label_en: "Filtering roadblock", level: "high", date: "2026-10-17", time: "07:00",
              line: "Filtering roadblock called for Sat 17 Oct, 07:00 — source: 17octobregiletjaune.net" }],
}
const company = {
    id: "fc:1", kind: "arms_company", kind_label: "Arms-industry company", name: "ACME", lat: 43.5, lon: 5.4,
    status: "listed (no call)", alarm: "grey", calls: [], sector: "Logiciel", lists: ["Drones"],
    source: "framacarte.org (anti-militarist map)", source_url: "https://framacarte.org/m/213599/",
}

describe("endangered places", () => {
    it("draws a warning triangle for a call and a disc for a listed place, cached", () => {
        const a = placeIconUri({ kind: "refinery", alarm: "red", hasCall: true, size: 24 })
        expect(a).toMatch(/^data:image\/svg\+xml/)
        expect(decodeURIComponent(a)).toContain("#E5484D")
        expect(placeIconUri({ kind: "refinery", alarm: "red", hasCall: true, size: 24 })).toBe(a)
        expect(decodeURIComponent(placeIconUri({ kind: "arms_company", alarm: "grey", size: 14 }))).toContain("<circle")
        expect(decodeURIComponent(clusterIconUri({ count: 12, alarm: "amber" }))).toContain(">12<")
        expect(worstAlarm("amber", "red")).toBe("red")
    })

    it("says the calls in plain English, or why a place is listed", () => {
        expect(placeDetail(refinery)).toContain("Filtering roadblock called for Sat 17 Oct, 07:00 — source: 17octobregiletjaune.net")
        expect(placeDetail(refinery)).toContain("Operator: TotalEnergies")
        expect(placeDetail(company)).toContain("anti-militarist map as a target for action")
    })

    it("opens in the inspector with each call and the source as a link", () => {
        const n = normalizeEntity("endangered_place", refinery)
        expect(n.identity.title).toBe("Raffinerie de Feyzin")
        expect(n.identity.subtitle).toContain("within 48 h")
        const by = Object.fromEntries(n.attributes.map((a) => [a.label, a.value]))
        expect(by.Call).toContain("Filtering roadblock called for Sat 17 Oct, 07:00")
        expect(by.Source).toBe(refinery.source_url)
        expect(by.Operator).toContain("TotalEnergies")
    })

    it("clusters on the phone when zoomed out, and splits close in", () => {
        const near = { ...refinery, id: "gj:2", lat: 45.68, lon: 4.86, alarm: "amber" }
        const out = clusterPlaces([refinery, near, company], 5)
        expect(out).toHaveLength(2)
        const cl = out.find((f) => f.id.startsWith("endangered-cl-"))
        expect(cl.title).toBe("2 endangered places here — 2 with calls to act")
        expect(cl.severity).toBe("high")
        expect(clusterPlaces([refinery, near, company], 12)).toHaveLength(3)
        const one = clusterPlaces([refinery], 12)[0]
        expect(one.raw.url).toBe(refinery.source_url)
        expect(one.raw.detail).toContain("Filtering roadblock")
    })

    it("is on by default only while a call is within the week", () => {
        expect(defaultOnNow(Date.parse("2026-10-11T12:00:00Z"))).toBe(true)
        expect(defaultOnNow(Date.parse("2026-11-01T12:00:00Z"))).toBe(false)
        const l = PHONE_LAYERS.find((x) => x.key === "endangered")
        expect(typeof l.defaultOn).toBe("boolean")
    })
})

describe("endangered places outside France", () => {
    const strike = {
        id: "it_mit:IT", kind: "strike", kind_label: "Strike", name: "Italy (nationwide)", lat: 42.5, lon: 12.6,
        country: "IT", country_name: "Italy", status: "upcoming", alarm: "red", level: "high",
        source: "MIT — proclaimed transport strikes (Italy)", source_url: "https://scioperi.mit.gov.it/mit2/public/scioperi",
        credit: "Ministero delle Infrastrutture e dei Trasporti — facts cited",
        calls: [{ kind: "strike_trasporto_merci", label_en: "Freight transport strike", level: "high", basis: "announced",
                  verb: "proclaimed", date: "2026-10-13", end_date: "2026-10-14", time: "06:00",
                  line: "Freight transport strike proclaimed for Tue 13 Oct, 06:00 to Wed 14 Oct — source: MIT — proclaimed transport strikes (Italy)" }],
    }
    const berlin = { id: "de_berlin:1", kind: "assembly", name: "Alexanderplatz, Berlin", lat: 52.52, lon: 13.41,
        country: "DE", country_name: "Germany", alarm: "amber", status: "upcoming", source: "Polizei Berlin — notified assemblies",
        calls: [{ kind: "assembly", label_en: "Notified assembly", level: "medium", basis: "announced", line: "x" }] }

    it("names the country, the source and its credit", async () => {
        const { placeSubtitle, creditLine } = await import("./endangeredPlaces.js")
        expect(placeSubtitle(strike)).toBe("Strike · Italy")
        expect(placeSubtitle(refinery)).not.toContain("France")
        expect(creditLine(strike)).toBe("Source: MIT — proclaimed transport strikes (Italy). Credit: Ministero delle Infrastrutture e dei Trasporti — facts cited.")
        expect(placeDetail(strike)).toContain("Credit: Ministero")
        const n = normalizeEntity("endangered_place", strike)
        const by = Object.fromEntries(n.attributes.map((a) => [a.label, a.value]))
        expect(by.Country).toBe("Italy")
        expect(by.Credit).toContain("Ministero")
        expect(n.identity.subtitle).toContain("supply strike within 48 h")
        expect(normalizeEntity("endangered_place", berlin).identity.subtitle).toContain("Notified or proclaimed")
    })

    it("filters by country, shared by the globe and the phone", async () => {
        const m = await import("./endangeredPlaces.js")
        m.setCountryFilter([])
        expect(m.filterByCountry([strike, berlin, refinery])).toHaveLength(3)
        let heard = null
        const off = m.subscribeCountryFilter((v) => { heard = v })
        m.toggleCountry("it")
        expect(heard).toEqual(["IT"])
        expect(m.filterByCountry([strike, berlin, refinery]).map((p) => p.id)).toEqual(["it_mit:IT"])
        m.toggleCountry("FR")
        expect(m.filterByCountry([strike, berlin, refinery]).map((p) => p.id)).toEqual(["it_mit:IT", "gj:806103973"])
        m.setCountryFilter([])
        off()
    })

    it("draws a glyph for each new kind", () => {
        for (const kind of ["assembly", "strike", "action", "lobby_office"]) {
            expect(decodeURIComponent(placeIconUri({ kind, alarm: "amber", hasCall: true, size: 22 }))).toContain("<path")
        }
    })
})
