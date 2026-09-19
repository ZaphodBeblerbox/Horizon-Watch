/**
 * viewportMath.js — the arithmetic behind zooming and panning a scene.
 *
 * WHY THIS IS SEPARATE. A zoom that drifts, snaps, or lets the image escape
 * the frame is the kind of bug that is obvious to a person and invisible to
 * a test that only checks the component renders. Keeping the maths pure
 * means the properties that actually matter — the point under the cursor
 * stays under the cursor, the image can always be brought back — are
 * testable exactly, without a DOM.
 *
 * Coordinates: `scale` is a multiplier (1 = fit), `tx`/`ty` are pixel
 * offsets applied BEFORE scaling, in the container's own coordinate space.
 * The rendered transform is `translate(tx, ty) scale(scale)`.
 */

export const MIN_SCALE = 1
export const MAX_SCALE = 24

export const clampScale = (s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/**
 * Zoom about a fixed point — the pixel under the cursor must not move.
 *
 * This is the whole reason wheel-zoom feels right or wrong. Scaling about
 * the container's origin instead makes the image slide away from wherever
 * the person was actually looking, which on a 60-megapixel scene means
 * losing the thing you were inspecting every single time you zoom.
 */
export function zoomAbout(view, factor, px, py) {
    const next = clampScale(view.scale * factor)
    if (next === view.scale) return view
    const k = next / view.scale
    return {
        scale: next,
        // Solve for the offset that keeps (px,py) mapped to itself:
        //   px = tx + s*u   and   px = tx' + s'*u   =>   tx' = px - k*(px - tx)
        tx: px - k * (px - view.tx),
        ty: py - k * (py - view.ty),
    }
}

/**
 * Keep the image within the frame.
 *
 * At scale 1 the image exactly fills the frame, so it is pinned. Zoomed in,
 * panning is bounded by the overflow, which stops the person dragging the
 * scene entirely off-screen and being left looking at nothing with no
 * obvious way back.
 */
export function clampPan(view, frameW, frameH) {
    const overflowX = Math.max(0, frameW * view.scale - frameW)
    const overflowY = Math.max(0, frameH * view.scale - frameH)
    // `|| 0` normalises negative zero: Math.max(-0, …) yields -0, which is
    // equal to 0 everywhere except Object.is, and renders as "-0px".
    return {
        ...view,
        tx: Math.min(0, Math.max(-overflowX, view.tx)) || 0,
        ty: Math.min(0, Math.max(-overflowY, view.ty)) || 0,
    }
}

export const IDENTITY = { scale: 1, tx: 0, ty: 0 }

/**
 * Centre the frame on a normalised box (0..1 of the image) at `scale`.
 *
 * This is what "fly to this detection" means inside a still image, and what
 * a notification's "show me" has to do once the globe has flown to the
 * right place: the object has to end up in the middle of the frame, not
 * merely somewhere within it.
 */
export function focusOnBox(box, frameW, frameH, scale = 6) {
    const s = clampScale(scale)
    const cx = (box.x + box.w / 2) * frameW
    const cy = (box.y + box.h / 2) * frameH
    return clampPan({ scale: s, tx: frameW / 2 - s * cx, ty: frameH / 2 - s * cy },
                    frameW, frameH)
}

/**
 * A scale at which the box fills a comfortable share of the frame.
 *
 * A fixed zoom level cannot serve both a 3-pixel vessel and a 400-pixel
 * quay: one arrives invisible, the other overflows. `fraction` is how much
 * of the frame the object should occupy.
 */
export function scaleToFit(box, fraction = 0.35) {
    const largest = Math.max(box.w || 0, box.h || 0)
    if (!largest) return 8
    return clampScale(fraction / largest)
}

/**
 * Where to draw an arrow pointing at a box, and from which side.
 *
 * The arrow exists because a thin outline around a 4-pixel object on a
 * crowded scene is genuinely hard to find. It is placed on whichever side
 * has room, so it never points in from outside the frame.
 */
export function arrowFor(box, frameW = 1, frameH = 1) {
    const cx = box.x + box.w / 2
    const cy = box.y + box.h / 2
    // Prefer approaching from the side with the most space.
    const room = { left: box.x, right: 1 - (box.x + box.w), top: box.y, bottom: 1 - (box.y + box.h) }
    const side = Object.keys(room).reduce((a, b) => (room[b] > room[a] ? b : a))
    const LEN = 0.12
    const tail = {
        left:   { x: Math.max(0, box.x - LEN), y: cy },
        right:  { x: Math.min(1, box.x + box.w + LEN), y: cy },
        top:    { x: cx, y: Math.max(0, box.y - LEN) },
        bottom: { x: cx, y: Math.min(1, box.y + box.h + LEN) },
    }[side]
    const head = {
        left:   { x: box.x, y: cy },
        right:  { x: box.x + box.w, y: cy },
        top:    { x: cx, y: box.y },
        bottom: { x: cx, y: box.y + box.h },
    }[side]
    return { side, tail, head }
}

/** Percentages for CSS, from a normalised box. */
export const boxToPct = (box) => ({
    left: `${box.x * 100}%`, top: `${box.y * 100}%`,
    width: `${box.w * 100}%`, height: `${box.h * 100}%`,
})
