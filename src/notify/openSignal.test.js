import { describe, it, expect, beforeEach, vi } from "vitest"
import {
    normalizeOpen, routeFor, parseOpenParams, lookupId, openSignal, setSignalSurface, setAlertFetcher, __resetSignalSurfaces,
} from "./openSignal.js"

const VESSEL_ID = "RUL-667002574-1791715498"
const TYPE = "Russia-linked vessel loitering"

describe("routeFor — what a notification opens", () => {
    it("a vessel-of-concern push (carries mmsi + alert_type) opens the vessel view", () => {
        const r = routeFor({ eventId: VESSEL_ID, lat: 59.85, lon: 25.57, headline: "VIXENA loitering off Estonia", mmsi: "667002574", alertType: TYPE })
        expect(r).toMatchObject({ action: "vessel", mmsi: "667002574", alertId: VESSEL_ID, lat: 59.85, lon: 25.57, alertType: TYPE })
    })
    it("recognises the vessel from the alert id alone (RUL-<mmsi>-<start>)", () => {
        expect(routeFor({ id: VESSEL_ID })).toMatchObject({ action: "vessel", mmsi: "667002574", alertType: TYPE })
    })
    it("recognises it from a tray item (alertType + mmsi from the feed) and from a General feed item (sig:<id>, entity_id)", () => {
        const tray = { id: VESSEL_ID, alertId: VESSEL_ID, kind: "signal", sev: "critical", title: "x", ref: { lat: 59.8, lon: 25.6 }, read: false, alertType: TYPE, mmsi: "667002574" }
        expect(routeFor(tray)).toMatchObject({ action: "vessel", mmsi: "667002574", lat: 59.8, lon: 25.6 })
        const general = { id: `sig:${VESSEL_ID}`, kind: "signal", alert_type: TYPE, alert_id: VESSEL_ID, entity_id: "667002574", lat: 1, lon: 2, headline: "h" }
        expect(routeFor(general)).toMatchObject({ action: "vessel", mmsi: "667002574", alertId: VESSEL_ID, title: "h" })
    })
    it("leaves other kinds as they were: livestream, asset, any other signal", () => {
        expect(routeFor({ id: "live:k", livestreamId: "k" }).action).toBe("livestream")
        expect(routeFor({ id: "a1", assetId: "as-9", lat: 1, lon: 2 }).action).toBe("asset")
        const s = routeFor({ eventId: "HEAT-123", lat: 48.85, lon: 2.32, headline: "Fire" })
        expect(s).toMatchObject({ action: "signal", alertId: "HEAT-123", lat: 48.85, lon: 2.32, title: "Fire" })
        expect(s.mmsi).toBeNull()
        // a vessel that is not of concern (an entity id on another alert type) stays a signal
        expect(routeFor({ id: "x", alert_type: "Heat", entity_id: "273123456" }).action).toBe("signal")
    })
    it("normalises the surface's sig- prefix and missing places", () => {
        expect(normalizeOpen({ id: "sig-ABC", lat: null, lon: undefined })).toMatchObject({ alertId: "ABC", lat: null, lon: null })
    })
})

describe("parseOpenParams — the app opened cold from a notification", () => {
    it("reads a vessel link", () => {
        const p = parseOpenParams(`?signal=${VESSEL_ID}&focus=59.85%2C25.57&vessel=667002574&h=VIXENA`)
        expect(p).toMatchObject({ id: VESSEL_ID, lat: 59.85, lon: 25.57, mmsi: "667002574", alertType: TYPE, title: "VIXENA" })
        expect(routeFor(p)).toMatchObject({ action: "vessel", mmsi: "667002574" })
    })
    it("reads the old links unchanged", () => {
        expect(parseOpenParams("?signal=a&focus=48.85,2.32")).toMatchObject({ id: "a", lat: 48.85, lon: 2.32, mmsi: null, alertType: null })
        expect(parseOpenParams("?signal=live%3Ak&live=k")).toMatchObject({ id: "live:k", livestreamId: "k" })
        expect(parseOpenParams("?foo=1")).toBeNull()
        expect(parseOpenParams("")).toBeNull()
    })
    it("ignores a vessel param that is not an MMSI", () => {
        expect(parseOpenParams("?signal=a&vessel=<script>").mmsi).toBeNull()
    })
})

describe("openSignal — one route for every entry point", () => {
    beforeEach(() => __resetSignalSurfaces())

    it("opens the vessel at once, without a lookup", async () => {
        const fetcher = vi.fn()
        setAlertFetcher(fetcher)
        const seen = []
        setSignalSurface((r) => seen.push(r))
        await openSignal({ eventId: VESSEL_ID, mmsi: "667002574", alertType: TYPE })
        expect(seen).toHaveLength(1)
        expect(seen[0].action).toBe("vessel")
        expect(fetcher).not.toHaveBeenCalled()
    })
    it("looks an unknown alert up and opens the vessel when that is what it is", async () => {
        setAlertFetcher(async (path) => {
            expect(path).toBe("/api/alerts/A-77")
            return { alert_id: "A-77", alert_type: TYPE, entity_id: "273123456", lat: 59.4, lon: 24.7, title: "T", raw_json: {} }
        })
        const seen = []
        setSignalSurface((r) => seen.push(r))
        await openSignal({ eventId: "A-77" })
        expect(seen[0]).toMatchObject({ action: "vessel", mmsi: "273123456", lat: 59.4, lon: 24.7, title: "T" })
    })
    it("keeps any other alert a signal (and a failed lookup changes nothing)", async () => {
        setAlertFetcher(async () => { throw new Error("404") })
        const seen = []
        setSignalSurface((r) => seen.push(r))
        await openSignal({ eventId: "HEAT-1", lat: 1, lon: 2 })
        expect(seen[0]).toMatchObject({ action: "signal", alertId: "HEAT-1", lat: 1, lon: 2 })
    })
    it("does not look up what cannot be an alert", () => {
        expect(lookupId(normalizeOpen({ id: "chan/123" }))).toBeNull()
        expect(lookupId(normalizeOpen({ id: "gc:9" }))).toBeNull()
        expect(lookupId(normalizeOpen({ id: "more:x" }))).toBeNull()
        expect(lookupId(normalizeOpen({ id: "HEAT-1" }))).toBe("HEAT-1")
    })
    it("holds a notification opened before the app is up, and opens it on the surface that arrives (the last registered wins)", async () => {
        setAlertFetcher(null)
        await openSignal({ id: VESSEL_ID })
        const desktop = vi.fn(), phone = vi.fn()
        setSignalSurface(desktop)
        await new Promise((r) => setTimeout(r, 0))
        expect(desktop).toHaveBeenCalledWith(expect.objectContaining({ action: "vessel", mmsi: "667002574" }))
        const off = setSignalSurface(phone)
        await openSignal({ id: "HEAT-2", alertType: "Heat" })
        expect(phone).toHaveBeenCalledWith(expect.objectContaining({ action: "signal" }))
        off()
        await openSignal({ id: "HEAT-3", alertType: "Heat" })
        expect(desktop).toHaveBeenLastCalledWith(expect.objectContaining({ alertId: "HEAT-3" }))
    })
})

describe("routeFor — an imagery finding opens on its boxes (2026-10-12)", () => {
    it("a border-sweep push (Imagery signal, entity = the zone) routes to the finding", () => {
        const r = routeFor({ eventId: "ALRT-9", alertType: "Imagery signal", entity_type: "sweep_finding", entity_id: "ZONE-061",
                             lat: 52.0, lon: 29.2, headline: "Possible new vehicle or tent concentration 16 km inside Belarus" })
        expect(r).toMatchObject({ action: "finding", zoneId: "ZONE-061", alertId: "ALRT-9" })
    })
    it("a radar change is recognised from its RCHG id alone", () => {
        expect(routeFor({ id: "RCHG-ZONE-005-2026-10-11" })).toMatchObject({ action: "finding", zoneId: "ZONE-005" })
    })
    it("an imagery signal without its zone looks the alert up, and finds it there", async () => {
        __resetSignalSurfaces()
        const seen = []
        setSignalSurface((x) => seen.push(x))
        setAlertFetcher(async () => ({ alert_id: "IMG-1", alert_type: "Imagery signal", entity_type: "vessel",
                                       raw_json: { zone_id: "ZONE-016", scan_id: "S1", kind: "naval_movement" } }))
        const r = await openSignal({ id: "IMG-1", alertType: "Imagery signal" })
        expect(r).toMatchObject({ action: "finding", zoneId: "ZONE-016" })
        expect(seen[0].alert.raw_json.scan_id).toBe("S1")
    })
    it("heat stays a plain signal", () => {
        expect(routeFor({ eventId: "HEAT-1", alertType: "Heat", lat: 1, lon: 2 }).action).toBe("signal")
    })
})
