import { describe, expect, it } from "vitest"
import {
    arrowCoords, bearing, circleRing, exitBar, metres, offset, policeDetail, policeFeatures, reportAlpha, tacticIcon,
} from "./policeActions.js"

const NOW = Date.parse("2026-10-18T16:00:00Z")
const REPU = { lat: 48.8674, lon: 2.3636 }
const src = (text, extra = {}) => ({ channel: "GJ2026IDF", channel_title: "GJ 2026 IDF", msg_id: 1, hhmm: "17:55", text,
                                     translation: "Tear gas is being fired at Place de la République.", url: "https://t.me/GJ2026IDF/1", media: "none", ...extra })

describe("geometry helpers", () => {
    it("offset moves the given distance on the given bearing", () => {
        const [la, lo] = offset(REPU.lat, REPU.lon, 90, 200)
        expect(metres(REPU.lat, REPU.lon, la, lo)).toBeGreaterThan(195)
        expect(metres(REPU.lat, REPU.lon, la, lo)).toBeLessThan(205)
        expect(Math.round(bearing(REPU.lat, REPU.lon, la, lo))).toBe(90)
    })
    it("circleRing is closed and at the radius", () => {
        const ring = circleRing(REPU.lat, REPU.lon, 120, 24)
        expect(ring).toHaveLength(25)
        expect(ring[0]).toEqual(ring[24])
        for (const [la, lo] of ring) expect(Math.abs(metres(REPU.lat, REPU.lon, la, lo) - 120)).toBeLessThan(2)
    })
    it("exitBar crosses the street: perpendicular to its axis, centred on the exit", () => {
        const exit = { lat: 48.869, lon: 2.3625, bearing: 330, axis: 330 }
        const [a, b] = exitBar(exit, 22)
        expect(metres(a[0], a[1], b[0], b[1])).toBeGreaterThan(42)
        const across = bearing(a[0], a[1], b[0], b[1])
        const d = Math.abs(((across - 330 + 540) % 360) - 180)
        expect(Math.abs(d - 90)).toBeLessThan(2)
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
        expect(metres(mid[0], mid[1], exit.lat, exit.lon)).toBeLessThan(1)
    })
    it("arrowCoords: a shaft ending at the place and two barbs behind its tip", () => {
        const from = { lat: 48.8705, lon: 2.3610 }
        const [shaft, head] = arrowCoords(from, REPU, 45)
        expect(shaft[1]).toEqual([REPU.lat, REPU.lon])
        expect(head[1]).toEqual([REPU.lat, REPU.lon])
        expect(metres(head[0][0], head[0][1], REPU.lat, REPU.lon)).toBeGreaterThan(40)
        // the barbs point back toward where the police came from
        expect(metres(head[0][0], head[0][1], from.lat, from.lon)).toBeLessThan(metres(REPU.lat, REPU.lon, from.lat, from.lon))
    })
    it("reportAlpha fades with age and ends at the report's life", () => {
        expect(reportAlpha(0, 60)).toBe(1)
        expect(reportAlpha(30, 60)).toBeCloseTo(0.65, 2)
        expect(reportAlpha(59, 60)).toBeGreaterThanOrEqual(0.3)
        expect(reportAlpha(61, 60)).toBe(0)
    })
    it("tacticIcon: a data-URI SVG with the words, no monospace", () => {
        const ic = tacticIcon("tear_gas", "Tear gas · 17:55")
        const svg = decodeURIComponent(ic.uri.split(",")[1])
        expect(svg).toContain("Tear gas · 17:55")
        expect(svg).not.toMatch(/mono/i)
        expect(ic.anchor).toEqual([14, 14])
    })
})

describe("policeFeatures", () => {
    const at = (min) => new Date(NOW - min * 60_000).toISOString()
    const data = { reports: [
        { id: "g", tactic: "tear_gas", title: "Tear gas used at Place de la République (Paris)", ...REPU, at: at(5), hhmm: "17:55",
          valid_min: 60, area: { radius_m: 140 }, sources: [src("ça gaze à Répu")] },
        { id: "k", tactic: "kettle", title: "Kettle at Place de la République (Paris) — exits blocked", ...REPU, at: at(10), hhmm: "17:50",
          valid_min: 120, label: "Kettled — exits blocked (reported 17:50)", exits_from: "osm",
          exits: [{ name: "Boulevard de Magenta", lat: 48.8689, lon: 2.3625, bearing: 330, axis: 330 },
                  { name: "Boulevard Voltaire", lat: 48.8662, lon: 2.3652, bearing: 135, axis: 135 },
                  { name: "Rue du Temple", lat: 48.8665, lon: 2.3620, bearing: 230, axis: 230 }],
          sources: [src("ça nasse à Répu")] },
        { id: "p", tactic: "police_arrival", title: "Police moving in at Place de la République (Paris) from Boulevard de Magenta",
          ...REPU, at: at(2), hhmm: "17:58", valid_min: 60, from: { lat: 48.8705, lon: 2.3610 }, from_place: "Boulevard de Magenta",
          sources: [src("les CRS arrivent par le bd Magenta", { media: "video" })] },
        { id: "old", tactic: "tear_gas", title: "Tear gas used at Bastille", lat: 48.8532, lon: 2.3692, at: at(90), valid_min: 60, sources: [] },
        { id: "nowhere", tactic: "arrests", title: "Arrests", lat: null, lon: null, at: at(1), valid_min: 90, sources: [] },
    ] }
    const f = policeFeatures(data, NOW)
    const byType = (t) => f.filter((x) => x.type === t)

    it("tear gas is an area with a fill for the globe", () => {
        const [a] = byType("police_area")
        expect(a.area.radius_m).toBe(140)
        expect(a.coords.length).toBeGreaterThan(20)
        expect(a.area.fill).toMatch(/^rgba\(/)
    })
    it("a kettle is one police line across each exit, with its label", () => {
        const [k] = byType("police_line")
        expect(k.coords).toHaveLength(3)
        const mark = f.find((x) => x.id === "pol-mark-k")
        expect(decodeURIComponent(mark.marker.iconUri)).toContain("Kettled — exits blocked (reported 17:50)")
    })
    it("police moving in is an arrow from the street they came by", () => {
        const [a] = byType("police_arrow")
        expect(a.coords).toHaveLength(2)
        expect(a.coords[0][1]).toEqual([REPU.lat, REPU.lon])
    })
    it("expired and unplaced reports are not drawn", () => {
        expect(f.some((x) => x.id.endsWith("-old"))).toBe(false)
        expect(f.some((x) => x.id.endsWith("-nowhere"))).toBe(false)
    })
    it("every feature opens a card quoting the post with its translation and link", () => {
        const mark = f.find((x) => x.id === "pol-mark-g")
        expect(mark.raw.kind).toBe("police_action")
        expect(mark.raw.detail).toContain("“ça gaze à Répu” — Tear gas is being fired at Place de la République.")
        expect(mark.raw.detail).toContain("https://t.me/GJ2026IDF/1")
        expect(mark.raw.url).toBe("https://t.me/GJ2026IDF/1")
    })
    it("older marks are fainter", () => {
        const g = f.find((x) => x.id === "pol-mark-g"), k = f.find((x) => x.id === "pol-mark-k")
        expect(g.alpha).toBeGreaterThan(k.alpha - 0.2)
        expect(f.find((x) => x.id === "pol-mark-p").alpha).toBeGreaterThan(g.alpha)
    })
    it("the card lists the closed exits", () => {
        const k = f.find((x) => x.id === "pol-mark-k")
        expect(policeDetail(k.raw)).toContain("Exits drawn closed: Boulevard de Magenta, Boulevard Voltaire, Rue du Temple.")
    })
    it("marks at one place stack instead of overlapping", () => {
        const anchors = ["pol-mark-k", "pol-mark-g", "pol-mark-p"].map((id) => f.find((x) => x.id === id).marker.iconAnchor[1])
        expect(new Set(anchors).size).toBe(3)
    })
    it("tolerates junk", () => {
        expect(policeFeatures(null)).toEqual([])
        expect(policeFeatures({ reports: [{ lat: "x" }, null].filter(Boolean) })).toEqual([])
    })
})
