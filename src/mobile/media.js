/**
 * media.js — the arithmetic of the phone's full-screen media viewer
 * (MediaViewer.jsx), kept pure so it can be tested without a browser.
 *
 *   fmtTime(s)                 0:07, 1:04, 1:02:09 — what the scrubber reads
 *   tapZone(x, width)          which third of the screen a tap landed in
 *   containRect(w, h, box)     where a picture of w×h sits inside a box when
 *                              it is shown whole (object-fit: contain)
 *   coverRect(w, h, box)       the same when it fills the box (cover)
 *   flyFrom(natural, el, fit, target)   the transform (and clip) that puts
 *                              the full-screen media exactly over the one
 *                              tapped, so it can grow from there
 */

/** Seconds as a clock: m:ss, or h:mm:ss past the hour. Nothing known: 0:00. */
export function fmtTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0
    const t = Math.floor(s)
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60
    const ss = String(sec).padStart(2, "0")
    return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** Left, middle or right third: a double tap on a side skips ten seconds. */
export function tapZone(x, width) {
    if (!(width > 0)) return "mid"
    const f = x / width
    return f < 1 / 3 ? "left" : f > 2 / 3 ? "right" : "mid"
}

/** The rect a w×h picture takes inside `box` when shown whole. */
export function containRect(w, h, box) {
    if (!(w > 0 && h > 0)) return { x: box.x, y: box.y, w: box.w, h: box.h }
    const k = Math.min(box.w / w, box.h / h)
    const rw = w * k, rh = h * k
    return { x: box.x + (box.w - rw) / 2, y: box.y + (box.h - rh) / 2, w: rw, h: rh }
}

/** The rect a w×h picture takes when it fills `box` (cropped at the edges). */
export function coverRect(w, h, box) {
    if (!(w > 0 && h > 0)) return { x: box.x, y: box.y, w: box.w, h: box.h }
    const k = Math.max(box.w / w, box.h / h)
    const rw = w * k, rh = h * k
    return { x: box.x + (box.w - rw) / 2, y: box.y + (box.h - rh) / 2, w: rw, h: rh }
}

/* The full-screen media is laid out at `target` (its rest), transform-origin
   at its top left. From here it starts — and to here it returns — scaled
   and moved onto the picture as it was on the page. A picture that filled
   its box (cover) was cropped there, so it also starts clipped to that box:
   `clip` is an inset in the media's own (unscaled) pixels. */
export function flyFrom(natural, el, fit, target) {
    const pic = fit === "cover" ? coverRect(natural.w, natural.h, el) : containRect(natural.w, natural.h, el)
    const s = target.w > 0 ? pic.w / target.w : 1
    const tx = pic.x - target.x, ty = pic.y - target.y
    let clip = [0, 0, 0, 0]
    if (fit === "cover" && s > 0) {
        clip = [
            Math.max(0, (el.y - pic.y) / s),
            Math.max(0, (pic.x + pic.w - (el.x + el.w)) / s),
            Math.max(0, (pic.y + pic.h - (el.y + el.h)) / s),
            Math.max(0, (el.x - pic.x) / s),
        ]
    }
    return { tx, ty, s, clip }
}

/* While swiped down: the media follows the finger and gives a little of
   its size — at most a quarter — scaled about its own centre. */
export function dragTransform(dx, dy, rect, viewH) {
    const k = 1 - Math.min(0.25, Math.max(0, dy) / Math.max(1, viewH) * 0.6)
    return { tx: dx + (1 - k) * rect.w / 2, ty: dy + (1 - k) * rect.h / 2, s: k }
}
