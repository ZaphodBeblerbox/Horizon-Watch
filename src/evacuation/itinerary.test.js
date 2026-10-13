import { describe, expect, it } from "vitest"
import {
    chosenItinerary, currentGroundLeg, itineraryHeadline, itineraryLines, itineraryStops, legColor, legLine, progressLine, takeoverWording, isEvacuation,
} from "./itinerary.js"
import { detailsBody } from "./SafeHouseFields.jsx"
import { safeHouseIcon, placesLabel } from "./safeHouseIcon.js"

const ground = (to, coords = [[48.85, 2.35], [49.0, 2.55]]) => ({ kind: "ground", mode: "car", label: `Drive to ${to.name}`, duration_label: "45 min",
    from: { lat: coords[0][0], lon: coords[0][1] }, to, coords, links: { apple: "https://maps.apple.com/?x", google: "https://www.google.com/maps/dir/?api=1" } })
const CDG = { lat: 49.0, lon: 2.55, name: "Charles de Gaulle (CDG)", code: "CDG" }
const GVA = { lat: 46.24, lon: 6.11, name: "Geneva Airport", code: "GVA" }
const HOUSE = { id: "OA-1", lat: 46.2, lon: 6.14, name: "Geneva house" }
const AIR = { key: "air:1", kind: "air", title: "By air", duration_label: "4 h 40", tags: ["recommended", "fastest"], summary: "Drive 45 min…",
    destination: HOUSE, legs: [ground(CDG), { kind: "air", mode: "air", label: "Fly CDG Paris → GVA Geneva", duration_label: "~1 h 05 in the air",
        from: CDG, to: GVA, coords: [[49.0, 2.55], [46.24, 6.11]] }, ground(HOUSE, [[46.24, 6.11], [46.2, 6.14]])] }
const OVER = { key: "overland:1", kind: "overland", title: "Overland", duration_label: "6 h 10", tags: ["lowest exposure"], destination: HOUSE,
    legs: [ground({ lat: 46.15, lon: 6.12, name: "the border at Bardonnex" }), { kind: "border", mode: "border", label: "Cross at Bardonnex", duration_label: "allow ~15 min",
        from: { lat: 46.15, lon: 6.12 }, to: { lat: 46.15, lon: 6.12 }, coords: [[46.15, 6.12]], crossing: { name: "Bardonnex" } }, ground(HOUSE)] }
const PLAN = { kind: "evacuation", recommended: "air:1", itineraries: [AIR, OVER] }

describe("evacuation itineraries", () => {
    it("knows an evacuation plan and picks the itinerary on show", () => {
        expect(isEvacuation(PLAN)).toBe(true)
        expect(isEvacuation({ safest: {} })).toBe(false)
        expect(chosenItinerary(PLAN).key).toBe("air:1")
        expect(chosenItinerary(PLAN, "overland:1").key).toBe("overland:1")
        expect(chosenItinerary(PLAN, "nope").key).toBe("air:1")
    })
    it("says each itinerary and leg in words, flights and sailings marked to check", () => {
        expect(itineraryHeadline(AIR)).toBe("Recommended · Fastest safe — By air, 4 h 40")
        expect(legLine(AIR.legs[1])).toContain("check flights")
        expect(legLine({ kind: "sea", label: "Sail", duration_label: "~5 h" })).toContain("check sailings")
    })
    it("colours legs by what they are and draws air dashed", () => {
        expect(legColor(AIR.legs[0])).toBe("#3ddc84")
        expect(legColor(AIR.legs[1])).not.toBe(legColor(AIR.legs[0]))
        const lines = itineraryLines(PLAN)
        expect(lines.map((l) => [l.kind, l.dashed])).toEqual([["ground", false], ["air", true], ["ground", false]])
        expect(itineraryLines(PLAN, "overland:1").map((l) => l.kind)).toEqual(["ground", "ground"])     // a crossing is a point
    })
    it("marks the change points and the safe house", () => {
        const st = itineraryStops(PLAN)
        expect(st.map((s) => s.kind)).toEqual(["change", "change", "safe_house"])
        expect(itineraryStops(PLAN, "overland:1").map((s) => s.kind)).toEqual(["border", "change", "safe_house"])
    })
    it("navigates the first ground leg in Apple / Google Maps", () => {
        expect(currentGroundLeg(AIR).to.code).toBe("CDG")
        expect(currentGroundLeg(AIR, 1).to.name).toBe("Geneva house")
    })
    it("tells the sender where the person is against the route", () => {
        expect(progressLine(null)).toMatch(/No live position/)
        expect(progressLine({ known: true, arrived: true })).toMatch(/Arrived/)
        expect(progressLine({ known: true, off_route: true, off_route_m: 1500, leg_label: "Drive to CDG" })).toBe("OFF ROUTE — 1.5 km from it · Drive to CDG")
        expect(progressLine({ known: true, leg_label: "Drive to CDG", remaining_label: "3 h 10", eta: "2026-10-12T18:40:00Z" }, () => "18:40"))
            .toBe("On the route · Drive to CDG · 3 h 10 left · ETA 18:40")
    })
})

describe("the evacuate takeover's wording", () => {
    const w = { kind: "evacuate", route: { route_plan_id: "RP-1", safe_house: "Geneva house", summary: "Drive 45 min to CDG, fly…",
        legs: [{ label: "Drive to CDG", duration_label: "45 min" }, { label: "Fly CDG → GVA", duration_label: "~1 h 05 in the air" }] } }
    it("reads EVACUATE, names the safe house, lists the legs", () => {
        const t = takeoverWording(w)
        expect(t.title).toBe("EVACUATE")
        expect(t.open).toBe("Open the evacuation route to Geneva house")
        expect(t.legs).toEqual(["Drive to CDG · 45 min", "Fly CDG → GVA · ~1 h 05 in the air"])
    })
    it("a plain warning stays a WARNING", () => {
        expect(takeoverWording({ kind: "warning", route: { route_plan_id: "RP-2" } })).toEqual({ title: "WARNING", open: "Open the route", how: null, legs: [] })
        expect(takeoverWording({ kind: "warning" }).open).toBeNull()
    })
})

describe("safe house fields", () => {
    it("sends numbers, a status and lists", () => {
        expect(detailsBody({ status: "closed", capacity: "6", occupancy: "", contact: "  ring twice ", allowed_users: ["u1"], allowed_teams: "Trifecta, Acme ," }))
            .toEqual({ status: "closed", capacity: 6, occupancy: null, contact: "ring twice", allowed_users: ["u1"], allowed_teams: ["Trifecta", "Acme"] })
        expect(detailsBody({}).status).toBe("open")
    })
    it("has its own pin, grey when closed, and says the places free", () => {
        expect(safeHouseIcon(false)).toMatch(/^data:image\/svg\+xml/)
        expect(safeHouseIcon(true)).not.toBe(safeHouseIcon(false))
        expect(placesLabel({ capacity: 6, occupancy: 2, reserved: 1 })).toBe(" · 3/6 free")
        expect(placesLabel({})).toBe("")
    })
})

import { declarable, isSafeHouse } from "./SafeHouseFields.jsx"
describe("declaring a building a safe house", () => {
    it("is offered for buildings and sites, never for what moves", () => {
        expect(declarable({ key: "office", group: "Sites" })).toBe(true)
        expect(declarable({ key: "vehicle_car", group: "Vehicles" })).toBe(false)
        expect(declarable({ key: "safe_house", group: "Safety" })).toBe(false)
        expect(isSafeHouse({ kind: "office", group: "Sites", details: { safe_house: true } })).toBe(true)
        expect(isSafeHouse({ kind: "office", group: "Sites", details: {} })).toBe(false)
        expect(isSafeHouse({ kind: "safe_house" })).toBe(true)
    })
    it("sends the declaration with the details", () => {
        expect(detailsBody({ safe_house: true, capacity: "4" })).toMatchObject({ safe_house: true, capacity: 4, status: "open" })
    })
})
