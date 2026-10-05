import { describe, it, expect } from "vitest"
import { decodeView, encodeView } from "./shareLink.js"

describe("share links", () => {
    it("round-trips a view and a theater", () => {
        const h = encodeView({ lat: 26.5, lon: 56.4, height: 850000, heading: 0.1, pitch: -1.2 }, "t-1")
        const d = decodeView(h)
        expect(d.theater).toBe("t-1")
        expect(d.view).toMatchObject({ lat: 26.5, lon: 56.4, height: 850000, heading: 0.1, pitch: -1.2 })
    })

    it("refuses nonsense rather than flying somewhere wrong", () => {
        expect(decodeView("#view=95,10,1000").view).toBeNull()
        expect(decodeView("#view=a,b,c").view).toBeNull()
        expect(decodeView("").view).toBeNull()
        expect(encodeView({})).toBe("")
    })
})
