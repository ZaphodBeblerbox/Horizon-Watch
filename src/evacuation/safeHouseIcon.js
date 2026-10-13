/**
 * safeHouseIcon.js — the SAFE HOUSE pin, one image for both maps (the globe's
 * GlobeSafeHousesLayer and the phone's "Safe houses" layer): a green house
 * with a check mark on a white-rimmed pin; grey when the house is closed.
 */
const _icon = {}
export function safeHouseIcon(closed = false) {
    const k = closed ? "c" : "o"
    if (_icon[k]) return _icon[k]
    const fill = closed ? "#6b7480" : "#2E9E5B"
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="56" viewBox="0 0 48 56">
      <path d="M24 55 L16 44 H8 a6 6 0 0 1 -6 -6 V8 a6 6 0 0 1 6 -6 H40 a6 6 0 0 1 6 6 V38 a6 6 0 0 1 -6 6 H32 Z" fill="${fill}" stroke="#fff" stroke-width="3"/>
      <g transform="translate(9 7) scale(1.25)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M3 11l9-7 9 7M5 9.5V20h14V9.5M8.8 14.2l2.3 2.3 4.2-4.6"/></g>
    </svg>`
    _icon[k] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    return _icon[k]
}

/** " · 3/6 free" — places left, counting evacuations already sent there. */
export const placesLabel = (h) => (h?.capacity != null ? ` · ${Math.max(0, h.capacity - (h.occupancy || 0) - (h.reserved || 0))}/${h.capacity} free` : "")
