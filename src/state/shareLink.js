/**
 * shareLink.js — a link that opens what you are looking at.
 *
 * Share opened the notification tray. What a colleague needs from "share"
 * is to land where you are: the same theater, the same piece of map, from
 * the same angle. The view travels in the URL hash, so it never reaches a
 * server log and works for anyone who can sign in to this deployment —
 * the link carries a place, not a permission.
 *
 *   #view=26.5000,56.4000,850000,0.00,-1.57&theater=<id>
 *          lat     lon     height  heading pitch (radians)
 */

const r = (n, d) => Number(n).toFixed(d)

export function encodeView({ lat, lon, height, heading = 0, pitch = -Math.PI / 2 } = {}, theaterId = null) {
    if (![lat, lon, height].every(Number.isFinite)) return ""
    const view = [r(lat, 4), r(lon, 4), Math.round(height), r(heading, 2), r(pitch, 2)].join(",")
    const q = new URLSearchParams({ view })
    if (theaterId) q.set("theater", theaterId)
    return `#${q.toString()}`
}

export function decodeView(hash) {
    const q = new URLSearchParams(String(hash || "").replace(/^#/, ""))
    const v = (q.get("view") || "").split(",").map(Number)
    const out = { theater: q.get("theater") || null, view: null }
    if (v.length >= 3 && v.slice(0, 3).every(Number.isFinite)
        && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180 && v[2] > 0) {
        out.view = {
            lat: v[0], lon: v[1], height: v[2],
            heading: Number.isFinite(v[3]) ? v[3] : 0,
            pitch: Number.isFinite(v[4]) ? v[4] : -Math.PI / 2,
            roll: 0,
        }
    }
    return out
}

export function shareUrl(camera, theaterId) {
    const base = `${window.location.origin}${window.location.pathname}`
    return base + encodeView(camera || {}, theaterId)
}
