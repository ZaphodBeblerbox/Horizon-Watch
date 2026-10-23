/**
 * safeHouseIcon.js — the SAFE HOUSE pin, one image for both maps (the globe's GlobeSafeHousesLayer and the
 * phone's "Safe houses" layer), in the one typology (lib/mapIcons.js): ours, so a pin, a gold tile with a house
 * and a check badge; a closed house is drawn in the past state (hollow, faint).
 */
import { pinIcon } from "../lib/mapIcons.js"

export function safeHouseIcon(closed = false) {
    return pinIcon({ glyph: "house", badge: "check", state: closed ? "past" : "live" }).uri
}

/** " · 3/6 free" — places left, counting evacuations already sent there. */
export const placesLabel = (h) => (h?.capacity != null ? ` · ${Math.max(0, h.capacity - (h.occupancy || 0) - (h.reserved || 0))}/${h.capacity} free` : "")
