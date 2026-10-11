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
