/**
 * watchPlace.js — a satellite watch area around a place, sized by what the
 * place is.
 *
 * Used by the voice command ("generate a watch area around King Fahd
 * Airport") and by the "Watch area around this place" button on map search
 * results. The place is resolved by the server against our own data
 * (GET /api/voice/resolve-place → backend/place_resolve.py) — never from a
 * model's coordinates — and the area is created through the same
 * POST /api/watch-zones every other "watch it" uses, which starts its first
 * scan. Imagery hears "akili:zones-changed" and lists it at once.
 */
import API_BASE from "../apiBase.js"

// The side of the square, in km, by kind (the same table as place_resolve.SIZE_KM).
export const SIZE_KM = { large_airport: 8, medium_airport: 5, small_airport: 3, heliport: 1.5, airport: 6,
                         port: 6, city: 15, country: 0, place: 5 }

/** Side in km for a search hit / resolved place. Pure. */
export function sizeForKind(kind, type) {
    if (kind === "airport") return SIZE_KM[type] || SIZE_KM.airport
    if (kind === "port") return SIZE_KM.port
    if (kind === "city" || kind === "location_city") return SIZE_KM.city
    return SIZE_KM.place
}

/** A GeoJSON square `sideKm` on a side around a point. Pure. */
export function squareKm(lat, lon, sideKm) {
    const half = sideKm / 2
    const dLat = half / 110.574
    const dLon = half / (111.320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))
    const r = (v) => Math.round(v * 1e6) / 1e6
    const [w, s, e, n] = [r(lon - dLon), r(lat - dLat), r(lon + dLon), r(lat + dLat)]
    return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

/** "with 20 km" / "20 km around" → 20 (1-50), else null. Pure. */
export function parseSizeKm(text) {
    const m = String(text || "").match(/(\d+(?:[.,]\d+)?)\s*(?:x\s*\d+(?:[.,]\d+)?\s*)?(km|kilomet(?:er|re)s?|k)\b/i)
    if (!m) return null
    const v = parseFloat(m[1].replace(",", "."))
    return Number.isFinite(v) && v > 0 ? Math.max(1, Math.min(50, v)) : null
}

function authHeaders() {
    const t = typeof localStorage !== "undefined" ? localStorage.getItem("hw-auth-token") : null
    // an empty Authorization header overrides the real sign-in (2026-10-11)
    return t ? { Authorization: `Bearer ${t}` } : {}
}

/** GET /api/voice/resolve-place → {ok, place, others, why}. */
export async function resolvePlace(q, { sizeKm = null } = {}) {
    const p = new URLSearchParams({ q: String(q || "") })
    if (sizeKm) p.set("size_km", String(sizeKm))
    const r = await fetch(`${API_BASE}/api/voice/resolve-place?${p}`, { credentials: "include", headers: authHeaders() })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) return { ok: false, why: typeof d?.detail === "string" ? d.detail : `The place lookup failed (${r.status}).` }
    return d
}

/** POST /api/watch-zones for a resolved place → the zone (throws with the server's reason). */
export async function createWatchArea({ name, polygon, kind = null, source = null, sizeKm = null, said = null }) {
    const r = await fetch(`${API_BASE}/api/watch-zones`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
            name: String(name || "Watched place").slice(0, 80), polygon_geojson: polygon,
            priority: "high", scan_interval_hours: 24, alert_threshold: "medium",
            description: said ? `Created by voice: “${String(said).slice(0, 160)}”` : null,
            metadata: { place_kind: kind, place_source: source, size_km: sizeKm, ...(said ? { created_by_voice: true } : {}) },
        }),
    })
    const z = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof z?.detail === "string" ? z.detail : `HTTP ${r.status}`)
    return z
}

/** DELETE the area (the voice command's undo). */
export async function deleteWatchArea(systemId) {
    await fetch(`${API_BASE}/api/watch-zones/${encodeURIComponent(systemId)}`, {
        method: "DELETE", credentials: "include", headers: authHeaders(),
    }).catch(() => {})
    window.dispatchEvent(new CustomEvent("akili:zones-changed"))
}

/** After creation: Imagery lists it and opens on it. */
export function openInImagery(zone) {
    window.dispatchEvent(new CustomEvent("akili:zones-changed"))
    const t = { systemId: zone.system_id }
    window.__plxImageryTarget = t
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "imagery" } }))
    window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", { detail: t }))
}

/** A search hit's kind in our words: airport | port | city | place. Pure. */
export function hitKind(h) {
    const t = String(h?.type || "").toLowerCase()
    if (t === "airport") return "airport"
    if (t === "port") return "port"
    const c = String(h?.category || "").toLowerCase()
    if (c === "aeroway") return "airport"
    if (c === "place" || c === "boundary") return "city"
    return "place"
}

/** One click from a search result or the inspector: watch the place, sized by kind. */
export async function watchHit(h) {
    const lat = +(h?.lat ?? h?.latitude), lon = +(h?.lon ?? h?.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("This result has no position.")
    const kind = hitKind(h)
    const km = sizeForKind(kind, h?.airport_type)
    const name = h?.name || h?.display_name || h?.label || "Watched place"
    const z = await createWatchArea({ name: `Watch · ${name}`, polygon: squareKm(lat, lon, km), kind, source: "search", sizeKm: km })
    openInImagery(z)
    return { zone: z, km, name }
}
