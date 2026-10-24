import { describe, it, expect, beforeEach, vi } from "vitest"
import { showSignalPin, subscribeSignalPin, closeOpenedSignal, setSignalPinLayer, signalPinLayerOn, getSignalPin, PIN_GRACE_MS } from "./signalPin.js"

// "On the ground now: … demonstrating …" opened from a notification: the triangle where it happens
// (owner, 2026-10-24: it mostly did not appear, and had no switch)
describe("the signal a notification opened, on the map", () => {
    beforeEach(() => { vi.useRealTimers(); setSignalPinLayer(true); showSignalPin(null) })

    it("a map that subscribes after the pin went up is given it at once (cold start, a map built later)", () => {
        showSignalPin({ id: "now:ev_1", lat: 48.8674, lon: 2.3636, title: "On the ground now: crowd at République" })
        const seen = vi.fn()
        const off = subscribeSignalPin(seen)
        expect(seen).toHaveBeenCalledTimes(1)
        expect(seen.mock.calls[0][0]).toMatchObject({ id: "now:ev_1", lat: 48.8674, lon: 2.3636 })
        off()
    })

    it("the card put away by the map's own flight there does not take the pin with it", () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-10-24T10:00:00Z"))
        showSignalPin({ id: "now:ev_2", lat: 48.85, lon: 2.37 })
        closeOpenedSignal("now:ev_2", { passive: true })
        expect(getSignalPin()).not.toBeNull()
        vi.setSystemTime(new Date(Date.now() + PIN_GRACE_MS + 10))
        closeOpenedSignal("now:ev_2", { passive: true })
        expect(getSignalPin()).toBeNull()
        // the user closing it is never ignored
        showSignalPin({ id: "now:ev_3", lat: 48.85, lon: 2.37 })
        closeOpenedSignal("now:ev_3")
        expect(getSignalPin()).toBeNull()
    })

    it("has its own layer switch: off hides the marker and keeps the pin, on brings it back", () => {
        const seen = []
        const off = subscribeSignalPin((p) => seen.push(p))
        showSignalPin({ id: "now:ev_4", lat: 1, lon: 2 })
        setSignalPinLayer(false)
        expect(signalPinLayerOn()).toBe(false)
        expect(seen.at(-1)).toBeNull()
        expect(getSignalPin()).not.toBeNull()
        const late = vi.fn()
        subscribeSignalPin(late)()
        expect(late).not.toHaveBeenCalled()
        setSignalPinLayer(true)
        expect(seen.at(-1)).toMatchObject({ id: "now:ev_4" })
        off()
    })
})
