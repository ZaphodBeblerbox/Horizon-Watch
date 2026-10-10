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
import API_BASE from "../../apiBase.js"
import { Icon, Sheet, SignalSheet, sevColor } from "./common.jsx"
import { myPosition, subscribeMyPosition } from "../../location/liveShare.js"
import { LiveNow } from "../../telegram/LivePlayer.jsx"

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
    ["ships", "Ships (AIS, live)"], ["aircraft", "Aircraft (ADS-B, live)"],
]
// LIVE TRACKS, the way MarineTraffic and Flightradar show them: what is in
// view, from zoom 5 in, an icon turned to its heading, a sheet on tap.
// Ships teal, aircraft pale; amber marks a military aircraft or a
// sanctioned ship — red is kept for severity, as on the desktop.
const TRACK_ZOOM = 5
const TRACK_CAP = 400
const shipIcon = (deg, warn) => L.divIcon({ className: "", iconSize: [16, 16], iconAnchor: [8, 8],
    html: `<svg width="16" height="16" viewBox="0 0 16 16" style="transform:rotate(${deg}deg)"><path d="M8 1 L12.5 14 L8 11.5 L3.5 14 Z" fill="${warn ? "#f5a524" : "#3fb6c6"}" stroke="rgba(0,0,0,.6)" stroke-width="1"/></svg>` })
const planeIcon = (deg, mil) => L.divIcon({ className: "", iconSize: [18, 18], iconAnchor: [9, 9],
    html: `<svg width="18" height="18" viewBox="0 0 24 24" style="transform:rotate(${deg}deg)"><path d="M12 2c.8 0 1.3.7 1.3 1.6v5.6l7.7 4.5v2l-7.7-2.3v4.9l2.2 1.6V21L12 20.1 8.5 21v-1.1l2.2-1.6v-4.9L3 15.7v-2l7.7-4.5V3.6C10.7 2.7 11.2 2 12 2z" fill="${mil ? "#f5a524" : "#dfe3ea"}" stroke="rgba(0,0,0,.6)" stroke-width=".8"/></svg>` })
const headingOf = (v) => (Number.isFinite(+v.heading) && +v.heading !== 511 ? +v.heading : Number.isFinite(+v.cog) ? +v.cog : Number.isFinite(+v.track) ? +v.track : 0)
const zoomFor = (height) => Math.max(2, Math.min(12, Math.round(Math.log2(40_000_000 / Math.max(50_000, height || 2_000_000)) + 1)))
const tsOf = (x) => Date.parse(x.published_at || x.posted_at || x.created_at || x.updated_at || "") || null

export default function MMap({ active, focus, onOpen, alerts = 0 }) {
    const el = useRef(null)
    const map = useRef(null)
    const base = useRef(null)
    const group = useRef(null)
    const [baseKey, setBaseKey] = useState("dark")
    const [hours, setHours] = useState(48)
    const [floor, setFloor] = useState("all")
    const [on, setOn] = useState({ signals: true, telegram: true, unrest: true, fusions: true, assets: true, ships: true, aircraft: true })
    const [bounds, setBounds] = useState(null)
    const [ships, setShips] = useState([])
    const [planes, setPlanes] = useState([])
    const [track, setTrack] = useState(null)       // the tapped ship or aircraft
    const tracks = useRef(null)
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
        map.current.on("moveend", () => setBounds(map.current.getBounds()))
        el.current._m2map = map.current            // reachable for browser checks
        group.current = L.layerGroup().addTo(map.current)
        tracks.current = L.layerGroup().addTo(map.current)
    }, [])
    // visible again after another tab: Leaflet must re-measure
    useEffect(() => { if (active && map.current) setTimeout(() => map.current.invalidateSize(), 60) }, [active])
    useEffect(() => {
        if (!map.current) return
        if (base.current) base.current.remove()
        const b = BASES[baseKey]
        base.current = L.layerGroup([
            // HIGH RESOLUTION: on a Retina screen, the next zoom's tiles at half size
            L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom + 2, maxNativeZoom: b.maxZoom, detectRetina: true }),
            L.tileLayer(b.labels, { maxZoom: b.maxZoom + 2, maxNativeZoom: b.maxZoom, pane: "labels", opacity: 0.9, detectRetina: true }),
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

    // THE BLUE DOT: where you are (location/liveShare.js), above everything
    const [me, setMe] = useState(() => myPosition())
    useEffect(() => subscribeMyPosition(setMe), [])
    const meMarker = useRef(null)
    useEffect(() => {
        if (!map.current) return
        meMarker.current?.remove()
        meMarker.current = null
        if (!me) return
        meMarker.current = L.marker([me.lat, me.lon], {
            icon: L.divIcon({ className: "", html: `<div class="m2-me${me.live ? " live" : ""}" title="You"></div>`, iconSize: [18, 18] }),
            keyboard: false, zIndexOffset: 1000, interactive: false,
        }).addTo(map.current)
    }, [me])

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

    // live tracks in view: after a pan (debounced) and every 15 s
    useEffect(() => {
        const want = active && bounds && zoom >= TRACK_ZOOM && (on.ships || on.aircraft)
        if (!want) { setShips([]); setPlanes([]); return undefined }
        let live = true
        const s = bounds.getSouth(), w = bounds.getWest(), n = bounds.getNorth(), e = bounds.getEast()
        const load = () => {
            if (on.ships) fetch(`${API_BASE}/api/ais/vessels?bbox=${s.toFixed(3)},${w.toFixed(3)},${n.toFixed(3)},${e.toFixed(3)}`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setShips(arr(d.vessels).slice(0, TRACK_CAP)) }).catch(() => {})
            else setShips([])
            if (on.aircraft) fetch(`${API_BASE}/adsb?limit=${TRACK_CAP}&west=${w.toFixed(3)}&south=${s.toFixed(3)}&east=${e.toFixed(3)}&north=${n.toFixed(3)}`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setPlanes(arr(d.aircraft || d.states)) }).catch(() => {})
            else setPlanes([])
        }
        const first = setTimeout(load, 400)
        const t = setInterval(load, 15_000)
        return () => { live = false; clearTimeout(first); clearInterval(t) }
    }, [active, bounds, zoom >= TRACK_ZOOM, on.ships, on.aircraft]) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const g = tracks.current
        if (!g) return
        g.clearLayers()
        for (const v of ships) {
            if (!Number.isFinite(+v.lat) || !Number.isFinite(+v.lon)) continue
            L.marker([+v.lat, +v.lon], { icon: shipIcon(headingOf(v), v.sanctioned || v.watchlisted), keyboard: false })
                .on("click", () => setTrack({ kind: "ship", ...v })).addTo(g)
        }
        for (const a of planes) {
            if (!Number.isFinite(+a.lat) || !Number.isFinite(+a.lon)) continue
            L.marker([+a.lat, +a.lon], { icon: planeIcon(headingOf(a), a.military), keyboard: false })
                .on("click", () => setTrack({ kind: "aircraft", ...a })).addTo(g)
        }
    }, [ships, planes])

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
    const counts = points.reduce((c, p) => ({ ...c, [p._k]: (c[p._k] || 0) + 1 }), {})

    // NEAR ME: where you are (location/liveShare.js), else ask the device
    const nearMe = async () => {
        let at = myPosition()
        if (!at) {
            try { const { devicePosition, saveHere } = await import("../../components/LocationPrompt.jsx"); const p = await devicePosition(); at = p; saveHere(p.lat, p.lon) } catch { return }
        }
        map.current?.setView([at.lat, at.lon], 9, { animate: true })
    }
    // SEARCH, like a tracker app's: places, ports, ships, signals (/api/search)
    const [q, setQ] = useState("")
    const [hits, setHits] = useState([])
    useEffect(() => {
        const t = q.trim()
        if (t.length < 2) { setHits([]); return undefined }
        const id = setTimeout(() => {
            fetch(`${API_BASE}/api/search?q=${encodeURIComponent(t)}&limit=8`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : [])).then((d) => {
                    // a result named only by its date says what it is in its description
                    const seen = new Set()
                    setHits(arr(d).filter((h) => Number.isFinite(+h.lat) && !/^(rule|strategic_zone)$/i.test(h.type || "")).map((h) => {
                        const dated = /^\d{1,2} [A-Z]{3} \d{4}$/.test(String(h.name || "").trim())
                        const title = dated && h.description ? String(h.description).replace(/\s+/g, " ").trim().slice(0, 110) : (h.name || h.display_name)
                        const subline = h.type === "geoconfirmed" ? ["Verified event", dated ? h.name : null, h.faction].filter(Boolean).join(" · ")
                            : [h.type, h.country || h.category].filter(Boolean).join(" · ")
                        return { ...h, _title: title, _sub: subline }
                    }).filter((h) => { const k = h._title; if (seen.has(k)) return false; seen.add(k); return true }))
                })
                .catch(() => setHits([]))
        }, 250)
        return () => clearTimeout(id)
    }, [q])
    const goHit = (h) => {
        setQ(""); setHits([])
        map.current?.setView([+h.lat, +h.lon], /water|strait|sea|gulf|country/i.test(`${h.type || ""} ${h.category || ""}`) ? 6 : 11, { animate: true })
    }
    const streams = usePoll(active ? "/api/telegram/live" : null, 60_000, (d) => arr(d?.streams))
    const [sheet, setSheet] = useState(null)        // "filters" | "time" | "live"
    const LAYER_COLOR = { signals: "#5b9bff", telegram: "#e5e9f0", unrest: "#f97316", fusions: "#c084fc", assets: "#c9a227", ships: "#3fb6c6", aircraft: "#dfe3ea" }
    const countOf = (k) => k === "ships" ? ships.length : k === "aircraft" ? planes.length : k === "assets" ? mine.assets.length
        : k === "unrest" ? (counts.unrest || 0) + (counts.announced || 0) : counts[k === "signals" ? "signal" : k === "fusions" ? "fusion" : k] || 0
    const timeLabel = `${hours} h`

    return (
        <div className="m2-map" data-screen-label="Phone map">
            {/* its own stacking layer: Leaflet's panes run up to z-index 700 and
                would otherwise cover the sheets that open over the map */}
            <div ref={el} style={{ position: "absolute", inset: 0, zIndex: 0, isolation: "isolate" }} />
            <div className="m2-mapui">
                {/* search, as a tracker app has it: one round bar on top */}
                <label className="m2-search">
                    <Icon id="g-search" size={18} />
                    <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search places, ports, ships, signals" aria-label="Search the map" />
                    {q && <button onClick={() => { setQ(""); setHits([]) }} aria-label="Clear" style={{ border: 0, background: "none", color: "var(--txt3)", fontSize: 18, cursor: "pointer" }}>×</button>}
                </label>
                <button className="m2-round" style={{ position: "absolute", right: 12, top: "calc(env(safe-area-inset-top, 0px) + 10px)" }}
                        aria-label="Alerts" onClick={() => onOpen?.("alerts")}>
                    <Icon id="g-bell" />{alerts > 0 && <span className="m2-badge">{Math.min(99, alerts)}</span>}
                </button>
                {hits.length > 0 && (
                    <div className="m2-results" role="listbox">
                        {hits.map((h, i) => (
                            <button key={i} role="option" onClick={() => goHit(h)}>
                                <Icon id={/ship|vessel/i.test(h.type || "") ? "g-ship" : /aircraft|flight/i.test(h.type || "") ? "g-plane" : "g-pin"} size={18} />
                                <span style={{ minWidth: 0 }}>
                                    <span className="m2-t" style={{ fontSize: 14.5 }}>{h._title}</span>
                                    <span className="m2-sub">{h._sub}</span>
                                </span>
                            </button>
                        ))}
                    </div>
                )}
                {/* round controls on the right (out of the way of search results) */}
                {hits.length === 0 && <div className="m2-rstack" style={{ top: "calc(env(safe-area-inset-top, 0px) + 70px)" }}>
                    <button className="m2-round" aria-label={baseKey === "dark" ? "Satellite map" : "Dark map"} onClick={() => setBaseKey(baseKey === "dark" ? "satellite" : "dark")}>
                        <Icon id={baseKey === "dark" ? "g-sat" : "g-layers"} />
                    </button>
                    <button className="m2-round" aria-label="Whole world" onClick={() => goTheater("global")}><Icon id="g-globe" /></button>
                    {mine.theaters.length > 0 && <button className="m2-round" aria-label="My theaters" onClick={() => setSheet("theaters")}><Icon id="g-tabs" /></button>}
                </div>}
                {/* what is in view, or how to see more */}
                {(on.ships || on.aircraft) && (
                    <div className="m2-pill" data-testid="track-count">
                        {zoom < TRACK_ZOOM ? "Zoom in for ships and aircraft"
                            : [on.ships && `${ships.length} ships`, on.aircraft && `${planes.length} aircraft`].filter(Boolean).join(" · ")}
                    </div>
                )}
                {/* the widgets, round and labelled, along the bottom */}
                <div className="m2-widgets">
                    <button className="m2-widget" onClick={() => setSheet("filters")} data-testid="w-filters"><span><Icon id="g-tune" size={22} /></span>Filters</button>
                    <button className="m2-widget" onClick={() => setSheet("time")}><span><Icon id="g-event" size={22} /></span>{timeLabel}</button>
                    <button className="m2-widget" onClick={nearMe}><span><Icon id="g-pin" size={22} /></span>Near me</button>
                    <button className="m2-widget" onClick={() => setSheet("live")}><span><Icon id="g-play" size={22} />{arr(streams).length > 0 && <span className="m2-badge">{arr(streams).length}</span>}</span>Live</button>
                </div>
            </div>

            {sheet === "filters" && (
                <Sheet onClose={() => setSheet(null)}>
                    <div data-testid="m2-filters">
                        <div className="m2-h">On the map</div>
                        <div className="m2-tiles">
                            {LAYERS.map(([k, l]) => (
                                <button key={k} className="m2-tile" aria-pressed={!!on[k]} onClick={() => setOn({ ...on, [k]: !on[k] })}>
                                    <i style={{ background: on[k] ? LAYER_COLOR[k] : "transparent", border: `2px solid ${LAYER_COLOR[k]}` }} />
                                    <b>{l}</b><small>{countOf(k)}</small>
                                </button>
                            ))}
                        </div>
                        <div className="m2-h">How serious</div>
                        <div className="m2-segs">
                            {FLOORS.map(([k, l]) => <button key={k} aria-pressed={floor === k} onClick={() => setFloor(k)}>{l}</button>)}
                        </div>
                        <div className="m2-h">Base map</div>
                        <div className="m2-basemaps">
                            <button aria-pressed={baseKey === "dark"} onClick={() => setBaseKey("dark")} style={{ background: "linear-gradient(160deg,#2a2f3a,#12151b)" }}>Dark</button>
                            <button aria-pressed={baseKey === "satellite"} onClick={() => setBaseKey("satellite")} style={{ background: "linear-gradient(160deg,#4d5a3a,#1f2c3d)" }}>Satellite</button>
                        </div>
                    </div>
                </Sheet>
            )}
            {sheet === "time" && (
                <Sheet onClose={() => setSheet(null)}>
                    <div className="m2-h">Show the last</div>
                    <div className="m2-segs">
                        {[...WINDOWS, 168].map((h) => <button key={h} aria-pressed={hours === h} onClick={() => { setHours(h); setSheet(null) }}>{h === 168 ? "7 d" : `${h} h`}</button>)}
                    </div>
                </Sheet>
            )}
            {sheet === "theaters" && (
                <Sheet onClose={() => setSheet(null)}>
                    <div className="m2-h">Your theaters</div>
                    <div className="m2-tiles">
                        {mine.theaters.map((t) => (
                            <button key={t.id} className="m2-tile" aria-pressed={theater === t.id} onClick={() => { goTheater(t.id); setSheet(null) }}>
                                <i style={{ background: "var(--accdim)", border: "2px solid var(--acchi)" }} /><b>{t.name}</b><small />
                            </button>
                        ))}
                    </div>
                </Sheet>
            )}
            {sheet === "live" && (
                <Sheet onClose={() => setSheet(null)}>
                    <div className="m2-h">Live on Telegram now</div>
                    {arr(streams).length === 0 ? <div className="m2-empty">No channel we read is live right now. You are told the moment one goes live.</div>
                        : <LiveNow compact />}
                </Sheet>
            )}
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={(s) => map.current?.setView([+s.lat, +s.lon], 11, { animate: true })} />}
            {track && <TrackSheet t={track} onClose={() => setTrack(null)} />}
        </div>
    )
}


/** A ship or an aircraft, in the words a tracker app uses. */
export function TrackSheet({ t, onClose }) {
    const rows = t.kind === "ship" ? [
        ["Flag", [t.flag_emoji, t.flag].filter(Boolean).join(" ")],
        ["Type", t.ship_type || t.ship_type_text],
        ["Speed", Number.isFinite(+t.speed) ? `${(+t.speed).toFixed(1)} kn` : null],
        ["Course", Number.isFinite(+t.cog) ? `${Math.round(+t.cog)}°` : null],
        ["Status", t.nav_status],
        ["Destination", t.destination],
        ["MMSI", t.mmsi], ["IMO", t.imo],
        ["Sanctions", t.sanctioned ? "listed" : null],
    ] : [
        ["Type", t.type], ["Operator", t.airline || (t.military ? "military" : null)],
        ["Altitude", Number.isFinite(+t.alt_baro) ? `${Math.round(+t.alt_baro).toLocaleString()} ft` : t.alt_baro],
        ["Ground speed", Number.isFinite(+t.gs) ? `${Math.round(+t.gs)} kn` : null],
        ["Track", Number.isFinite(+t.track) ? `${Math.round(+t.track)}°` : null],
        ["Squawk", t.squawk], ["ICAO", t.icao],
    ]
    const title = t.kind === "ship" ? (t.name || `MMSI ${t.mmsi}`) : (String(t.flight || "").trim() || t.icao)
    return (
        <Sheet onClose={onClose}>
            <div data-testid="track-sheet">
                <div className="m2-eyebrow">{t.kind === "ship" ? "Ship" : t.military ? "Military aircraft" : "Aircraft"}</div>
                <div style={{ fontSize: 20, fontWeight: 650, margin: "2px 0 10px" }}>{title}</div>
                <div className="m2-card">
                    {rows.filter(([, v]) => v != null && v !== "").map(([k, v]) => (
                        <div key={k} className="m2-row" style={{ cursor: "default", gridTemplateColumns: "110px 1fr" }}>
                            <span className="m2-sub" style={{ margin: 0 }}>{k}</span><span className="m2-t" style={{ fontWeight: 500 }}>{v}</span>
                        </div>
                    ))}
                </div>
                {t.name_status && <div className="m2-sub" style={{ marginTop: 8 }}>{t.name_status}</div>}
            </div>
        </Sheet>
    )
}
