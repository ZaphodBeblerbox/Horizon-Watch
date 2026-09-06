import { describe, it, expect, vi, beforeEach } from "vitest"

// This suite runs under vitest's "node" environment (no jsdom, confirmed
// via project config) — sessionStore.js's real applySession()/applyView()
// dispatch real window events (the same akili:restore-tabs channel
// app.jsx already listens on live in the browser). A real, minimal
// EventTarget stands in for `window` here so those dispatches are real
// function calls, not undefined-reference crashes — this does not change
// anything about the code under test, only makes `window` exist.
if (typeof globalThis.window === "undefined") {
    globalThis.window = new EventTarget()
    globalThis.window.location = { hostname: "localhost" }
}

// Mock every real module sessionStore.js orchestrates, so this test
// exercises the real capture/apply LOGIC (which fields go where) without
// needing a live Cesium viewer, a live Situation.jsx, or a live backend.
vi.mock("../globe/cameraState.js", () => ({
    getCameraState: vi.fn(),
    restoreCameraState: vi.fn(),
}))
vi.mock("../state/situationFilterState.js", () => ({
    getFilterState: vi.fn(),
    restoreFilterState: vi.fn(),
}))
vi.mock("./briefingBasket.js", () => ({
    getBriefingItems: vi.fn(() => []),
    clearBriefing: vi.fn(),
    addToBriefing: vi.fn(),
}))

describe("sessionStore — real capture/apply orchestration (V3 Phase 1, §5.1/§5.2)", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        localStorage?.clear?.()
    })

    it("captureCurrentSession() pulls real state from every real owner — filters, camera, basket", async () => {
        const { getFilterState } = await import("../state/situationFilterState.js")
        const { getCameraState } = await import("../globe/cameraState.js")
        const { getBriefingItems } = await import("./briefingBasket.js")

        getFilterState.mockReturnValue({
            severityFloor: "moderate", timeWindow: "7d",
            groupsOn: { conflict: true, maritime: false, cyber: true },
            contextOn: { risk: true }, tracksOn: { vessels: true },
        })
        getCameraState.mockReturnValue({ lon: 45, lat: 25, height: 250000, heading: 0, pitch: -90, roll: 0 })
        getBriefingItems.mockReturnValue([{ id: "sig:ALT-1", label: "x" }, { id: "sig:ALT-2", label: "y" }])

        const { captureCurrentSession } = await import("./sessionStore.js")
        const captured = captureCurrentSession()

        expect(captured.severity_floor).toBe("moderate")
        expect(captured.time_window).toBe("7d")
        expect(captured.domains.sort()).toEqual(["conflict", "cyber"]) // only the ON ones
        expect(captured.context_layers).toEqual({ risk: true })
        expect(captured.track_layers).toEqual({ vessels: true })
        expect(captured.camera).toEqual({ lon: 45, lat: 25, height: 250000, heading: 0, pitch: -90, roll: 0 })
        expect(captured.basket).toEqual(["sig:ALT-1", "sig:ALT-2"])
    })

    it("applySession() restores filters, camera, tabs, AND basket atomically — not just filters", async () => {
        const { restoreFilterState } = await import("../state/situationFilterState.js")
        const { restoreCameraState } = await import("../globe/cameraState.js")
        const { clearBriefing, addToBriefing } = await import("./briefingBasket.js")
        const { applySession } = await import("./sessionStore.js")

        const dispatchSpy = vi.spyOn(window, "dispatchEvent")

        const session = {
            severity_floor: "high", time_window: "24h",
            domains: ["maritime"], context_layers: { risk: true }, track_layers: { vessels: true },
            camera: { lon: 10, lat: 20, height: 500000, heading: 0, pitch: -90, roll: 0 },
            tabs: [{ id: "t1", type: "situation" }, { id: "t2", type: "dossiers", recordRef: "ent:SZONE-011" }],
            basket: ["sig:ALT-9"],
        }
        applySession(session)

        expect(restoreFilterState).toHaveBeenCalledWith(expect.objectContaining({
            severityFloor: "high", timeWindow: "24h", groupsOn: { maritime: true },
            contextOn: { risk: true }, tracksOn: { vessels: true },
        }))
        expect(restoreCameraState).toHaveBeenCalledWith(session.camera)
        expect(clearBriefing).toHaveBeenCalled()
        expect(addToBriefing).toHaveBeenCalledWith("sig:ALT-9", "sig:ALT-9")

        const tabEvent = dispatchSpy.mock.calls.map((c) => c[0]).find((e) => e.type === "akili:restore-tabs")
        expect(tabEvent).toBeTruthy()
        expect(tabEvent.detail.tabs).toEqual(session.tabs)
        expect(tabEvent.detail.activeTabId).toBe("t2")
    })

    it("applyView() changes ONLY filter-level state — never dispatches a tab restore or touches the basket", async () => {
        const { restoreFilterState } = await import("../state/situationFilterState.js")
        const { restoreCameraState } = await import("../globe/cameraState.js")
        const { clearBriefing } = await import("./briefingBasket.js")
        const { applyView } = await import("./sessionStore.js")

        const dispatchSpy = vi.spyOn(window, "dispatchEvent")
        const view = { severity_floor: "critical", time_window: "24h", domains: ["cyber"], context_layers: { labels: true } }
        applyView(view)

        expect(restoreFilterState).toHaveBeenCalledWith(expect.objectContaining({
            severityFloor: "critical", timeWindow: "24h", groupsOn: { cyber: true }, contextOn: { labels: true },
        }))
        expect(restoreCameraState).not.toHaveBeenCalled()
        expect(clearBriefing).not.toHaveBeenCalled()
        expect(dispatchSpy.mock.calls.some((c) => c[0].type === "akili:restore-tabs")).toBe(false)
    })
})
