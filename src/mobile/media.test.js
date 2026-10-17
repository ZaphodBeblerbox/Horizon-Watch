import { describe, it, expect } from "vitest"
import { containRect, coverRect, dragTransform, flyFrom, fmtTime, tapZone } from "./media.js"

describe("fmtTime", () => {
    it("reads as a clock", () => {
        expect(fmtTime(0)).toBe("0:00")
        expect(fmtTime(7.9)).toBe("0:07")
        expect(fmtTime(64)).toBe("1:04")
        expect(fmtTime(3729)).toBe("1:02:09")
    })
    it("says 0:00 when nothing is known yet", () => {
        expect(fmtTime(NaN)).toBe("0:00")
        expect(fmtTime(Infinity)).toBe("0:00")
        expect(fmtTime(-3)).toBe("0:00")
    })
})

describe("tapZone", () => {
    it("splits the screen in thirds", () => {
        expect(tapZone(10, 390)).toBe("left")
        expect(tapZone(129, 390)).toBe("left")
        expect(tapZone(195, 390)).toBe("mid")
        expect(tapZone(261, 390)).toBe("right")
        expect(tapZone(389, 390)).toBe("right")
    })
    it("is the middle when there is no width", () => expect(tapZone(5, 0)).toBe("mid"))
})

describe("fitting", () => {
    const screen = { x: 0, y: 0, w: 400, h: 800 }
    it("contains a landscape video across the width, centred", () => {
        expect(containRect(1600, 900, screen)).toEqual({ x: 0, y: 287.5, w: 400, h: 225 })
    })
    it("covers by cropping the sides", () => {
        const r = coverRect(1600, 900, { x: 0, y: 0, w: 200, h: 200 })
        expect(r.h).toBe(200)
        expect(r.x).toBeCloseTo(-(r.w - 200) / 2)
    })
})

describe("flyFrom", () => {
    const target = { x: 0, y: 287.5, w: 400, h: 225 }
    it("puts the full-screen media over the one on the page", () => {
        const el = { x: 20, y: 100, w: 200, h: 112.5 }
        const t = flyFrom({ w: 1600, h: 900 }, el, "contain", target)
        expect(t.s).toBeCloseTo(0.5)
        expect(t.tx).toBeCloseTo(20)
        expect(t.ty).toBeCloseTo(100 - 287.5)
        expect(t.clip).toEqual([0, 0, 0, 0])
    })
    it("clips a cropped (cover) picture to its box", () => {
        const el = { x: 0, y: 0, w: 200, h: 200 }
        const t = flyFrom({ w: 1600, h: 900 }, el, "cover", target)
        // the picture is 355.6 wide in a 200 box: 77.8 hidden each side, in unscaled px
        expect(t.clip[0]).toBeCloseTo(0)
        expect(t.clip[1]).toBeCloseTo(t.clip[3])
        expect(t.clip[3] * t.s).toBeCloseTo((t.s * 400 - 200) / 2)
    })
})

describe("dragTransform", () => {
    it("follows the finger and gives at most a quarter of its size", () => {
        const r = { w: 400, h: 225 }
        expect(dragTransform(0, 0, r, 800)).toEqual({ tx: 0, ty: 0, s: 1 })
        const far = dragTransform(0, 5000, r, 800)
        expect(far.s).toBe(0.75)
        expect(far.tx).toBeCloseTo(50)
    })
})
