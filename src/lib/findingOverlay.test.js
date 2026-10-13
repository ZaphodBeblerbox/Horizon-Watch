import { describe, it, expect, beforeEach, vi } from "vitest"
import {
    b64Mime, overlayFinding, overlayKey, viewsFor, leafletImageBounds, cesiumRectDegrees, coversFindings, clampOpacity,
    subscribeOverlay, getOverlay, setOverlayView, setOverlayOpacity, loadOverlayRadar, overlayUrl, __setOverlayDeps, __resetOverlay,
} from "./findingOverlay.js"
import { showFindings, clearFindings } from "./findings.js"
import { showSignalPin, getSignalPin, closeOpenedSignal, isOpenedSignal } from "./signalPin.js"

const BOUNDS = [38.19, 48.452, 38.244, 48.488]
const radarF = (id, box) => ({ id, kind: "radar_change", scan_id: "S-R", zone_id: "ZONE-005", box, label: "x", lat: box[1], lon: box[0] })
const opticalF = { id: "obj:1", kind: "vehicle", scan_id: "S-O", zone_id: "ZONE-016", box: [10.1, 50.1, 10.2, 50.2], lat: 50.15, lon: 10.15 }
const flush = () => new Promise((r) => setTimeout(r, 0))

describe("the overlay's pure helpers", () => {
    it("tells PNG from JPEG", () => {
        expect(b64Mime("iVBORw0KGgo")).toBe("image/png")
        expect(b64Mime("/9j/4AAQ")).toBe("image/jpeg")
        expect(b64Mime("")).toBe("image/png")
    })
    it("lays down the image of the finding in focus, else a radar one, else any with a scan", () => {
        const a = radarF("a", [38.2, 48.46, 38.21, 48.47])
        expect(overlayFinding({ findings: [opticalF, a] }).id).toBe("a")
        expect(overlayFinding({ findings: [opticalF, a], focusId: "obj:1" }).id).toBe("obj:1")
        expect(overlayFinding({ findings: [{ id: "n", box: [0, 0, 1, 1] }] })).toBeNull()
        expect(overlayKey({ zoneId: "ZONE-005", findings: [a] })).toBe("ZONE-005|radar:S-R")
        expect(overlayKey({ zoneId: "ZONE-016", findings: [opticalF] })).toBe("ZONE-016|scene:S-O")
    })
    it("a notification's own pass (shown.scanId) wins over the zone's other passes", () => {
        const a = radarF("a", [38.2, 48.46, 38.21, 48.47])
        const mine = { ...opticalF, id: "obj:2", scan_id: "S-MINE" }
        // the zone's list holds a radar comparison too; the notification was about the optical pass
        expect(overlayFinding({ findings: [a, opticalF, mine], scanId: "S-MINE" }).id).toBe("obj:2")
        // none of the boxes is from that pass (a signal about something gone): the pass by itself
        const bare = overlayFinding({ zoneId: "ZONE-016", findings: [a, opticalF], scanId: "S-GONE", scanKind: "scene" })
        expect(bare).toMatchObject({ scan_id: "S-GONE", kind: "scene", zone_id: "ZONE-016" })
        expect(overlayKey({ zoneId: "ZONE-016", findings: [a], scanId: "S-GONE", scanKind: "scene" })).toBe("ZONE-016|scene:S-GONE")
        expect(overlayKey({ zoneId: "ZONE-005", findings: [opticalF], scanId: "S-R2", scanKind: "radar" })).toBe("ZONE-005|radar:S-R2")
        // the focus still decides first
        expect(overlayFinding({ findings: [a, mine], scanId: "S-MINE", focusId: "a" }).id).toBe("a")
    })
    it("bounds: Leaflet [[s, w], [n, e]], Cesium degrees, and a broken box refused", () => {
        expect(leafletImageBounds(BOUNDS)).toEqual([[48.452, 38.19], [48.488, 38.244]])
        expect(leafletImageBounds({ min_lon: 38.19, min_lat: 48.452, max_lon: 38.244, max_lat: 48.488 })).toEqual([[48.452, 38.19], [48.488, 38.244]])
        expect(cesiumRectDegrees(BOUNDS)).toEqual({ west: 38.19, south: 48.452, east: 38.244, north: 48.488 })
        expect(leafletImageBounds([1, 2, 0, 3])).toBeNull()
        expect(cesiumRectDegrees(null)).toBeNull()
    })
    it("the image covers the boxes drawn on it", () => {
        expect(coversFindings(BOUNDS, [radarF("a", [38.2, 48.46, 38.21, 48.47])])).toBe(true)
        expect(coversFindings(BOUNDS, [radarF("b", [38.3, 48.46, 38.31, 48.47])])).toBe(false)
    })
    it("views only for the images there are; opacity kept in 0..1", () => {
        expect(viewsFor({ status: "ready", kind: "radar", layers: { after: "x", before: "y", change: "z" } }).map((v) => v[1])).toEqual(["after", "before", "change"])
        expect(viewsFor({ status: "ready", kind: "optical", layers: { after: "x", before: null } }).map((v) => v[1])).toEqual(["after"])
        expect(viewsFor({ status: "missing", kind: "radar" })).toEqual([])
        expect(clampOpacity(2)).toBe(1)
        expect(clampOpacity(-1)).toBe(0)
        expect(clampOpacity("x")).toBe(0.85)
    })
})

describe("the overlay follows the findings on show", () => {
    beforeEach(() => { clearFindings(); __resetOverlay() })

    it("a radar finding: its After image at the comparison's bounds; switch, fade, and gone when the findings are cleared", async () => {
        __setOverlayDeps({
            radar: vi.fn(async () => ({ status: "ready", bounds: BOUNDS, after_b64: "iVBORa", before_b64: "iVBORb", change_b64: "iVBORc" })),
        })
        const seen = []
        const off = subscribeOverlay((s) => seen.push(s))
        showFindings({ zoneId: "ZONE-005", findings: [radarF("a", [38.2, 48.46, 38.21, 48.47])], alertId: "RCHG-ZONE-005-2026-10-11" })
        expect(getOverlay().status).toBe("loading")
        await flush()
        const ov = getOverlay()
        expect(ov).toMatchObject({ status: "ready", kind: "radar", bounds: BOUNDS, view: "after", opacity: 0.85 })
        expect(overlayUrl("after")).toMatch(/^(blob:|data:image\/png;base64,iVBORa)/)
        setOverlayView("change")
        expect(getOverlay().view).toBe("change")
        setOverlayView("nonsense")
        expect(getOverlay().view).toBe("change")
        setOverlayOpacity(0.4)
        expect(getOverlay().opacity).toBe(0.4)
        clearFindings()
        expect(getOverlay()).toBeNull()
        expect(seen[seen.length - 1]).toBeNull()
        expect(overlayUrl("after")).toBeNull()
        off()
    })
    it("radar images not kept: says so, and loads them on request", async () => {
        let ready = false
        const start = vi.fn(async () => { ready = true; return { status: "running" } })
        __setOverlayDeps({
            radar: async () => (ready ? { status: "ready", bounds: BOUNDS, after_b64: "iVBORa" }
                : { status: "missing", regenerable: true, requests: 10, why: "ran before its images were kept" }),
            start, pollMs: 1,
        })
        subscribeOverlay(() => {})
        showFindings({ zoneId: "ZONE-005", findings: [radarF("a", [38.2, 48.46, 38.21, 48.47])] })
        await flush()
        expect(getOverlay()).toMatchObject({ status: "missing", regenerable: true, requests: 10 })
        await loadOverlayRadar()
        expect(start).toHaveBeenCalledWith("ZONE-005", "S-R")
        expect(getOverlay()).toMatchObject({ status: "ready", kind: "radar" })
    })
    it("an optical finding: the pass and the previous one over the zone's bbox", async () => {
        __setOverlayDeps({
            scene: async () => ({ image_b64: "/9j/a", reference_image_b64: "/9j/b", scan: { image_timestamp_utc: "2026-10-10T10:00:00Z" } }),
            zone: async () => ({ bbox: { min_lon: 10, min_lat: 50, max_lon: 10.5, max_lat: 50.5 } }),
        })
        subscribeOverlay(() => {})
        showFindings({ zoneId: "ZONE-016", findings: [opticalF] })
        await flush(); await flush()
        expect(getOverlay()).toMatchObject({ status: "ready", kind: "optical", bounds: [10, 50, 10.5, 50.5] })
        expect(viewsFor(getOverlay()).map((v) => v[1])).toEqual(["after", "before"])
    })
    it("opened from a notification: that pass's image is fetched, not another of the zone's", async () => {
        const scene = vi.fn(async () => ({ image_b64: "/9j/a", reference_image_b64: "/9j/b" }))
        const radar = vi.fn(async () => ({ status: "ready", bounds: BOUNDS, after_b64: "iVBORa" }))
        __setOverlayDeps({ scene, radar, zone: async () => { throw new Error("not needed: the zone came with the findings") } })
        subscribeOverlay(() => {})
        showFindings({ zoneId: "ZONE-016", findings: [radarF("a", [38.2, 48.46, 38.21, 48.47]), opticalF], scanId: "S-O", scanKind: "scene",
                       zone: { bbox: { min_lon: 10, min_lat: 50, max_lon: 10.5, max_lat: 50.5 } } })
        await flush(); await flush()
        expect(radar).not.toHaveBeenCalled()
        expect(scene).toHaveBeenCalledWith("S-O")
        expect(getOverlay()).toMatchObject({ status: "ready", kind: "optical", scanId: "S-O", bounds: [10, 50, 10.5, 50.5] })
        expect(viewsFor(getOverlay()).map((v) => v[1])).toEqual(["after", "before"])
    })
    it("a stale answer for findings already replaced is dropped", async () => {
        let release
        __setOverlayDeps({ radar: () => new Promise((r) => { release = r }) })
        subscribeOverlay(() => {})
        showFindings({ zoneId: "ZONE-005", findings: [radarF("a", [38.2, 48.46, 38.21, 48.47])] })
        clearFindings()
        release({ status: "ready", bounds: BOUNDS, after_b64: "iVBORa" })
        await flush()
        expect(getOverlay()).toBeNull()
    })
})

describe("closing the opened signal clears what it drew", () => {
    beforeEach(() => { clearFindings(); showSignalPin(null) })
    it("its marker, only when it is the one on show", () => {
        showSignalPin({ id: "GC-1", alertId: "GC-1", lat: 46.47, lon: 30.71, title: "Odesa" })
        expect(isOpenedSignal("GC-1")).toBe(true)
        closeOpenedSignal("other")
        expect(getSignalPin()).not.toBeNull()
        closeOpenedSignal("sig-GC-1")
        expect(getSignalPin()).toBeNull()
    })
    it("its boxes (and so the image under them)", () => {
        showFindings({ zoneId: "ZONE-005", findings: [radarF("a", [38.2, 48.46, 38.21, 48.47])], alertId: "RCHG-ZONE-005-2026-10-11" })
        closeOpenedSignal("RCHG-ZONE-005-2026-10-11")
        expect(isOpenedSignal()).toBe(false)
    })
    it("a marker without a place is no marker", () => {
        expect(showSignalPin({ id: "x", lat: null, lon: 2 })).toBeNull()
    })
})

describe("a failed image can be asked for again", () => {
    beforeEach(() => { clearFindings(); __resetOverlay() })
    it("failed → Try again → ready", async () => {
        let n = 0
        __setOverlayDeps({ radar: async () => { n += 1; if (n === 1) throw new Error("the server did not respond within 30s"); return { status: "ready", bounds: BOUNDS, after_b64: "iVBORa" } } })
        const { retryOverlay } = await import("./findingOverlay.js")
        subscribeOverlay(() => {})
        showFindings({ zoneId: "ZONE-005", findings: [radarF("a", [38.2, 48.46, 38.21, 48.47])] })
        await flush()
        expect(getOverlay()).toMatchObject({ status: "failed", why: "the server did not respond within 30s" })
        retryOverlay()
        await flush()
        expect(getOverlay()).toMatchObject({ status: "ready" })
    })
})
