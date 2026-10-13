import { describe, it, expect, vi } from "vitest"
import { alertStub, findingsForRoute, focusFindingId, scanOfAlert, showFor, signalPoint } from "./openFinding.js"
import { overlayKey } from "../lib/findingOverlay.js"

// Shaped as the alerts are stored (backend: the row's raw_json holds the
// alert as written, the producer's raw_json one level down).
const SMOKE = {
    alert_id: "ALT-588082D0", alert_type: "Imagery signal", entity_type: "smoke_plume", entity_id: "",
    title: "Rostock hafen: Black smoke plume, 2.0 km long", lat: 54.16694, lon: 12.10866,
    raw_json: { alert_type: "Imagery signal", raw_json: {
        scan_id: "S-ROS", zone_id: "ZONE-004", kind: "other", focus: "smoke_plume", instrument: "OPTICAL",
        reason: "A plume not there on the previous pass. Source 54.174803, 12.120955." } },
}
const RCHG = {
    alert_id: "RCHG-ZONE-005-2026-10-11", alert_type: "Imagery signal", entity_type: "radar_change", entity_id: "ZONE-005",
    lat: 48.460326, lon: 38.199789,
    raw_json: { raw_json: { scan_id: "S-R", zone_id: "ZONE-005", kind: "radar_change" } },
}
const f = (id, label, box, scan, kind = "object") => ({ id, label, kind, box, scan_id: scan, zone_id: "ZONE-004" })
const ROS = [
    f("det:fire", "New active fire", [12.10, 54.16, 12.101, 54.161], "S-ROS"),
    f("det:smoke-far", "New smoke plume", [12.05, 54.10, 12.06, 54.11], "S-ROS"),
    f("det:smoke", "New smoke plume", [12.115, 54.17, 12.125, 54.18], "S-ROS"),
    f("det:old-smoke", "New smoke plume", [12.12, 54.174, 12.122, 54.176], "S-OLD"),
]

describe("which pass and which box a finding notification is about", () => {
    it("the pass: optical scene or radar comparison", () => {
        expect(scanOfAlert(SMOKE)).toEqual({ scanId: "S-ROS", kind: "scene" })
        expect(scanOfAlert(RCHG)).toEqual({ scanId: "S-R", kind: "radar" })
        expect(scanOfAlert(alertStub({ alertId: "X", zoneId: "ZONE-1" }))).toBeNull()
    })
    it("the point: the source the reason names, else the alert's own", () => {
        expect(signalPoint(SMOKE)).toEqual({ lat: 54.174803, lon: 12.120955 })
        expect(signalPoint(RCHG)).toEqual({ lat: 48.460326, lon: 38.199789 })
        expect(signalPoint({})).toBeNull()
    })
    it("the box: the kind it names, of its own pass, nearest its point", () => {
        // not the fire (another kind), not the older pass's plume, not the far plume
        expect(focusFindingId(ROS, SMOKE)).toBe("det:smoke")
    })
    it("a radar change: the box holding the alert's point", () => {
        const rs = [
            { id: "chg:1", kind: "radar_change", label: "Radar change — new bright returns", box: [38.21, 48.47, 38.22, 48.48], scan_id: "S-R" },
            { id: "chg:2", kind: "radar_change", label: "Radar change — returns gone (darker)", box: [38.198558, 48.459714, 38.20121, 48.460759], scan_id: "S-R" },
        ]
        expect(focusFindingId(rs, RCHG)).toBe("chg:2")
    })
    it("nothing to go on: no focus rather than a guess", () => {
        const stub = alertStub({ alertId: "ALT-1", zoneId: "ZONE-004" })
        expect(focusFindingId(ROS, stub)).toBeNull()
        expect(focusFindingId([], SMOKE)).toBeNull()
    })
    it("what is put on show names the pass, so its own image is laid down", () => {
        const s = showFor({ zoneId: "ZONE-004", findings: ROS, zone: { bbox: { min_lon: 12 } } }, SMOKE)
        expect(s).toMatchObject({ zoneId: "ZONE-004", focusId: "det:smoke", scanId: "S-ROS", scanKind: "scene" })
        expect(overlayKey(s)).toBe("ZONE-004|scene:S-ROS")
    })
})

describe("findingsForRoute: the alert row first, as on the desktop", () => {
    it("the route came without the row (openSignal's 1.5 s lookup lost the race): it is fetched, and the zone and pass come from it", async () => {
        const fetchAlert = vi.fn(async () => SMOKE)
        const forAlert = vi.fn(async (a) => ({ zoneId: "ZONE-004", findings: a === SMOKE ? ROS : [], zone: null }))
        const r = { action: "finding", alertId: "ALT-588082D0", id: "ALT-588082D0", alertType: "Imagery signal", zoneId: null, title: "Smoke" }
        const { alert, show } = await findingsForRoute(r, { fetchAlert, forAlert })
        expect(fetchAlert).toHaveBeenCalledWith("ALT-588082D0")
        expect(forAlert).toHaveBeenCalledWith(SMOKE)
        expect(alert).toBe(SMOKE)
        expect(show).toMatchObject({ zoneId: "ZONE-004", scanId: "S-ROS", focusId: "det:smoke" })
        expect(show.findings).toHaveLength(4)
    })
    it("a radar change's id names the zone, so openSignal never looked it up: still fetched, for its pass", async () => {
        const fetchAlert = vi.fn(async () => RCHG)
        const forAlert = vi.fn(async () => ({ zoneId: "ZONE-005", findings: [], zone: null }))
        const { show } = await findingsForRoute({ action: "finding", alertId: RCHG.alert_id, zoneId: "ZONE-005" }, { fetchAlert, forAlert })
        expect(fetchAlert).toHaveBeenCalledOnce()
        expect(show).toMatchObject({ scanId: "S-R", scanKind: "radar" })
    })
    it("the route already carries the row: not fetched again", async () => {
        const fetchAlert = vi.fn()
        const forAlert = vi.fn(async () => ({ zoneId: "ZONE-004", findings: ROS }))
        await findingsForRoute({ action: "finding", alertId: "ALT-588082D0", alert: SMOKE }, { fetchAlert, forAlert })
        expect(fetchAlert).not.toHaveBeenCalled()
        expect(forAlert).toHaveBeenCalledWith(SMOKE)
    })
    it("the lookup fails: what the route carried is used", async () => {
        const forAlert = vi.fn(async (a) => ({ zoneId: a.raw_json.zone_id, findings: [] }))
        const { alert, show } = await findingsForRoute({ action: "finding", alertId: "ALT-9", zoneId: "ZONE-004", title: "x" },
            { fetchAlert: async () => { throw new Error("offline") }, forAlert })
        expect(alert).toMatchObject({ alert_id: "ALT-9", raw_json: { zone_id: "ZONE-004" } })
        expect(show).toMatchObject({ zoneId: "ZONE-004", findings: [], scanId: null })
    })
    it("an id that is not an alert row is not looked up", async () => {
        const fetchAlert = vi.fn()
        await findingsForRoute({ action: "finding", alertId: "N-abc", zoneId: "ZONE-1" }, { fetchAlert, forAlert: async () => ({ findings: [] }) })
        expect(fetchAlert).not.toHaveBeenCalled()
    })
})
