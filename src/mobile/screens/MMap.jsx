/**
 * MMap.jsx — the map on the phone: a light 2-D map (Leaflet) instead of the
 * desktop's 3-D globe, which a phone carries badly.
 *
 *   theaters     Global and the user's own, one tap to go there
 *   filters      the last 24 / 48 / 72 hours; all, high and up, or critical
 *   layers       every desktop layer, with the desktop's icons and groups
 *                (../mapLayers.js), plus live ships and aircraft
 *   a point      opens its sheet: footage, cited X posts, share to the desk
 *
 * Base maps: Esri's dark grey canvas and satellite imagery, each with its
 * place-name layer, credited on the map as their terms ask.
 */
import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import { useMine, usePoll, arr } from "../useMine.js"
import API_BASE from "../../apiBase.js"
import { Icon, Sheet, SignalSheet, sevColor } from "./common.jsx"
import { myPosition, subscribeMyPosition } from "../../location/liveShare.js"
import { LiveNow } from "../../telegram/LivePlayer.jsx"
import { PHONE_LAYERS, layerGroups } from "../mapLayers.js"


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
// EVERY DESKTOP LAYER (owner, 2026-10-10), the desktop's icons and groups:
// ../mapLayers.js. Live ships and aircraft are the phone's own, below.
export const LAYERS = [...PHONE_LAYERS.map((l) => [l.key, l.label]), ["ships", "Ships (AIS, live)"], ["aircraft", "Aircraft (ADS-B, live)"]]
const LIVE_ICON = {
    ships: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 16 16"><path d="M8 1 L12.5 14 L8 11.5 L3.5 14 Z" fill="#3fb6c6" stroke="rgba(0,0,0,.6)"/></svg>'),
    aircraft: "data:image/svg+xml;utf8," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"><path d="M12 2c.8 0 1.3.7 1.3 1.6v5.6l7.7 4.5v2l-7.7-2.3v4.9l2.2 1.6V21L12 20.1 8.5 21v-1.1l2.2-1.6v-4.9L3 15.7v-2l7.7-4.5V3.6C10.7 2.7 11.2 2 12 2z" fill="#dfe3ea" stroke="rgba(0,0,0,.6)" stroke-width=".8"/></svg>'),
}
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

export default function MMap({ active, focus, onOpen, alerts = 0, chrome = true }) {
    const el = useRef(null)
    const map = useRef(null)
    const base = useRef(null)
    const group = useRef(null)
    const [baseKey, setBaseKey] = useState("dark")
    const [hours, setHours] = useState(48)
    const [floor, setFloor] = useState("all")
    const [on, setOn] = useState(() => ({ ...Object.fromEntries(PHONE_LAYERS.map((l) => [l.key, !!l.defaultOn])), ships: true, aircraft: true }))
    const [feats, setFeats] = useState({})        // layer key → its features in view
    const [bounds, setBounds] = useState(null)
    const [ships, setShips] = useState([])
    const [planes, setPlanes] = useState([])
    const [track, setTrack] = useState(null)       // the tapped ship or aircraft
    const tracks = useRef(null)
    const [open, setOpen] = useState(null)
    const [theater, setTheater] = useState("global")
    const [zoom, setZoom] = useState(2)
    const mine = useMine()

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
        setBounds(map.current.getBounds())
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

    // LOAD what is on, for the view: after a pan, and again every few minutes
    // (more slowly while the map is only the background)
    useEffect(() => {
        if (!bounds) return undefined
        let live = true
        const b = { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() }
        const run = () => {
            for (const l of PHONE_LAYERS) {
                if (!on[l.key] || zoom < (l.minZoom || 0)) { setFeats((f) => (f[l.key]?.length ? { ...f, [l.key]: [] } : f)); continue }
                l.load({ bounds: b, zoom, hours }).then((x) => { if (live) setFeats((f) => ({ ...f, [l.key]: Array.isArray(x) ? x : [] })) }).catch(() => {})
            }
        }
        const first = setTimeout(run, 250)
        const t = setInterval(run, active ? 2 * 60_000 : 10 * 60_000)
        return () => { live = false; clearTimeout(first); clearInterval(t) }
    }, [bounds, zoom, hours, on, active])

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

    // DRAW: areas under lines under points, each with the desktop's own image
    useEffect(() => {
        const g = group.current
        if (!g) return
        g.clearLayers()
        const maxRank = floor === "critical" ? 0 : floor === "high" ? 1 : 9
        const tap = (f, l) => () => setOpen({ ...(f.raw || {}), headline: f.title || l.label, title: f.title || l.label, location: f.sub,
                                               severity_tier: f.severity || f.raw?.severity_tier, lat: f.lat ?? f.raw?.lat, lon: f.lon ?? f.raw?.lon })
        const order = { areas: 0, lines: 1, points: 2 }
        for (const l of [...PHONE_LAYERS].sort((a, c) => order[a.kind] - order[c.kind])) {
            if (!on[l.key]) continue
            for (const f of feats[l.key] || []) {
                if (l.kind === "areas") {
                    if (!f.rings) continue
                    const a = L.polygon(f.rings, { color: f.strokeColor || f.color, weight: f.weight ?? 1, fillColor: f.color, fillOpacity: f.fillOpacity ?? 0.15, interactive: !!f.title })
                    if (f.title) a.on("click", tap(f, l))
                    a.addTo(g)
                } else if (l.kind === "lines") {
                    if (!f.coords) continue
                    const ln = L.polyline(f.coords, { color: f.color, weight: f.weight || 2, dashArray: f.dash || undefined, opacity: 0.85, interactive: !!f.title })
                    if (f.title) ln.on("click", tap(f, l))
                    ln.addTo(g)
                } else {
                    if (!Number.isFinite(+f.lat) || !Number.isFinite(+f.lon) || !f.iconUri) continue
                    if (f.severity && (RANK[String(f.severity).toLowerCase()] ?? 3) > maxRank) continue
                    const w = f.iconWidth || f.size || 16, h = f.iconHeight || f.size || 16
                    L.marker([+f.lat, +f.lon], {
                        icon: L.icon({ iconUrl: f.iconUri, iconSize: [w, h], iconAnchor: f.iconAnchor || [w / 2, h / 2] }),
                        keyboard: false, zIndexOffset: f.severity === "critical" ? 500 : 0,
                    }).on("click", tap(f, l)).addTo(g)
                }
            }
        }
    }, [feats, on, floor])

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
    const countOf = (k) => k === "ships" ? ships.length : k === "aircraft" ? planes.length : (feats[k] || []).length
    const tooFar = (l) => zoom < (l.minZoom || 0)
    const timeLabel = `${hours} h`

    return (
        <div className="m2-map" data-screen-label="Phone map">
            {/* its own stacking layer: Leaflet's panes run up to z-index 700 and
                would otherwise cover the sheets that open over the map */}
            <div ref={el} style={{ position: "absolute", inset: 0, zIndex: 0, isolation: "isolate" }} />
            {chrome && <div className="m2-mapui">
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
            </div>}

            {sheet === "filters" && (
                <Sheet onClose={() => setSheet(null)}>
                    <div data-testid="m2-filters">
                        {[...layerGroups(), { group: "Live", layers: [{ key: "ships", label: "Ships (AIS, live)", legendIcon: LIVE_ICON.ships, minZoom: TRACK_ZOOM },
                                                                    { key: "aircraft", label: "Aircraft (ADS-B, live)", legendIcon: LIVE_ICON.aircraft, minZoom: TRACK_ZOOM }] }].map(({ group: gname, layers }) => (
                            <div key={gname}>
                                <div className="m2-h">{gname}</div>
                                <div className="m2-tiles">
                                    {layers.map((l) => (
                                        <button key={l.key} className="m2-tile" aria-pressed={!!on[l.key]} onClick={() => setOn((o) => ({ ...o, [l.key]: !o[l.key] }))} data-layer={l.key}>
                                            <img src={l.legendIcon} alt="" />
                                            <b>{l.label}</b><small>{on[l.key] ? (tooFar(l) ? "zoom in" : countOf(l.key)) : ""}</small>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
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
