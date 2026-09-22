/**
 * annotateScene.js — burn detections into the image you export.
 *
 * WHY. A satellite scene could be looked at with its detections drawn
 * over it on the globe, and exported as bare pixels — so the export
 * lost the entire finding. Anyone receiving it had a picture of some
 * coastline and no indication of what had been detected, where, with
 * what confidence, or when the image was taken.
 *
 * The datestamp was already composited into the pixels rather than
 * floated over them (see ImagerySidebar's compositeDatestamp), for the
 * good reason that a burned-in mark survives being cropped, pasted into
 * a document or screenshotted. Annotations belong in the pixels for
 * exactly the same reason, so this extends that approach rather than
 * inventing an overlay.
 *
 * THE PROJECTION IS THE PART THAT CAN BE SILENTLY WRONG, so it lives
 * here as a pure function with tests. A scene is a plate-carrée crop:
 * longitude maps linearly across, latitude linearly down and INVERTED,
 * because image y grows downward while latitude grows upward. Getting
 * that flip wrong draws every box mirrored about the centre, which
 * looks plausible and is completely wrong.
 */

import { coord } from "../globe/markerOrientation.js"

/** Are these usable scene bounds? */
export function validBounds(b) {
    if (!b) return false
    const v = [b.min_lon, b.min_lat, b.max_lon, b.max_lat]
    if (!v.every((n) => Number.isFinite(Number(n)))) return false
    return Number(b.max_lon) > Number(b.min_lon) && Number(b.max_lat) > Number(b.min_lat)
}

/**
 * A lat/lon to pixel x/y inside an image of the given size.
 *
 * Returns null for bounds that cannot be projected rather than NaN,
 * because NaN coordinates draw nothing and report nothing.
 */
export function project(lat, lon, bounds, width, height) {
    if (!validBounds(bounds)) return null
    // coord(), not Number(): Number(null) is 0 and Number("") is 0, so a
    // missing latitude would project to a real pixel rather than being
    // rejected. That is the Null Island bug, which this codebase has now
    // hit in marker positions, vessel headings and trade-route waypoints.
    const la = coord(lat), lo = coord(lon)
    if (la === null || lo === null) return null
    const { min_lon, min_lat, max_lon, max_lat } = bounds
    const x = ((lo - min_lon) / (max_lon - min_lon)) * width
    // INVERTED: image y grows downward, latitude grows upward.
    const y = ((max_lat - la) / (max_lat - min_lat)) * height
    return { x, y }
}

/**
 * A detection's outline in pixels, using the same shape resolution the
 * globe layer uses so the export and the screen cannot disagree.
 */
export function detectionPixels(det, bounds, width, height, cornersOf) {
    const shape = cornersOf(det)
    if (!shape) return null
    const pts = []
    for (const [lat, lon] of shape.corners) {
        const p = project(lat, lon, bounds, width, height)
        if (!p) return null
        pts.push(p)
    }
    return pts.length >= 3 ? { points: pts, source: shape.source } : null
}

/** The label for a box: what it is and how sure, never a bare class id. */
export function detectionLabel(det) {
    const what = String(det?.object_type || det?.label || det?.category || "object")
        .replace(/_/g, " ")
    const conf = Number(det?.confidence)
    return Number.isFinite(conf) ? `${what} ${Math.round(conf * 100)}%` : what
}

/**
 * The provenance line burned along the bottom.
 *
 * Says what the image is and where the boxes came from. An exported
 * image that does not say it is machine-detected can be mistaken for a
 * confirmed observation, which is the one thing this must never allow.
 */
export function provenanceLine(meta = {}) {
    const bits = []
    if (meta.sensor) bits.push(String(meta.sensor))
    bits.push(meta.captured ? `captured ${meta.captured}` : "capture date unknown")
    if (Number.isFinite(Number(meta.cloud))) bits.push(`${Math.round(meta.cloud)}% cloud`)
    const n = Number(meta.detections)
    if (Number.isFinite(n)) {
        bits.push(`${n} automated detection${n === 1 ? "" : "s"} — not confirmed`)
    }
    return bits.join(" · ")
}
