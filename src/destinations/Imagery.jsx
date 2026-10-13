/**
 * Imagery.jsx — what the satellites saw over the areas being watched.
 *
 * IT LEADS WITH THE ANSWER. The page used to open on a list of fifty
 * identical "2026-10-04 · 15 storage tank · 1 port infrastructure" rows and
 * eighteen "storage tank · existing" detections: the measurements, with
 * the reading left to the analyst. It now opens on one sentence of what
 * changed since the previous pass ("Since 29 Sep: 1 vessel fewer"), the
 * imagery analyst's note on what the pass shows (scene_note.py, the cheap
 * vision model), and one action — put it on the map.
 *
 * Below that: the scene itself with every detection drawn as its own
 * outline (the ship's rotated hull, the tank's footprint), the passes as
 * acquisitions rather than checks, the counts per kind across passes, and
 * the detections grouped by kind with the changed kinds first.
 *
 * The comparison machinery (ZoomPanViewer, swipe, split) is unchanged —
 * see components/imagery/sceneComparison.jsx. What this page derives from
 * the scans is in imageryModel.js, with tests.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { toast } from "../ui/toast.js"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import { fileSignal } from "../state/filing.js"
import { agoLabel } from "../utils/formatTime.js"
import { squareAround } from "../insight/respond.js"
import {
    AOI_CLASSES, fmtDate, SceneComparison,
} from "../components/imagery/sceneComparison.jsx"
import { acquisitions, changeHeadline, countSeries, DET_COLORS, fmtDay, groupDetections, noun, pickInitialPass } from "./imageryModel.js"
import { fetchFindings, findingOutlines as findingOutlinesFor, isRadarFinding, shortLabel, showFindings, strengthText } from "../lib/findings.js"
import { RADAR_BRIGHTER, RADAR_CAVEATS, RADAR_DARKER, RADAR_WHAT } from "../lib/radarExplain.js"
import FindingViewer from "../components/imagery/FindingViewer.jsx"
import FindingThumb from "../components/imagery/FindingThumb.jsx"
import { buildZoneTree, hasFindings, isBackground, isProposal, zoneFinding } from "./overwatchTree.js"
import { hm } from "../utils/clock.js"
import { confirmAction } from "../ui/confirm.js"

const safeArray = (v) => (Array.isArray(v) ? v : [])
const ON = "var(--accdim)"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const CARD = { border: "1px solid var(--gline)", background: "var(--glass2)" }
const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt)", font: "inherit",
    fontSize: 12, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const PRIMARY = { ...BTN, border: 0, background: "var(--acc)", color: "var(--mz-cream)", fontWeight: 600 }
const FIELD = {
    width: "100%", height: 28, padding: "0 8px", border: "1px solid var(--gline2)",
    background: "var(--glass2)", color: "var(--txt)", font: "inherit",
    fontSize: 12.5, outline: "none", borderRadius: 0, boxSizing: "border-box",
}
const KIND_C = DET_COLORS
const KIND_WORD = { new: "new since the last pass", removed: "gone since the last pass", existing: "there before", expanded: "grew", unconfirmed: "one model only, not seen before" }
const SENSOR = { OPTICAL: "Sentinel-2 optical · 10 m", SAR: "Sentinel-1 radar · 10 m" }
const MODES = [["Scene", "scene"], ["Swipe", "swipe"], ["Side by side", "split"], ["Fade", "fade"], ["Blink", "blink"]]

const whenFull = (iso) => {
    if (!iso) return "—"
    const s = String(iso)
    const hhmm = s.length > 10 ? `, ${hm(s)}` : ""
    return `${fmtDay(s)} ${s.slice(0, 4)}${hhmm}`
}

/** Draw a new area on the map, or a new boundary for an existing one. */
function drawOnMap(zone = null, mode = "rectangle") {
    window.dispatchEvent(new CustomEvent("akili:open-map"))
    // After the switch, so the map is there to draw on.
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:imagery-draw", {
        detail: zone ? { systemId: zone.system_id, name: zone.name, mode } : { mode },
    })), 250)
}

export default function Imagery() {
    const [manage, setManage] = useState(false)
    const [sensor, setSensor] = useState("optical")       // optical | radar
    const [adding, setAdding] = useState(false)
    const [zones, setZones] = useState(null)
    const [zoneId, setZoneId] = useState(null)
    const [scans, setScans] = useState([])
    const [scanId, setScanId] = useState(null)
    const [scene, setScene] = useState(null)
    const [loadingScene, setLoadingScene] = useState(false)
    const [err, setErr] = useState(null)
    const [target, setTarget] = useState(() => window.__plxImageryTarget || null)
    // Overwatch: which conflict the panel is on, and the group to open —
    // set by the voice command "generate overwatch zones for Ukraine".
    const [owConflict, setOwConflict] = useState(() => window.__plxImageryOverwatch?.conflict || "ukraine")
    const [owFocus, setOwFocus] = useState(() => window.__plxImageryOverwatch?.group || null)

    const [sar, setSar] = useState({})                    // {loading, error, data}
    const [sarDate, setSarDate] = useState(null)
    const stageRef = useRef(null)
    const [fit, setFit] = useState({ w: 0, h: 0, cw: 0 })
    const [mode, setMode] = useState("scene")
    const [against, setAgainst] = useState("prev")        // prev | hires | date:YYYY-MM-DD | pass:<scanId>
    const [compareImg, setCompareImg] = useState(null)    // {b64, label, date, loading, error}
    const [compareTry, setCompareTry] = useState(0)
    const [dates, setDates] = useState([])
    const [context, setContext] = useState(null)
    const [fadeOpacity, setFadeOpacity] = useState(50)
    const [blinkOn, setBlinkOn] = useState(true)
    const [showBoxes, setShowBoxes] = useState(true)
    const [swipePos, setSwipePos] = useState(50)
    const [changesOnly, setChangesOnly] = useState(false)
    const [selectedDet, setSelectedDet] = useState(null)
    const [openGroup, setOpenGroup] = useState(null)
    const clipRef = useRef(null)
    const fadeRef = useRef(null)
    const viewerRef = useRef(null)

    const zone = useMemo(() => safeArray(zones).find((z) => z.system_id === zoneId) || null, [zones, zoneId])
    const allPasses = useMemo(() => acquisitions(scans), [scans])
    // A radar CHANGE run is stored as a SAR scan with regions and no image;
    // counting it as a radar pass left the radar view on a pass with nothing
    // to show (2026-10-11 "SAR loading doesn't work"). Only passes holding an
    // image are viewable; with none, the latest pass is fetched live.
    const sarPasses = useMemo(() => allPasses.filter((p) => p.instrument === "SAR" && p.hasImage), [allPasses])
    // The passes of the sensor being looked at. Radar passes stored by the
    // scanner are read like optical ones; with none stored, radar is
    // fetched live (liveRadar).
    const passes = useMemo(() => allPasses.filter((p) => (sensor === "radar" ? p.instrument === "SAR" && p.hasImage : p.instrument !== "SAR")), [allPasses, sensor])
    const liveRadar = sensor === "radar" && sarPasses.length === 0
    const series = useMemo(() => countSeries(passes), [passes])

    // Another screen asked for a scene (Inbox "open imagery", a briefing's
    // change-detection link): find its area and pass.
    useEffect(() => {
        const h = (e) => setTarget(e.detail || null)
        window.addEventListener("akili:imagery-open-scene", h)
        return () => window.removeEventListener("akili:imagery-open-scene", h)
    }, [])
    // A finding to open on its image once the area's findings are read
    // (a notification's "Open in Imagery").
    const pendingFinding = useRef(null)
    useEffect(() => {
        if (!target) return
        window.__plxImageryTarget = null
        if (target.findingId) pendingFinding.current = { zoneId: target.systemId, id: target.findingId }
        const go = (systemId, sid) => { if (systemId) { setZoneId(systemId); setManage(false) } if (sid) setScanId(sid) }
        if (target.detectionId && !target.scanId) {
            fetch(`${API_BASE}/api/imagery/detections/${target.detectionId}/locate`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).then((d) => d && go(d.system_id, d.scan_id)).catch(() => {})
        } else go(target.systemId, target.scanId)
    }, [target])

    const loadZonesRef = useRef(null)
    useEffect(() => {
        const open = (d) => {
            if (!d) return
            window.__plxImageryOverwatch = null
            if (d.conflict) setOwConflict(d.conflict)
            if (d.group) setOwFocus(d.group)
            setManage(true)
            loadZonesRef.current?.()
        }
        open(window.__plxImageryOverwatch)
        const h = (e) => open(e.detail)
        window.addEventListener("akili:imagery-overwatch", h)
        return () => window.removeEventListener("akili:imagery-overwatch", h)
    }, [])
    const loadZones = useCallback(() => {
        fetch(`${API_BASE}/api/watch-zones`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => {
                const list = Array.isArray(d) ? d : safeArray(d?.zones)
                setZones(list)
                // Never open on a proposal or the sweep's bookkeeping zones.
                setZoneId((cur) => cur || list.find((z) => !isBackground(z))?.system_id || null)
            })
            .catch((e) => setErr(e.message))
    }, [])
    useEffect(() => { loadZonesRef.current = loadZones; loadZones() }, [loadZones])
    // a zone saved or deleted elsewhere (the map's satellite panel, a
    // notification card) appears here at once (owner, 2026-10-11)
    useEffect(() => {
        const h = () => loadZones()
        window.addEventListener("akili:zones-changed", h)
        return () => window.removeEventListener("akili:zones-changed", h)
    }, [loadZones])
    // The strip holds the hand-drawn areas as buttons; generated overwatch
    // zones (forty at a time) go in one grouped picker beside them.
    const stripZones = useMemo(() => safeArray(zones).filter((z) => !isBackground(z) && !z.metadata?.group), [zones])
    const pickerTree = useMemo(() => buildZoneTree(safeArray(zones).filter((z) => !isBackground(z) && z.metadata?.group), { findingsFirst: true }), [zones])
    const freshCount = useMemo(() => safeArray(zones).filter((z) => !isBackground(z) && zoneFinding(z).fresh).length, [zones])
    const proposedCount = useMemo(() => safeArray(zones).filter(isProposal).length, [zones])

    /* THE PASSES OF THE AREA ON SCREEN, AND ONLY THAT AREA (2026-10-12).
       Switching areas used to leave the previous area's passes in place
       until the new list arrived — the pass picker then chose one of the OLD
       area's scans and its scene was fetched for the new area — and a slow
       answer for the previous area could land after the new one. Each
       request is numbered; only the latest is taken. A failed list says so. */
    const scansReq = useRef(0)
    const scanIdRef = useRef(scanId)
    scanIdRef.current = scanId
    const [scansErr, setScansErr] = useState(null)
    const loadScans = useCallback((zid) => {
        const n = ++scansReq.current
        if (!zid) { setScans([]); return }
        setScansErr(null)
        fetch(`${API_BASE}/api/watch-zones/${zid}/scans`, { credentials: "include" })
            .then(async (r) => { if (!r.ok) throw new Error(`the server answered ${r.status}`); return r.json() })
            .then((d) => {
                if (n !== scansReq.current) return
                const list = Array.isArray(d) ? d : safeArray(d?.scans)
                setScans(list)
                const pick = pickInitialPass(list, scanIdRef.current)
                if (pick.scanId && pick.scanId !== scanIdRef.current) setSensor(pick.sensor)
                setScanId(pick.scanId)
            })
            .catch((e) => {
                if (n !== scansReq.current) return
                setScans([])
                setScansErr(e instanceof TypeError ? "the server did not answer (network or server error)" : e.message)
            })
    }, [])
    useEffect(() => { setScans([]); loadScans(zoneId) }, [zoneId, loadScans])
    // A NEW AREA'S FIRST PASS (a voice command, "Watch area" on a search
    // result): the scan was started on creation and lands a minute or two
    // later — look again every 20 s for ten minutes instead of leaving
    // "not photographed yet" on screen until a reload.
    const zoneCreated = safeArray(zones).find((z) => z.system_id === zoneId)?.created_at || null
    const noPassYet = !scans.some((x) => x?.status === "completed")
    useEffect(() => {
        if (!zoneId || !noPassYet || !zoneCreated) return undefined
        const ageMs = Date.now() - new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(zoneCreated) ? zoneCreated : `${zoneCreated}Z`).getTime()
        if (!(ageMs < 10 * 60_000)) return undefined
        const t = setInterval(() => loadScans(zoneId), 20_000)
        return () => clearInterval(t)
    }, [zoneId, noPassYet, zoneCreated, loadScans])

    // What to look for here — asked for first, because the imagery note is
    // written against it.
    useEffect(() => {
        if (!zoneId) return undefined
        let live = true, timer = null, tries = 0
        setContext(null); setDates([]); setAgainst("prev")
        const read = () => fetch(`${API_BASE}/api/imagery/zones/${zoneId}/context`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!live) return; setContext(d); if (d?.pending && tries++ < 12) timer = setTimeout(read, 5000) })
            .catch(() => {})
        read()
        fetch(`${API_BASE}/api/imagery/zones/${zoneId}/dates?days=730`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setDates(safeArray(d?.dates)) }).catch(() => {})
        return () => { live = false; clearTimeout(timer) }
    }, [zoneId])

    // The scene, and — while the analyst's note is being written — a
    // re-read until it arrives.
    /* THE SCENE, with a visible failure (2026-10-12). A failed read used to
       be swallowed — the stage stayed empty under "Pick a pass." with no
       reason and no retry, which is most of "the image sometimes doesn't
       load". The note is then polled ALONE (?note_only=1): re-reading the
       whole scene every 6 s re-sent one or two megabytes of image each time
       and held a server worker while doing it. */
    const [sceneErr, setSceneErr] = useState(null)
    const [sceneTry, setSceneTry] = useState(0)
    useEffect(() => {
        if (!scanId) { setScene(null); setSceneErr(null); return undefined }
        let live = true, timer = null, tries = 0, full = 0
        const ctl = typeof AbortController !== "undefined" ? new AbortController() : null
        setLoadingScene(true); setScene(null); setSelectedDet(null); setSceneErr(null)
        const url = `${API_BASE}/api/imagery/scenes/${scanId}`
        const pollNote = () => {
            if (tries++ >= 15) return
            timer = setTimeout(() => {
                // A note not even requested yet (the area's context was not
                // known at the first read) needs the full read to start it.
                const fullRead = full < 2 && tries % 5 === 4
                if (fullRead) full += 1
                fetch(fullRead ? url : `${url}?note_only=1`, { credentials: "include" })
                    .then((r) => (r.ok ? r.json() : null))
                    .then((d) => {
                        if (!live) return
                        if (d?.note) setScene((cur) => (cur ? { ...cur, note: d.note, note_pending: false } : cur))
                        else pollNote()
                    })
                    .catch(() => { if (live) pollNote() })
            }, 6000)
        }
        fetch(url, { credentials: "include", signal: ctl?.signal })
            .then(async (r) => {
                const d = await r.json().catch(() => null)
                if (!r.ok) throw new Error(typeof d?.detail === "string" ? d.detail : `the server answered ${r.status}`)
                return d
            })
            .then((d) => {
                if (!live) return
                setScene(d)
                if (d && !d.note && d.image_b64) pollNote()
            })
            .catch((e) => {
                if (!live || e?.name === "AbortError") return
                setSceneErr(e instanceof TypeError ? "the server did not answer (network or server error)" : e.message)
            })
            .finally(() => { if (live) setLoadingScene(false) })
        return () => { live = false; clearTimeout(timer); ctl?.abort() }
    }, [scanId, sceneTry])

    const note = scene?.note || null
    const allChanges = useMemo(() => {
        const doubtful = new Set(note?.doubtful || [])
        const notable = new Map((note?.notable || []).map((n) => [n.id, n.note]))
        return safeArray(scene?.changes).map((c) => ({ ...c, doubtful: doubtful.has(c.id), note: notable.get(c.id) || c.note || "" }))
    }, [scene, note])
    const changes = useMemo(
        () => (changesOnly ? allChanges.filter((c) => c.type === "new" || c.type === "removed") : allChanges),
        [allChanges, changesOnly])
    const groups = useMemo(() => groupDetections(allChanges), [allChanges])
    const pass = passes.find((p) => p.scanId === scanId) || null
    const headline = scene ? changeHeadline(scene.counts, scene.reference_date) : null
    const imagedPasses = passes.filter((p) => p.hasImage && p.scanId !== scanId)

    // The image to compare against: the previous pass, an earlier pass, the
    // sharp reference, or Sentinel-2 on any date.
    useEffect(() => {
        if (!scene || against === "prev") { setCompareImg(null); return undefined }
        let live = true
        const url = against === "hires" ? `${API_BASE}/api/imagery/zones/${zoneId}/hires`
            : against.startsWith("date:") ? `${API_BASE}/api/imagery/zones/${zoneId}/on-date?date=${against.slice(5)}`
            : `${API_BASE}/api/imagery/scenes/${against.slice(5)}`
        setCompareImg({ loading: true })
        fetch(url, { credentials: "include" })
            .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`); return d })
            .then((d) => {
                if (!live) return
                if (against.startsWith("pass:")) setCompareImg({ b64: d.image_b64, date: d.scan?.image_timestamp_utc, label: `Pass · ${whenFull(d.scan?.image_timestamp_utc)}` })
                else if (against === "hires") setCompareImg({ b64: d.image_b64, date: d.date, label: `Sharp reference · ${d.date ? fmtDay(d.date) + " " + d.date.slice(0, 4) : "undated"} · ${d.resolution_m ? `${d.resolution_m} m` : ""} ${d.source || ""}`.trim(), meta: d })
                else setCompareImg({ b64: d.image_b64, date: d.date, label: `Sentinel-2 · ${whenFull(d.date)}` })
            })
            .catch((e) => { if (live) setCompareImg({ error: e.message }) })
        return () => { live = false }
    }, [against, scene, zoneId, compareTry])

    const compareScene = useMemo(() => {
        if (!scene) return null
        if (against === "prev") return scene
        return { ...scene, reference_image_b64: compareImg?.b64 || null, reference_date: compareImg?.date || null }
    }, [scene, against, compareImg])
    const compareLabel = against === "prev"
        ? (sensor === "radar" ? (scene?.scan ? `Optical pass · ${whenFull(scene.scan.image_timestamp_utc)}` : null)
            : scene?.reference_date ? `Previous pass · ${whenFull(scene.reference_date)}` : null)
        : compareImg?.label || null

    useEffect(() => {
        if (mode !== "blink") return undefined
        const t = setInterval(() => setBlinkOn((v) => !v), 800)
        return () => clearInterval(t)
    }, [mode])
    const view = mode === "scene" ? "after" : mode === "split" ? "split" : "swipe"
    const pos = mode === "fade" ? 100 : mode === "blink" ? (blinkOn ? 100 : 0) : swipePos
    const ar = zone?.bbox ? (() => {
        const b = zone.bbox
        return ((b.max_lon - b.min_lon) * Math.cos(((b.min_lat + b.max_lat) / 2) * Math.PI / 180)) / Math.max(1e-6, b.max_lat - b.min_lat)
    })() : 1

    // The radar pass, fetched when asked for (the first run downloads the
    // radar ship detector and can take a minute).
    const [sarTry, setSarTry] = useState(0)
    useEffect(() => {
        if (!liveRadar || !zoneId) return undefined
        let live = true
        setSar({ loading: true, error: null, started: Date.now() })
        fetch(`${API_BASE}/api/imagery/zones/${zoneId}/sar${sarDate ? `?date=${sarDate}` : ""}`, { credentials: "include" })
            .then(async (r) => {
                const d = await r.json().catch(() => ({}))
                if (!r.ok) {
                    const why = typeof d.detail === "string" ? d.detail : null
                    throw new Error(why || (r.status === 503 ? "Radar processing is unavailable on the server right now."
                        : r.status === 502 ? "Sentinel Hub did not return the radar pass." : `The server answered ${r.status}.`))
                }
                if (!d.image_b64) throw new Error("The radar pass came back without an image.")
                return d
            })
            .then((d) => { if (live) setSar({ data: d }) })
            .catch((e) => {
                if (!live) return
                // A server error without CORS headers surfaces as a bare
                // TypeError — say what that means instead of "Failed to fetch".
                const msg = e instanceof TypeError ? "The server did not answer the radar request (network or server error)." : e.message
                setSar({ error: msg })
            })
        return () => { live = false }
    }, [liveRadar, zoneId, sarDate, sarTry])
    useEffect(() => { setSar({}); setSarDate(null); setSensor("optical") }, [zoneId])
    useEffect(() => {
        const first = passes[0]?.scanId
        if (first && !passes.some((p) => p.scanId === scanId)) setScanId(first)
    }, [sensor, passes]) // eslint-disable-line react-hooks/exhaustive-deps

    // Fit the image to the stage, keeping its shape.
    useEffect(() => {
        const el = stageRef.current
        if (!el) return undefined
        const measure = () => {
            const cw = el.clientWidth, ch = el.clientHeight
            if (!cw || !ch) return
            const w = Math.min(cw, ch * ar)
            setFit({ w: Math.floor(w), h: Math.floor(w / ar), cw })
        }
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [ar, zone, manage])

    const radarScene = useMemo(() => {
        if (!liveRadar || !sar.data) return null
        // Compared against the optical pass by default — what radar sees
        // next to what it is.
        const ref = against === "prev" ? { b64: scene?.image_b64, date: scene?.scan?.image_timestamp_utc } : { b64: compareImg?.b64, date: compareImg?.date }
        return {
            scan: { image_timestamp_utc: sar.data.date, instrument: "SAR" }, image_b64: sar.data.image_b64,
            reference_image_b64: ref.b64 || null, reference_date: ref.date || null, changes: sar.data.changes,
        }
    }, [sensor, sar, against, scene, compareImg])
    const displayScene = liveRadar ? radarScene : compareScene
    const shown = liveRadar ? safeArray(sar.data?.changes) : changes

    /* WHAT THE AUTOMATIC WATCH FOUND HERE (owner, 2026-10-12): border-sweep
       finds, radar change regions, new objects — each a box on the ground
       (GET /api/watch-zones/{id}/findings), drawn on whichever image of the
       area is showing (every image of an area is laid on the area's own
       frame), listed beside it, and put on the map with one click. */
    const [findings, setFindings] = useState({ list: [], loading: false })
    const [findTry, setFindTry] = useState(0)
    useEffect(() => {
        if (!zoneId) { setFindings({ list: [], loading: false }); return undefined }
        let live = true
        setFindings({ list: [], loading: true })
        fetchFindings(zoneId)
            .then((d) => { if (live) setFindings({ list: safeArray(d?.findings), loading: false }) })
            .catch((e) => { if (live) setFindings({ list: [], loading: false, error: e.message }) })
        return () => { live = false }
    }, [zoneId, findTry])
    const findingOutlines = useMemo(
        () => (zone?.bbox ? findingOutlinesFor(findings.list, zone.bbox) : []),
        [findings, zone])
    /* A FINDING IS OPENED ON ITS IMAGE, HERE (owner, 2026-10-12: "why does
       it redirect us to the map to see new detections? And it does so
       without loading the image."). Clicking a finding used to only
       highlight a box a few pixels wide on a 20 km optical scene, and the
       one way to "see" it was the map button — which leaves Imagery and
       draws the boxes on the globe without any image. Now a click opens
       FindingViewer: the radar comparison's own Before / After / Change
       images (or the optical pass), boxes on them, zoomed to the one
       chosen. The map stays one button away, never automatic. */
    const [inspectId, setInspectId] = useState(null)
    const [radarHelp, setRadarHelp] = useState(false)
    const [thumbV, setThumbV] = useState(0)        // radar images just fetched: cut the thumbnails again
    const autoOpened = useRef(null)
    useEffect(() => { setInspectId(null) }, [zoneId])
    useEffect(() => {
        const list = findings.list
        if (!list.length || !zoneId) return
        const p = pendingFinding.current
        if (p && (!p.zoneId || p.zoneId === zoneId)) {
            pendingFinding.current = null
            setInspectId((list.find((f) => f.id === p.id) || list[0]).id)
            return
        }
        // An area that exists because the sweep found something opens on
        // what it found — that is the reason to look at it.
        if (autoOpened.current !== zoneId && zone?.metadata?.subgroup === "Found by sweep") {
            autoOpened.current = zoneId
            setInspectId(list[0].id)
        }
    }, [findings, zoneId, zone])
    const showFindingsOnMap = useCallback((focusId = null) => {
        if (!findings.list.length) return
        showFindings({ zoneId, findings: findings.list, title: zone?.name, focusId, fit: true })
        window.dispatchEvent(new CustomEvent("akili:open-map"))
    }, [findings, zoneId, zone])

    const exportPixels = useCallback(async () => {
        const b64 = scene?.image_b64
        if (!b64) { toast("No image to export", { icon: "i-alert" }); return }
        try {
            const img = new Image()
            await new Promise((res, rej) => {
                img.onload = res; img.onerror = () => rej(new Error("image did not decode"))
                img.src = `data:image/png;base64,${b64}`
            })
            const c = document.createElement("canvas")
            c.width = img.naturalWidth; c.height = img.naturalHeight
            const ctx = c.getContext("2d")
            ctx.drawImage(img, 0, 0)
            if (showBoxes) {
                ctx.lineWidth = Math.max(2, Math.round(c.width / 500))
                ctx.font = `${Math.max(11, Math.round(c.width / 90))}px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif`
                for (const d of changes) {
                    ctx.strokeStyle = d.type === "new" ? "#d8a24a" : d.type === "removed" ? "#f46043" : "#a0b2d2"
                    ctx.beginPath()
                    const pts = Array.isArray(d.polygon) && d.polygon.length >= 3 ? d.polygon
                        : d.bbox ? [[d.bbox[0], d.bbox[1]], [d.bbox[0] + d.bbox[2], d.bbox[1]], [d.bbox[0] + d.bbox[2], d.bbox[1] + d.bbox[3]], [d.bbox[0], d.bbox[1] + d.bbox[3]]] : []
                    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * c.width, y * c.height) : ctx.moveTo(x * c.width, y * c.height)))
                    ctx.closePath(); ctx.stroke()
                    if (pts.length) {
                        ctx.fillStyle = ctx.strokeStyle
                        ctx.fillText(`${String(d.label).replace(/_/g, " ")} ${Math.round((d.conf ?? 0) * 100)}%`,
                            pts[0][0] * c.width, Math.max(12, pts[0][1] * c.height - 4))
                    }
                }
            }
            const a = document.createElement("a")
            a.href = c.toDataURL("image/png")
            a.download = `${zone?.name || "scene"}-${(scene?.scan?.image_timestamp_utc || "").slice(0, 10)}.png`.replace(/\s+/g, "-")
            document.body.appendChild(a); a.click(); a.remove()
            toast("Exported as PNG")
        } catch (e) {
            toast(`Export failed — ${e.message || e}`, { icon: "i-alert" })
        }
    }, [scene, view, showBoxes, changes, zone])

    /** The scene on the Situation map, georeferenced, with its outlines
     *  and the previous pass to compare against (MapSceneCard). */
    const showOnMap = useCallback(() => {
        if (!scene?.image_b64 || !zone?.bbox) { toast("This scene has no image to place", { icon: "i-alert" }); return }
        const b = zone.bbox
        const bounds = { north: b.max_lat, south: b.min_lat, east: b.max_lon, west: b.min_lon }
        window.__plxMapScene = {
            name: zone.name, systemId: zone.system_id, bounds, instrument: scene.scan?.instrument || "OPTICAL",
            after: { b64: scene.image_b64, date: scene.scan?.image_timestamp_utc },
            before: scene.reference_image_b64 ? { b64: scene.reference_image_b64, date: scene.reference_date } : null,
            changes: allChanges, headline,
        }
        window.dispatchEvent(new CustomEvent("akili:map-show-scene", { detail: window.__plxMapScene }))
        if (findings.list.length) showFindings({ zoneId: zone.system_id, findings: findings.list, title: zone.name })
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        const spanKm = Math.max((b.max_lat - b.min_lat) * 111, (b.max_lon - b.min_lon) * 111 * Math.cos(((b.min_lat + b.max_lat) / 2) * Math.PI / 180))
        window.dispatchEvent(new CustomEvent("akili:fly-to", {
            detail: { lat: (b.min_lat + b.max_lat) / 2, lon: (b.min_lon + b.max_lon) / 2, altitude: Math.max(4000, spanKm * 1600) },
        }))
    }, [scene, zone, allChanges, headline, findings])

    const deleteScene = useCallback(async () => {
        if (!zone || !scanId) return
        if (!(await confirmAction({ title: "Are you sure?", message: `Delete this pass over "${zone.name}"?\n\nIts ${safeArray(scene?.changes).length} detections go with it, `
            + "and a later pass loses it as its comparison.", confirm: "Delete", danger: true }))) return
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones/${zone.system_id}/scans/${scanId}`, { method: "DELETE", credentials: "include" })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            toast("Pass deleted"); setScanId(null); loadScans(zone.system_id)
        } catch (e) { toast(`Could not delete it — ${e.message}`, { icon: "i-alert" }) }
    }, [zone, scanId, scene, loadScans])

    const deleteDetection = useCallback(async (det) => {
        if (!det?.id || String(det.id).startsWith("removed-")) return
        try {
            const r = await fetch(`${API_BASE}/api/imagery/detections/${det.id}`, { method: "DELETE", credentials: "include" })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            setScene((s) => (s ? { ...s, changes: safeArray(s.changes).filter((c) => c.id !== det.id) } : s))
            toast("Detection deleted")
        } catch (e) { toast(`Could not delete it — ${e.message}`, { icon: "i-alert" }) }
    }, [])

    const fileScene = useCallback(async () => {
        if (!scene || !zone) return
        const out = await fileSignal({
            id: scanId, kind: "signal", source: "sentinel",
            headline: `${zone.name}: ${headline}`, region: zone.name,
            severity: allChanges.some((c) => c.type === "new") ? "significant" : "routine",
            lat: zone.bbox ? (zone.bbox.min_lat + zone.bbox.max_lat) / 2 : null,
            lon: zone.bbox ? (zone.bbox.min_lon + zone.bbox.max_lon) / 2 : null,
            imageUrl: `data:image/png;base64,${scene.image_b64}`,
            when: scene.scan?.image_timestamp_utc || null,
        })
        toast(out.path ? `Filed to ${out.path.join(" / ")}` : "Saved for briefing")
    }, [scene, zone, scanId, headline, allChanges])

    if (err) return (
        <section data-screen-label="Overwatch" style={MODE_SURFACE}>
            <div style={{ padding: 20, color: "var(--txt3)" }}>Imagery is unavailable ({err}).</div>
        </section>
    )
    if (!zones) return (
        <section data-screen-label="Overwatch" style={MODE_SURFACE}>
            <Loading size={22} inline label="Reading the watched areas" style={{ padding: 20 }} />
        </section>
    )

    return (
        <section data-screen-label="Overwatch" style={MODE_SURFACE}>
            <header style={{
                display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 52,
                boxSizing: "border-box", flex: "none", padding: "8px 14px 8px 18px", borderBottom: "1px solid var(--gline)",
            }}>
                <h2 style={{ margin: "0 8px 0 0", fontWeight: 600, fontSize: 18, letterSpacing: "-.01em" }}>Imagery</h2>
                <nav aria-label="Watched areas" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {stripZones.map((z) => (
                        <button key={z.system_id} onClick={() => {
                            setManage(false)
                            // Clearing the pass only when the area changes: re-clicking
                            // the area already open left the page with no pass at all.
                            if (z.system_id !== zoneId) { setZoneId(z.system_id); setScanId(null) }
                        }} style={{
                            ...BTN, height: 30, display: "flex", alignItems: "center", gap: 8,
                            background: !manage && z.system_id === zoneId ? ON : "transparent",
                            borderColor: !manage && z.system_id === zoneId ? "var(--acchi)" : "var(--gline2)",
                        }}>
                            {zoneFinding(z).fresh
                                ? <FreshDot on size={7} />
                                : <i style={{ width: 7, height: 7, background: z.status === "active" ? "var(--green)" : "var(--txt4)" }} />}
                            {z.name}
                        </button>
                    ))}
                </nav>
                {pickerTree.length > 0 && (
                    <select aria-label="Overwatch zones" value={!manage && zone?.metadata?.group ? zone.system_id : ""}
                        onChange={(e) => { if (e.target.value) { setManage(false); setZoneId(e.target.value); setScanId(null) } }}
                        style={{ ...FIELD, width: 240, height: 30, background: !manage && zone?.metadata?.group ? ON : "var(--glass2)" }}>
                        <option value="">Overwatch zones ({pickerTree.reduce((n, g) => n + g.count, 0)})…</option>
                        {pickerTree.flatMap((g) => g.subgroups.map((sg) => (
                            <optgroup key={`${g.group}/${sg.subgroup}`} label={`${g.group} · ${sg.subgroup}`}>
                                {sg.zones.map((z) => <option key={z.system_id} value={z.system_id}>{zoneFinding(z).fresh ? `● ${z.name} — new finding` : z.name}</option>)}
                            </optgroup>
                        )))}
                    </select>
                )}
                {freshCount > 0 && (
                    <button onClick={() => setManage(true)} title="Areas whose latest scans found something new — listed first in Manage areas" style={{ ...BTN, height: 30, display: "flex", alignItems: "center", gap: 7, borderColor: "var(--red)", color: "var(--red)" }}>
                        <FreshDot on size={7} />{freshCount} with new findings
                    </button>
                )}
                {proposedCount > 0 && (
                    <button onClick={() => setManage(true)} title="Generated overwatch zones waiting for your yes or no" style={{ ...BTN, height: 30, borderColor: "var(--acchi)" }}>
                        {proposedCount} proposed
                    </button>
                )}
                <button onClick={() => setAdding((v) => !v)} style={{ ...BTN, height: 30, color: "var(--acchi)" }}>+ Watch a place</button>
                <button onClick={() => drawOnMap()} title="Draw the area yourself, as a box or a polygon" style={{ ...BTN, height: 30, color: "var(--acchi)" }}>✎ Draw an area on the map</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setManage((v) => !v)} style={{ ...BTN, background: manage ? ON : "transparent" }}>
                    {manage ? "Back to the imagery" : "Manage areas"}
                </button>
            </header>

            {adding && <NewArea onDone={(z) => { setAdding(false); loadZones(); if (z?.system_id) { setManage(false); setZoneId(z.system_id) } }} onCancel={() => setAdding(false)} />}

            {manage ? (
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
                    <OverwatchPanel conflict={owConflict} setConflict={setOwConflict}
                        onChanged={(group) => { if (group) setOwFocus(group); loadZones() }} />
                    <AreasTab zones={zones} onChanged={loadZones} focusGroup={owFocus}
                        onOpen={(z) => { setZoneId(z); setManage(false) }} />
                </div>
            ) : !zone ? (
                <div style={{ padding: 24, color: "var(--txt3)", maxWidth: 560, textWrap: "pretty" }}>
                    No area is being watched yet. “Watch an area” picks a place and has the satellites
                    photographed over it on a schedule, with every vessel, aircraft, tank and vehicle the
                    detector finds compared against the pass before.
                </div>
            ) : (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                    {/* ── A FINDING, on the image it was found in ── */}
                    {inspectId && findings.list.some((f) => f.id === inspectId) ? (
                        <FindingViewer zone={zone} findings={findings.list} selectedId={inspectId}
                            onSelect={setInspectId} onClose={() => setInspectId(null)}
                            onImagesReady={() => setThumbV((v) => v + 1)}
                            onShowOnMap={(id, img) => {
                                // The image goes with the boxes: the map used to get the
                                // boxes alone, drawn over the basemap without any image.
                                if (img?.after && img.bounds) {
                                    const [w, so, e, n] = img.bounds
                                    window.__plxMapScene = {
                                        name: zone.name, systemId: zone.system_id, bounds: { north: n, south: so, east: e, west: w },
                                        instrument: img.kind === "radar" ? "SAR" : "OPTICAL",
                                        after: { b64: img.after, date: img.dateAfter }, before: img.before ? { b64: img.before, date: img.dateBefore } : null,
                                        changes: [], headline: findings.list.find((x) => x.id === id)?.label || zone.name,
                                    }
                                    window.dispatchEvent(new CustomEvent("akili:map-show-scene", { detail: window.__plxMapScene }))
                                }
                                showFindingsOnMap(id)
                            }}
                            fallback={scene?.image_b64 && (scene.scan?.instrument || "OPTICAL") !== "SAR" ? { image_b64: scene.image_b64, date: scene.scan?.image_timestamp_utc } : null} />
                    ) : (
                    /* ── THE IMAGE, and what is needed to read it ── */
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "10px 14px 10px 18px", gap: 8 }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 14, flex: "none" }}>
                            <div style={{ minWidth: 0, flex: 1 }}>
                                <span style={EYE}>
                                    {zone.name} · {liveRadar ? `Sentinel-1 radar · ${sar.data ? whenFull(sar.data.date) : "…"} · fetched live` : `${SENSOR[pass?.instrument || scene?.scan?.instrument] || "Sentinel"}${pass ? ` · ${whenFull(pass.when)} · ${agoLabel(pass.when)}` : ""}`}
                                    {sensor !== "radar" && pass?.fire ? " · triggered by a fire detection" : ""}
                                </span>
                                <h3 style={{ margin: "3px 0 0", fontWeight: 600, fontSize: 18, lineHeight: 1.3, letterSpacing: "-.01em", textWrap: "pretty" }}>
                                    {liveRadar
                                        ? (sar.data ? `Radar: ${shown.length} ${noun("vessel", shown.length)} on the water${sar.data.date ? ` on ${fmtDay(sar.data.date)}` : ""}.` : sar.error ? "No radar pass to show." : "Reading the radar pass…")
                                        : loadingScene ? "Reading the pass…" : headline || (passes.length ? "Pick a pass."
                                            : scans.some((x) => x?.status === "pending" || x?.status === "running") || (zone?.created_at && Date.now() - new Date(`${String(zone.created_at).replace(/Z$/, "")}Z`).getTime() < 10 * 60_000)
                                                ? "The first satellite pass is on its way — this page shows it when it lands."
                                                : "This area has not been photographed yet.")}
                                </h3>
                                {(() => {
                                    const f = zoneFinding(zone)
                                    if (!f.fresh && !f.radar) return null
                                    return (
                                        <div data-zone-finding style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 4, fontSize: 12.5, color: f.fresh ? "var(--red)" : "var(--txt3)" }}>
                                            <FreshDot on={f.fresh} size={7} />
                                            <span>{f.fresh ? `New finding: ${f.text}` : ""}{f.fresh && f.radar && f.kind !== "radar_change" ? " · " : ""}{f.radar && !(f.fresh && f.kind === "radar_change") ? `Radar change ${fmtDay(f.radar.at)}: ${f.radar.headline}` : ""}</span>
                                            {findings.list.length > 0 && (
                                                <button data-open-finding onClick={() => setInspectId(findings.list[0].id)} style={{ ...BTN, height: 22, fontSize: 11, padding: "0 8px", color: "var(--txt)" }}>See it on the image</button>
                                            )}
                                        </div>
                                    )
                                })()}
                            </div>
                            <div style={{ display: "flex", gap: 6, flex: "none" }}>
                                <button onClick={showOnMap} style={BTN} disabled={!scene?.image_b64} title="Put this image on the map (leaves Imagery)">Show on the map</button>
                                <button onClick={() => drawOnMap(zone)} title="Draw a new boundary for this area on the map" style={BTN}>Redraw area</button>
                                <button onClick={exportPixels} style={BTN}>Export</button>
                                <button onClick={fileScene} style={BTN}>Save for briefing</button>
                                <button onClick={deleteScene} title="Delete this pass" style={{ ...BTN, color: "var(--txt4)", padding: "0 8px" }}>✕</button>
                            </div>
                        </div>

                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: "none" }}>
                            <div style={{ display: "flex", border: "1px solid var(--gline2)" }} title="Optical sees what things are; radar sees through cloud and at night">
                                {[["Optical", "optical"], ["Radar", "radar"]].map(([k, v]) => (
                                    <button key={v} onClick={() => setSensor(v)} style={{
                                        height: 26, padding: "0 12px", border: 0, background: sensor === v ? "var(--acc)" : "transparent",
                                        color: sensor === v ? "var(--mz-cream)" : "var(--txt3)", font: "inherit", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                                    }}>{k}</button>
                                ))}
                            </div>
                            {liveRadar && sar.data?.dates?.length > 1 && (
                                <select value={sar.data.date} onChange={(e) => setSarDate(e.target.value)} style={{ ...FIELD, width: 150, height: 26, fontSize: 11.5 }}>
                                    {sar.data.dates.map((d) => <option key={d} value={d}>{fmtDay(d)} {d.slice(0, 4)}</option>)}
                                </select>
                            )}
                            <div data-tour="imagery-compare" style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                                {MODES.map(([k, v]) => (
                                    <button key={v} onClick={() => setMode(v)} style={{
                                        height: 26, padding: "0 10px", border: 0, background: mode === v ? ON : "transparent",
                                        color: mode === v ? "var(--txt)" : "var(--txt3)", font: "inherit", fontSize: 11.5, cursor: "pointer",
                                    }}>{k}</button>
                                ))}
                            </div>
                            {mode !== "scene" && (
                                <select value={against} onChange={(e) => setAgainst(e.target.value)} title="What to compare this image with"
                                    style={{ ...FIELD, width: 250, height: 26, fontSize: 11.5 }}>
                                    {liveRadar
                                        ? <option value="prev">{pass ? `Optical pass · ${fmtDay(pass.when)}` : "Optical pass"}</option>
                                        : <option value="prev">{scene?.reference_date ? `Previous pass · ${fmtDay(scene.reference_date)}` : "Previous pass (no image)"}</option>}
                                    <option value="hires">Sharp reference · Esri, sub-metre</option>
                                    {imagedPasses.length > 0 && <optgroup label="Earlier passes">
                                        {imagedPasses.map((p) => <option key={p.key} value={`pass:${p.scanId}`}>{whenFull(p.when)}</option>)}
                                    </optgroup>}
                                    {dates.length > 0 && <optgroup label="Sentinel-2 on a date">
                                        {dates.filter((d) => d.date !== String(pass?.when || "").slice(0, 10)).slice(0, 120).map((d) => (
                                            <option key={d.date} value={`date:${d.date}`}>{fmtDay(d.date)} {d.date.slice(0, 4)} · {Math.round(d.cloud ?? 0)}% cloud</option>
                                        ))}
                                    </optgroup>}
                                </select>
                            )}
                            <button onClick={() => setShowBoxes((v) => !v)} style={{ ...BTN, height: 26, fontSize: 11.5, background: showBoxes ? ON : "transparent" }}>Outlines</button>
                            {sensor !== "radar" && <button onClick={() => setChangesOnly((v) => !v)} style={{ ...BTN, height: 26, fontSize: 11.5, background: changesOnly ? ON : "transparent" }}>Changes only</button>}
                            <span style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 11, color: "var(--txt3)" }}>
                                {(sensor === "radar" ? ["existing"] : ["new", "removed", "existing"]).map((k) => (
                                    <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                        <i style={{ width: 12, height: 0, borderTop: `3px ${k === "removed" ? "dashed" : "solid"} ${KIND_C[k]}` }} />
                                        {sensor === "radar" ? "radar contact on water" : KIND_WORD[k]}
                                    </span>
                                ))}
                                {sensor !== "radar" && <span title="Found by only one of the two detection models">┄ one model only</span>}
                            </span>
                        </div>
                        {/* WHEN EACH IMAGE WAS TAKEN, right above it — the one fact an
                            image cannot be read without. */}
                        {displayScene && (
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flex: "none" }}>
                                <Stamp align="left" dim={mode === "blink" && !blinkOn}
                                    label={`${sensor === "radar" ? "Radar" : "Optical"}${mode === "split" ? " · left" : mode === "swipe" ? " · left of the handle" : ""}`}
                                    when={displayScene.scan?.image_timestamp_utc} />
                                {mode !== "scene" && (
                                    compareImg?.loading ? <span style={{ fontSize: 12, color: "var(--txt3)" }}>Loading the comparison…</span>
                                    : compareImg?.error ? <span data-image-state="error" style={{ fontSize: 12, color: "var(--amber)" }}>Comparison unavailable — {compareImg.error} <button onClick={() => setCompareTry((n) => n + 1)} style={{ ...BTN, height: 22, fontSize: 11, padding: "0 8px" }}>Try again</button></span>
                                    : (against === "hires" ? compareImg?.date : displayScene.reference_date)
                                        ? <Stamp align="right" dim={mode === "blink" && blinkOn}
                                            label={`${against === "hires" ? "Sharp reference" : compareLabel?.split(" · ")[0] || "Comparison"}${mode === "split" ? " · right" : mode === "swipe" ? " · right of the handle" : ""}`}
                                            when={against === "hires" ? compareImg?.date : displayScene.reference_date} />
                                        : <span style={{ fontSize: 12, color: "var(--txt3)" }}>No earlier image — choose another to compare with</span>
                                )}
                            </div>
                        )}

                        {/* The stage: the image fitted to all the room there is, in
                            its own shape, nothing around it. */}
                        <div ref={stageRef} style={{ flex: 1, minHeight: 280, position: "relative" }}>
                            {displayScene && fit.w > 0 && (
                                <div style={{ position: "absolute", left: (fit.cw - fit.w) / 2, top: 0, width: fit.w, height: fit.h }}>
                                    <SceneComparison
                                        scene={displayScene} view={view} showBoxes={showBoxes} changes={[...shown, ...findingOutlines]}
                                        swipePos={pos} onSwipePos={setSwipePos}
                                        fadeOn={mode === "fade"} fadeOpacity={fadeOpacity}
                                        swipeHandle={mode === "swipe"} refLabel={compareLabel} stretch stamped
                                        clipRef={clipRef} fadeRef={fadeRef} viewerRef={viewerRef}
                                        onSelectDet={(d) => (d?.finding ? setInspectId(d.finding.id) : setSelectedDet(d))} selectedDet={selectedDet}
                                    />
                                </div>
                            )}
                            {!liveRadar && loadingScene && (
                                <div data-image-state="loading" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--glass2)" }}>
                                    <Loading size={20} inline label="Loading the pass and its image" style={{ padding: 16 }} />
                                </div>
                            )}
                            {!liveRadar && !loadingScene && (sceneErr || scansErr) && (
                                <div data-image-state="error" role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
                                    <div style={{ maxWidth: 460, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                                        <div style={{ fontWeight: 600 }}>{sceneErr ? "This pass could not be loaded" : "The passes of this area could not be listed"}</div>
                                        <div style={{ color: "var(--txt3)", fontSize: 12.5, textWrap: "pretty" }}>{sceneErr || scansErr}</div>
                                        <button onClick={() => (sceneErr ? setSceneTry((n) => n + 1) : loadScans(zoneId))} style={BTN}>Try again</button>
                                    </div>
                                </div>
                            )}
                            {!liveRadar && !loadingScene && !sceneErr && !scansErr && !displayScene && findings.list.length > 0 && (
                                <div data-image-state="none" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
                                    <div style={{ maxWidth: 460, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                                        <div style={{ fontWeight: 600 }}>No image of this area is held yet</div>
                                        <div style={{ color: "var(--txt3)", fontSize: 12.5, textWrap: "pretty" }}>
                                            {findings.list.length} finding{findings.list.length === 1 ? "" : "s"} of the automatic watch {findings.list.length === 1 ? "is" : "are"} listed on the right; the first optical pass is on its way.
                                            {findings.list.some(isRadarFinding) ? " The radar findings can be seen on the radar images they were found in." : ""}
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button data-open-finding onClick={() => setInspectId(findings.list[0].id)} style={PRIMARY}>See the findings on their image</button>
                                            <button onClick={() => showFindingsOnMap()} style={BTN}>Show on the map</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                            {liveRadar && sar.loading && (
                                <div data-sar-state="loading" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--glass2)" }}>
                                    <Loading size={20} inline label="Fetching the Sentinel-1 radar pass and looking for ships — up to a minute the first time" style={{ padding: 16 }} />
                                </div>
                            )}
                            {liveRadar && sar.error && (
                                <div data-sar-state="error" role="alert" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24 }}>
                                    <div style={{ maxWidth: 460, textAlign: "center", display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
                                        <div style={{ fontWeight: 600 }}>The radar image could not be loaded</div>
                                        <div style={{ color: "var(--txt3)", fontSize: 12.5, textWrap: "pretty" }}>{sar.error}</div>
                                        <button onClick={() => setSarTry((n) => n + 1)} style={BTN}>Try again</button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* The comparison as a slider: how much of each image shows. */}
                        {(mode === "swipe" || mode === "fade") && displayScene?.reference_image_b64 && (
                            <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 12, alignItems: "center", flex: "none", padding: "2px 8px" }}>
                                <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
                                    This {sensor === "radar" ? "radar " : ""}pass · {fmtDay(displayScene.scan?.image_timestamp_utc)}
                                </span>
                                <input type="range" min={0} max={100} step={0.5} aria-label="Compare the two images"
                                    value={mode === "fade" ? 100 - fadeOpacity : 100 - swipePos}
                                    onChange={(e) => (mode === "fade" ? setFadeOpacity(100 - Number(e.target.value)) : setSwipePos(100 - Number(e.target.value)))}
                                    style={{ width: "100%", accentColor: "var(--acchi)", height: 22 }} />
                                <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", textAlign: "right" }}>
                                    {against === "hires" ? "Sharp reference" : "Comparison"} · {fmtDay(against === "hires" ? compareImg?.date : displayScene.reference_date)}
                                </span>
                            </div>
                        )}

                        {/* The passes as a time slider. */}
                        {!liveRadar && passes.length > 1 && (
                            <PassSlider passes={passes} scanId={scanId} onPick={setScanId} />
                        )}
                    </div>
                    )}

                    {/* ── READING IT ── */}
                    <aside style={{ width: 360, flex: "none", borderLeft: "1px solid var(--gline)", overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                        {/* What the automatic watch found comes first: it is the answer. */}
                        {(findings.list.length > 0 || findings.error) && (
                            <div data-findings-card={findings.list.length} style={{ ...CARD, borderColor: findings.list.some((f) => f.tone === "red") ? "var(--red)" : "var(--gline)" }}>
                                <div style={{ padding: "10px 12px 6px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                                    <span style={EYE}>Found by the automatic watch</span>
                                    {findings.list.length > 0 && <button onClick={() => showFindingsOnMap()} style={{ ...BTN, height: 24, fontSize: 11 }}>Show on the map</button>}
                                </div>
                                {findings.error && (
                                    <div style={{ padding: "4px 12px 10px", fontSize: 12, color: "var(--amber)" }}>
                                        Could not read them — {findings.error} <button onClick={() => setFindTry((n) => n + 1)} style={{ ...BTN, height: 22, fontSize: 11, padding: "0 8px" }}>Try again</button>
                                    </div>
                                )}
                                {findings.list.some(isRadarFinding) && (
                                    <div style={{ padding: "0 12px 8px", fontSize: 11.5, color: "var(--txt3)", lineHeight: 1.45 }}>
                                        <button onClick={() => setRadarHelp((v) => !v)} aria-expanded={radarHelp} data-radar-help
                                            style={{ border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", fontSize: 11.5, cursor: "pointer", padding: 0, textAlign: "left" }}>
                                            {radarHelp ? "Hide" : "What do “new bright returns” and “darker” mean?"}
                                        </button>
                                        {radarHelp && (
                                            <div data-radar-help-text style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 5, color: "var(--txt2)" }}>
                                                <span>{RADAR_WHAT}</span>
                                                <span><b style={{ color: "#FF3B30", fontWeight: 600 }}>Brighter</b> — {RADAR_BRIGHTER.replace(/^Brighter \(new bright returns\): /, "")}</span>
                                                <span><b style={{ color: "#4096FF", fontWeight: 600 }}>Darker</b> — {RADAR_DARKER.replace(/^Darker \(returns gone\): /, "")}</span>
                                                <span style={{ color: "var(--txt3)" }}>{RADAR_CAVEATS}</span>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {findingOutlines.map((o, i) => (
                                    <button key={o.id} data-finding-row={o.finding.id} onClick={() => setInspectId(o.finding.id)}
                                        title="Open it on its image" style={{
                                        display: "grid", gridTemplateColumns: "auto minmax(0,1fr)", gap: "2px 10px", alignItems: "center", width: "100%",
                                        padding: "8px 12px", border: 0, borderTop: "1px solid var(--gline)", textAlign: "left", cursor: "pointer",
                                        background: inspectId === o.finding.id ? ON : "transparent", color: "var(--txt)", font: "inherit",
                                    }}>
                                        <span style={{ gridRow: "1 / 4" }}>
                                            {i < 12 ? <FindingThumb key={`${o.finding.id}:${thumbV}`} zoneId={zoneId} finding={o.finding} size={46} />
                                                : <i style={{ display: "block", width: 10, height: 10, border: `2px ${o.estimate ? "dashed" : "solid"} ${o.color}` }} />}
                                        </span>
                                        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                                            <i style={{ width: 9, height: 9, flex: "none", border: `2px ${o.estimate ? "dashed" : "solid"} ${o.color}` }} />
                                            <span title={o.finding.label} style={{ fontSize: 12, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortLabel(o.finding)}</span>
                                        </span>
                                        <span style={{ fontSize: 11.5, color: "var(--txt2)" }}>
                                            {[o.finding.size, fmtDay(o.finding.date), strengthText(o.finding)].filter(Boolean).join(" · ")}
                                        </span>
                                        <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                                            {o.finding.sensor || "satellite"}{o.finding.landcover ? ` · on ${o.finding.landcover}` : ""}{o.estimate ? " · size estimated from its area" : o.finding.box_source === "regions" ? " · extent rebuilt from its radar regions" : ""}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div style={{ ...CARD, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={EYE}>Imagery note</span>
                            {note?.summary
                                ? <span style={{ fontSize: 12.5, color: "var(--txt2)", lineHeight: 1.5, textWrap: "pretty" }}>{note.summary}</span>
                                : <span style={{ fontSize: 12, color: "var(--txt4)" }}>{scene?.image_b64 ? "Writing the note…" : "No image to read for this pass."}</span>}
                            {note?.quality && <span style={{ fontSize: 12, color: "var(--amber)" }}>{note.quality}</span>}
                            {note?.model && <span style={{ ...EYE, fontSize: 9 }}>read by {note.model} against what matters here</span>}
                        </div>
                        <ContextCard context={context} onKind={async (k) => {
                            await fetch(`${API_BASE}/api/watch-zones/${zone.system_id}`, {
                                method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ kind: k }),
                            }).catch(() => {})
                            setContext((c) => ({ ...c, kind: k, kind_source: "set by you" }))
                            toast("Saved — the next pass is judged as " + (KIND_LABEL[k] || k))
                        }} />
                        {series.length > 0 && passes.length > 1 && (
                            <div style={{ ...CARD, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                                <span style={EYE}>Counts across passes · shaded = normal range</span>
                                {series.slice(0, 4).map((s) => (
                                    <CountChart key={s.label} s={s} selectedKey={pass?.key}
                                        onPick={(k) => { const p = passes.find((x) => x.key === k); if (p) setScanId(p.scanId) }} />
                                ))}
                            </div>
                        )}
                        <div style={CARD}>
                            <div style={{ padding: "10px 12px 6px", display: "flex", justifyContent: "space-between" }}>
                                <span style={EYE}>What the detector found</span>
                                <span style={{ ...EYE, letterSpacing: ".04em" }}>{shown.length}</span>
                            </div>
                            {groupDetections(shown).map((g) => {
                                const open = openGroup === g.label
                                return (
                                    <div key={g.label} style={{ borderTop: "1px solid var(--gline)" }}>
                                        <button onClick={() => setOpenGroup(open ? null : g.label)} style={{
                                            display: "flex", alignItems: "baseline", gap: 8, width: "100%", padding: "8px 12px",
                                            border: 0, background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer", textAlign: "left",
                                        }}>
                                            <span style={{ fontWeight: 600, fontSize: 13 }}>{g.items.length} {noun(g.label, g.items.length)}</span>
                                            <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                                                {sensor === "radar" ? "on the water" : [g.new && `${g.new} new`, g.removed && `${g.removed} gone`].filter(Boolean).join(" · ") || "unchanged"}
                                            </span>
                                            <span style={{ marginLeft: "auto", color: "var(--txt4)", fontSize: 11 }}>{open ? "–" : "+"}</span>
                                        </button>
                                        {open && g.items.map((d) => (
                                            <div key={d.id} onClick={() => setSelectedDet(d)} style={{
                                                display: "grid", gridTemplateColumns: "12px minmax(0,1fr) auto auto", gap: "2px 8px",
                                                alignItems: "center", padding: "7px 12px 7px 20px", cursor: "pointer",
                                                background: selectedDet?.id === d.id ? ON : "transparent",
                                            }}>
                                                <i style={{ width: 12, height: 0, borderTop: `3px ${d.type === "removed" ? "dashed" : "solid"} ${KIND_C[d.type] || "var(--txt4)"}` }} />
                                                <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                    {d.length_m ? `${Math.round(d.length_m)} × ${Math.round(d.width_m || 0)} m` : noun(d.label, 1)}
                                                    <span style={{ color: "var(--txt3)" }}> · {sensor === "radar" ? (d.note || "radar contact") : KIND_WORD[d.type] || d.type}</span>
                                                    {d.tier && <span style={{ color: d.tier === "confirmed" ? "var(--green)" : "var(--txt4)" }}> · {d.tier === "confirmed" ? "confirmed" : "one model"}</span>}
                                                </span>
                                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt3)" }}>{Math.round((d.conf ?? 0) * 100)}%</span>
                                                {sensor !== "radar" && !String(d.id).startsWith("removed-") ? (
                                                    <button onClick={(e) => { e.stopPropagation(); deleteDetection(d) }} title="Delete this detection"
                                                        style={{ border: 0, background: "transparent", color: "var(--txt4)", font: "inherit", cursor: "pointer" }}>✕</button>
                                                ) : <span />}
                                                {sensor !== "radar" && (d.note || d.doubtful) && (
                                                    <span style={{ gridColumn: "2 / 5", fontSize: 11, color: d.doubtful ? "var(--amber)" : "var(--txt2)" }}>
                                                        {d.doubtful ? "Doubtful — the imagery note does not think this is what the detector says. " : ""}{d.note}
                                                    </span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                )
                            })}
                            {!shown.length && <div style={{ padding: 12, fontSize: 12, color: "var(--txt3)" }}>Nothing detected.</div>}
                        </div>
                        <div style={CARD}>
                            <div style={{ padding: "10px 12px 6px" }}><span style={EYE}>Passes</span></div>
                            {passes.map((p) => (
                                <button key={p.key} onClick={() => setScanId(p.scanId)} style={{
                                    display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 8px", width: "100%",
                                    padding: "7px 12px", border: 0, borderTop: "1px solid var(--gline)",
                                    background: p.scanId === scanId ? ON : "transparent", color: "var(--txt)", font: "inherit",
                                    textAlign: "left", cursor: "pointer",
                                }}>
                                    <span style={{ fontSize: 12, fontWeight: 600 }}>{whenFull(p.when)}</span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: (p.cloud ?? 0) > 30 ? "var(--amber)" : "var(--txt4)" }}>{p.instrument === "SAR" ? "radar" : `${Math.round(p.cloud ?? 0)}% cloud`}</span>
                                    <span style={{ gridColumn: "1 / 3", fontSize: 11, color: "var(--txt3)" }}>
                                        {Object.entries(p.byType).map(([k, v]) => `${v} ${noun(k, v)}`).join(" · ") || "nothing detected"}
                                        {p.fire ? " · fire-triggered" : ""}{!p.hasImage ? " · image retired" : ""}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </aside>
                </div>
            )}
        </section>
    )
}

/** The capture time, large, beside the image. */
function Stamp({ align, label, when, dim }) {
    if (!when) return null
    const t = String(when)
    const time = t.length > 10 ? ` · ${t.slice(11, 16)} UTC` : ""
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: align, opacity: dim ? 0.4 : 1, transition: "opacity .2s" }}>
            <span style={{ ...EYE, fontSize: 9.5 }}>{label} · captured</span>
            <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-.01em" }}>
                {fmtDay(t)} {t.slice(0, 4)}{time}
                <span style={{ fontSize: 12, fontWeight: 400, color: "var(--txt3)" }}> · {agoLabel(t)}</span>
            </span>
        </div>
    )
}

/** What this place is about now, and what to look for in its imagery. */
const KIND_LABEL = {
    naval_base: "naval base", airbase: "airbase", oil_terminal: "oil terminal",
    energy_site: "energy site", commercial_port: "commercial port", other: "other",
}
const KIND_RULE = {
    naval_base: "every vessel arriving or leaving is a signal",
    airbase: "every aircraft arriving or leaving is a signal",
    oil_terminal: "vessels above their normal range are a signal",
    energy_site: "new heat is a signal",
    commercial_port: "traffic is counted; only an extreme swing is a signal",
    other: "only extreme swings are a signal",
}

function ContextCard({ context, onKind }) {
    const sur = context?.surroundings || {}
    const sigs = safeArray(sur.signals)
    return (
        <div style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={EYE}>What matters here</span>
            {context?.kind && (
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, flexWrap: "wrap" }}>
                    <span style={{ color: "var(--txt3)" }}>This is</span>
                    <select value={context.kind} onChange={(e) => onKind?.(e.target.value)}
                        style={{ ...FIELD, width: "auto", height: 26, fontSize: 12, fontWeight: 600 }}>
                        {Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <span style={{ color: "var(--txt4)", fontSize: 11 }}>{context.kind_source} · {KIND_RULE[context.kind]}</span>
                </label>
            )}
            {!context ? <Loading size={16} inline label="Reading the area's situation" /> : (
                <>
                    {context.situation
                        ? <span style={{ fontSize: 13, color: "var(--txt2)", lineHeight: 1.45, textWrap: "pretty" }}>{context.situation}</span>
                        : <span style={{ fontSize: 12, color: "var(--txt4)" }}>{context.pending ? "Working out what matters here…" : "No situation known."}</span>}
                    {safeArray(context.watch_for).length > 0 && (
                        <ul style={{ margin: 0, paddingLeft: 16, display: "flex", flexDirection: "column", gap: 3, fontSize: 12.5 }}>
                            {context.watch_for.map((w) => <li key={w}>{w}</li>)}
                        </ul>
                    )}
                    <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                        {sur.local ?? 0} signal{sur.local === 1 ? "" : "s"} within 150 km and {sur.regional ?? 0} in the region this week · {sur.fires ?? 0} fire detection{sur.fires === 1 ? "" : "s"} within 25 km · {sur.vessels_now ?? 0} vessel{sur.vessels_now === 1 ? "" : "s"} nearby now
                    </span>
                    {sigs.slice(0, 3).map((x) => (
                        <span key={x.headline} style={{ fontSize: 11.5, color: "var(--txt2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={x.headline}>
                            · {x.headline} <span style={{ color: "var(--txt4)" }}>{x.km} km · {agoLabel(x.published_at)}</span>
                        </span>
                    ))}
                </>
            )}
        </div>
    )
}

/**
 * One kind's count at each pass, as a line over time, with its normal range
 * shaded: the mean ± one standard deviation of the passes before the last,
 * so a pass outside the band is visibly unusual. Hover a point for the pass,
 * click it to open that pass.
 */
function CountChart({ s, selectedKey, onPick }) {
    const [hover, setHover] = useState(null)
    const pts = s.points
    const W = 330, H = 64, P = 6
    const ns = pts.map((p) => p.n)
    const base = ns.length > 2 ? ns.slice(0, -1) : ns
    const mean = base.reduce((a, b) => a + b, 0) / Math.max(1, base.length)
    const sd = Math.sqrt(base.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, base.length))
    const max = Math.max(1, ...ns, mean + sd)
    const x = (i) => P + (pts.length === 1 ? (W - 2 * P) / 2 : (i / (pts.length - 1)) * (W - 2 * P))
    const y = (n) => H - P - (n / max) * (H - 2 * P)
    const last = ns[ns.length - 1] ?? 0
    const off = Math.abs(last - mean) > Math.max(1, sd)
    const h = hover != null ? pts[hover] : null
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12 }}>
                <span style={{ color: "var(--txt2)" }}>{noun(s.label, 2)}</span>
                <span style={{ marginLeft: "auto", fontFamily: "var(--mz-font-mono)", fontSize: 11, color: h ? "var(--txt)" : off ? "var(--amber)" : "var(--txt)" }}>
                    {h ? `${fmtDay(h.when)}: ${h.n}` : `${last} now · normal ${Math.max(0, Math.round(mean - sd))}–${Math.round(mean + sd)}`}
                </span>
            </div>
            <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block", overflow: "visible" }} onMouseLeave={() => setHover(null)}>
                <rect x={P} width={W - 2 * P} y={y(mean + sd)} height={Math.max(1, y(Math.max(0, mean - sd)) - y(mean + sd))} fill="var(--accdim)" />
                <line x1={P} x2={W - P} y1={y(mean)} y2={y(mean)} stroke="var(--txt4)" strokeDasharray="3 3" strokeWidth={1} />
                <polyline fill="none" stroke="var(--acchi)" strokeWidth={1.8} points={pts.map((p, i) => `${x(i)},${y(p.n)}`).join(" ")} />
                {pts.map((p, i) => (
                    <g key={p.key} style={{ cursor: "pointer" }} onMouseEnter={() => setHover(i)} onClick={() => onPick(p.key)}>
                        <rect x={x(i) - 8} y={0} width={16} height={H} fill="transparent" />
                        <circle cx={x(i)} cy={y(p.n)} r={p.key === selectedKey ? 4.5 : hover === i ? 4 : 2.6}
                            fill={p.key === selectedKey ? "var(--acchi)" : "var(--bg-1, #fff)"} stroke="var(--acchi)" strokeWidth={1.6} />
                    </g>
                ))}
            </svg>
        </div>
    )
}

/** The passes on a time line: drag or click to move through them. */
function PassSlider({ passes, scanId, onPick }) {
    const chron = [...passes].reverse()
    const idx = Math.max(0, chron.findIndex((p) => p.scanId === scanId))
    const t = (p) => new Date(String(p.when).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(p.when) ? "" : "Z")).getTime()
    const t0 = t(chron[0]), t1 = t(chron[chron.length - 1])
    const at = (p) => (t1 > t0 ? (t(p) - t0) / (t1 - t0) : 0.5) * 100
    return (
        <div style={{ flex: "none", padding: "4px 8px 0" }}>
            <div style={{ position: "relative", height: 26 }}>
                <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 2, background: "var(--gline2)" }} />
                {chron.map((p, i) => (
                    <button key={p.key} onClick={() => onPick(p.scanId)} title={`${whenFull(p.when)}${p.hasImage ? "" : " · image retired"}`} style={{
                        position: "absolute", left: `calc(${at(p)}% - 7px)`, top: 6, width: 14, height: 14, padding: 0, cursor: "pointer",
                        border: `2px solid ${i === idx ? "var(--acchi)" : "var(--txt4)"}`,
                        background: i === idx ? "var(--acchi)" : p.hasImage ? "var(--bg-1, #fff)" : "transparent",
                        transform: "rotate(45deg)",
                    }} />
                ))}
            </div>
            <div style={{ position: "relative", height: 14, fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                {chron.map((p, i) => (i === 0 || i === chron.length - 1 || i === idx) && (
                    <span key={p.key} style={{ position: "absolute", left: `${at(p)}%`, transform: `translateX(${i === 0 ? "0" : i === chron.length - 1 ? "-100%" : "-50%"})`,
                                               color: i === idx ? "var(--txt)" : undefined, whiteSpace: "nowrap" }}>{fmtDay(p.when)}</span>
                ))}
            </div>
            <input type="range" min={0} max={chron.length - 1} value={idx} aria-label="Move through the passes"
                onChange={(e) => onPick(chron[Number(e.target.value)].scanId)}
                style={{ width: "100%", accentColor: "var(--acchi)", margin: "2px 0 0" }} />
        </div>
    )
}

/**
 * Watch an area: name a place, choose how big and how often. The square is
 * centred on the place; the scanner covers it at native resolution in tiles.
 */
function NewArea({ onDone, onCancel }) {
    const [q, setQ] = useState("")
    const [hits, setHits] = useState([])
    const [place, setPlace] = useState(null)
    const [km, setKm] = useState(5)
    const [every, setEvery] = useState(24)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        const t = q.trim()
        if (t.length < 2 || place?.label === t) { setHits([]); return undefined }
        const timer = setTimeout(() => {
            fetch(`${API_BASE}/api/search?q=${encodeURIComponent(t)}&limit=6`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : [])).then((d) => setHits(Array.isArray(d) ? d.filter((x) => Number.isFinite(x.lat)) : []))
                .catch(() => setHits([]))
        }, 200)
        return () => clearTimeout(timer)
    }, [q, place])

    const create = async () => {
        if (!place) return
        setBusy(true)
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}` },
                body: JSON.stringify({
                    name: place.name.slice(0, 80), polygon_geojson: squareAround(place.lat, place.lon, km / 2),
                    scan_interval_hours: every, priority: "high", alert_threshold: "medium",
                }),
            })
            const d = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
            toast(`Watching ${place.name} — the first optical and radar pass is being fetched now`, { icon: "i-check" })
            onDone(d)
        } catch (e) { toast(`Could not create it — ${e.message}`, { icon: "i-alert" }) } finally { setBusy(false) }
    }

    return (
        <div style={{ flex: "none", padding: "12px 18px", borderBottom: "1px solid var(--gline)", display: "grid",
                      gridTemplateColumns: "minmax(220px,2fr) 120px 140px 190px auto", gap: 10, alignItems: "end" }}>
            <label style={{ position: "relative", display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={EYE}>Place</span>
                <input autoFocus value={q} onChange={(e) => { setQ(e.target.value); setPlace(null) }} placeholder="A port, an airbase, a town, a strait…" style={FIELD} />
                {hits.length > 0 && !place && (
                    <div style={{ position: "absolute", top: 50, left: 0, right: 0, zIndex: 20, background: "var(--bg-1, var(--canvas))", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)" }}>
                        {hits.map((h) => (
                            <button key={`${h.lat},${h.lon}`} onClick={() => { const label = h.display_name || h.name; setPlace({ name: h.name || label, label, lat: h.lat, lon: h.lon }); setQ(label); setHits([]) }}
                                style={{ display: "block", width: "100%", padding: "7px 10px", border: 0, background: "transparent", color: "var(--txt)", font: "inherit", fontSize: 12.5, textAlign: "left", cursor: "pointer" }}>
                                {h.display_name || h.name}
                            </button>
                        ))}
                    </div>
                )}
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={EYE}>Size</span>
                <select value={km} onChange={(e) => setKm(Number(e.target.value))} style={FIELD}>
                    {[2, 5, 10, 20, 40].map((k) => <option key={k} value={k}>{k} × {k} km</option>)}
                </select>
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={EYE}>Check every</span>
                <select value={every} onChange={(e) => setEvery(Number(e.target.value))} style={FIELD}>
                    {[6, 12, 24, 48, 120].map((h) => <option key={h} value={h}>{h} hours</option>)}
                </select>
            </label>
            <span style={{ fontSize: 11.5, color: "var(--txt3)", alignSelf: "center", lineHeight: 1.35 }}>
                Optical and radar, every pass.<br />The first pass starts now.
            </span>
            <span style={{ display: "flex", gap: 6 }}>
                <button onClick={create} disabled={!place || busy} style={{ ...PRIMARY, opacity: place ? 1 : 0.5 }}>{busy ? "Creating…" : "Watch it"}</button>
                <button onClick={onCancel} style={BTN}>Cancel</button>
            </span>
        </div>
    )
}

/**
 * ▣ Areas — what is being watched, how often, and with what.
 *
 * Interval, sensor and class are the three settings that decide what a
 * region can ever detect, so they are on the row rather than behind an
 * edit dialog: changing a cadence should not be a four-click operation.
 */
const areaKm = (z) => {
    const b = z?.bbox
    if (!b) return ""
    const w = (b.max_lon - b.min_lon) * 111.32 * Math.cos(((b.min_lat + b.max_lat) / 2) * Math.PI / 180)
    const h = (b.max_lat - b.min_lat) * 110.57
    return `${w.toFixed(w < 10 ? 1 : 0)} × ${h.toFixed(h < 10 ? 1 : 0)} km`
}

const AREA_GRID = "1.6fr .9fr .7fr 1fr .9fr auto"

/** The red dot: this zone's latest scans found something new (zone_change.py). */
function FreshDot({ on, size = 8 }) {
    if (!on) return null
    return <i data-fresh-dot aria-label="new finding" style={{ width: size, height: size, borderRadius: "50%", background: "var(--red)", flex: "none", display: "inline-block", boxShadow: "0 0 0 3px color-mix(in srgb, var(--red) 22%, transparent)" }} />
}

/** "● 2 last · 5 in 7 d" — what a zone's scans found, with the finding as the tooltip. */
function FindingBadge({ zone }) {
    const f = zoneFinding(zone)
    const tip = [f.text, f.radar?.headline && `Radar change: ${f.radar.headline}`].filter(Boolean).join("\n")
    if (!f.fresh && !f.week && !f.radar) return <span style={{ fontSize: 11, color: "var(--txt4)" }}>nothing found</span>
    return (
        <span data-finding-badge title={tip || undefined} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: f.fresh ? "var(--red)" : "var(--txt3)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
            <FreshDot on={f.fresh} size={7} />
            {f.fresh ? (f.kind === "radar_change" ? "radar change" : `${f.count} new`) : null}
            {f.fresh && (f.last || f.week) ? " · " : ""}
            {f.last || f.week ? `${f.last} last · ${f.week} in 7 d` : (!f.fresh && f.radar ? "radar: nothing new" : "")}
        </span>
    )
}

/** Group/subgroup roll-up: "2 with new findings · 14 detections in 7 days". */
function RollUp({ fresh, week }) {
    if (!fresh && !week) return null
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: fresh ? "var(--red)" : "var(--txt3)" }}>
            <FreshDot on={fresh > 0} size={7} />
            {fresh ? `${fresh} with new findings` : ""}{fresh && week ? " · " : ""}{week ? `${week} detection${week === 1 ? "" : "s"} in 7 days` : ""}
        </span>
    )
}

/** POST to the overwatch API; throws with the server's own reason. */
async function owPost(path, body) {
    const r = await fetch(`${API_BASE}/api/overwatch/${path}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
    return d
}

/**
 * ▣ Areas — what is being watched, as a tree: conflict → kind of place →
 * areas (overwatchTree.js). Generated proposals sit in the same tree with
 * their one-line reason and Accept / Decline, by the area, the subgroup or
 * the whole group — nothing generated is scanned until accepted.
 *
 * Interval, sensor and class stay on the row rather than behind an edit
 * dialog: changing a cadence should not be a four-click operation.
 */
function AreasTab({ zones, onChanged, onOpen, focusGroup }) {
    const [editing, setEditing] = useState(null)
    const [draft, setDraft] = useState({})
    // "With findings first" is the default: the point of the list is where
    // something was detected (owner, 2026-10-11). "Only with findings" filters.
    const [findingsFirst, setFindingsFirst] = useState(true)
    const [onlyFindings, setOnlyFindings] = useState(false)
    const tree = useMemo(() => buildZoneTree(onlyFindings ? safeArray(zones).filter((z) => isProposal(z) || hasFindings(z)) : zones, { findingsFirst }),
        [zones, findingsFirst, onlyFindings])
    const freshTotal = useMemo(() => safeArray(zones).filter((z) => zoneFinding(z).fresh).length, [zones])
    // Groups start open when small or when they hold proposals to decide on.
    const [closed, setClosed] = useState({})
    const isOpen = (key, dflt) => (key in closed ? !closed[key] : dflt)
    const toggle = (key, dflt) => setClosed((c) => ({ ...c, [key]: isOpen(key, dflt) }))
    useEffect(() => {
        if (focusGroup) setClosed((c) => ({ ...c, [focusGroup]: false }))
    }, [focusGroup])

    const start = (z) => { setEditing(z.system_id); setDraft({ ...z }) }
    const save = async (z) => {
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones/${z.system_id}`, {
                method: "PUT", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: draft.name, aoi_class: draft.aoi_class,
                    scan_interval_hours: Number(draft.scan_interval_hours) || 24,
                    sensor_preference: draft.sensor_preference,
                    description: draft.description || "",
                }),
            })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            toast("Area saved"); setEditing(null); onChanged()
        } catch (e) { toast(`Could not save it — ${e.message}`, { icon: "i-alert" }) }
    }
    const togglePause = async (z) => {
        const active = z.status === "active"
        await fetch(`${API_BASE}/api/watch-zones/${z.system_id}`, {
            method: "PUT", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: !active, status: active ? "paused" : "active" }),
        }).catch(() => {})
        onChanged()
    }
    const scanNow = async (z) => {
        toast(`Scanning ${z.name}…`)
        await fetch(`${API_BASE}/api/watch-zones/${z.system_id}/scan-now`,
            { method: "POST", credentials: "include" }).catch(() => {})
        onChanged()
    }
    const del = async (z) => {
        if (!(await confirmAction({ title: "Are you sure?", message: 
            `Delete "${z.name}" (${z.system_id})?\n\n`
            + `This also deletes every scan of this area and all their detections, `
            + `permanently. Change detection has no baseline to compare against afterwards.`
        , confirm: "Delete", danger: true }))) return
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones/${z.system_id}`,
                { method: "DELETE", credentials: "include" })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            toast("Area deleted"); onChanged(); window.dispatchEvent(new CustomEvent("akili:zones-changed"))
        } catch (e) { toast(`Could not delete it — ${e.message}`, { icon: "i-alert" }) }
    }
    /** Accept or decline proposals: {ids} | {group, subgroup?}. */
    const decide = async (verb, sel, what) => {
        try {
            const d = await owPost(verb, sel)
            if (verb === "accept") {
                const n = safeArray(d.activated).length
                toast(`${what}: ${n} area${n === 1 ? "" : "s"} now watched${safeArray(d.sweeps).length ? " · border sweep started" : ""}`)
            } else toast(`${what}: ${safeArray(d.declined).length} declined`)
            onChanged()
        } catch (e) { toast(`Could not ${verb} — ${e.message}`, { icon: "i-alert" }) }
    }

    const SMALL = { ...BTN, height: 24, padding: "0 9px", fontSize: 11.5 }
    const head = () => ({
        display: "flex", alignItems: "center", gap: 10, width: "100%", border: 0, background: "transparent",
        color: "var(--txt)", font: "inherit", cursor: "pointer", padding: 0, textAlign: "left", flex: 1, minWidth: 0,
    })

    const row = (z) => {
        const on = editing === z.system_id
        const m = z.metadata || {}
        if (isProposal(z)) {
            return (
                <div key={z.system_id} data-proposal={z.system_id} style={{
                    display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center",
                    padding: "8px 14px 8px 34px", borderBottom: "1px solid var(--gline)", fontSize: 12.5,
                    background: "color-mix(in srgb, var(--acc) 5%, transparent)",
                }}>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                            <span style={{ fontWeight: 600 }}>{z.name}</span>
                            <span style={{ ...EYE, fontSize: 9.5, color: "var(--acchi)" }}>proposed</span>
                            {m.score != null && <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt3)" }}>score {Math.round(m.score)}</span>}
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt4)" }}>
                                {z.aoi_class === "sweep_plan" ? "starts the sweep" : `every ${z.scan_interval_hours}h · ${areaKm(z)}`}
                            </span>
                        </div>
                        <div style={{ color: "var(--txt3)", marginTop: 2, textWrap: "pretty" }}>{m.reason || z.description}</div>
                    </div>
                    <span style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => decide("accept", { ids: [z.system_id] }, z.name)}
                            style={{ ...SMALL, border: 0, background: "var(--acc)", color: "var(--mz-cream)" }}>
                            {z.aoi_class === "sweep_plan" ? "Start sweep" : "Accept"}
                        </button>
                        <button onClick={() => decide("decline", { ids: [z.system_id] }, z.name)} style={SMALL}>Decline</button>
                    </span>
                </div>
            )
        }
        return (
            <div key={z.system_id} style={{
                display: "grid", gridTemplateColumns: AREA_GRID,
                gap: 12, alignItems: "center", padding: "10px 14px 10px 34px",
                borderBottom: "1px solid var(--gline)", fontSize: 13,
            }}>
                {on ? (
                    <>
                        <input value={draft.name || ""} style={FIELD}
                            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                        <select value={draft.aoi_class || "custom"} style={FIELD}
                            onChange={(e) => setDraft((d) => ({ ...d, aoi_class: e.target.value }))}>
                            {[...new Set([...AOI_CLASSES, draft.aoi_class || "custom"])].map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <input type="number" min={1} value={draft.scan_interval_hours || 24} style={FIELD}
                            onChange={(e) => setDraft((d) => ({ ...d, scan_interval_hours: e.target.value }))} />
                        <span style={{ color: "var(--txt3)", fontSize: 12 }}>optical + radar · {areaKm(z)}</span>
                        <span style={{ color: "var(--txt4)", fontSize: 11 }}>—</span>
                        <span style={{ display: "flex", gap: 4 }}>
                            <button onClick={() => save(z)} style={{ ...BTN, border: 0, background: "var(--acc)", color: "var(--mz-cream)" }}>Save</button>
                            <button onClick={() => setEditing(null)} style={BTN}>Cancel</button>
                        </span>
                    </>
                ) : (
                    <>
                        <button onClick={() => onOpen(z.system_id)} title={zoneFinding(z).text || m.reason || z.description || ""} style={{
                            border: 0, background: "transparent", color: "var(--txt)",
                            font: "inherit", fontWeight: 600, textAlign: "left",
                            cursor: "pointer", padding: 0, minWidth: 0, display: "flex", alignItems: "center", gap: 7,
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}><FreshDot on={zoneFinding(z).fresh} /><span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{z.name}</span></button>
                        <span style={{ color: "var(--txt2)" }}>{z.aoi_class}</span>
                        <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--txt2)" }}>
                            {z.aoi_class === "sweep_plan" ? "—" : `${z.scan_interval_hours}h`}
                        </span>
                        <span style={{ color: "var(--txt2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {z.aoi_class === "sweep_plan" ? "radar, tile by tile" : `optical + radar · ${areaKm(z)}`}
                        </span>
                        <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt3)" }}>
                                {z.last_scanned_at ? fmtDate(z.last_scanned_at) : "never"}
                            </span>
                            {z.aoi_class !== "sweep_plan" && <FindingBadge zone={z} />}
                        </span>
                        <span style={{ display: "flex", gap: 4 }}>
                            {z.aoi_class === "sweep_plan" ? (
                                <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>controlled in the sweep panel above</span>
                            ) : (
                                <>
                                    <button onClick={() => start(z)} style={BTN}>Edit</button>
                                    <button onClick={() => drawOnMap(z)} title="Draw a new boundary for this area on the map" style={BTN}>Redraw</button>
                                    <button onClick={() => scanNow(z)} style={BTN}>Scan now</button>
                                    <button onClick={() => togglePause(z)} style={BTN}>
                                        {z.status === "active" ? "Pause" : "Resume"}
                                    </button>
                                </>
                            )}
                            <button onClick={() => del(z)} style={{ ...BTN, color: "var(--red)" }}>Delete</button>
                        </span>
                    </>
                )}
            </div>
        )
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--gline)" }} data-testid="areas-tree">
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 14px", borderBottom: "1px solid var(--gline)", flexWrap: "wrap" }}>
                <RollUp fresh={freshTotal} week={0} />
                {!freshTotal && <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>No new findings in the last 72 hours</span>}
                <div style={{ flex: 1 }} />
                <button onClick={() => setFindingsFirst((v) => !v)} aria-pressed={findingsFirst} style={{ ...SMALL, background: findingsFirst ? ON : "transparent" }}>With findings first</button>
                <button onClick={() => setOnlyFindings((v) => !v)} aria-pressed={onlyFindings} style={{ ...SMALL, background: onlyFindings ? ON : "transparent" }}>Only with findings</button>
            </div>
            <div style={{
                display: "grid", gridTemplateColumns: AREA_GRID,
                gap: 12, padding: "9px 14px 9px 34px", borderBottom: "1px solid var(--gline)", ...EYE,
            }}>
                <span>Area</span><span>Class</span><span>Every</span>
                <span>Sensors · size</span><span>Last pass · found</span><span />
            </div>
            {tree.map((g) => {
                const gOpen = isOpen(g.group, g.proposed > 0 || g.count <= 12 || g.group === focusGroup)
                return (
                    <div key={g.group} data-group={g.group}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 14px", borderBottom: "1px solid var(--gline)", background: "var(--glass2)" }}>
                            <button onClick={() => toggle(g.group, gOpen)} style={head(gOpen)} aria-expanded={gOpen}>
                                <span style={{ width: 12, color: "var(--txt3)" }}>{gOpen ? "▾" : "▸"}</span>
                                <span style={{ fontWeight: 600, fontSize: 14 }}>{g.group}</span>
                                <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>
                                    {g.count - g.proposed} watched{g.proposed ? ` · ${g.proposed} proposed` : ""}
                                </span>
                                <RollUp fresh={g.fresh} week={g.week} />
                            </button>
                            {g.proposed > 0 && g.group !== "Other" && (
                                <span style={{ display: "flex", gap: 4, flex: "none" }}>
                                    <button onClick={() => decide("accept", { group: g.group }, `${g.group}, all`)}
                                        style={{ ...SMALL, border: 0, background: "var(--acc)", color: "var(--mz-cream)" }}>Accept all</button>
                                    <button onClick={() => decide("decline", { group: g.group }, `${g.group}, all`)} style={SMALL}>Decline all</button>
                                </span>
                            )}
                        </div>
                        {gOpen && g.subgroups.map((s) => {
                            const key = `${g.group}/${s.subgroup}`
                            const sOpen = isOpen(key, true)
                            return (
                                <div key={key} data-subgroup={s.subgroup}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 14px 7px 26px", borderBottom: "1px solid var(--gline)" }}>
                                        <button onClick={() => toggle(key, sOpen)} style={head(sOpen)} aria-expanded={sOpen}>
                                            <span style={{ width: 12, color: "var(--txt4)" }}>{sOpen ? "▾" : "▸"}</span>
                                            <span style={{ ...EYE, color: "var(--txt2)" }}>{s.subgroup}</span>
                                            <span style={{ fontSize: 11, color: "var(--txt4)" }}>
                                                {s.zones.length - s.proposed ? `${s.zones.length - s.proposed} watched` : ""}
                                                {s.zones.length - s.proposed && s.proposed ? " · " : ""}
                                                {s.proposed ? `${s.proposed} proposed` : ""}
                                            </span>
                                            <RollUp fresh={s.fresh} week={s.week} />
                                        </button>
                                        {s.proposed > 0 && g.group !== "Other" && (
                                            <span style={{ display: "flex", gap: 4, flex: "none" }}>
                                                <button onClick={() => decide("accept", { group: g.group, subgroup: s.subgroup }, s.subgroup)} style={SMALL}>
                                                    {s.subgroup === "Border sweep" ? "Start sweep" : "Accept subgroup"}
                                                </button>
                                                <button onClick={() => decide("decline", { group: g.group, subgroup: s.subgroup }, s.subgroup)} style={SMALL}>Decline</button>
                                            </span>
                                        )}
                                    </div>
                                    {sOpen && s.zones.map(row)}
                                </div>
                            )
                        })}
                    </div>
                )
            })}
            {onlyFindings && zones.length > 0 && !tree.length && (
                <div style={{ padding: 16, fontSize: 12.5, color: "var(--txt3)" }}>No area has findings in the last 7 days.</div>
            )}
            {!zones.length && (
                <div style={{ padding: 16, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                    No areas are being watched. Generate overwatch zones for a conflict above, or draw an
                    area on the map — this screen is for looking at what came back.
                </div>
            )}
        </div>
    )
}

/**
 * Overwatch — "generate overwatch zones for <conflict>", and the border
 * sweep. Generation proposes (never scans); the report says how many of
 * each kind were proposed and how many more are available.
 */
function OverwatchPanel({ conflict, setConflict, onChanged }) {
    const [conflicts, setConflicts] = useState([])
    const [busy, setBusy] = useState(false)
    const [report, setReport] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/conflicts`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setConflicts(safeArray(d?.conflicts)))
            .catch(() => {})
    }, [])
    const generate = async () => {
        setBusy(true)
        try {
            const d = await owPost("generate", { conflict })
            setReport(d)
            toast(`${safeArray(d.created).length} new proposal${safeArray(d.created).length === 1 ? "" : "s"}${safeArray(d.updated).length ? `, ${d.updated.length} updated` : ""} for ${d.group}`)
            onChanged(d.group)
        } catch (e) { toast(`Could not generate — ${e.message}`, { icon: "i-alert" }) }
        setBusy(false)
    }
    return (
        <div style={{ ...CARD, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }} data-testid="overwatch-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={EYE}>Overwatch</span>
                <select value={conflict} onChange={(e) => setConflict(e.target.value)} style={{ ...FIELD, width: 260 }} aria-label="Conflict">
                    {(conflicts.length ? conflicts : [{ id: conflict, name: conflict }]).map((c) => (
                        <option key={c.id} value={c.id}>{c.name || c.id}</option>
                    ))}
                </select>
                <button onClick={generate} disabled={busy} style={PRIMARY}>{busy ? "Generating…" : "Generate overwatch zones"}</button>
                <span style={{ fontSize: 11.5, color: "var(--txt3)", flex: 1, minWidth: 220, textWrap: "pretty" }}>
                    Proposes up to 40 places where a change seen from orbit would say what a side does next.
                    Nothing is scanned until you accept it.
                </span>
            </div>
            {report && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontSize: 12, color: "var(--txt2)" }} data-testid="overwatch-report">
                    {Object.entries(report.report || {}).map(([sub, r]) => (
                        <span key={sub}>
                            <b style={{ fontWeight: 600 }}>{sub}</b> {r.proposed} proposed
                            {r.more_available ? ` · ${r.more_available} more available` : ""}
                            {r.already_watched ? ` · ${r.already_watched} already watched` : ""}
                        </span>
                    ))}
                    {safeArray(report.notes).map((n) => <span key={n} style={{ color: "var(--txt3)" }}>{n}</span>)}
                </div>
            )}
            <SweepPanel conflict={conflict} onChanged={onChanged} />
        </div>
    )
}

const RESULT_C = { found: "var(--red)", clean: "var(--green)", no_data: "var(--txt4)", inconclusive: "var(--amber, #d8a24a)", error: "var(--txt4)" }

/** The border sweep: progress, what it found, start / pause / stop, and
 *  the tiles looked at most recently. */
function SweepPanel({ conflict, onChanged }) {
    const [st, setSt] = useState(null)
    const read = useCallback(() => {
        fetch(`${API_BASE}/api/overwatch/sweep/status?conflict=${encodeURIComponent(conflict)}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => setSt(d)).catch(() => {})
    }, [conflict])
    useEffect(() => {
        read()
        const t = setInterval(read, 30000)
        return () => clearInterval(t)
    }, [read])
    const act = async (action) => {
        try {
            setSt(await owPost(`sweep/${action}`, { conflict }))
            toast(action === "start" ? "Border sweep running — one or two tiles every 15 minutes" : `Sweep ${action === "pause" ? "paused" : "stopped"}`)
            onChanged()
        } catch (e) { toast(`Could not ${action} the sweep — ${e.message}`, { icon: "i-alert" }) }
    }
    if (!st) return null
    const total = st.tiles_total || st.tiles_planned || 0
    const done = st.tiles_done || 0
    const status = st.status || "none"
    if (!total) return (
        <div style={{ fontSize: 12, color: "var(--txt3)" }}>No border band to sweep for this conflict.</div>
    )
    return (
        <div style={{ borderTop: "1px solid var(--gline)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }} data-testid="sweep-panel">
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={EYE}>Border sweep</span>
                <span style={{ fontSize: 12, color: "var(--txt2)" }}>
                    {status === "none" ? `${total} tiles of ~20 km planned — not started`
                        : `${status} · ${done} of ${total} tiles swept · ${st.found || 0} found`}
                    {st.current_tile ? ` · looking at ${st.current_tile}` : ""}
                </span>
                <div style={{ flex: 1, minWidth: 120, height: 4, background: "var(--gline)" }}>
                    <div style={{ width: `${total ? Math.min(100, (done / total) * 100) : 0}%`, height: "100%", background: "var(--acc)" }} />
                </div>
                {status === "running"
                    ? <button onClick={() => act("pause")} style={BTN}>Pause</button>
                    : <button onClick={() => act("start")} style={{ ...BTN, color: "var(--acchi)" }}>{status === "none" ? "Start sweep" : "Resume sweep"}</button>}
                {status !== "none" && status !== "stopped" && <button onClick={() => act("stop")} style={BTN}>Stop</button>}
            </div>
            <div style={{ fontSize: 11.5, color: "var(--txt3)", textWrap: "pretty" }}>
                Radar change, one ~20 km tile at a time, 20–150 km in from the border on the side that would stage.
                A tile with nothing new is deleted again; a new cluster of bright radar returns is kept and notified.
                At 10–20 m a field hospital, a tent camp and a vehicle park look alike — a find is a reason to look, not an identification.
                {st.last_error ? ` Last error: ${st.last_error}` : ""}
            </div>
            {safeArray(st.found_items).length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {st.found_items.map((f) => (
                        <div key={`${f.tile_id}-${f.scanned_at}`} style={{ fontSize: 12, color: "var(--txt)" }}>
                            <span style={{ color: "var(--red)" }}>●</span> {f.title || f.summary}
                            <span style={{ color: "var(--txt4)", fontFamily: "var(--mz-font-mono)", fontSize: 10.5 }}> · {f.tile_id} · {fmtDate(f.scanned_at)}{f.zone_id ? ` · ${f.zone_id}` : ""}</span>
                        </div>
                    ))}
                </div>
            )}
            {safeArray(st.recent).length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }} aria-label="Tiles swept">
                    {st.recent.slice(0, 40).map((r) => (
                        <span key={`${r.tile_id}-${r.scanned_at}`} title={`${r.tile_id} · ${r.result} · ${r.scanned_at}\n${r.summary?.summary || ""}`} style={{
                            fontFamily: "var(--mz-font-mono)", fontSize: 10, padding: "1px 5px",
                            border: `1px solid ${RESULT_C[r.result] || "var(--gline2)"}`, color: "var(--txt3)",
                        }}>{r.tile_id} {r.result}</span>
                    ))}
                </div>
            )}
        </div>
    )
}
