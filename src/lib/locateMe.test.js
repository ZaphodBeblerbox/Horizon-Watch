// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest"
import { findMe, flyToMe, browserFix, CITY_ALTITUDE_M } from "./locateMe.js"

const geo = (lat, lon) => ({ getCurrentPosition: (ok) => ok({ coords: { latitude: lat, longitude: lon } }) })
const denied = { getCurrentPosition: (_ok, err) => err({ code: 1 }) }

describe("My location (desktop map)", () => {
    it("prefers this device's live fix, then the browser, then the stored position", async () => {
        expect(await findMe({ mine: () => ({ lat: 1, lon: 2, live: true }), browser: async () => ({ lat: 9, lon: 9 }) }))
            .toEqual({ lat: 1, lon: 2, source: "live" })
        expect(await findMe({ mine: () => ({ lat: 1, lon: 2, live: false }), browser: async () => ({ lat: 48.85, lon: 2.35 }) }))
            .toEqual({ lat: 48.85, lon: 2.35, source: "browser" })
        expect(await findMe({ mine: () => ({ lat: 1, lon: 2, live: false }), browser: async () => null }))
            .toEqual({ lat: 1, lon: 2, source: "stored" })
        expect(await findMe({ mine: () => null, browser: async () => null })).toBeNull()
    })

    it("asks the browser once and survives a refusal or no API", async () => {
        expect(await browserFix(geo(48.8, 2.3))).toEqual({ lat: 48.8, lon: 2.3 })
        expect(await browserFix(denied)).toBeNull()
        expect(await browserFix(null)).toBeNull()
    })

    it("flies the globe there at a city zoom", async () => {
        const seen = vi.fn()
        window.addEventListener("akili:fly-to", (e) => seen(e.detail))
        await flyToMe({ mine: () => null, browser: async () => ({ lat: 48.85, lon: 2.35 }) })
        expect(seen).toHaveBeenCalledWith({ lat: 48.85, lon: 2.35, altitude: CITY_ALTITUDE_M })
        expect(CITY_ALTITUDE_M).toBeLessThan(60_000)
    })
})
