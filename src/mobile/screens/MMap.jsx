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
import { drawVesselThreat } from "./MVesselThreat.jsx"
import { myPosition, myTrail, subscribeMyPosition } from "../../location/liveShare.js"
import { devicePosition, saveHere, connectionPosition } from "../../components/LocationPrompt.jsx"
import { useStream } from "../../location/useLivePositions.js"
import { freshness, presence } from "../../location/glide.js"
import { createLiveMarkers } from "../liveMarkers.js"
import { getCurrentUser } from "../../state/authStore.js"
import { LiveNow } from "../../telegram/LivePlayer.jsx"
import { PHONE_LAYERS, layerGroups, forgetAssets } from "../mapLayers.js"
import EndangeredCountryChips, { useEndangeredCountries, useEndangeredActive } from "../../components/EndangeredCountryChips.jsx"
import StrikesLayerControls from "../../components/StrikesLayerControls.jsx"
import { useStrikeSettings } from "../../globe/useStrikeSettings.js"
import { getSettings, subscribeSettings, updateSetting } from "../../state/settingsStore.js"
import { deleteTheater } from "../../lib/theatersApi.js"
import TrackPhoto from "../../components/TrackPhoto.jsx"
import { attachFindings } from "../findingsLeaflet.js"
import CountryFlag from "../../components/CountryFlag.jsx"
import { trackCountry } from "../../lib/icaoCountry.js"


import { BASES, FALLBACKS } from "../tileSources.js"
import TrackPanel, { useTrackState } from "../../location/TrackPanel.jsx"
import { drawTrack } from "../trackLeaflet.js"
import { openRoutePanel } from "../../routes/store.js"
import { confirmAction } from "../../ui/confirm.js"
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
// THE TEAM, LIVE (location/positionStream.js): a blue dot with the name and
// how fresh it is; pale and dashed for a city-level fix (a connection's)
const escHtml = (t) => String(t ?? "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]))
const teamIcon = (name, live, coarse) => L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11],
    html: `<div class="m2-team${live ? " live" : ""}${coarse ? " coarse" : ""}" data-testid="team-dot"><i></i><span class="m2-team-label"><b>${escHtml(name)}</b><small data-fresh></small></span></div>` })
const meIcon = (live) => L.divIcon({ className: "", iconSize: [18, 18],
    html: `<div class="m2-me${live ? " live" : ""}" title="You" data-testid="me-dot" data-live="${live ? 1 : 0}"></div>` })
const coarseFix = (p) => p?.source === "ip" || (p?.accuracy_m ?? 0) >= 1000

export default function MMap({ active, focus, onOpen, alerts = 0, chrome = true }) {
    const el = useRef(null)
    const map = useRef(null)
    const base = useRef(null)
    const group = useRef(null)
    const meExtras = useRef(null)          // the accuracy ring and the way you came
    const trackG = useRef(null)            // the shown track (location/track.js, ../trackLeaflet.js)
    const trackFit = useRef(null)
    const liveMarks = useRef(null)         // you, the team and the assets they move: gliding (../liveMarkers.js)
    const [baseKey, setBaseKey] = useState(() => getSettings()?.phoneMapDefault?.base || "dark")
    const [hours, setHours] = useState(48)
    const [floor, setFloor] = useState(() => getSettings()?.phoneMapDefault?.floor || "all")
    // the account's settings can arrive after the map opens: take them then, unless the user has already changed something
    useEffect(() => subscribeSettings((st) => {
        const v = st?.phoneMapDefault
        if (!v || touched.current) return
        setOn({ ...builtIn(), ...(v.layers || {}) }); if (v.base) setBaseKey(v.base); if (v.floor) setFloor(v.floor)
    }), []) // eslint-disable-line react-hooks/exhaustive-deps
    const saveDefault = () => { updateSetting("phoneMapDefault", { layers: on, base: baseKey, floor }); setSavedAt(Date.now()) }
    const resetDefault = () => { updateSetting("phoneMapDefault", null); setOn(builtIn()); setBaseKey("dark"); setFloor("all"); setSavedAt(null) }
    // MY DEFAULT LAYERS (owner, 2026-10-10): saved with the account's
    // settings (Filters › Save as my default), so every phone opens on them
    const builtIn = () => ({ ...Object.fromEntries(PHONE_LAYERS.map((l) => [l.key, !!l.defaultOn])), ships: true, aircraft: true })
    const savedView = () => getSettings()?.phoneMapDefault || null
    const [on, setOn] = useState(() => ({ ...builtIn(), ...(savedView()?.layers || {}) }))
    const touched = useRef(false)
    const [savedAt, setSavedAt] = useState(null)
    const [feats, setFeats] = useState({})        // layer key → its features in view
    const [bounds, setBounds] = useState(null)
    const [ships, setShips] = useState([])
    const [planes, setPlanes] = useState([])
    const [track, setTrack] = useState(null)       // the tapped ship or aircraft
    const tracks = useRef(null)
    const [open, setOpen] = useState(null)
    const [theater, setTheater] = useState("global")
    const [zoom, setZoom] = useState(2)
    const threat = useRef(null)            // the vessel-of-concern live view (MVesselThreat.jsx)
    const [threatOn, setThreatOn] = useState(false)
    const mine = useMine()
    const epCountries = useEndangeredCountries()          // endangered places: the countries chosen
    const epActive = useEndangeredActive()                // and "Active only" (called, or a call within 2 km)
    const strikeSet = useStrikeSettings()                 // strikes: the acts and time window chosen

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
        meExtras.current = L.layerGroup().addTo(map.current)
        trackG.current = L.layerGroup().addTo(map.current)
        liveMarks.current = createLiveMarkers(L, L.layerGroup().addTo(map.current))
        el.current._m2live = liveMarks.current        // reachable for browser checks
        setBounds(map.current.getBounds())
    }, [])
    // what the automatic watch found, as boxes (a finding's notification puts them on show)
    useEffect(() => attachFindings(L, map.current), [])
    // visible again after another tab: Leaflet must re-measure
    useEffect(() => { if (active && map.current) setTimeout(() => map.current.invalidateSize(), 60) }, [active])
    // MEASURED WHENEVER ITS BOX CHANGES (2026-10-12: "markers but no map" on the
    // iPhone): created behind another tab, the map can measure 0×0 and then
    // asks for no tiles while its markers still draw. Re-measure on any size change.
    useEffect(() => {
        if (!el.current || typeof ResizeObserver === "undefined") return undefined
        const ro = new ResizeObserver(() => map.current?.invalidateSize())
        ro.observe(el.current)
        return () => ro.disconnect()
    }, [])
    const [tilesFailed, setTilesFailed] = useState(false)
    // 0 Esri, 1 Esri via our server, 2 Esri second host, 3 OpenStreetMap — and the
    // phone starts from the one that last worked here, not 8 s of failures first
    const [tileSource, setTileSource] = useState(() => { try { const v = +localStorage.getItem("m2-tile-source"); return v > 0 && v < FALLBACKS.length ? v : 0 } catch { return 0 } })
    useEffect(() => {
        if (!map.current) return
        if (base.current) base.current.remove()
        const set = tileSource === 0 ? BASES : FALLBACKS[tileSource - 1]
        const b = set[baseKey] || set.dark
        // ANOTHER TILE SOURCE only when this one plainly fails (2026-10-12): Esri
        // can refuse a phone's network (iCloud Private Relay, some carriers). Many
        // errors AND not one tile within 8 s → the next source; the last failing
        // too → say so, with a retry. A slow connection does not trip it.
        let loaded = 0, failed = 0, settled = false
        const ground = L.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.maxZoom + 2, maxNativeZoom: b.maxZoom, detectRetina: true,
                                             className: b.dim ? "m2-tiles-dim" : "" })
        const next = () => {
            if (settled || loaded > 0 || failed < 8) return
            settled = true
            if (tileSource < FALLBACKS.length) setTileSource(tileSource + 1)
            else setTilesFailed(true)
        }
        ground.on("tileload", () => {
            if (loaded === 0 && tileSource < FALLBACKS.length) { try { localStorage.setItem("m2-tile-source", String(tileSource)) } catch { /* private mode */ } }
            loaded += 1; setTilesFailed(false)
        })
        let timeUp = false
        ground.on("tileerror", () => { failed += 1; if (timeUp) next() })
        const watchdog = setTimeout(() => { timeUp = true; next() }, 8000)
        ground.on("remove", () => clearTimeout(watchdog))
        base.current = L.layerGroup([
            // HIGH RESOLUTION: on a Retina screen, the next zoom's tiles at half size
            ground,
            ...(b.labels ? [L.tileLayer(b.labels, { maxZoom: b.maxZoom + 2, maxNativeZoom: b.maxZoom, pane: "labels", opacity: 0.9, detectRetina: true })] : []),
        ]).addTo(map.current)
        map.current.invalidateSize()
    }, [baseKey, tileSource])

    // LOAD what is on, for the view: after a pan, and again every few minutes
    // (more slowly while the map is only the background)
    useEffect(() => {
        if (!bounds) return undefined
        let live = true
        const b = { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() }
        const run = () => {
            for (const l of PHONE_LAYERS) {
                if (l.key === "people") continue          // pushed live (the stream below), never polled here
                if (!on[l.key] || zoom < (l.minZoom || 0)) { setFeats((f) => (f[l.key]?.length ? { ...f, [l.key]: [] } : f)); continue }
                l.load({ bounds: b, zoom, hours }).then((x) => { if (live) setFeats((f) => ({ ...f, [l.key]: Array.isArray(x) ? x : [] })) }).catch(() => {})
            }
        }
        const first = setTimeout(run, 250)
        const t = setInterval(run, active ? 2 * 60_000 : 10 * 60_000)
        return () => { live = false; clearTimeout(first); clearInterval(t) }
    }, [bounds, zoom, hours, on, active, epCountries, epActive, strikeSet])

    // THE BLUE DOT: where you are (location/liveShare.js), above everything —
    // with the way you came while sharing, and the accuracy as a soft ring.
    // The dot itself glides with the others (liveMarks, below).
    const [me, setMe] = useState(() => myPosition())
    useEffect(() => subscribeMyPosition(setMe), [])
    useEffect(() => {
        const g = meExtras.current
        if (!g) return
        g.clearLayers()
        if (!me?.live) return
        const trail = myTrail().filter((p) => Date.now() - p.at < 6 * 3600_000).map((p) => [p.lat, p.lon])
        if (trail.length > 1) L.polyline(trail, { color: "#3b8cff", weight: 3, opacity: 0.7, interactive: false, className: "m2-me-trail" }).addTo(g)
        if (me.accuracy > 20 && me.accuracy < 3000) L.circle([me.lat, me.lon], { radius: me.accuracy, color: "#3b8cff", weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false }).addTo(g)
    }, [me])

    // THE TRACK on show (an asset's or a person's): coloured by age, its
    // stops, start and end; the replay draws it up to the scrubber
    const tr = useTrackState()
    useEffect(() => {
        if (!trackG.current || !map.current) return
        if (!tr.target) { trackG.current.clearLayers(); trackFit.current = null; return }
        const b = drawTrack(L, trackG.current, tr.data, tr.scrubT)
        const key = `${tr.target.kind}:${tr.target.id}:${tr.range}`
        if (b && b.isValid() && trackFit.current !== key) {
            trackFit.current = key
            map.current.fitBounds(b, { padding: [40, 40], maxZoom: 16 })
        }
    }, [tr.target, tr.data, tr.scrubT, tr.range])

    // THE TEAM AND THE ASSETS THEY MOVE, PUSHED (location/positionStream.js):
    // each position arrives as it is sent, and the marker glides to it
    const stream = useStream(!!active && (on.people || on.assets))
    const uid = getCurrentUser()?.id
    const team = on.people ? stream.people().filter((p) => String(p.user_id) !== String(uid)) : []
    // an asset a phone moves: at that phone's latest position (yours: this
    // device's own fix, fresher than any round trip)
    const liveAssets = new Map()
    if (on.assets) {
        for (const f of feats.assets || []) {
            const a = f.raw || {}
            const linked = a.identifiers?.user_id
            if (linked && a.kind === "person" && on.people) continue        // shown as the person itself
            if (linked && me?.live && String(linked) === String(uid)) { liveAssets.set(a.id, { lat: me.lat, lon: me.lon, at: me.at, f }); continue }
            const sp = stream.asset(a.id)
            if (sp && sp.at >= (Date.parse(a.position?.as_of || "") || 0)) liveAssets.set(a.id, { lat: sp.lat, lon: sp.lon, at: sp.at, gapMs: sp.prevAt ? sp.at - sp.prevAt : undefined, f })
        }
    }
    const liveKey = [...liveAssets.keys()].sort().join("|")
    useEffect(() => {
        const lm = liveMarks.current
        if (!lm) return
        const items = []
        if (me) items.push({ key: "me", lat: me.lat, lon: me.lon, icon: meIcon(!!me.live), iconSig: `me|${!!me.live}`, z: 1000, at: me.live ? me.at : null })
        const now = stream.serverNow()
        for (const p of team) {
            const live = freshness(p.at, now).live
            items.push({ key: `person-${p.user_id}`, lat: p.lat, lon: p.lon, at: p.at, gapMs: p.prevAt ? p.at - p.prevAt : undefined,
                         icon: teamIcon(p.name, live, coarseFix(p)), iconSig: `${p.name}|${live}|${coarseFix(p)}`, z: 900,
                         onClick: () => setOpen({ ...p, headline: `${p.name} — ${live ? "live location" : "last shared location"}`, title: p.name,
                                                  location: coarseFix(p) ? "city level, from their connection" : p.accuracy_m != null ? `within ${Math.round(p.accuracy_m)} m` : null,
                                                  published_at: new Date(p.at).toISOString(), lat: p.lat, lon: p.lon }) })
        }
        for (const [id, x] of liveAssets) {
            const f = x.f
            const w = f.iconWidth || f.size || 16, h = f.iconHeight || f.size || 16
            items.push({ key: `asset-${id}`, lat: x.lat, lon: x.lon, at: x.at, gapMs: x.gapMs, z: 800,
                         icon: L.icon({ iconUrl: f.iconUri, iconSize: [w, h], iconAnchor: f.iconAnchor || [w / 2, h / 2] }), iconSig: f.iconUri,
                         onClick: () => setOpen({ ...(f.raw || {}), headline: f.title, title: f.title, location: f.sub, lat: x.lat, lon: x.lon }) })
        }
        lm.sync(items)
    }) // every render: the stream, your fix and the asset list all change it; sync() only moves what moved
    // "live · 3 s ago", counted up between positions
    useEffect(() => {
        const id = setInterval(() => liveMarks.current?.refresh((e) => (e.at ? presence(e.at, stream.serverNow()) : null)), 1000)
        return () => clearInterval(id)
    }, [stream])
    // AN ASSET LINKED TO YOU appears at once: the first live position creates
    // it on the server, and the cached list does not have it yet
    useEffect(() => {
        if (!me?.live || !on.assets || !bounds) return
        const mineListed = (feats.assets || []).some((f) => String(f.raw?.identifiers?.user_id || "") === String(uid))
        if (mineListed) return
        const l = PHONE_LAYERS.find((x) => x.key === "assets")
        const b = { south: bounds.getSouth(), north: bounds.getNorth(), west: bounds.getWest(), east: bounds.getEast() }
        let live = true
        forgetAssets()
        l?.load({ bounds: b, zoom, hours }).then((x) => { if (live) setFeats((f) => ({ ...f, assets: Array.isArray(x) ? x : [] })) }).catch(() => {})
        return () => { live = false }
    }, [me?.live, Math.round((me?.at || 0) / 30_000)]) // eslint-disable-line react-hooks/exhaustive-deps

    // DRAW: areas under lines under points, each with the desktop's own image
    useEffect(() => {
        const g = group.current
        if (!g) return
        g.clearLayers()
        const maxRank = floor === "critical" ? 0 : floor === "high" ? 1 : 9
        const tap = (f, l) => () => setOpen({ ...(f.raw || {}), headline: f.title || l.label, title: f.title || l.label, location: f.sub,
                                               severity_tier: f.severity || f.raw?.severity_tier, lat: f.lat ?? f.raw?.lat, lon: f.lon ?? f.raw?.lon })
        const order = { areas: 0, lines: 1, points: 2 }
        // Telegram posts and GeoConfirmed placemarks a strike pin stands for
        // are drawn as that pin (globe/strikes.js covers)
        const covered = new Set(on.strikes ? (feats.strikes || []).flatMap((f) => f.raw?.covers || []) : [])
        for (const l of [...PHONE_LAYERS].sort((a, c) => order[a.kind] - order[c.kind])) {
            if (!on[l.key] || l.key === "people") continue                // the team: live markers
            for (const f of feats[l.key] || []) {
                if (l.key === "assets" && liveAssets.has(f.raw?.id)) continue    // moved by a phone: a live marker
                if ((l.key === "telegram" || l.key === "geoConfirmed") && covered.has(f.id)) continue
                // A PERSON'S OWN "(live)" ASSET is that person: drawn once, as the
                // person (the blue dot for you, the team marker for others), never twice
                if (l.key === "assets" && f.raw?.kind === "person" && f.raw?.identifiers?.user_id && on.people) continue
                if (l.kind === "areas") {
                    if (!f.rings) continue
                    const a = L.polygon(f.rings, { color: f.strokeColor || f.color, weight: f.weight ?? 1, fillColor: f.color, fillOpacity: f.fillOpacity ?? 0.15, dashArray: f.dash || undefined, interactive: !!f.title, className: f.className })
                    if (f.title) a.on("click", tap(f, l))
                    a.addTo(g)
                    // A count on the area (a zone with a fresh finding).
                    if (f.badge && Number.isFinite(+f.badge.lat) && Number.isFinite(+f.badge.lon)) {
                        const b = L.marker([+f.badge.lat, +f.badge.lon], {
                            icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11],
                                              html: `<div class="m2-aoi-badge">${String(f.badge.text).slice(0, 3).replace(/[<>&"]/g, "")}</div>` }),
                            keyboard: false, zIndexOffset: 400,
                        })
                        if (f.title) b.on("click", tap(f, l))
                        b.addTo(g)
                    }
                } else if (l.kind === "lines") {
                    if (!f.coords) continue
                    const ln = L.polyline(f.coords, { color: f.color, weight: f.weight || 2, dashArray: f.dash || undefined, opacity: 0.85, interactive: !!f.title })
                    if (f.title) ln.on("click", tap(f, l))
                    ln.addTo(g)
                    // a symbol on the line (a movement's unit, a flight's weapon)
                    const mk = f.marker
                    if (mk?.iconUri && Number.isFinite(+mk.lat) && Number.isFinite(+mk.lon)) {
                        const w = mk.iconWidth || 18, h = mk.iconHeight || 18
                        L.marker([+mk.lat, +mk.lon], {
                            icon: L.icon({ iconUrl: mk.iconUri, iconSize: [w, h], iconAnchor: mk.iconAnchor || [w / 2, h / 2] }),
                            keyboard: false,
                        }).on("click", tap(f, l)).addTo(g)
                    }
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
    }, [feats, on, floor, liveKey]) // eslint-disable-line react-hooks/exhaustive-deps

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
        // a vessel of concern, live: rings, trail, targets, line to the top one
        if (focus.vesselThreat) {
            if (!threat.current) threat.current = L.layerGroup().addTo(map.current)
            const b = drawVesselThreat(L, threat.current, focus.vesselThreat)
            setThreatOn(true)
            // a pan still running (centred early, MobileApp) would swallow the fit
            // under a half sheet (opened from a notification): framed in the map left above it
            if (b) { map.current.stop(); map.current.fitBounds(b, { animate: true, ...(focus._noSheet ? { paddingTopLeft: [20, 70], paddingBottomRight: [20, Math.round(window.innerHeight * 0.46) + 10] } : {}) }) }
            // opened from its notification: the vessel's sheet with it
            // (_noSheet: the phone shell has opened the signal's sheet itself)
            if ((focus.headline || focus.title) && !focus._noSheet) setOpen(focus)
            return
        }
        if (focus._noSheet) {
            // the signal in the middle of the map left above the half sheet
            const z = Math.max(map.current.getZoom(), 11)
            const c = map.current.unproject(map.current.project([+focus.lat, +focus.lon], z).add([0, Math.round(window.innerHeight * 0.21)]), z)
            map.current.setView(c, z, { animate: true })
        } else map.current.setView([+focus.lat, +focus.lon], Math.max(map.current.getZoom(), 9), { animate: true })
        if ((focus.headline || focus.title) && !focus._noSheet) setOpen(focus)
    }, [focus])
    const clearThreat = () => { threat.current?.clearLayers(); setThreatOn(false) }

    const goTheater = (id) => {
        setTheater(id)
        if (!map.current) return
        if (id === "global") { map.current.setView([25, 20], 2, { animate: true }); return }
        const t = mine.theaters.find((x) => x.id === id)
        if (t?.view) map.current.setView([t.view.lat, t.view.lon], zoomFor(t.view.height), { animate: true })
    }

    // NEAR ME: this device's live position; else ask the device, inside the
    // tap (the place saved in the account may be another device's — the
    // desktop's — and is only the last resort)
    const [nearMsg, setNearMsg] = useState(null)
    const nearMe = async () => {
        const at = myPosition()
        if (at?.live) { map.current?.setView([at.lat, at.lon], 14, { animate: true }); return }
        const asked = devicePosition()
        setNearMsg("Finding you…")
        try {
            const p = await asked
            setNearMsg(null)
            map.current?.setView([p.lat, p.lon], p.approximate ? 9 : 14, { animate: true })
            saveHere(p.lat, p.lon, p.label || null)
        } catch (e) {
            setNearMsg(e.message)
            setNearApprox(e.kind === "denied")
            if (at) map.current?.setView([at.lat, at.lon], 9, { animate: true })
        }
    }
    // REFUSED: where the connection is, city level — only if chosen, and said
    const [nearApprox, setNearApprox] = useState(false)
    const goApprox = async (ev) => {
        ev?.stopPropagation?.()
        setNearApprox(false)
        setNearMsg("Finding your connection's city…")
        try {
            const p = await connectionPosition()
            map.current?.setView([p.lat, p.lon], 9, { animate: true })
            saveHere(p.lat, p.lon, p.label ? `${p.label} (approximate)` : null, true)
            setNearMsg(`Approximate location — from your connection, city level${p.label ? ` (${p.label})` : ""}. Not where this phone precisely is.`)
        } catch (e) { setNearMsg(e.message) }
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
    const countOf = (k) => k === "ships" ? ships.length : k === "aircraft" ? planes.length : k === "people" ? team.length : (feats[k] || []).length
    const tooFar = (l) => zoom < (l.minZoom || 0)
    const timeLabel = `${hours} h`

    return (
        <div className="m2-map" data-screen-label="Phone map">
            {/* its own stacking layer: Leaflet's panes run up to z-index 700 and
                would otherwise cover the sheets that open over the map */}
            <div ref={el} style={{ position: "absolute", inset: 0, zIndex: 0, isolation: "isolate" }} />
            {tilesFailed && chrome && (
                <div className="m2-pill" role="alert" style={{ bottom: "auto", top: "calc(env(safe-area-inset-top, 0px) + 66px)" }}>
                    Map tiles could not load ·{" "}
                    <button onClick={() => { try { localStorage.removeItem("m2-tile-source") } catch { /* */ } setTilesFailed(false); setTileSource(0) }}
                            style={{ border: 0, background: "none", color: "var(--acchi, #8fb4e8)", font: "inherit", cursor: "pointer", padding: 0 }}>Retry</button>
                </div>
            )}
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
                {threatOn && (
                    <button className="m2-btn ghost" onClick={clearThreat} data-testid="m2-threat-clear"
                            style={{ position: "absolute", top: "calc(env(safe-area-inset-top, 0px) + 64px)", right: 12, zIndex: 500 }}>
                        Close vessel view
                    </button>
                )}
                {nearMsg && (
                    <div role="alert" data-testid="near-me-msg" className="m2-card" onClick={() => setNearMsg(null)}
                         style={{ position: "absolute", left: 12, right: 12, bottom: "calc(env(safe-area-inset-bottom, 0px) + 150px)", zIndex: 600, padding: "10px 12px", fontSize: 13, lineHeight: 1.5 }}>
                        {nearMsg}
                        {nearApprox && <button className="m2-chip" data-testid="near-me-approx" onClick={goApprox}
                                               style={{ display: "block", marginTop: 8 }}>Use approximate location (your connection, city level)</button>}
                    </div>
                )}
                {/* the widgets, round and labelled, along the bottom */}
                <div className="m2-widgets" style={tr.target ? { display: "none" } : undefined}>{/* the track panel takes their place */}
                    <button className="m2-widget" onClick={() => setSheet("filters")} data-testid="w-filters"><span><Icon id="g-tune" size={22} /></span>Filters</button>
                    <button className="m2-widget" onClick={() => setSheet("time")}><span><Icon id="g-event" size={22} /></span>{timeLabel}</button>
                    <button className="m2-widget" onClick={nearMe}><span><Icon id="g-pin" size={22} /></span>Near me</button>
                    {/* GET ME OUT: the safest way out from where this phone is (routes/RoutePanel.jsx) */}
                    <button className="m2-widget" onClick={() => openRoutePanel({ request: { from: { me: true }, to: null, mode: "foot", purpose: "exit" }, title: "Get me out" })} data-testid="get-me-out">
                        <span className="plx-getout"><Icon id="g-route" size={22} /></span>Get me out</button>
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
                                        <button key={l.key} className="m2-tile" aria-pressed={!!on[l.key]} onClick={() => { touched.current = true; setSavedAt(null); setOn((o) => ({ ...o, [l.key]: !o[l.key] })) }} data-layer={l.key}>
                                            <img src={l.legendIcon} alt="" />
                                            <b>{l.label}</b><small>{on[l.key] ? (tooFar(l) ? "zoom in" : countOf(l.key)) : ""}</small>
                                        </button>
                                    ))}
                                </div>
                                {/* under whichever group holds the layer (it moved to Infrastructure) */}
                                {layers.some((l) => l.key === "endangered") && <EndangeredCountryChips enabled={!!on.endangered} variant="phone" />}
                                {layers.some((l) => l.key === "strikes") && on.strikes && <StrikesLayerControls variant="phone" />}
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
                        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 16 }}>
                            <button className="m2-btn" data-testid="save-default-layers" onClick={saveDefault}>{savedAt ? "Saved as your default" : "Save as my default"}</button>
                            <button className="m2-btn ghost" onClick={resetDefault}>Reset</button>
                        </div>
                        <div className="m2-sub" style={{ marginTop: 6 }}>These layers, the base map and how serious open on every phone you sign in on.</div>
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
                                <i style={{ background: "var(--accdim)", border: "2px solid var(--acchi)" }} /><b>{t.name}</b>
                                {/* DELETE A THEATER here too (owner, 2026-10-11) */}
                                <small role="button" tabIndex={0} aria-label={`Delete ${t.name}`} data-testid="m2-theater-delete"
                                       style={{ fontSize: 20, lineHeight: 1, padding: "2px 4px", color: "var(--txt3)" }}
                                       onClick={async (e) => {
                                           e.stopPropagation()
                                           if (!(await confirmAction({ title: "Are you sure?", message: `Delete the theater “${t.name}”? Anything you filed while watching it stays.`, confirm: "Delete", danger: true }))) return
                                           try {
                                               await deleteTheater(t.id)
                                               if (theater === t.id) goTheater("global")
                                               window.dispatchEvent(new CustomEvent("akili:theater-deleted", { detail: { id: t.id } }))
                                           } catch (err) { window.alert(`Could not delete it — ${err.message}`) }
                                       }}>×</small>
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
            {open && <SignalSheet s={open} onClose={() => setOpen(null)} onShowOnMap={(s) => {
                if (s?.vesselThreat && map.current) {
                    if (!threat.current) threat.current = L.layerGroup().addTo(map.current)
                    const b = drawVesselThreat(L, threat.current, s.vesselThreat)
                    setThreatOn(true)
                    if (b) map.current.fitBounds(b, { animate: true })
                    return
                }
                map.current?.setView([+s.lat, +s.lon], 11, { animate: true })
            }} />}
            {track && <TrackSheet t={track} onClose={() => setTrack(null)} />}
            {active && tr.target && <TrackPanel variant="phone" />}
        </div>
    )
}


/** A ship or an aircraft, in the words a tracker app uses. */
export function TrackSheet({ t, onClose }) {
    const country = trackCountry(t.kind === "ship" ? "vessel" : "aircraft", t)
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
        ["Registered in", country?.name],
        ["Altitude", Number.isFinite(+t.alt_baro) ? `${Math.round(+t.alt_baro).toLocaleString()} ft` : t.alt_baro],
        ["Ground speed", Number.isFinite(+t.gs) ? `${Math.round(+t.gs)} kn` : null],
        ["Track", Number.isFinite(+t.track) ? `${Math.round(+t.track)}°` : null],
        ["Squawk", t.squawk], ["ICAO", t.icao],
    ]
    const title = t.kind === "ship" ? (t.name || `MMSI ${t.mmsi}`) : (String(t.flight || "").trim() || t.icao)
    return (
        <Sheet onClose={onClose}>
            <div data-testid="track-sheet">
                {/* This airframe or this hull, with its credit; nothing if there is no photograph. */}
                <TrackPhoto kind={t.kind === "ship" ? "vessel" : "aircraft"} track={t} alt={title} style={{ marginBottom: 12 }} />
                <div className="m2-eyebrow">{t.kind === "ship" ? "Ship" : t.military ? "Military aircraft" : "Aircraft"}</div>
                <div style={{ fontSize: 20, fontWeight: 650, margin: "2px 0 10px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    {country && <CountryFlag iso2={country.iso2} name={country.name} size={20} />}
                    <span>{title}</span>
                </div>
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
