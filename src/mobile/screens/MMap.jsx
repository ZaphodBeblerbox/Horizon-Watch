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
import { Icon, Sheet, SignalSheet } from "./common.jsx"
import MPeek from "./MPeek.jsx"
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
import { closeOpenedSignal } from "../../lib/signalPin.js"
import CountryFlag from "../../components/CountryFlag.jsx"
import { trackCountry } from "../../lib/icaoCountry.js"


import { BASES, FALLBACKS } from "../tileSources.js"
import TrackPanel, { useTrackState } from "../../location/TrackPanel.jsx"
import { drawTrack } from "../trackLeaflet.js"
import { openRoutePanel, subscribeRoutePanel, getRoutePanel } from "../../routes/store.js"
import { drawPlan } from "../../routes/routeLayer.leaflet.js"
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
// SHARPER, LARGER MARKS ON THE PHONE (owner, 2026-10-17: "a much greater
// resolution for all the icons"): every mark is vector, drawn here a fifth
// larger than the desktop's so its detail reads at arm's length.
const PHONE_ICON_SCALE = 1.2
const scaled = (f, dw = 16) => {
    const w = Math.round((f.iconWidth || f.size || dw) * PHONE_ICON_SCALE), h = Math.round((f.iconHeight || f.size || dw) * PHONE_ICON_SCALE)
    const a = f.iconAnchor ? [Math.round(f.iconAnchor[0] * PHONE_ICON_SCALE), Math.round(f.iconAnchor[1] * PHONE_ICON_SCALE)] : [w / 2, h / 2]
    return { w, h, a }
}
// A STEADY MAP (owner: "it lags when you zoom in and out"): event points
// close together on screen are drawn as one count until zoom 11; what is
// yours (assets, people, safe houses), places with their own grouping and
// anything critical are never folded away.
const CLUSTER_LAYERS = new Set(["geoConfirmed", "telegram", "unrest", "strikes", "imagerySignals", "fires", "derivedAlerts",
                                "ports", "airports", "facMilitary", "facMedical", "facSecurity", "power:sites"])
const CLUSTER_PX = 46
const CLUSTER_UNTIL = 11
const CLUSTER_MIN = 3
const clusterIcon = (n) => {
    const d = n >= 100 ? 44 : n >= 20 ? 38 : 32
    return L.divIcon({ className: "", iconSize: [d, d], iconAnchor: [d / 2, d / 2], html: `<div class="m2-cluster">${n > 999 ? "999+" : n}</div>` })
}
const pickedIcon = L.divIcon({ className: "", iconSize: [40, 40], iconAnchor: [20, 20], html: '<div class="m2-picked"></div>' })

export default function MMap({ active, focus, onOpen, alerts = 0, chrome = true }) {
    const el = useRef(null)
    const map = useRef(null)
    const prog = useRef(false)             // a move the app made (not a finger): the card stays
    const drawn = useRef(new Map())        // key → { layer, sig }: marks kept between draws, changed only where changed
    const pts = useRef([])                 // the point signals drawn, for the card's swipe
    const picked = useRef(null)
    const [detail, setDetail] = useState(null)
    const returning = useRef(false)        // the card coming back out of its sheet: no entrance of its own
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
        map.current.on("moveend", () => { setBounds(map.current.getBounds()); setTimeout(() => { prog.current = false }, 60) })
        // the map moved by a finger puts the card away (MPeek; MobileApp's listens too)
        const gesture = () => { setOpen(null); window.dispatchEvent(new CustomEvent("m2:map-gesture")) }
        map.current.on("dragstart", gesture)
        map.current.on("zoomstart", () => { if (!prog.current) gesture() })
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

    // DRAW: areas under lines under points, each with the desktop's own image.
    // KEPT, NOT REBUILT: every mark has a key and a signature; a draw removes
    // what went, adds what came and leaves the rest alone (it used to clear
    // and recreate every marker for each layer's answer — several thousand
    // DOM nodes per pan, which is what made zooming stutter on a phone).
    useEffect(() => {
        const g = group.current, m = map.current
        if (!g || !m) return
        const maxRank = floor === "critical" ? 0 : floor === "high" ? 1 : 9
        const tap = (f, l, key) => () => setOpen({ ...(f.raw || {}), headline: f.title || l.label, title: f.title || l.label, location: f.sub, layerLabel: l.label,
                                                    severity_tier: f.severity || f.raw?.severity_tier, lat: f.lat ?? f.raw?.lat, lon: f.lon ?? f.raw?.lon, _key: key })
        const want = new Map()
        const points = []
        // Telegram posts and GeoConfirmed placemarks a strike pin stands for
        // are drawn as that pin (globe/strikes.js covers)
        const covered = new Set(on.strikes ? (feats.strikes || []).flatMap((f) => f.raw?.covers || []) : [])
        for (const l of PHONE_LAYERS) {
            if (!on[l.key] || l.key === "people") continue                // the team: live markers
            ;(feats[l.key] || []).forEach((f, i) => {
                const key = `${l.key}:${f.id ?? i}`
                if (l.key === "assets" && liveAssets.has(f.raw?.id)) return    // moved by a phone: a live marker
                if ((l.key === "telegram" || l.key === "geoConfirmed") && covered.has(f.id)) return
                // A PERSON'S OWN "(live)" ASSET is that person: drawn once, as the
                // person (the blue dot for you, the team marker for others), never twice
                if (l.key === "assets" && f.raw?.kind === "person" && f.raw?.identifiers?.user_id && on.people) return
                if (l.kind === "areas") {
                    if (!f.rings) return
                    want.set(`a:${key}`, { sig: `${f.color}|${f.strokeColor}|${f.fillOpacity}|${f.weight}|${f.dash}|${f.rings.length}|${JSON.stringify(f.rings[0]?.[0])}|${f.badge?.text || ""}`, make: () => {
                        const a = L.polygon(f.rings, { color: f.strokeColor || f.color, weight: f.weight ?? 1, fillColor: f.color, fillOpacity: f.fillOpacity ?? 0.15, dashArray: f.dash || undefined, interactive: !!f.title, className: f.className })
                        if (f.title) a.on("click", tap(f, l, key))
                        // A count on the area (a zone with a fresh finding).
                        if (f.badge && Number.isFinite(+f.badge.lat) && Number.isFinite(+f.badge.lon)) {
                            const fg = L.featureGroup([a])
                            const bm = L.marker([+f.badge.lat, +f.badge.lon], {
                                icon: L.divIcon({ className: "", iconSize: [22, 22], iconAnchor: [11, 11],
                                                  html: `<div class="m2-aoi-badge">${String(f.badge.text).slice(0, 3).replace(/[<>&"]/g, "")}</div>` }),
                                keyboard: false, zIndexOffset: 400,
                            })
                            if (f.title) bm.on("click", tap(f, l, key))
                            fg.addLayer(bm)
                            return fg
                        }
                        return a
                    } })
                } else if (l.kind === "lines") {
                    if (!f.coords) return
                    want.set(`l:${key}`, { sig: `${f.color}|${f.weight}|${f.dash}|${f.coords.length}|${JSON.stringify(f.coords[0]?.[0])}|${f.marker?.iconUri?.length || 0}`, make: () => {
                        const ln = L.polyline(f.coords, { color: f.color, weight: f.weight || 2, dashArray: f.dash || undefined, opacity: 0.85, interactive: !!f.title })
                        if (f.title) ln.on("click", tap(f, l, key))
                        // a symbol on the line (a movement's unit, a flight's weapon)
                        const mk = f.marker
                        if (mk?.iconUri && Number.isFinite(+mk.lat) && Number.isFinite(+mk.lon)) {
                            const { w, h, a } = scaled({ iconWidth: mk.iconWidth || 18, iconHeight: mk.iconHeight || 18, iconAnchor: mk.iconAnchor })
                            return L.featureGroup([ln, L.marker([+mk.lat, +mk.lon], { icon: L.icon({ iconUrl: mk.iconUri, iconSize: [w, h], iconAnchor: a }), keyboard: false }).on("click", tap(f, l, key))])
                        }
                        return ln
                    } })
                } else {
                    if (!Number.isFinite(+f.lat) || !Number.isFinite(+f.lon) || !f.iconUri) return
                    const rank = RANK[String(f.severity || "").toLowerCase()] ?? 3
                    if (f.severity && rank > maxRank) return
                    points.push({ key, f, l, lat: +f.lat, lon: +f.lon, fold: CLUSTER_LAYERS.has(l.key) && rank > 0 })
                }
            })
        }
        // GROUP what crowds the screen, in a grid of the screen at this zoom
        // (stable as the map pans, so a pan never reshuffles the groups)
        const z = m.getZoom()
        const loose = []
        if (z < CLUSTER_UNTIL) {
            const cells = new Map()
            for (const p of points) {
                if (!p.fold) { loose.push(p); continue }
                const q = m.project([p.lat, p.lon], z)
                const c = `${Math.floor(q.x / CLUSTER_PX)}:${Math.floor(q.y / CLUSTER_PX)}`
                if (!cells.has(c)) cells.set(c, [])
                cells.get(c).push(p)
            }
            for (const [c, list] of cells) {
                if (list.length < CLUSTER_MIN) { loose.push(...list); continue }
                const lat = list.reduce((x, p) => x + p.lat, 0) / list.length, lon = list.reduce((x, p) => x + p.lon, 0) / list.length
                want.set(`c:${z}:${c}`, { sig: `${list.length}|${lat.toFixed(4)}|${lon.toFixed(4)}`, make: () => L.marker([lat, lon], { icon: clusterIcon(list.length), keyboard: false, zIndexOffset: 200 })
                    .on("click", () => {
                        prog.current = true
                        m.flyToBounds(L.latLngBounds(list.map((p) => [p.lat, p.lon])), { padding: [70, 70], maxZoom: Math.min(z + 4, 15), duration: 0.6 })
                    }) })
            }
        } else loose.push(...points)
        for (const p of loose) {
            const { w, h, a } = scaled(p.f)
            want.set(`p:${p.key}`, { sig: `${p.f.iconUri}|${w}|${h}|${p.lat}|${p.lon}`, make: () => L.marker([p.lat, p.lon], {
                icon: L.icon({ iconUrl: p.f.iconUri, iconSize: [w, h], iconAnchor: a }),
                keyboard: false, zIndexOffset: p.f.severity === "critical" ? 500 : 0,
            }).on("click", tap(p.f, p.l, p.key)) })
        }
        const kept = drawn.current
        for (const [k, d] of kept) {
            const w = want.get(k)
            if (!w || w.sig !== d.sig) { g.removeLayer(d.layer); kept.delete(k) }
        }
        for (const [k, w] of want) {
            if (kept.has(k)) continue
            const layer = w.make()
            if (!layer) continue
            layer.addTo(g)
            kept.set(k, { layer, sig: w.sig })
        }
        // what the card swipes through: every point signal, west to east
        pts.current = points.map((p) => ({ key: p.key, lat: p.lat, lon: p.lon, open: tap(p.f, p.l, p.key) })).sort((x, y) => x.lon - y.lon || y.lat - x.lat)
    }, [feats, on, floor, liveKey, zoom]) // eslint-disable-line react-hooks/exhaustive-deps

    // A ROUTE, ON THIS MAP (owner, 2026-10-17: "don't open a new map"): the
    // route planner's tray publishes its plan; drawn here and framed in the
    // map left above the tray
    const routeG = useRef(null)
    const routeFit = useRef(null)
    useEffect(() => {
        const m = map.current
        if (!m) return undefined
        routeG.current = L.layerGroup().addTo(m)
        const draw = (st) => {
            const g = routeG.current
            if (!g) return
            if (!st.open || !st.plan) { g.clearLayers(); if (!st.open) routeFit.current = null; return }
            setOpen(null)
            const b = drawPlan(L, g, st.plan, st.plan.selected || null)
            const key = `${st.plan.origin?.lat},${st.plan.origin?.lon},${st.plan.safest?.key || ""}`
            if (b && b.isValid() && routeFit.current !== key) {
                routeFit.current = key
                prog.current = true
                m.fitBounds(b, { paddingTopLeft: [24, 80], paddingBottomRight: [24, Math.round(window.innerHeight * 0.6)], maxZoom: 17 })
            }
        }
        draw(getRoutePanel())
        const off = subscribeRoutePanel(draw)
        return () => { off(); routeG.current?.remove(); routeG.current = null }
    }, [])

    // THE CARD'S POINT, ringed on the map
    useEffect(() => {
        const m = map.current
        if (!m) return
        if (picked.current) { picked.current.remove(); picked.current = null }
        if (open && Number.isFinite(+open.lat) && Number.isFinite(+open.lon)) {
            picked.current = L.marker([+open.lat, +open.lon], { icon: pickedIcon, interactive: false, keyboard: false, zIndexOffset: -100 }).addTo(m)
        }
    }, [open?.lat, open?.lon, open?._key]) // eslint-disable-line react-hooks/exhaustive-deps
    // THE CARD SWIPES THROUGH WHAT IS IN VIEW, west to east, and the map
    // glides (never jumps) to each, the point kept above the card
    const inView = () => {
        const b = map.current?.getBounds()
        return b ? pts.current.filter((p) => b.contains([p.lat, p.lon])) : []
    }
    const stepPeek = (dir, probe = false) => {
        const list = inView()
        if (!list.length || !open) return false
        let i = list.findIndex((p) => p.key === open._key)
        if (i < 0) {                       // not one of them (a notification's): from the nearest
            const c = map.current.getCenter()
            i = list.reduce((best, p, j) => (Math.hypot(p.lat - c.lat, p.lon - c.lng) < Math.hypot(list[best].lat - c.lat, list[best].lon - c.lng) ? j : best), 0) - (dir > 0 ? 1 : -1)
        }
        const next = list[i + dir]
        if (!next) return false
        if (probe) return true
        next.open()
        const m = map.current
        prog.current = true
        const zz = m.getZoom()
        m.panTo(m.unproject(m.project([next.lat, next.lon], zz).add([0, 70]), zz), { animate: true, duration: 0.45 })
        return true
    }
    // the card put away: what a notification drew for it goes too (lib/signalPin.js)
    // (a finding's boxes stay: the map is moved to look at them)
    const hadOpen = useRef(null)
    useEffect(() => {
        if (open) { hadOpen.current = open; return }
        const was = hadOpen.current
        hadOpen.current = null
        if (was && !was._peekOnly) closeOpenedSignal(was.id)
    }, [open])
    // THE DETAILS: an alert's own record, fetched as the card opens into them
    const openDetail = (x) => {
        setDetail(x)
        const id = x?.alert_id || (/^(ALT|SIG)-/i.test(String(x?.id || "")) ? x.id : null)
        if (!id) return
        fetch(`${API_BASE}/api/alerts/${encodeURIComponent(id)}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((a) => { if (a && (a.title || a.headline)) setDetail((cur) => (cur && cur._key === x._key ? { ...a, ...Object.fromEntries(Object.entries(x).filter(([, v]) => v != null && v !== "")),
                summary: a.message || a.description || x.summary, severity_tier: a.severity || x.severity_tier } : cur)) })
            .catch(() => {})
    }
    const peekList = open?._key ? inView() : []
    const peekIndex = open?._key ? peekList.findIndex((p) => p.key === open._key) : -1

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
    // SHIPS AND AIRCRAFT, MOVED NOT REDRAWN: each keeps its marker; a new
    // position moves it, a new heading turns it, and only the gone are removed
    const trackMarks = useRef(new Map())
    useEffect(() => {
        const g = tracks.current
        if (!g) return
        const seen = new Set()
        const put = (key, lat, lon, iconKey, icon, onTap) => {
            seen.add(key)
            const have = trackMarks.current.get(key)
            if (have) {
                have.m.setLatLng([lat, lon])
                if (have.iconKey !== iconKey) { have.m.setIcon(icon()); have.iconKey = iconKey }
                have.m.off("click").on("click", onTap)
                return
            }
            const m = L.marker([lat, lon], { icon: icon(), keyboard: false }).on("click", onTap).addTo(g)
            trackMarks.current.set(key, { m, iconKey })
        }
        for (const v of ships) {
            if (!Number.isFinite(+v.lat) || !Number.isFinite(+v.lon)) continue
            const deg = Math.round(headingOf(v) / 5) * 5, warn = !!(v.sanctioned || v.watchlisted)
            put(`s:${v.mmsi ?? `${v.lat},${v.lon}`}`, +v.lat, +v.lon, `${deg}|${warn}`, () => shipIcon(deg, warn), () => setTrack({ kind: "ship", ...v }))
        }
        for (const a of planes) {
            if (!Number.isFinite(+a.lat) || !Number.isFinite(+a.lon)) continue
            const deg = Math.round(headingOf(a) / 5) * 5, mil = !!a.military
            put(`a:${a.icao ?? a.hex ?? `${a.lat},${a.lon}`}`, +a.lat, +a.lon, `${deg}|${mil}`, () => planeIcon(deg, mil), () => setTrack({ kind: "aircraft", ...a }))
        }
        for (const [k, x] of trackMarks.current) if (!seen.has(k)) { g.removeLayer(x.m); trackMarks.current.delete(k) }
    }, [ships, planes])

    // something elsewhere asked to be shown here
    useEffect(() => {
        // the card alone: what it is about frames the view itself (a finding's boxes)
        if (focus?._peekOnly) { setOpen({ ...focus, _key: `focus:${focus.id || focus._t}` }); return }
        if (!focus || !map.current || !Number.isFinite(+focus.lat)) return
        // a vessel of concern, live: rings, trail, targets, line to the top one
        if (focus.vesselThreat) {
            if (!threat.current) threat.current = L.layerGroup().addTo(map.current)
            const b = drawVesselThreat(L, threat.current, focus.vesselThreat)
            setThreatOn(true)
            // a pan still running (centred early, MobileApp) would swallow the fit
            // under a half sheet (opened from a notification): framed in the map left above it
            if (b) { prog.current = true; map.current.stop(); map.current.fitBounds(b, { animate: true, ...(focus._noSheet ? { paddingTopLeft: [20, 70], paddingBottomRight: [20, Math.round(window.innerHeight * 0.46) + 10] } : {}) }) }
            // opened from its notification: the vessel's sheet with it
            // (_noSheet: the phone shell has opened the signal's sheet itself)
            if ((focus.headline || focus.title) && !focus._noSheet) setOpen({ ...focus, _key: `focus:${focus.id || focus._t}` })
            return
        }
        if (focus._noSheet) {
            // the signal in the middle of the map left above the half sheet
            const z = Math.max(map.current.getZoom(), 11)
            const c = map.current.unproject(map.current.project([+focus.lat, +focus.lon], z).add([0, Math.round(window.innerHeight * 0.21)]), z)
            prog.current = true
            map.current.setView(c, z, { animate: true })
        } else {
            // the point above the card that opens with it
            const z = Math.max(map.current.getZoom(), 9)
            prog.current = true
            map.current.setView(map.current.unproject(map.current.project([+focus.lat, +focus.lon], z).add([0, 70]), z), z, { animate: true })
        }
        if ((focus.headline || focus.title) && !focus._noSheet) setOpen({ ...focus, _key: focus._key || `focus:${focus.id || focus._t}` })
    }, [focus])
    const clearThreat = () => { threat.current?.clearLayers(); setThreatOn(false) }

    const goTheater = (id) => {
        setTheater(id)
        if (!map.current) return
        prog.current = true
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
                            style={{ border: 0, background: "none", color: "var(--txt)", textDecoration: "underline", font: "inherit", cursor: "pointer", padding: 0 }}>Retry</button>
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
                    {/* BACK TO ME (owner, 2026-10-17): the map centred on where this phone is */}
                    <button className="m2-round m2-me-btn" aria-label="Centre on me" data-testid="m2-recenter" onClick={() => { prog.current = true; nearMe() }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden><path d="M12 2.5 19.5 20 12 16.2 4.5 20Z" transform="rotate(45 12 12)" fill="currentColor" /></svg>
                    </button>
                </div>}
                {/* what is in view, or how to see more */}
                {(on.ships || on.aircraft) && (
                    <div className="m2-pill" data-testid="track-count" style={open ? { opacity: 0 } : undefined}>
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
                <div className="m2-widgets" style={tr.target ? { display: "none" } : open ? { opacity: 0, pointerEvents: "none" } : undefined}>{/* the track panel takes their place */}
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
                                <i style={{ background: "rgba(255,255,255,.1)", border: "1.5px solid rgba(255,255,255,.5)" }} /><b>{t.name}</b>
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
            {open && chrome && !detail && <MPeek s={open} onClose={() => setOpen(null)} onDetails={() => openDetail(open)} returning={returning.current}
                                                 onStep={peekList.length > 1 ? stepPeek : null} index={peekIndex >= 0 ? peekIndex : null} count={peekList.length} />}
            {detail && <SignalSheet s={detail} fromPeek={!!open} onClose={() => { returning.current = true; setDetail(null); setTimeout(() => { returning.current = false }, 600) }} onShowOnMap={(s) => {
                if (s?.vesselThreat && map.current) {
                    if (!threat.current) threat.current = L.layerGroup().addTo(map.current)
                    const b = drawVesselThreat(L, threat.current, s.vesselThreat)
                    setThreatOn(true)
                    prog.current = true
                    if (b) map.current.fitBounds(b, { animate: true })
                    return
                }
                prog.current = true
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
