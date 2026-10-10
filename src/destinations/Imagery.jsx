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
import { acquisitions, changeHeadline, countSeries, DET_COLORS, fmtDay, groupDetections, noun } from "./imageryModel.js"
import { hm } from "../utils/clock.js"

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

    const [sar, setSar] = useState({})                    // {loading, error, data}
    const [sarDate, setSarDate] = useState(null)
    const stageRef = useRef(null)
    const [fit, setFit] = useState({ w: 0, h: 0, cw: 0 })
    const [mode, setMode] = useState("scene")
    const [against, setAgainst] = useState("prev")        // prev | hires | date:YYYY-MM-DD | pass:<scanId>
    const [compareImg, setCompareImg] = useState(null)    // {b64, label, date, loading, error}
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
    const sarPasses = useMemo(() => allPasses.filter((p) => p.instrument === "SAR"), [allPasses])
    // The passes of the sensor being looked at. Radar passes stored by the
    // scanner are read like optical ones; with none stored, radar is
    // fetched live (liveRadar).
    const passes = useMemo(() => allPasses.filter((p) => (p.instrument === "SAR") === (sensor === "radar")), [allPasses, sensor])
    const liveRadar = sensor === "radar" && sarPasses.length === 0
    const series = useMemo(() => countSeries(passes), [passes])

    // Another screen asked for a scene (Inbox "open imagery", a briefing's
    // change-detection link): find its area and pass.
    useEffect(() => {
        const h = (e) => setTarget(e.detail || null)
        window.addEventListener("akili:imagery-open-scene", h)
        return () => window.removeEventListener("akili:imagery-open-scene", h)
    }, [])
    useEffect(() => {
        if (!target) return
        window.__plxImageryTarget = null
        const go = (systemId, sid) => { if (systemId) setZoneId(systemId); if (sid) setScanId(sid) }
        if (target.detectionId && !target.scanId) {
            fetch(`${API_BASE}/api/imagery/detections/${target.detectionId}/locate`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null)).then((d) => d && go(d.system_id, d.scan_id)).catch(() => {})
        } else go(target.systemId, target.scanId)
    }, [target])

    const loadZones = useCallback(() => {
        fetch(`${API_BASE}/api/watch-zones`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => {
                const list = Array.isArray(d) ? d : safeArray(d?.zones)
                setZones(list)
                setZoneId((cur) => cur || list[0]?.system_id || null)
            })
            .catch((e) => setErr(e.message))
    }, [])
    useEffect(() => { loadZones() }, [loadZones])

    const loadScans = useCallback((zid) => {
        if (!zid) { setScans([]); return }
        fetch(`${API_BASE}/api/watch-zones/${zid}/scans`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                const list = Array.isArray(d) ? d : safeArray(d?.scans)
                setScans(list)
                setScanId((cur) => (cur && list.some((s) => s.scan_id === cur) ? cur
                    : acquisitions(list).find((p) => p.instrument !== "SAR")?.scanId || null))
            })
            .catch(() => setScans([]))
    }, [])
    useEffect(() => { loadScans(zoneId) }, [zoneId, loadScans])

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
    useEffect(() => {
        if (!scanId) { setScene(null); return undefined }
        let live = true, timer = null, tries = 0
        setLoadingScene(true); setScene(null); setSelectedDet(null)
        const read = (first) => fetch(`${API_BASE}/api/imagery/scenes/${scanId}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live) return
                if (first || d?.note) setScene((cur) => (first ? d : { ...cur, note: d.note, note_pending: false }))
                if (d && !d.note && d.image_b64 !== null && tries++ < 15) timer = setTimeout(() => read(false), 6000)
            })
            .catch(() => {})
            .finally(() => { if (live && first) setLoadingScene(false) })
        read(true)
        return () => { live = false; clearTimeout(timer) }
    }, [scanId])

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
    }, [against, scene, zoneId])

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
    useEffect(() => {
        if (!liveRadar || !zoneId) return undefined
        let live = true
        setSar((cur) => ({ ...cur, loading: true, error: null }))
        fetch(`${API_BASE}/api/imagery/zones/${zoneId}/sar${sarDate ? `?date=${sarDate}` : ""}`, { credentials: "include" })
            .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`); return d })
            .then((d) => { if (live) setSar({ data: d }) })
            .catch((e) => { if (live) setSar({ error: e.message }) })
        return () => { live = false }
    }, [liveRadar, zoneId, sarDate])
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
                ctx.font = `${Math.max(11, Math.round(c.width / 90))}px monospace`
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
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        const spanKm = Math.max((b.max_lat - b.min_lat) * 111, (b.max_lon - b.min_lon) * 111 * Math.cos(((b.min_lat + b.max_lat) / 2) * Math.PI / 180))
        window.dispatchEvent(new CustomEvent("akili:fly-to", {
            detail: { lat: (b.min_lat + b.max_lat) / 2, lon: (b.min_lon + b.max_lon) / 2, altitude: Math.max(4000, spanKm * 1600) },
        }))
    }, [scene, zone, allChanges, headline])

    const deleteScene = useCallback(async () => {
        if (!zone || !scanId) return
        if (!window.confirm(`Delete this pass over "${zone.name}"?\n\nIts ${safeArray(scene?.changes).length} detections go with it, `
            + "and a later pass loses it as its comparison.")) return
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
                    {zones.map((z) => (
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
                            <i style={{ width: 7, height: 7, background: z.status === "active" ? "var(--green)" : "var(--txt4)" }} />
                            {z.name}
                        </button>
                    ))}
                </nav>
                <button onClick={() => setAdding((v) => !v)} style={{ ...BTN, height: 30, color: "var(--acchi)" }}>+ Watch a place</button>
                <button onClick={() => drawOnMap()} title="Draw the area yourself, as a box or a polygon" style={{ ...BTN, height: 30, color: "var(--acchi)" }}>✎ Draw an area on the map</button>
                <div style={{ flex: 1 }} />
                <button onClick={() => setManage((v) => !v)} style={{ ...BTN, background: manage ? ON : "transparent" }}>
                    {manage ? "Back to the imagery" : "Manage areas"}
                </button>
            </header>

            {adding && <NewArea onDone={(z) => { setAdding(false); loadZones(); if (z?.system_id) { setManage(false); setZoneId(z.system_id) } }} onCancel={() => setAdding(false)} />}

            {manage ? (
                <AreasTab zones={zones} onChanged={loadZones} onOpen={(z) => { setZoneId(z); setManage(false) }} />
            ) : !zone ? (
                <div style={{ padding: 24, color: "var(--txt3)", maxWidth: 560, textWrap: "pretty" }}>
                    No area is being watched yet. “Watch an area” picks a place and has the satellites
                    photographed over it on a schedule, with every vessel, aircraft, tank and vehicle the
                    detector finds compared against the pass before.
                </div>
            ) : (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                    {/* ── THE IMAGE, and what is needed to read it ── */}
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
                                        : loadingScene ? "Reading the pass…" : headline || (passes.length ? "Pick a pass." : "This area has not been photographed yet.")}
                                </h3>
                            </div>
                            <div style={{ display: "flex", gap: 6, flex: "none" }}>
                                <button onClick={showOnMap} style={PRIMARY} disabled={!scene?.image_b64}>Show on the map</button>
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
                                    : compareImg?.error ? <span style={{ fontSize: 12, color: "var(--amber)" }}>Comparison unavailable — {compareImg.error}</span>
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
                                        scene={displayScene} view={view} showBoxes={showBoxes} changes={shown}
                                        swipePos={pos} onSwipePos={setSwipePos}
                                        fadeOn={mode === "fade"} fadeOpacity={fadeOpacity}
                                        swipeHandle={mode === "swipe"} refLabel={compareLabel} stretch stamped
                                        clipRef={clipRef} fadeRef={fadeRef} viewerRef={viewerRef}
                                        onSelectDet={setSelectedDet} selectedDet={selectedDet}
                                    />
                                </div>
                            )}
                            {liveRadar && sar.loading && <Loading size={20} inline label="Fetching the radar pass and looking for ships — up to a minute the first time" style={{ padding: 16 }} />}
                            {liveRadar && sar.error && <div style={{ padding: 16, color: "var(--txt3)" }}>{sar.error}</div>}
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

                    {/* ── READING IT ── */}
                    <aside style={{ width: 360, flex: "none", borderLeft: "1px solid var(--gline)", overflow: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
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

function AreasTab({ zones, onChanged, onOpen }) {
    const [editing, setEditing] = useState(null)
    const [draft, setDraft] = useState({})

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
        if (!window.confirm(
            `Delete "${z.name}" (${z.system_id})?\n\n`
            + `This also deletes every scan of this area and all their detections, `
            + `permanently. Change detection has no baseline to compare against afterwards.`
        )) return
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones/${z.system_id}`,
                { method: "DELETE", credentials: "include" })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            toast("Area deleted"); onChanged()
        } catch (e) { toast(`Could not delete it — ${e.message}`, { icon: "i-alert" }) }
    }

    return (
        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
            <div style={{ display: "flex", flexDirection: "column", border: "1px solid var(--gline)" }}>
                <div style={{
                    display: "grid", gridTemplateColumns: "1.6fr .9fr .7fr 1fr .7fr auto",
                    gap: 12, padding: "9px 14px", borderBottom: "1px solid var(--gline)", ...EYE,
                }}>
                    <span>Area</span><span>Class</span><span>Every</span>
                    <span>Sensors · size</span><span>Last pass</span><span />
                </div>
                {zones.map((z) => {
                    const on = editing === z.system_id
                    return (
                        <div key={z.system_id} style={{
                            display: "grid", gridTemplateColumns: "1.6fr .9fr .7fr 1fr .7fr auto",
                            gap: 12, alignItems: "center", padding: "10px 14px",
                            borderBottom: "1px solid var(--gline)", fontSize: 13,
                        }}>
                            {on ? (
                                <>
                                    <input value={draft.name || ""} style={FIELD}
                                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
                                    <select value={draft.aoi_class || "custom"} style={FIELD}
                                        onChange={(e) => setDraft((d) => ({ ...d, aoi_class: e.target.value }))}>
                                        {AOI_CLASSES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                                    <button onClick={() => onOpen(z.system_id)} style={{
                                        border: 0, background: "transparent", color: "var(--txt)",
                                        font: "inherit", fontWeight: 600, textAlign: "left",
                                        cursor: "pointer", padding: 0, minWidth: 0,
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{z.name}</button>
                                    <span style={{ color: "var(--txt2)" }}>{z.aoi_class}</span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--txt2)" }}>
                                        {z.scan_interval_hours}h
                                    </span>
                                    <span style={{ color: "var(--txt2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        optical + radar · {areaKm(z)}
                                    </span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt3)" }}>
                                        {z.last_scanned_at ? fmtDate(z.last_scanned_at) : "never"}
                                    </span>
                                    <span style={{ display: "flex", gap: 4 }}>
                                        <button onClick={() => start(z)} style={BTN}>Edit</button>
                                        <button onClick={() => drawOnMap(z)} title="Draw a new boundary for this area on the map" style={BTN}>Redraw</button>
                                        <button onClick={() => scanNow(z)} style={BTN}>Scan now</button>
                                        <button onClick={() => togglePause(z)} style={BTN}>
                                            {z.status === "active" ? "Pause" : "Resume"}
                                        </button>
                                        <button onClick={() => del(z)} style={{ ...BTN, color: "var(--red)" }}>Delete</button>
                                    </span>
                                </>
                            )}
                        </div>
                    )
                })}
                {!zones.length && (
                    <div style={{ padding: 16, fontSize: 12.5, color: "var(--txt3)", textWrap: "pretty" }}>
                        No areas are being watched. Draw one on the map with the Overwatch panel —
                        that is where tasking happens; this screen is for looking at what came back.
                    </div>
                )}
            </div>
        </div>
    )
}
