/**
 * farIcons.js — ships and aircraft as icons when the camera is far out.
 *
 * Every 3D model is its own draw call and its own glTF in memory; a billboard is one quad in a batch. So from
 * far out (GlobeView's MODEL_ALT) each contact is a small icon pointed along its heading — all of them, not a
 * budget's worth — and the full models appear only once you are close, for what is in view (owner, 2026-10-10).
 *
 * The icon is the one typology's (lib/mapIcons.js trafficIcon): the same hull and aircraft as the phone map, at
 * the same constant 16 px, neutral, amber when watchlisted / sanctioned / military of interest. Never scaled by
 * camera distance (owner, 2026-10-23).
 */
import { Cartesian3, Color } from "cesium"
import { trafficIcon, trafficTone, SIZE } from "../lib/mapIcons.js"

/** A hull seen from above, bow up, in a traffic tone (neutral | urgent | flash). */
export const shipIcon = (tone = "neutral") => trafficIcon({ kind: "ship", tone }).uri

/** An aircraft seen from above, nose up, in a traffic tone. */
export const planeIcon = (tone = "neutral") => trafficIcon({ kind: "plane", tone }).uri

export { trafficTone }

/** Billboard props: the icon turned to a compass heading (degrees, clockwise from north), one constant size. */
export function headingBillboard(image, headingDeg) {
    const h = Number.isFinite(+headingDeg) ? +headingDeg : 0
    return {
        image, width: SIZE.traffic, height: SIZE.traffic,
        rotation: -h * Math.PI / 180, alignedAxis: Cartesian3.UNIT_Z,
        color: Color.WHITE,
    }
}
