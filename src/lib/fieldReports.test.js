// @vitest-environment jsdom
// User reports on the client (lib/fieldReports.js) and their marker (lib/mapIcons.js reportIcon).
import { describe, it, expect, vi, afterEach } from "vitest"
import {
    KIND_LIST, EXPIRY_CHIPS, buildReportBody, cleanHours, defaultExpiryH, reportActive, expiryWords, whenWords,
    reportLines, reportFeatures, mediaUrl, listReports, createReport, endReport, CHANGED_EVENT,
} from "./fieldReports.js"
import { reportIcon, reportMarker, REPORT_KINDS, markerIcon, svgOf, STATES } from "./mapIcons.js"
import { liveSignalDrawn } from "./liveSignals.js"
import { protestState } from "./protests.js"

const NOW = Date.parse("2026-10-24T12:00:00Z")
const R = { id: "fr_1", kind: "police", title: "Police at République", lat: 48.8674, lon: 2.3636, place: "Place de la République",
            occurred_at: "2026-10-24T11:50:00Z", expires_at: "2026-10-24T13:30:00Z", ended_at: null,
            author: { id: "ana", name: "Ana" }, label: "Reported by Ana, unverified", mine: true, media: [] }

afterEach(() => { vi.unstubAllGlobals() })

describe("reportIcon", () => {
    it("draws every kind with its glyph and the dashed 'user' edge", () => {
        expect(Object.keys(REPORT_KINDS)).toEqual(["police", "crowd", "clashes", "roadblock", "fire", "explosion", "shots", "other"])
        for (const k of Object.keys(REPORT_KINDS)) {
            const uri = reportIcon(k)
            expect(uri.startsWith("data:image/svg+xml")).toBe(true)
            expect(svgOf(uri)).toContain('stroke-dasharray="2.2 1.6"')
        }
        expect(reportIcon("nonsense")).toBe(reportIcon("other"))
        expect(reportIcon("police")).not.toBe(reportIcon("crowd"))
        expect(reportMarker("fire").w).toBe(24)
    })
    it("is the one typology's 'user' state", () => {
        expect(STATES).toContain("user")
        expect(markerIcon({ kind: "event", glyph: "police", state: "user" }).uri).toBe(reportIcon("police"))
        expect(svgOf(markerIcon({ kind: "event", glyph: "roadblock" }).uri)).toContain("M7 12h18v6H7z")
    })
})

describe("the form's helpers", () => {
    it("lists the kinds with labels and default expiry", () => {
        expect(KIND_LIST.map((k) => k.kind)).toEqual(Object.keys(REPORT_KINDS))
        expect(KIND_LIST.find((k) => k.kind === "police")).toMatchObject({ label: "Police", expiryH: 2 })
        expect(defaultExpiryH("crowd")).toBe(3)
        expect(EXPIRY_CHIPS).toEqual([1, 2, 6, 12, 24])
    })
    it("cleans hours and caps them", () => {
        expect(cleanHours("12")).toBe(12)
        expect(cleanHours("1,5")).toBe(1.5)
        expect(cleanHours(500)).toBe(72)
        expect(cleanHours("")).toBe(null)
        expect(cleanHours(-1)).toBe(null)
    })
    it("builds the POST body, with a default title and expiry", () => {
        const b = buildReportBody({ kind: "police", lat: 48.86741234567, lon: 2.3636, place: "Place de la République, Paris" })
        expect(b).toEqual({ kind: "police", title: "Police at Place de la République, Paris", lat: 48.867412, lon: 2.3636,
                            expires_in_h: 2, audience: "company", place: "Place de la République, Paris" })
        const c = buildReportBody({ kind: "crowd", lat: 1, lon: 2, expiresInH: 12, note: " big ", audience: "everyone", media: [{ path: "a/b.jpg", type: "image" }] })
        expect(c).toMatchObject({ expires_in_h: 12, note: "big", audience: "everyone", media: [{ path: "a/b.jpg", type: "image" }] })
        expect(() => buildReportBody({ lat: 1, lon: 2 })).toThrow(/what you saw/)
        expect(() => buildReportBody({ kind: "fire" })).toThrow(/pin/)
        expect(() => buildReportBody({ kind: "fire", lat: 1, lon: 2, expiresInH: "soon" })).toThrow(/hours/)
    })
})

describe("reading a report", () => {
    it("is active until it expires or ends", () => {
        expect(reportActive(R, NOW)).toBe(true)
        expect(reportActive(R, Date.parse("2026-10-24T13:31:00Z"))).toBe(false)
        expect(reportActive({ ...R, ended_at: "2026-10-24T11:59:00Z" }, NOW)).toBe(false)
    })
    it("says who, when and the expiry in words", () => {
        expect(whenWords(R.occurred_at, NOW)).toBe("10 min ago")
        expect(expiryWords(R, NOW)).toBe("Expires in 1 h 30 min")
        expect(expiryWords({ ...R, ended_at: "x" }, NOW)).toBe("Ended")
        expect(expiryWords(R, Date.parse("2026-10-25T00:00:00Z"))).toBe("Expired")
        expect(reportLines(R, NOW)).toEqual({ title: "Police at République", who: "Reported by Ana, unverified", when: "10 min ago", expiry: "Expires in 1 h 30 min" })
    })
    it("makes the phone map's features, dropping expired ones", () => {
        const f = reportFeatures([R, { ...R, id: "fr_2", expires_at: "2026-10-24T11:00:00Z" }], NOW)
        expect(f).toHaveLength(1)
        expect(f[0]).toMatchObject({ id: "fr-fr_1", lat: 48.8674, iconUri: reportIcon("police"), collide: true })
        expect(f[0].raw).toMatchObject({ kind: "field_report", report_kind: "police", layerLabel: "User report" })
    })
    it("gives the server's media paths the API base", () => {
        expect(mediaUrl({ url: "https://x.org/a.jpg" })).toBe("https://x.org/a.jpg")
        expect(mediaUrl({ url: "/api/field-reports/fr_1/media/0" })).toMatch(/\/api\/field-reports\/fr_1\/media\/0$/)
    })
    it("is never drawn twice: the live-signal layers leave user reports to the User reports layer", () => {
        expect(liveSignalDrawn({ source_kind: "user", act: "police_intervention", event_time: new Date().toISOString() })).toBe(false)
        expect(protestState({ source_kind: "user", kind: "police", frame: "live" })).toBe("user")
    })
})

describe("the api", () => {
    it("lists, creates and ends, and tells the maps", async () => {
        const calls = []
        vi.stubGlobal("fetch", vi.fn(async (url, opts = {}) => {
            calls.push([url, opts.method || "GET", opts.body])
            return { ok: true, json: async () => (String(url).endsWith("/end") ? { ...R, ended_at: "now" } : url.includes("?") || opts.method ? R : { reports: [R] }) }
        }))
        const heard = vi.fn()
        window.addEventListener(CHANGED_EVENT, heard)
        expect(await listReports()).toEqual([R])
        await createReport({ kind: "police", lat: 1, lon: 2 })
        await endReport("fr_1")
        window.removeEventListener(CHANGED_EVENT, heard)
        expect(calls.map((c) => [c[0].replace(/^.*\/api/, "/api"), c[1]])).toEqual([
            ["/api/field-reports", "GET"], ["/api/field-reports", "POST"], ["/api/field-reports/fr_1/end", "POST"]])
        expect(heard).toHaveBeenCalledTimes(2)
    })
    it("throws the server's words", async () => {
        vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ detail: "kind must be one of police, crowd" }) })))
        await expect(createReport({})).rejects.toThrow("kind must be one of police, crowd")
    })
})
