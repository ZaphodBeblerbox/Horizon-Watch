/**
 * farIcons.js — ships and aircraft as icons when the camera is far out.
 *
 * Every 3D model is its own draw call and its own glTF in memory; a
 * billboard is one quad in a batch. So from far out (GlobeView's MODEL_ALT)
 * each contact is a small icon pointed along its heading — all of them, not
 * a budget's worth — and the full models appear only once you are close,
 * for what is in view (owner, 2026-10-10).
 */
import { Cartesian3, Color, NearFarScalar } from "cesium"

const _cache = {}
const svg = (body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`)}`

/** A hull seen from above, bow up. */
export function shipIcon(fill) {
    const k = `s${fill}`
    return _cache[k] ||= svg(`<path d="M16 3 L21 10 L21 27 Q16 30 11 27 L11 10 Z" fill="${fill}" stroke="#0b1220" stroke-width="1.6" stroke-linejoin="round"/>`)
}

/** An aircraft seen from above, nose up. */
export function planeIcon(fill) {
    const k = `p${fill}`
    return _cache[k] ||= svg(`<path d="M16 2.5 C17.3 2.5 17.6 4.5 17.6 6.5 V12.5 L28.5 18.5 V21 L17.6 17.8 V24.5 L21 27.2 V29 L16 27.6 L11 29 V27.2 L14.4 24.5 V17.8 L3.5 21 V18.5 L14.4 12.5 V6.5 C14.4 4.5 14.7 2.5 16 2.5 Z" fill="${fill}" stroke="#0b1220" stroke-width="1.3" stroke-linejoin="round"/>`)
}

/** Billboard props: the icon turned to a compass heading (degrees, clockwise from north). */
export function headingBillboard(image, headingDeg, size = 16) {
    const h = Number.isFinite(+headingDeg) ? +headingDeg : 0
    return {
        image, width: size, height: size,
        rotation: -h * Math.PI / 180, alignedAxis: Cartesian3.UNIT_Z,
        scaleByDistance: new NearFarScalar(3e5, 1.0, 1.5e7, 0.55),
        color: Color.WHITE,
    }
}
