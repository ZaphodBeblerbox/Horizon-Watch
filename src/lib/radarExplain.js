/**
 * radarExplain.js — what a radar "brighter" or "darker" change means, in
 * plain words (owner, 2026-10-12: "What does 'new bright change' even mean,
 * what does it indicate?").
 *
 * One wording, used beside the Imagery viewer, in the finding list and in
 * the notification's cut-out, so the explanation never differs between
 * screens.
 */

export const RADAR_WHAT =
    "Sentinel-1 radar brightness is how strongly the ground sends the satellite's radar pulse back."

export const RADAR_BRIGHTER =
    "Brighter (new bright returns): something there now sends much more back than before — typically new metal "
    + "or upright hard surfaces: vehicles, containers, metal-framed tents and shelters, new structures, construction "
    + "equipment, fresh earthworks or berms with steep faces."

export const RADAR_DARKER =
    "Darker (returns gone): something that reflected has gone, or the surface became smoother and flatter — "
    + "vehicles left, structures removed or destroyed, flooding or standing water, cleared land."

export const RADAR_CAVEATS =
    "Rain and wet soil, harvest and ploughing, snow, and a different viewing angle (another orbit) change radar "
    + "brightness too. That is why only camp-sized clusters on land that is not cropland are kept, and passes from "
    + "the same orbit are compared. At 10–20 m a vehicle park, a tent camp and a field hospital look alike — "
    + "identify on high-resolution imagery."

/** The one line for a finding's direction. Pure. */
export function radarMeaning(f) {
    const dir = f?.direction || (f?.kind === "sweep_find" ? "appeared" : null)
    if (f?.kind === "sweep_find" && /Cleared/.test(f?.label || "")) return RADAR_DARKER
    if (dir === "removed") return RADAR_DARKER
    if (dir === "appeared" || f?.kind === "sweep_find" || f?.kind === "radar_change") return RADAR_BRIGHTER
    return null
}
