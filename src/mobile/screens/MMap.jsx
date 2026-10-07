/**
 * MMap.jsx — the map on the phone: a light 2-D map (Leaflet) instead of the
 * desktop's 3-D globe, which a phone carries badly.
 *
 *   theaters     Global and the user's own, one tap to go there
 *   filters      the last 24 / 48 / 72 hours; all, high and up, or critical
 *   layers       news and verified events, Telegram footage, unrest and
 *                protests, fusions, your assets — each switched on its own
 *   a point      opens its sheet: footage, cited X posts, share to the desk
 *
 * Base maps: Esri's dark grey canvas and satellite imagery, each with its
 * place-name layer, credited on the map as their terms ask.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useMine, usePoll, arr } from "../useMine.js"
import { Icon, Sheet, SignalSheet, sevColor } from "./common.jsx"

// Esri's public base maps, credited as their terms ask (CARTO's now want a key).
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services"
const BASES = {
    dark: { url: `${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
            attribution: "Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16 },
    satellite: { url: `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, labels: `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`,
            attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics", maxZoom: 18 },
}
const WINDOWS = [24, 48, 72]
const FLOORS = [["all", "All"], ["high", "High +"], ["critical", "Critical"]]
const RANK = { critical: 0, significant: 1, high: 1, elevated: 2, moderate: 2, medium: 2, low: 3 }
export const LAYERS = [
    ["signals", "News & verified"], ["telegram", "Telegram footage"], ["unrest", "Unrest & protests"], ["fusions", "Fusions"], ["assets", "My assets"],
]
const zoomFor = (height) => Math.max(2, Math.min(12, Math.round(Math.log2(40_000_000 / Math.max(50_000, height || 2_000_000)) + 1)))
const tsOf = (x) => Date.parse(x.published_at || x.posted_at || x.created_at || x.updated_at || "") || null

export default function MMap({ active, focus }) {
    const el = useRef(null)
    const map = useRef(null)
    const base = useRef(null)
    const group = useRef(null)
    const [baseKey, setBaseKey] = useState("dark")
    const [hours, setHours] = useState(48)
    const [floor, setFloor] = useState("all")
    const [on, setOn] = useState({ signals: true, telegram: true, unrest: true, fusions: true, assets: true })
    const [layersOpen, setLayersOpen] = useState(false)
    const [open, setOpen] = useState(null)
    const [theater, setTheater] = useState("global")
    const [zoom, setZoom] = useState(2)
    const mine = useMine()

    const surface = usePoll(active ? "/api/surface" : null, 60_000, (d) => arr(d?.items ?? d))
    const posts = usePoll(active ? `/api/telegram/posts?hours=${hours}` : null, 2 * 60_000, (d) => arr(d?.posts))
    const fusions = usePoll(active ? "/api/fusions?status=active&limit=200" : null, 2 * 60_000, (d) => arr(d))

    // the map itself, once
    useEffect(() => {
        if (!el.current || map.current) return
        map.current = L.map(el.current, { zoomControl: false, worldCopyJump: true, attributionControl: true, minZoom: 2 }).setView([25, 20], 2)
        // place names above the map, under the points, and never in the way of a tap
        const labels = map.current.createPane("labels")
        labels.style.zIndex = 350
        labels.style.pointerEvents = "none"
        map.current.on("zoomend", () => setZoom(map.current.getZoom()))
        group.current = L.layerGroup().addTo(map.current)
    }, [])
    // visible again after another tab: Leaflet must re-measure
    useEffect(() => { if (active && map.current) setTimeout(() => map.current.invalidateSize(), 60) }, [active])
    useEffect(() => {
        if (!map.current) return
        if (base.current) base.current.remove()
        const b = BASES[baseKey]
        base.current = L.layerGroup([
            L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom }),
            L.tileLayer(b.labels, { maxZoom: b.maxZoom, pane: "labels", opacity: 0.9 }),
        ]).addTo(map.current)
    }, [baseKey])

    const points = useMemo(() => {
        const cutoff = Date.now() - hours * 3600_000
        const maxRank = floor === "critical" ? 0 : floor === "high" ? 1 : 9
        const ok = (x) => Number.isFinite(+x.lat) && Number.isFinite(+x.lon) && (!tsOf(x) || tsOf(x) >= cutoff)
            && (RANK[String(x.severity_tier || x.severity || "").toLowerCase()] ?? 3) <= maxRank
        const out = []
        if (on.signals) for (const s of arr(surface)) if (ok(s) && s.source_type !== "telegram_announcement") out.push({ ...s, _k: "signal" })
        for (const p of arr(posts)) {
            const unrest = p.event_type === "unrest"
            if (!ok(p) || (unrest ? !on.unrest : !on.telegram)) continue
            out.push({ ...p, _k: unrest ? "unrest" : "telegram" })
        }
        if (on.unrest) for (const s of arr(surface)) if (s.source_type === "telegram_announcement" && Number.isFinite(+s.lat)) out.push({ ...s, _k: "announced" })
        if (on.fusions) for (const f of arr(fusions)) if (ok(f)) out.push({ ...f, headline: f.title, _k: "fusion" })
        return out
    }, [surface, posts, fusions, on, hours, floor])

    // draw
    useEffect(() => {
        const g = group.current
        if (!g) return
        g.clearLayers()
        for (const p of points) {
            const color = p._k === "unrest" || p._k === "announced" ? "#f97316" : sevColor(p.severity_tier || p.severity)
            const z = map.current?.getZoom?.() ?? 3
            const r = (p._k === "fusion" ? 6 : p.severity_tier === "critical" ? 5.5 : 4) + (z >= 6 ? 2 : 0)
            const m = L.circleMarker([+p.lat, +p.lon], {
                radius: r, color: p._k === "telegram" && p.media === "video" ? "#ffffff" : "rgba(0,0,0,.55)", weight: p._k === "announced" ? 2 : 1.5,
                fillColor: color, fillOpacity: p._k === "announced" ? 0 : 0.9,
            })
            m.on("click", () => setOpen(p))
            m.addTo(g)
        }
        if (on.assets) for (const a of mine.assets) {
            if (!Number.isFinite(+a.lat)) continue
            L.circle([+a.lat, +a.lon], { radius: (+a.radius_km || 20) * 1000, color: "#7aa7ff", weight: 1, fillOpacity: 0.05, dashArray: "4 4" }).addTo(g)
            L.marker([+a.lat, +a.lon], { icon: L.divIcon({ className: "", html: '<div class="m2-pin" style="width:14px;height:14px;background:#7aa7ff"></div>', iconSize: [14, 14] }) })
                .on("click", () => setOpen({ headline: a.name, location: a.address || a.country, lat: a.lat, lon: a.lon, summary: `${a.kind_label || a.kind} · watch radius ${a.radius_km} km` }))
                .addTo(g)
        }
    }, [points, on.assets, mine.assets, zoom >= 6])

    // something elsewhere asked to be shown here
    useEffect(() => {
        if (!focus || !map.current || !Number.isFinite(+focus.lat)) return
        map.current.setView([+focus.lat, +focus.lon], Math.max(map.current.getZoom(), 9), { animate: true })
        if (focus.headline || focus.title) setOpen(focus)
    }, [focus])

    const goTheater = (id) => {
        setTheater(id)
        if (!map.current) return
        if (id === "global") { map.current.setView([25, 20], 2, { animate: true }); return }
        const t = mine.theaters.find((x) => x.id === id)
        if (t?.view) map.current.setView([t.view.lat, t.view.lon], zoomFor(t.view.height), { animate: true })
    }
    const locate = () => navigator.geolocation?.getCurrentPosition((pos) => map.current?.setView([pos.coords.latitude, pos.coords.longitude], 10, { animate: true }), () => {})
    const counts = points.reduce((c, p) => ({ ...c, [p._k]: (c[p._k] || 0) + 1 }), {})

    return (
        <div className="m2-map" data-screen-label="Phone map">
            {/* its own stacking layer: Leaflet's panes run up to z-index 700 and
                would otherwise cover the sheets that open over the map */}
            <div ref={el} style={{ position: "absolute", inset: 0, zIndex: 0, isolation: "isolate" }} />
            <div className="m2-mapbar">
                <div className="m2-chips">
                    <button className="m2-chip" aria-pressed={theater === "global"} onClick={() => goTheater("global")}><Icon id="g-globe" size={14} />Global</button>
                    {mine.theaters.map((t) => <button key={t.id} className="m2-chip" aria-pressed={theater === t.id} onClick={() => goTheater(t.id)}>{t.name}</button>)}
                </div>
                <div className="m2-chips">
                    {WINDOWS.map((h) => <button key={h} className="m2-chip" aria-pressed={hours === h} onClick={() => setHours(h)}>{h} h</button>)}
                    {FLOORS.map(([k, l]) => <button key={k} className="m2-chip" aria-pressed={floor === k} onClick={() => setFloor(k)}>{l}</button>)}
                </div>
            </div>
            <button className="m2-fab" style={{ bottom: 120 }} onClick={() => setLayersOpen(true)} aria-label="Layers"><Icon id="g-layers" /></button>
            <button className="m2-fab" style={{ bottom: 68 }} onClick={() => setBaseKey(baseKey === "dark" ? "satellite" : "dark")} aria-label="Base map"><Icon id={baseKey === "dark" ? "g-sat" : "g-map"} /></button>
            <button className="m2-fab" style={{ bottom: 16 }} onClick={locate} aria-label="Where I am"><Icon id="g-pin" /></button>
            {layersOpen && (
                <Sheet onClose={() => setLayersOpen(false)}>
                    <div className="m2-eyebrow" style={{ marginBottom: 8 }}>Layers</div>
                    <div className="m2-card">
                        {LAYERS.map(([k, l]) => (
                            <button key={k} className="m2-row" onClick={() => setOn({ ...on, [k]: !on[k] })} aria-pressed={!!on[k]}>
                                <span className="m2-dot" style={{ background: on[k] ? "var(--acchi, #7aa7ff)" : "transparent", border: "1px solid var(--gline2, #555)" }} />
                                <span className="m2-t">{l}</span>
                                <span className="m2-when">{k === "assets" ? mine.assets.length : k === "unrest" ? (counts.unrest || 0) + (counts.announced || 0) : counts[k === "signals" ? "signal" : k === "fusions" ? "fusion" : k] || 0}</span>
                            </button>
                        ))}
                    </div>
                    <div className="m2-sub" style={{ marginTop: 10 }}>Base map: {baseKey === "dark" ? "dark streets" : "satellite"} — switch with the button above the location button.</div>
                </Sheet>
            )}
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={(s) => map.current?.setView([+s.lat, +s.lon], 11, { animate: true })} />}
        </div>
    )
}
