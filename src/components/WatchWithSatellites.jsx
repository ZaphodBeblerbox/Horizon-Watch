/**
 * WatchWithSatellites.jsx — save the place an alert is about as a recurring
 * satellite watch (an Imagery area), from the Inspector.
 *
 * Optical and radar on every pass, the first pass now; the area's kind
 * (what counts as a signal there) is proposed from its context and can be
 * changed on the Imagery page.
 */
import { useState } from "react"
import API_BASE from "../apiBase.js"
import { squareAround } from "../insight/respond.js"
import { toast } from "../ui/toast.js"

const WATCHABLE = new Set(["alert", "fusion", "surge", "gdelt_event", "event", "geoconfirmed", "telegram",
                           "signal", "thermal_anomaly", "fire", "detection", "port", "airport"])

export function canWatch(entityType, data) {
    const lat = Number(data?.lat ?? data?.latitude ?? data?.centroid_lat)
    const lon = Number(data?.lon ?? data?.longitude ?? data?.centroid_lon)
    return WATCHABLE.has(entityType) && Number.isFinite(lat) && Number.isFinite(lon)
}

export default function WatchWithSatellites({ data }) {
    const [open, setOpen] = useState(false)
    const [km, setKm] = useState(6)
    const [every, setEvery] = useState(24)
    const [busy, setBusy] = useState(false)
    const lat = Number(data?.lat ?? data?.latitude ?? data?.centroid_lat)
    const lon = Number(data?.lon ?? data?.longitude ?? data?.centroid_lon)
    const title = String(data?.headline || data?.title || data?.name || data?.label || "Watched place")
    const [name, setName] = useState(title.replace(/\s+—.*$/, "").slice(0, 60))

    const go = async () => {
        setBusy(true)
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones`, {
                method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim() || "Watched place", polygon_geojson: squareAround(lat, lon, km / 2),
                                       scan_interval_hours: every, priority: "high", alert_threshold: "medium" }),
            })
            const z = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(z.detail || `HTTP ${r.status}`)
            toast(`Watching ${name} every ${every} h — the first optical and radar pass is on its way`, { icon: "i-check" })
            setOpen(false)
            window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", { detail: { systemId: z.system_id } }))
        } catch (e) { toast(`Could not create the watch — ${e.message}`, { icon: "i-alert" }) } finally { setBusy(false) }
    }

    const field = { height: 26, border: "1px solid var(--gline2)", background: "var(--glass2)", color: "var(--txt)", font: "inherit", fontSize: 12 }
    if (!open) return (
        <button onClick={() => setOpen(true)} title="Save this place as a recurring satellite watch (Imagery)"
            style={{ ...field, flex: "1 1 100%", cursor: "pointer", padding: "0 10px" }}>
            Watch with satellites
        </button>
    )
    return (
        <div style={{ flex: "1 1 100%", display: "flex", flexDirection: "column", gap: 6, padding: 8, border: "1px solid var(--gline2)" }}>
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ ...field, padding: "0 8px" }} aria-label="Name of the watched area" />
            <div style={{ display: "flex", gap: 6 }}>
                <select value={km} onChange={(e) => setKm(Number(e.target.value))} style={{ ...field, flex: 1 }}>
                    {[2, 6, 10, 20].map((k) => <option key={k} value={k}>{k} × {k} km</option>)}
                </select>
                <select value={every} onChange={(e) => setEvery(Number(e.target.value))} style={{ ...field, flex: 1 }}>
                    {[6, 12, 24, 48, 120].map((h) => <option key={h} value={h}>every {h} h</option>)}
                </select>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
                <button onClick={go} disabled={busy} style={{ ...field, flex: 1, border: 0, background: "var(--acc)", color: "var(--mz-cream)", fontWeight: 600, cursor: "pointer" }}>
                    {busy ? "Creating…" : "Watch it — optical and radar"}
                </button>
                <button onClick={() => setOpen(false)} style={{ ...field, cursor: "pointer", padding: "0 10px" }}>Cancel</button>
            </div>
        </div>
    )
}
