import { describe, it, expect } from "vitest"
import {
    zoomAbout, clampPan, clampScale, focusOnBox, scaleToFit, arrowFor,
    IDENTITY, MIN_SCALE, MAX_SCALE, containRect, boxToFrame,
} from "./viewportMath.js"

const FRAME = 1000

describe("zoom about the cursor", () => {
    it("keeps the point under the cursor exactly where it was", () => {
        // The property that decides whether wheel-zoom feels right. Scaling
        // about the origin instead slides the scene away from whatever the
        // person was inspecting.
        const px = 730, py = 210
        let v = IDENTITY
        const imageAt = (view) => ({ u: (px - view.tx) / view.scale, w: (py - view.ty) / view.scale })
        const before = imageAt(v)
        v = zoomAbout(v, 1.25, px, py)
        v = zoomAbout(v, 1.25, px, py)
        v = zoomAbout(v, 1.25, px, py)
        const after = imageAt(v)
        expect(after.u).toBeCloseTo(before.u, 6)
        expect(after.w).toBeCloseTo(before.w, 6)
    })

    it("zooming in and back out returns to where it started", () => {
        let v = zoomAbout(IDENTITY, 2, 400, 300)
        v = zoomAbout(v, 0.5, 400, 300)
        expect(v.scale).toBeCloseTo(1, 6)
        expect(v.tx).toBeCloseTo(0, 6)
        expect(v.ty).toBeCloseTo(0, 6)
    })

    it("cannot zoom out past the fitted view", () => {
        const v = zoomAbout(IDENTITY, 0.1, 500, 500)
        expect(v.scale).toBe(MIN_SCALE)
    })

    it("cannot zoom in without limit", () => {
        let v = IDENTITY
        for (let i = 0; i < 100; i++) v = zoomAbout(v, 2, 500, 500)
        expect(v.scale).toBe(MAX_SCALE)
    })

    it("is a no-op at the limits rather than drifting", () => {
        const at = { scale: MAX_SCALE, tx: -50, ty: -70 }
        expect(zoomAbout(at, 1.2, 500, 500)).toBe(at)
    })

    it("clamps scale symmetrically", () => {
        expect(clampScale(0)).toBe(MIN_SCALE)
        expect(clampScale(1e6)).toBe(MAX_SCALE)
        expect(clampScale(3)).toBe(3)
    })
})

describe("panning stays inside the frame", () => {
    it("is pinned when the image exactly fills the frame", () => {
        const v = clampPan({ scale: 1, tx: 300, ty: -400 }, FRAME, FRAME)
        expect(v.tx).toBe(0)
        expect(v.ty).toBe(0)
    })

    it("cannot drag the scene off-screen and leave nothing visible", () => {
        // Being left staring at blank space with no obvious way back is the
        // failure this prevents.
        const v = clampPan({ scale: 4, tx: 99999, ty: -99999 }, FRAME, FRAME)
        expect(v.tx).toBeLessThanOrEqual(0)
        expect(v.tx).toBeGreaterThanOrEqual(-(FRAME * 4 - FRAME))
        expect(v.ty).toBeGreaterThanOrEqual(-(FRAME * 4 - FRAME))
    })

    it("allows the full range of the overflow", () => {
        const overflow = FRAME * 3 - FRAME
        expect(clampPan({ scale: 3, tx: -overflow, ty: -overflow }, FRAME, FRAME).tx)
            .toBe(-overflow)
    })
})

describe("focusing on a detection", () => {
    const box = { x: 0.8, y: 0.1, w: 0.02, h: 0.02 }

    it("puts the object in the middle of the frame, not merely on screen", () => {
        const v = focusOnBox(box, FRAME, FRAME, 6)
        const screenX = v.tx + v.scale * (box.x + box.w / 2) * FRAME
        const screenY = v.ty + v.scale * (box.y + box.h / 2) * FRAME
        // Clamping can pull an edge object off exact centre; it must still
        // land well inside the frame.
        expect(screenX).toBeGreaterThan(0)
        expect(screenX).toBeLessThan(FRAME)
        expect(screenY).toBeGreaterThan(0)
        expect(screenY).toBeLessThan(FRAME)
    })

    it("centres exactly for an object away from the edges", () => {
        const mid = { x: 0.5, y: 0.5, w: 0.02, h: 0.02 }
        const v = focusOnBox(mid, FRAME, FRAME, 4)
        const screenX = v.tx + v.scale * (mid.x + mid.w / 2) * FRAME
        expect(screenX).toBeCloseTo(FRAME / 2, 3)
    })

    it("never leaves the image out of bounds", () => {
        const corner = { x: 0.99, y: 0.99, w: 0.01, h: 0.01 }
        const v = focusOnBox(corner, FRAME, FRAME, 10)
        expect(v.tx).toBeLessThanOrEqual(0)
        expect(v.tx).toBeGreaterThanOrEqual(-(FRAME * v.scale - FRAME))
    })

    it("scales a tiny object far more than a large one", () => {
        // A fixed zoom cannot serve a 3px vessel and a 400px quay at once.
        const vessel = scaleToFit({ w: 0.004, h: 0.004 })
        const quay = scaleToFit({ w: 0.4, h: 0.2 })
        expect(vessel).toBeGreaterThan(quay)
        expect(vessel).toBeLessThanOrEqual(MAX_SCALE)
        expect(quay).toBeGreaterThanOrEqual(MIN_SCALE)
    })

    it("handles a degenerate box without producing NaN", () => {
        expect(Number.isFinite(scaleToFit({ w: 0, h: 0 }))).toBe(true)
    })
})

describe("the arrow that points at a detection", () => {
    it("approaches from the side with the most room", () => {
        // An arrow pointing in from outside the frame is invisible, which
        // defeats the point of having one.
        const nearLeft = arrowFor({ x: 0.02, y: 0.5, w: 0.01, h: 0.01 })
        expect(nearLeft.side).toBe("right")
        const nearTop = arrowFor({ x: 0.5, y: 0.01, w: 0.01, h: 0.01 })
        expect(nearTop.side).toBe("bottom")
    })

    it("keeps the tail inside the image", () => {
        for (const box of [
            { x: 0.0, y: 0.0, w: 0.01, h: 0.01 },
            { x: 0.99, y: 0.99, w: 0.01, h: 0.01 },
            { x: 0.5, y: 0.5, w: 0.02, h: 0.02 },
        ]) {
            const a = arrowFor(box)
            expect(a.tail.x).toBeGreaterThanOrEqual(0)
            expect(a.tail.x).toBeLessThanOrEqual(1)
            expect(a.tail.y).toBeGreaterThanOrEqual(0)
            expect(a.tail.y).toBeLessThanOrEqual(1)
        }
    })

    it("points its head at the object's edge, not its centre", () => {
        const a = arrowFor({ x: 0.4, y: 0.4, w: 0.1, h: 0.1 })
        const cx = 0.45, cy = 0.45
        const dist = Math.hypot(a.head.x - cx, a.head.y - cy)
        expect(dist).toBeGreaterThan(0)
    })
})

// ── where the image actually is inside the pane ───────────────────────────
//
// The reported bug: "the detections aren't aligned with the image". The
// cause was that the image is drawn with objectFit:contain — which centres
// it and leaves bars when its aspect ratio differs from the pane — while
// the overlay mapped box fractions to the PANE. Every box was then off by
// the width of a bar, and wrongly scaled on top of that.

describe("containRect", () => {
    it("fills the frame exactly when the aspect ratios match", () => {
        const r = containRect({ w: 800, h: 600 }, { w: 400, h: 300 })
        expect(r).toEqual({ imgX: 0, imgY: 0, imgW: 400, imgH: 300 })
    })

    it("bars a portrait scene left and right in a landscape pane", () => {
        // 1000x2000 into 800x800 → 400x800, centred: 200px bars either side.
        const r = containRect({ w: 1000, h: 2000 }, { w: 800, h: 800 })
        expect(r).toEqual({ imgX: 200, imgY: 0, imgW: 400, imgH: 800 })
    })

    it("bars a landscape scene top and bottom in a portrait pane", () => {
        const r = containRect({ w: 2000, h: 1000 }, { w: 800, h: 800 })
        expect(r).toEqual({ imgX: 0, imgY: 200, imgW: 800, imgH: 400 })
    })

    it("a centred box stays centred, which the frame mapping also got right", () => {
        // The bug is invisible at the centre — which is why it survived.
        const { imgX, imgW } = containRect({ w: 1000, h: 2000 }, { w: 800, h: 800 })
        expect(imgX + 0.5 * imgW).toBe(400)
    })

    it("an object at the image's left edge is not at the pane's left edge", () => {
        // The regression this exists to catch. Mapping fraction 0 to the
        // frame puts the box 200px left of the object it describes.
        const { imgX } = containRect({ w: 1000, h: 2000 }, { w: 800, h: 800 })
        expect(imgX).toBeGreaterThan(0)
    })

    it("falls back to the whole frame before the image reports its size", () => {
        // onLoad has not fired yet. The frame is the only guess available,
        // and it must not produce NaN geometry.
        expect(containRect({ w: 0, h: 0 }, { w: 800, h: 600 }))
            .toEqual({ imgX: 0, imgY: 0, imgW: 800, imgH: 600 })
    })

    it("survives a frame of zero size during layout", () => {
        const r = containRect({ w: 1000, h: 1000 }, { w: 0, h: 0 })
        expect(Object.values(r).every(Number.isFinite)).toBe(true)
    })
})

describe("boxToFrame", () => {
    it("is the identity when the image fills the frame", () => {
        const rect = containRect({ w: 800, h: 600 }, { w: 400, h: 300 })
        const b = { x: 0.25, y: 0.5, w: 0.1, h: 0.2 }
        const f = boxToFrame(b, rect, 400, 300)
        expect([f.x, f.y, f.w, f.h]).toEqual([0.25, 0.5, 0.1, 0.2])
    })

    it("shrinks a box by the letterbox ratio, so focus zooms correctly", () => {
        // 1000x2000 in an 800x800 pane: the image is half the pane wide, so
        // a box spanning a tenth of the image spans a twentieth of the pane.
        // Zooming as if it were a tenth lands at half the intended scale.
        const rect = containRect({ w: 1000, h: 2000 }, { w: 800, h: 800 })
        const f = boxToFrame({ x: 0, y: 0, w: 0.1, h: 0.1 }, rect, 800, 800)
        expect(f.w).toBeCloseTo(0.05)
        expect(f.h).toBeCloseTo(0.1)
        expect(f.x).toBeCloseTo(0.25)   // the 200px bar, as a fraction
    })

    it("leaves the box alone when the image size is not known yet", () => {
        const b = { x: 0.3, y: 0.3, w: 0.1, h: 0.1 }
        expect(boxToFrame(b, { imgX: 0, imgY: 0, imgW: 0, imgH: 0 }, 800, 800)).toBe(b)
        expect(boxToFrame(b, null, 800, 800)).toBe(b)
    })
})
