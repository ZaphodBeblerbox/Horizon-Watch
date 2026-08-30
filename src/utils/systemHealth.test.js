import { describe, it, expect } from "vitest"
import { summarizeHealth } from "./systemHealth.js"

describe("summarizeHealth", () => {
    it("reports operational with no real health data yet (initial load)", () => {
        expect(summarizeHealth(null).status).toBe("operational")
    })

    it("reports operational when every real source is ok", () => {
        const data = { backend: { status: "ok" }, data_sources: [{ status: "ok" }, { status: "ok" }] }
        expect(summarizeHealth(data).status).toBe("operational")
    })

    it("reports degraded when a real source is degraded or pending, never escalating to outage", () => {
        const degraded = { data_sources: [{ status: "ok" }, { status: "degraded" }] }
        expect(summarizeHealth(degraded).status).toBe("degraded")
        expect(summarizeHealth(degraded).detail).toMatch(/1 FEED DEGRADED/)

        const pending = { data_sources: [{ status: "pending" }] }
        expect(summarizeHealth(pending).status).toBe("degraded")
    })

    it("reports outage when a real source or the backend itself is in error", () => {
        const data = { data_sources: [{ status: "error" }, { status: "ok" }] }
        expect(summarizeHealth(data).status).toBe("outage")
        expect(summarizeHealth(data).detail).toMatch(/1 FEED DOWN/)
    })

    it("outage takes priority over degraded when both are present", () => {
        const data = { data_sources: [{ status: "error" }, { status: "degraded" }] }
        expect(summarizeHealth(data).status).toBe("outage")
    })
})
