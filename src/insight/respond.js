/**
 * respond.js — turn an insight into an action, in one click.
 *
 * watchArea:   a satellite watch zone (POST /api/watch-zones) centred on the
 *              place — a square ~2 × km across, rescanned every 24 h.
 * theaterHere: a new local theater framing the place, with the layers that
 *              fit a security watch, selected at once.
 */
import API_BASE from "../apiBase.js"
import { createTheater } from "../lib/theatersApi.js"
import { toast } from "../ui/toast.js"

export function squareAround(lat, lon, km = 25) {
    const dLat = km / 111
    const dLon = km / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)))
    const [s, n, w, e] = [lat - dLat, lat + dLat, lon - dLon, lon + dLon]
    return { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

export async function watchArea({ name, lat, lon, km = 25 }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { toast("No position to watch", { icon: "i-alert" }); return null }
    const r = await fetch(`${API_BASE}/api/watch-zones`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}` },
        body: JSON.stringify({ name: `Watch · ${name}`.slice(0, 80), polygon_geojson: squareAround(lat, lon, km),
                               priority: "high", scan_interval_hours: 24, alert_threshold: "medium" }),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) { toast(d.detail || "Could not create the watch area", { icon: "i-alert" }); return null }
    toast(`Watching ${name} — satellite scans every 24 h (Overwatch)`, { icon: "i-check" })
    return d
}

export async function theaterHere({ name, lat, lon, height = 450_000 }) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { toast("No position for a theater", { icon: "i-alert" }); return null }
    try {
        const t = await createTheater({
            name: String(name).slice(0, 60), sev: "elevated",
            view: { lat, lon, height },
            layers: { groups: ["news", "alerts", "maritime"], infra: ["chokepoints", "ports", "airfields"], tracks: ["vessels", "aircraft"] },
        })
        window.dispatchEvent(new CustomEvent("akili:theater-created", { detail: { id: t.id } }))
        toast(`Theater “${t.name}” created`, { icon: "i-check" })
        return t
    } catch (e) {
        toast(e.message || "Could not create the theater", { icon: "i-alert" })
        return null
    }
}
