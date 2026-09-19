import { useState, useEffect, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"
import { SENSOR_OPTIONS, SENSOR_LABEL, AOI_CLASS_ICON, AOI_CLASSES, fmtDate, SceneScrubber, SceneComparison } from "../components/imagery/sceneComparison.jsx"
import ScanProgress from "../components/imagery/ScanProgress.jsx"
import AoiMiniMap from "./AoiMiniMap.jsx"
import Minimap from "../components/Minimap.jsx"
import { boundsToPolygon } from "./sourcesLogic.js"

// Imagery — page-by-page rebuild, Part B. A UI over the real, already-
// existing Sentinel scanner pipeline (backend/sentinel_scanner.py, real
// YOLO-OBB/DOTA optical detector) — never a second/parallel/demo pipeline.
// No glass panes (not called for in this part of the spec, unlike
// Situation/Dossiers) — plain docked panes matching Generate.jsx.
//
// Honest scope disclosure: the real pipeline in this codebase is single-
// scene vessel detection, not the full task/pair/co-register/... pipeline
// the spec describes. This page bridges that real output into a real
// two-scene comparison (backend/imagery_pipeline.py: real reference-scan
// lookup, real spatial new/existing/removed matching, real persistent-
// false-positive suppression) rather than fabricating the missing stages.
// SAR is real and deployed as of the SAR-detector round (backend/
// sar_detector.py, real Sentinel-1 raw VH/VV bands + Faster R-CNN) —
// this page shows both OPTICAL and SAR detections, per the scan's own
// real `instrument` field.
//
// Real Part [Imagery/Situation top-bar entry point] round: the sensor
// vocabulary and comparison-view UI (SceneScrubber/SceneComparison) now
// live in ../components/imagery/sceneComparison.jsx, shared with
// src/components/ImagerySidebar.jsx (Situation's top-bar imagery/detection
// entry point) — this file no longer defines its own copy.

const CADENCES = ["daily", "3-day", "weekly", "monthly", "on demand"]

// Object types are stored as schema keys. A person reads "storage tank";
// "storage_tank" is an implementation detail leaking into a deliverable.
const readable = (t) => (t || "object").replace(/_/g, " ")

/**
 * NewAreaForm — name the drawn box and say how it should be watched.
 *
 * Sensor is chosen HERE rather than defaulted, because it is the decision
 * that determines what the region can ever detect: optical sees what a
 * thing is and fails under cloud and at night; SAR sees through both and
 * cannot tell you what it found. Burying that behind a default would make
 * a region quietly unable to answer the question it was drawn for.
 */
function NewAreaForm({ bounds, onCancel, onCreate }) {
    const [name, setName] = useState("")
    const [sensor, setSensor] = useState("sentinel2_optical")
    const [cadence, setCadence] = useState(24)
    const [aoiClass, setAoiClass] = useState("custom")
    const [busy, setBusy] = useState(false)

    // What was actually drawn, in units a person can sanity-check before
    // committing to a recurring scan of it.
    const midLat = (bounds.north + bounds.south) / 2
    const kmW = Math.abs(bounds.east - bounds.west) * 111.32 * Math.cos((midLat * Math.PI) / 180)
    const kmH = Math.abs(bounds.north - bounds.south) * 111.32
    const areaKm2 = Math.round(kmW * kmH)
    // One Sentinel Hub request per 2048px tile at 10 m/px.
    const tiles = Math.max(1, Math.ceil(kmW / 20.48) * Math.ceil(kmH / 20.48))

    return (
        <div style={{ border: "1px solid var(--line)", padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)" }}>New observation area</div>
            <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                {kmW.toFixed(1)} × {kmH.toFixed(1)} km · {areaKm2.toLocaleString()} km²<br />
                ≈ {tiles} API request{tiles === 1 ? "" : "s"} per scan at native 10 m/px
            </div>
            <input className="input sm" placeholder="Name (e.g. Kharg Island terminal)"
                value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <select className="input sm" value={sensor} onChange={(e) => setSensor(e.target.value)}>
                {SENSOR_OPTIONS.filter((o) => o.real).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                ))}
            </select>
            <select className="input sm" value={aoiClass} onChange={(e) => setAoiClass(e.target.value)}>
                {AOI_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <label style={{ font: "400 10px var(--font)", color: "var(--txt-3)" }}>
                Re-scan every
                <input className="input sm" type="number" min={1} value={cadence}
                    onChange={(e) => setCadence(e.target.value)}
                    style={{ width: 60, marginLeft: 6 }} /> h
            </label>
            <div style={{ display: "flex", gap: 6 }}>
                <button className="btn sm" disabled={busy || !name.trim()}
                    onClick={async () => { setBusy(true); try { await onCreate({ name, sensor, cadence, aoiClass }) } finally { setBusy(false) } }}>
                    {busy ? "creating…" : "create"}
                </button>
                <button className="btn sm" onClick={onCancel}>cancel</button>
            </div>
        </div>
    )
}


export default function Imagery({ onOpenGenerate }) {
    const [aois, setAois] = useState([])
    const [selectedAoi, setSelectedAoi] = useState(null)
    // V3 Phase 1, §2.2 — real hook-based extension point, owned and called
    // by this component itself (never reassigned from outside).
    const inspectorExtensions = useInspectorExtensions()
    const [scenes, setScenes] = useState([])
    const [selectedScanId, setSelectedScanId] = useState(null)
    const [scene, setScene] = useState(null)
    // The big scene, zoomable, is the default. Comparison is a deliberate
    // choice, not the resting state: a tiled scan is tens of megapixels and
    // splitting the pane in two halves the resolution you can actually
    // inspect, which is the whole point of fetching it at 10 m/px.
    const [view, setView] = useState("after")
    const [showBoxes, setShowBoxes] = useState(true)
    // Real fullscreen toggle for the scene/detection image itself — the
    // comparison view's images were capped at a small fixed size
    // (maxWidth 420 / maxHeight 60-70vh) with no way to inspect a scan at
    // full resolution. This expands the same real <SceneComparison> in
    // place to fill the viewport rather than opening a second, parallel
    // "big image" viewer.
    const [fullscreen, setFullscreen] = useState(false)
    useEffect(() => {
        if (!fullscreen) return
        const onKey = (e) => { if (e.key === "Escape") setFullscreen(false) }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [fullscreen])
    const [confFloor, setConfFloor] = useState(0)
    const [kinds, setKinds] = useState({ new: true, expanded: true, removed: true })
    const [swipePos, setSwipePos] = useState(50)
    const [fadeOn, setFadeOn] = useState(false)
    const [fadeOpacity, setFadeOpacity] = useState(55)
    const [scopeCountry, setScopeCountry] = useState("")
    const [running, setRunning] = useState(false)
    const [selectedDet, setSelectedDet] = useState(null)
    // Native-resolution tiled scan: a job id to follow, and the cost of the
    // plan so the person sees what a scan will spend BEFORE it spends it.
    // Available scene dates for the selected area. The endpoint that serves
    // these was returning a 500 until this round, and before that collapsed
    // an entire history to one entry, so nothing has ever been able to offer
    // a choice of date.
    const [dates, setDates] = useState([])
    const [scanDate, setScanDate] = useState("")
    const [tiledJob, setTiledJob] = useState(null)
    const [tiledResult, setTiledResult] = useState(null)
    const viewerRef = useRef(null)
    // Draw a new observation region directly here. Until now a region could
    // only be created from Sources or over the API, which made the Imagery
    // page read-only for the one thing it exists to do.
    const [drawActive, setDrawActive] = useState(false)
    const [drawnBounds, setDrawnBounds] = useState(null)
    const clipRef = useRef(null)
    const fadeRef = useRef(null)

    const pendingLocateRef = useRef(null) // {systemId, scanId} awaiting AOI load
    const pendingFocusRef = useRef(null)  // detection_id to centre once the scene arrives

    useEffect(() => { loadAois() }, [])
    function loadAois() {
        fetch(`${API_BASE}/api/imagery/aois`).then((r) => r.json()).then((rows) => {
            setAois(rows)
            if (pendingLocateRef.current) {
                const { systemId, scanId } = pendingLocateRef.current
                pendingLocateRef.current = null
                const match = rows.find((r) => r.system_id === systemId)
                if (match) { setSelectedAoi(match); setSelectedScanId(scanId); return }
            }
            if (!selectedAoi && rows.length) setSelectedAoi(rows.find((r) => r.status === "active") || rows[0])
        })
    }

    useEffect(() => {
        if (!selectedAoi) return
        fetch(`${API_BASE}/api/watch-zones/${selectedAoi.system_id}/scans`).then((r) => r.json()).then((rows) => {
            setScenes(rows)
            const firstCompleted = rows.find((s) => s.status === "completed")
            setSelectedScanId(firstCompleted ? firstCompleted.scan_id : null)
        })
    }, [selectedAoi])

    useEffect(() => {
        if (!selectedScanId) { setScene(null); return }
        fetch(`${API_BASE}/api/imagery/scenes/${selectedScanId}`).then((r) => r.json()).then(setScene)
    }, [selectedScanId])

    // "Show me this one." Selecting a detection has to actually take the
    // person to it: a 4-pixel object inside a 40-megapixel scene is not
    // findable by being told it is highlighted somewhere. Switches to the
    // single-scene view because that is the one that can zoom, centres the
    // object, and the arrow follows from selectedDet.
    const focusDetection = useCallback((c) => {
        setSelectedDet(c || null)
        if (!c?.bbox) return
        setView("after")
        // The viewer only exists once that view has rendered.
        requestAnimationFrame(() => {
            viewerRef.current?.focus({ x: c.bbox[0], y: c.bbox[1], w: c.bbox[2], h: c.bbox[3] })
        })
    }, [])

    // Real deep-link entry point — the Briefings reader's "open change
    // detection" xref action jumps here with a real detection_id; resolve
    // its real (system_id, scan_id) and select both, the same state a
    // direct click through aois/scenes would land on.
    useEffect(() => {
        const handler = (e) => {
            const { detectionId, scanId, systemId } = e.detail || {}

            // An alert may know the scene without knowing which object
            // anchored it. Open the scene anyway rather than refusing: "we
            // cannot take you to the exact box" is not a reason to withhold
            // the picture.
            if (!detectionId && scanId) {
                if (systemId) {
                    const match = aois.find((r) => r.system_id === systemId)
                    if (match) setSelectedAoi(match)
                    else pendingLocateRef.current = { systemId, scanId }
                }
                setSelectedScanId(scanId)
                return
            }
            if (!detectionId) return
            fetch(`${API_BASE}/api/imagery/detections/${detectionId}/locate`).then((r) => (r.ok ? r.json() : null)).then((loc) => {
                if (!loc) return
                // Remember WHICH detection, not just which scene. A
                // notification that says "vessel detected at Khor Fakkan"
                // and then drops the reader into a scene with forty boxes
                // has made them do the search again by hand.
                pendingFocusRef.current = detectionId
                if (!aois.length) { pendingLocateRef.current = { systemId: loc.system_id, scanId: loc.scan_id }; return }
                const match = aois.find((r) => r.system_id === loc.system_id)
                if (match) setSelectedAoi(match)
                setSelectedScanId(loc.scan_id)
            }).catch(() => {})
        }
        window.addEventListener("akili:imagery-open-scene", handler)
        return () => window.removeEventListener("akili:imagery-open-scene", handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aois])

    useEffect(() => {
        setDates([]); setScanDate("")
        if (!selectedAoi?.bbox) return
        const b = selectedAoi.bbox
        let cancelled = false
        fetch(`${API_BASE}/api/sentinel/dates`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                bounds: { west: b.min_lon, south: b.min_lat, east: b.max_lon, north: b.max_lat },
                max_cloud: 60, days_back: 180,
            }),
        }).then((r) => (r.ok ? r.json() : null))
          .then((d) => { if (!cancelled) setDates(Array.isArray(d?.dates) ? d.dates : []) })
          .catch(() => { if (!cancelled) setDates([]) })
        return () => { cancelled = true }
    }, [selectedAoi])

    // The scene arrives asynchronously after the deep link resolves, so the
    // focus has to wait for it rather than firing into an empty viewer.
    useEffect(() => {
        const want = pendingFocusRef.current
        if (!want || !scene) return
        const target = (scene.changes || []).find(
            (c) => c.id === want || c.id === `removed-${want}`)
        if (!target) {
            // The detection did not survive into this scene's view — say so
            // rather than silently landing on the scene with nothing
            // selected, which reads as "we found nothing here".
            pendingFocusRef.current = null
            toast("That detection is no longer part of this scene's results", {})
            return
        }
        pendingFocusRef.current = null
        focusDetection(target)
    }, [scene, focusDetection])

    async function reRunDetection() {
        if (!selectedAoi || running) return
        setRunning(true)
        await fetch(`${API_BASE}/api/watch-zones/${selectedAoi.system_id}/scan-now`, { method: "POST" })
        toast("Real detection run started", {})
        // Poll for a new completed scan (real backend call, real elapsed time — no fixed schedule).
        const before = new Set(scenes.map((s) => s.scan_id))
        for (let i = 0; i < 40; i++) {
            await new Promise((r) => setTimeout(r, 3000))
            const rows = await fetch(`${API_BASE}/api/watch-zones/${selectedAoi.system_id}/scans`).then((r) => r.json())
            const fresh = rows.find((s) => !before.has(s.scan_id) && (s.status === "completed" || s.status === "error"))
            if (fresh) {
                setScenes(rows)
                setSelectedScanId(fresh.scan_id)
                toast(fresh.status === "completed" ? "Detection run complete" : `Run failed: ${fresh.error_message || "unknown error"}`, {})
                break
            }
        }
        setRunning(false)
    }

    // Run the AOI at the sensor's own resolution rather than as one
    // downsampled thumbnail. Uncapped by design, so the cost is shown and
    // confirmed rather than quietly spent: a zone-sized area is 60 API
    // requests and several minutes.
    async function runTiledScan() {
        if (!selectedAoi || tiledJob) return
        const b = selectedAoi.bbox
        const bounds = { west: b.min_lon, south: b.min_lat, east: b.max_lon, north: b.max_lat }
        const est = await fetch(`${API_BASE}/api/imagery/scan-tiled`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ bounds, estimate_only: true }),
        }).then((r) => r.json()).catch(() => null)
        if (!est || est.error) { toast(est?.error || "Could not plan a scan for this area", {}); return }
        if (est.api_requests > 8 &&
            !window.confirm(`${est.describe}\n\nRun it?`)) return

        const started = await fetch(`${API_BASE}/api/imagery/scan-tiled`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ bounds, date: scanDate || null,
                                   system_id: selectedAoi.system_id }),
        }).then((r) => r.json()).catch(() => null)
        if (!started || started.error) { toast(started?.error || "Scan could not be started", {}); return }
        setTiledResult(null)
        setTiledJob(started.job_id)
    }

    async function onTiledDone(jobId) {
        const out = await fetch(`${API_BASE}/api/imagery/scan-tiled/${jobId}`, { credentials: "include" })
            .then((r) => r.json()).catch(() => null)
        setTiledJob(null)
        if (!out) return
        setTiledResult(out)
        if (out.status === "error") { toast(out.error_message || "Scan failed", {}); return }
        // Partial coverage is a real qualification on the result, not a
        // detail to bury: "nothing there" and "never looked there" must not
        // read the same.
        // The scan is now part of the region's history, so the scene list
        // has to pick it up — otherwise the date just scanned is invisible
        // and cannot be compared against anything.
        if (out.scan_id && selectedAoi) {
            const rows = await fetch(`${API_BASE}/api/watch-zones/${selectedAoi.system_id}/scans`,
                                     { credentials: "include" })
                .then((r) => r.json()).catch(() => null)
            if (Array.isArray(rows)) { setScenes(rows); setSelectedScanId(out.scan_id) }
        }
        const cov = Math.round((out.coverage_fraction ?? 1) * 100)
        toast(`${out.detections?.length ?? 0} detection(s) at ${out.m_per_px} m/px` +
              (cov < 100 ? ` — ${cov}% of the area covered, ${out.tiles_failed?.length || 0} tile(s) failed` : ""), {})
    }

    // Deleting left the panel showing the region it had just removed:
    // the list reloaded but selectedAoi still pointed at the dead row, and
    // loadAois only auto-selects when nothing is selected. It looked as
    // though the delete had failed.
    function onAoiDeleted() {
        setSelectedAoi(null)
        setScenes([])
        setSelectedScanId(null)
        setScene(null)
        setSelectedDet(null)
        setTiledResult(null)
        loadAois()
        toast("Observation area deleted", { icon: "i-check" })
    }

    async function createDrawnArea({ name, sensor, cadence, aoiClass }) {
        const polygon = boundsToPolygon(drawnBounds)
        if (!name.trim() || !polygon) { toast("Give the area a name first", {}); return }
        const res = await fetch(`${API_BASE}/api/watch-zones`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
                name: name.trim(), polygon_geojson: polygon,
                aoi_class: aoiClass, sensor_preference: sensor,
                scan_interval_hours: Number(cadence),
                // A region drawn by hand is one the analyst wants looked at,
                // so it scans for vessels by default rather than arriving
                // inert with no tasks and silently never producing anything.
                ml_tasks: ["ship_detection"],
            }),
        })
        const d = await res.json().catch(() => null)
        if (!res.ok) { toast(d?.detail || "Could not create the area", {}); return }
        setDrawnBounds(null); setDrawActive(false)
        toast(`${d.system_id} created — ${SENSOR_LABEL[sensor] || sensor}, every ${cadence}h`, { icon: "i-check" })
        loadAois()
        setSelectedAoi(d)
    }

    function proposeCoverage() {
        if (!scopeCountry.trim()) { toast("Enter a country code first", {}); return }
        fetch(`${API_BASE}/api/imagery/propose-coverage`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ country_code: scopeCountry.trim() }),
        }).then((r) => r.json()).then((res) => {
            toast(`${res.created} proposed AOI(s) added — ${res.note}`, {})
            loadAois()
        })
    }

    function acceptAoi(aoi) {
        fetch(`${API_BASE}/api/imagery/aois/${aoi.system_id}/accept`, { method: "POST" }).then(() => { toast("AOI accepted — real scan loop started", { icon: "i-check" }); loadAois() })
    }

    function locate(aoi) {
        const lat = (aoi.bbox.min_lat + aoi.bbox.max_lat) / 2, lon = (aoi.bbox.min_lon + aoi.bbox.max_lon) / 2
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude: 200000 } })), 50)
    }

    function confirmDet(id) {
        fetch(`${API_BASE}/api/imagery/detections/${id}/confirm`, { method: "POST" }).then(() => {
            fetch(`${API_BASE}/api/imagery/scenes/${selectedScanId}`).then((r) => r.json()).then(setScene)
        })
    }
    function rejectDet(id) {
        fetch(`${API_BASE}/api/imagery/detections/${id}/reject`, { method: "POST" }).then(() => {
            fetch(`${API_BASE}/api/imagery/scenes/${selectedScanId}`).then((r) => r.json()).then(setScene)
        })
    }

    function addToBriefingScene() {
        if (!scene) return
        addToBriefing(scene.scan.scan_id, `Sentinel scan — ${scene.zone.name}`)
        toast("Added to briefing basket", { icon: "i-check" })
    }
    function raiseSignal() {
        if (!scene || !selectedDet) { toast("Select a detection first", {}); return }
        confirmDet(selectedDet.id)
        toast(`Raised: ${selectedDet.label} confirmed as a real finding`, { icon: "i-check" })
    }

    // Fade-under: writes opacity directly on the clip element ref, no
    // re-render, so dragging stays smooth (§B4's literal requirement).
    function onFadeSlider(e) {
        const v = Number(e.target.value)
        setFadeOpacity(v)
        if (fadeRef.current) fadeRef.current.style.opacity = fadeOn ? v / 100 : 1
    }
    function onSwipeDrag(e) {
        const rect = e.currentTarget.getBoundingClientRect()
        function onMove(ev) {
            const pct = Math.max(0, Math.min(100, ((ev.clientX - rect.x) / rect.width) * 100))
            setSwipePos(pct)
        }
        function onUp() { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp) }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
    }

    const changes = (scene?.changes || []).filter((c) => c.conf >= confFloor && kinds[c.type] !== false && !(c.type === "removed" && !kinds.removed))
    const visibleChanges = changes.filter((c) => !(c.suppressed && c.reviewed_status === "pending"))

    // One source for the map, the list and the image overlay. Deriving the
    // map from a second query would let the three disagree about what was
    // found, which is worse than not having a map.
    const mapDetections = visibleChanges
        .filter((c) => c.lat != null && c.lon != null)
        .map((c) => ({
            detection_id: c.id, centroid_lat: c.lat, centroid_lon: c.lon,
            object_type: c.label, confidence: c.conf,
            change_type: c.type === "existing" ? "persisted"
                : c.type === "removed" ? "gone" : c.type,
        }))

    return (
        <div style={{ display: "grid", gridTemplateColumns: "250px 1fr 330px", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            {/* Left — observation areas */}
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <button className="btn sm" style={{ width: "100%" }}
                    onClick={() => { setDrawActive((v) => !v); setDrawnBounds(null) }}
                    title="Drag a box on the map below to define a new observation region">
                    {drawActive ? "cancel drawing" : "+ draw observation area"}
                </button>
                {drawActive && !drawnBounds ? (
                    <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                        click one corner on the map, then the opposite corner
                    </div>
                ) : null}
                {drawnBounds ? (
                    <NewAreaForm bounds={drawnBounds}
                        onCancel={() => { setDrawnBounds(null); setDrawActive(false) }}
                        onCreate={createDrawnArea} />
                ) : null}

                <div className="field"><label>Scope (country code)</label>
                    <div style={{ display: "flex", gap: 6 }}>
                        <input className="input" style={{ flex: 1 }} value={scopeCountry} onChange={(e) => setScopeCountry(e.target.value)} placeholder="e.g. US" />
                        <button className="btn sm" onClick={proposeCoverage}>propose</button>
                    </div>
                </div>
                <div>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Areas</div>
                    {aois.map((a) => (
                        <div key={a.system_id} role="button" onClick={() => setSelectedAoi(a)}
                            style={{ padding: "6px 4px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: selectedAoi?.system_id === a.system_id ? "var(--bg-2)" : "transparent", opacity: a.status === "proposed" ? 0.55 : 1 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                <svg className="icon sm"><use href={`#${AOI_CLASS_ICON[a.aoi_class] || "i-pin"}`} /></svg>
                                <span style={{ font: "400 12px var(--font)", color: "var(--txt)" }}>{a.name}</span>
                            </div>
                            <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{a.system_id} · {a.aoi_class} · {(a.bbox.max_lon - a.bbox.min_lon).toFixed(1)}°</div>
                            <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)" }}>{a.status === "proposed" ? "proposed" : `every ${a.scan_interval_hours}h`}</div>
                        </div>
                    ))}
                </div>
                {selectedAoi && (
                    <div>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Scenes</div>
                        {scenes.length === 0 ? <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)" }}>No real scenes ingested yet.</div> : scenes.map((s) => (
                            <div key={s.scan_id} role="button" onClick={() => setSelectedScanId(s.scan_id)}
                                style={{ padding: "3px 0", font: "400 11px var(--font)", color: selectedScanId === s.scan_id ? "var(--txt)" : "var(--txt-3)", cursor: "pointer" }}>
                                {fmtDate(s.image_timestamp_utc)} · {s.status}{s.status === "completed" ? ` · ${s.result_summary?.total_detections ?? 0} det` : ""}
                            </div>
                        ))}
                        <div className="field" style={{ marginTop: 10 }}><label>Confidence floor — {confFloor.toFixed(2)}</label>
                            <input type="range" min={0} max={1} step={0.05} value={confFloor} onChange={(e) => setConfFloor(Number(e.target.value))} />
                        </div>
                        <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                            {["new", "expanded", "removed"].map((k) => (
                                <label key={k} style={{ display: "flex", alignItems: "center", gap: 5, font: "400 11px var(--font)", color: "var(--txt-2)" }}>
                                    <input type="checkbox" className="check" checked={kinds[k]} onChange={(e) => setKinds((p) => ({ ...p, [k]: e.target.checked }))} />{k}
                                </label>
                            ))}
                        </div>
                        <button className="btn primary sm" style={{ marginTop: 10, width: "100%" }} disabled={running} onClick={reRunDetection}>
                            {running ? "running…" : "re-run detection"}
                        </button>
                        {running && <div style={{ height: 2, background: "var(--bg-3)", marginTop: 6 }}><div style={{ height: "100%", width: "60%", background: "var(--acc-hi)", animation: "imgpulse 1.2s ease-in-out infinite" }} /></div>}
                    </div>
                )}
            </div>

            {/* Centre — comparison. Becomes a real fixed full-viewport
                overlay (not a second component) when fullscreen is on, so
                the exact same real <SceneComparison> just renders bigger —
                no separate "big image" viewer to keep in sync. */}
            <div style={fullscreen
                ? { position: "fixed", inset: 0, zIndex: 50, background: "var(--bg-0)", display: "flex", flexDirection: "column" }
                : { display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ height: 32, flexShrink: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
                    <span style={{ font: "400 11px var(--mono)", color: "var(--txt-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {scene ? `${scene.scan.scan_id.slice(0, 8)} · ${scene.zone.name} · ${fmtDate(scene.reference_date)} → ${fmtDate(scene.scan.image_timestamp_utc)} · ${SENSOR_LABEL[scene.zone.sensor_preference] || "Sentinel-2 · optical 10m"}` : "No scene selected"}
                    </span>
                    <div style={{ flex: 1 }} />
                    <div className="seg">{["split", "swipe", "after"].map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}</div>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, font: "400 11px var(--font)", color: "var(--txt-2)" }}>
                        <input type="checkbox" className="check" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} />boxes
                    </label>
                    {view === "swipe" && (
                        <>
                            <label style={{ display: "flex", alignItems: "center", gap: 5, font: "400 11px var(--font)", color: "var(--txt-2)" }}>
                                <input type="checkbox" className="check" checked={fadeOn} onChange={(e) => { setFadeOn(e.target.checked); if (fadeRef.current) fadeRef.current.style.opacity = e.target.checked ? fadeOpacity / 100 : 1 }} />fade under
                            </label>
                            <input type="range" min={0} max={100} value={fadeOpacity} onChange={onFadeSlider} style={{ width: 70, opacity: fadeOn ? 1 : 0.4, pointerEvents: fadeOn ? "auto" : "none" }} />
                        </>
                    )}
                    {/* Real Part 3 fix — "run detection now" reachable directly from
                        the image/comparison window itself, not only the left rail.
                        Calls the exact same real reRunDetection() function as the
                        left rail's "re-run detection" button — one real detector-
                        invocation entry point, not a second implementation. */}
                    <button className="btn sm" disabled={!selectedAoi || running} onClick={reRunDetection}>
                        {running ? "running…" : "run detection now"}
                    </button>
                    {/* Native-resolution tiled scan. Distinct from the button
                        above, which runs the zone's configured single-image
                        scan: this one covers the AOI at the sensor's own
                        10 m/px in a grid, which is the difference between a
                        100m vessel being one pixel and being ten. */}
                    {/* WHICH DAY. Comparing two dates is the basis of every
                        change finding, and until this round the picker was
                        unreachable: the endpoint 500'd on every call, and
                        beneath that the search collapsed 43 distinct dates
                        into one. Cloud cover is shown per date because on an
                        optical sensor it decides whether a scene is worth
                        scanning at all. */}
                    <select className="input sm" value={scanDate}
                        disabled={!dates.length || !!tiledJob}
                        onChange={(e) => setScanDate(e.target.value)}
                        title={dates.length
                            ? "Which pass to scan — cloud cover in brackets"
                            : "No scene dates loaded for this area"}
                        style={{ height: 24, maxWidth: 190 }}>
                        <option value="">
                            {dates.length ? `latest pass (${dates.length} available)` : "no dates"}
                        </option>
                        {dates.map((d) => (
                            <option key={d.date} value={d.date}>
                                {d.date}{d.cloud_cover != null ? ` · ${Math.round(d.cloud_cover)}% cloud` : ""}
                            </option>
                        ))}
                    </select>
                    <button className="btn sm" disabled={!selectedAoi || !!tiledJob} onClick={runTiledScan}
                        title="Cover this area at the sensor's native resolution (shows the cost first)">
                        {tiledJob ? "scanning…" : scanDate ? `scan ${scanDate}` : "native-res scan"}
                    </button>
                    <button className="btn sm" onClick={raiseSignal}>raise signal</button>
                    <button className="btn sm" onClick={addToBriefingScene}>add to briefing</button>
                    <button className="btn sm" disabled={!scene || scene.scan.status !== "completed"}
                        title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen — inspect this scan at full size"}
                        aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)}>
                        {fullscreen ? "exit fullscreen" : "fullscreen"}
                    </button>
                </div>

                <ScanProgress jobId={tiledJob} onDone={onTiledDone} />

                {/* The result of a native-res scan, stated with its own
                    qualifications. Coverage below 100% is reported because
                    an unscanned corner must not read as an empty one. */}
                {tiledResult && tiledResult.status === "completed" ? (
                    <div style={{ padding: "5px 10px", borderBottom: "1px solid var(--bdr)",
                                  font: "400 10px var(--mono)", color: "var(--txt-dim)" }}>
                        native-res scan · {tiledResult.detections?.length ?? 0} detection(s) ·{" "}
                        {tiledResult.m_per_px} m/px{tiledResult.degraded ? " (coarsened)" : ""} ·{" "}
                        {Math.round((tiledResult.coverage_fraction ?? 1) * 100)}% of the area covered
                        {tiledResult.tiles_failed?.length
                            ? ` · ${tiledResult.tiles_failed.length} tile(s) failed`
                            : ""}
                    </div>
                ) : null}

                <SceneScrubber scenes={scenes} selectedScanId={selectedScanId} onSelect={setSelectedScanId} currentInstrument={scene?.scan?.instrument} />

                <div style={{ flex: 1, overflow: "auto", padding: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {!scene ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Select an area with a real completed scene.</div>
                    ) : scene.scan.status !== "completed" ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Not yet detected for this scene — run "re-run detection" to call the real detector.</div>
                    ) : (
                        <SceneComparison scene={scene} view={view} showBoxes={showBoxes} changes={visibleChanges}
                            swipePos={swipePos} onSwipeDrag={onSwipeDrag} fadeOn={fadeOn} fadeOpacity={fadeOpacity}
                            clipRef={clipRef} fadeRef={fadeRef} onSelectDet={setSelectedDet} selectedDet={selectedDet}
                            fullscreen={fullscreen} viewerRef={viewerRef} />
                    )}
                </div>
            </div>

            {/* Right — AOI editor + detections */}
            <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto", padding: 12 }}>
                {selectedAoi && <AoiEditor aoi={selectedAoi} onSaved={loadAois} onAccept={() => acceptAoi(selectedAoi)} onLocate={() => locate(selectedAoi)} onDeleted={onAoiDeleted} />}
                {/* WHERE THIS SCAN WAS RUN — nothing more.
                    The same locator the Inbox shows for a signal, answering
                    "where in the world is this" without a camera move. It
                    briefly plotted every detection as a point, which
                    duplicated the detection list and competed with the image
                    for the job of showing what was found. The image does
                    that; this says where. */}
                {selectedAoi && (
                    <div style={{ marginTop: 16 }}>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>
                            Where
                        </div>
                        <Minimap
                            focus={{
                                lat: (selectedAoi.bbox.min_lat + selectedAoi.bbox.max_lat) / 2,
                                lon: (selectedAoi.bbox.min_lon + selectedAoi.bbox.max_lon) / 2,
                            }}
                            label={selectedAoi.name}
                            color="var(--acc-hi)"
                        />
                    </div>
                )}

                <div style={{ marginTop: 16 }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Detections</div>
                    {!scene || visibleChanges.length === 0 ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>{scene?.scan?.status === "completed" ? "No detections in this scene." : "Not yet detected."}</div>
                    ) : visibleChanges.map((c) => (
                        <div key={c.id} role="button" onClick={() => focusDetection(c)}
                            style={{ padding: "6px 4px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: selectedDet?.id === c.id ? "var(--bg-2)" : "transparent" }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ font: "400 12px var(--font)", color: "var(--txt)" }}>{readable(c.label)} · {c.type}</span>
                                <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{Math.round(c.conf * 100)}%</span>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                                <span style={{ font: "400 10px var(--font)", color: c.reviewed_status === "confirmed" ? "var(--delta-better)" : c.reviewed_status === "rejected" ? "var(--delta-worse)" : "var(--txt-4)" }}>{c.reviewed_status}</span>
                                <div style={{ display: "flex", gap: 4 }}>
                                    <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); confirmDet(c.id) }}>confirm</button>
                                    <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); rejectDet(c.id) }}>reject</button>
                                </div>
                            </div>
                            {selectedDet?.id === c.id && c.interpretation && (
                                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)", marginTop: 4, lineHeight: 1.4 }}>{c.interpretation}</div>
                            )}
                        </div>
                    ))}
                </div>
                {scene && (
                    <div style={{ marginTop: 16 }}>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Object counts — reference → current</div>
                        <div className="statgrid">
                            {scene.counts.length === 0 ? (
                                <div className="stat"><span className="value">—</span><span className="label">no reference scan yet</span></div>
                            ) : scene.counts.map(([label, current, delta]) => (
                                <div className="stat" key={label}>
                                    <span className="value">{current}</span>
                                    <span className={`delta ${delta > 0 ? "worse" : delta < 0 ? "better" : ""}`} style={{ fontFamily: "var(--mono)" }}>{delta > 0 ? "+" : ""}{delta}</span>
                                    <span className="label">{label}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {inspectorExtensions.map((Ext, i) => (
                    <Ext key={i} recordRef={selectedAoi ? `aoi:${selectedAoi.system_id}` : null} record={selectedAoi} />
                ))}
            </div>
            <style>{"@keyframes imgpulse{0%,100%{opacity:.5}50%{opacity:1}}"}</style>
        </div>
    )
}

function AoiEditor({ aoi, onSaved, onAccept, onLocate, onDeleted }) {
    const [name, setName] = useState(aoi.name)
    const [cls, setCls] = useState(aoi.aoi_class)
    const [cadenceH, setCadenceH] = useState(aoi.scan_interval_hours)
    const [notes, setNotes] = useState(aoi.description || "")
    const [owner, setOwner] = useState(aoi.owner || "")
    const [sensor, setSensor] = useState(aoi.sensor_preference || "sentinel2_optical")
    useEffect(() => { setName(aoi.name); setCls(aoi.aoi_class); setCadenceH(aoi.scan_interval_hours); setNotes(aoi.description || ""); setOwner(aoi.owner || ""); setSensor(aoi.sensor_preference || "sentinel2_optical") }, [aoi.system_id])

    function save() {
        fetch(`${API_BASE}/api/watch-zones/${aoi.system_id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, aoi_class: cls, scan_interval_hours: cadenceH, description: notes, owner, sensor_preference: sensor }),
        }).then(() => { toast("Area saved", { icon: "i-check" }); onSaved() })
    }
    function togglePause() {
        fetch(`${API_BASE}/api/watch-zones/${aoi.system_id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: aoi.status !== "active", status: aoi.status === "active" ? "paused" : "active" }),
        }).then(() => onSaved())
    }
    function del() {
        // Irreversible, and it takes the region's whole scan history with
        // it — including the detections that are the baseline every future
        // change comparison runs against. Worth one sentence of warning
        // that says what is actually lost, rather than "are you sure?".
        if (!window.confirm(
            `Delete "${aoi.name}" (${aoi.system_id})?\n\n` +
            `This also deletes every scan of this area and all their ` +
            `detections, permanently. Change detection has no baseline ` +
            `to compare against afterwards.`
        )) return
        fetch(`${API_BASE}/api/watch-zones/${aoi.system_id}`, {
            method: "DELETE", credentials: "include",
        })
            .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() })
            .then((d) => onDeleted(d))
            // A delete that fails silently leaves the region on screen and
            // the person assuming it worked.
            .catch((e) => toast(`Could not delete ${aoi.system_id}: ${e.message}`, { icon: "i-alert" }))
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label>Class</label>
                <select className="input" value={cls} onChange={(e) => setCls(e.target.value)}>{AOI_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}</select>
            </div>
            <div className="field"><label>Cadence (hours)</label><input className="input" type="number" value={cadenceH} onChange={(e) => setCadenceH(Number(e.target.value))} /></div>
            <div className="field">
                <label>Sensor</label>
                <select className="input" value={sensor} onChange={(e) => setSensor(e.target.value)}>
                    {SENSOR_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value} disabled={!s.real} title={s.real ? "" : "No real scan/detection pipeline is deployed for this sensor yet"}>
                            {s.label}{s.real ? "" : " (not yet implemented)"}
                        </option>
                    ))}
                </select>
                {!SENSOR_OPTIONS.find((s) => s.value === sensor)?.real && (
                    <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", marginTop: 3 }}>
                        Saved as this area's real stated preference, but no real scan/detection pipeline exists for it yet — a scan attempt will be honestly rejected until one is built.
                    </div>
                )}
            </div>
            <div className="field"><label>Owner</label><input className="input" value={owner} onChange={(e) => setOwner(e.target.value)} /></div>
            <div className="field"><label>Standing note</label><textarea className="input" style={{ minHeight: 50 }} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>Status: {aoi.status}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button className="btn primary sm" onClick={save}>save area</button>
                {aoi.status === "proposed" ? (
                    <button className="btn sm" onClick={onAccept}>accept</button>
                ) : (
                    <button className="btn sm" onClick={togglePause}>{aoi.status === "active" ? "pause" : "resume"}</button>
                )}
                <button className="btn sm" onClick={onLocate}>locate</button>
                <button className="btn danger sm" onClick={del}>delete</button>
            </div>
        </div>
    )
}
