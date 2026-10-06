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
    SENSOR_OPTIONS, AOI_CLASSES, fmtDate, SceneComparison,
} from "../components/imagery/sceneComparison.jsx"
import { acquisitions, changeHeadline, countSeries, DET_COLORS, fmtDay, groupDetections, noun } from "./imageryModel.js"

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
const KIND_WORD = { new: "new since the last pass", removed: "gone since the last pass", existing: "there before", expanded: "grew" }
const SENSOR = { OPTICAL: "Sentinel-2 optical · 10 m", SAR: "Sentinel-1 radar · 10 m" }
const MODES = [["Scene", "scene"], ["Swipe", "swipe"], ["Side by side", "split"], ["Fade", "fade"], ["Blink", "blink"]]

const whenFull = (iso) => {
    if (!iso) return "—"
    const s = String(iso)
    const hhmm = s.length > 10 ? `, ${s.slice(11, 16)}Z` : ""
    return `${fmtDay(s)} ${s.slice(0, 4)}${hhmm}`
}

export default function Imagery() {
    const [manage, setManage] = useState(false)
    const [adding, setAdding] = useState(false)
    const [zones, setZones] = useState(null)
    const [zoneId, setZoneId] = useState(null)
    const [scans, setScans] = useState([])
    const [scanId, setScanId] = useState(null)
    const [scene, setScene] = useState(null)
    const [loadingScene, setLoadingScene] = useState(false)
    const [err, setErr] = useState(null)
    const [target, setTarget] = useState(() => window.__plxImageryTarget || null)

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
    const passes = useMemo(() => acquisitions(scans), [scans])
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
                setScanId((cur) => (cur && list.some((s) => s.scan_id === cur) ? cur : acquisitions(list)[0]?.scanId || null))
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
        ? (scene?.reference_date ? `Previous pass · ${whenFull(scene.reference_date)}` : null)
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
                        <button key={z.system_id} onClick={() => { setManage(false); setZoneId(z.system_id); setScanId(null) }} style={{
                            ...BTN, height: 30, display: "flex", alignItems: "center", gap: 8,
                            background: !manage && z.system_id === zoneId ? ON : "transparent",
                            borderColor: !manage && z.system_id === zoneId ? "var(--acchi)" : "var(--gline2)",
                        }}>
                            <i style={{ width: 7, height: 7, background: z.status === "active" ? "var(--green)" : "var(--txt4)" }} />
                            {z.name}
                        </button>
                    ))}
                </nav>
                <button onClick={() => setAdding((v) => !v)} style={{ ...BTN, height: 30, color: "var(--acchi)" }}>+ Watch an area</button>
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
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(280px,1fr)", gap: 14 }}>
                    {/* THE ANSWER */}
                    <div style={{ ...CARD, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 8 }}>
                        <span style={EYE}>
                            {zone.name} · {SENSOR[pass?.instrument || scene?.scan?.instrument] || "Sentinel"}
                            {pass ? ` · pass of ${whenFull(pass.when)} · ${agoLabel(pass.when)}` : ""}
                            {pass?.fire ? " · triggered by a fire detection" : ""}
                        </span>
                        {loadingScene && <Loading size={18} inline label="Reading the pass" />}
                        {!loadingScene && !scene && (
                            <span style={{ color: "var(--txt3)" }}>
                                {passes.length ? "Pick a pass on the right." : "This area has not been photographed yet. The first pass arrives with the next scan."}
                            </span>
                        )}
                        {scene && (
                            <>
                                <h3 style={{ margin: 0, fontWeight: 600, fontSize: 22, lineHeight: 1.25, letterSpacing: "-.01em", textWrap: "pretty" }}>{headline}</h3>
                                {note?.summary ? (
                                    <p style={{ margin: 0, color: "var(--txt2)", fontSize: 13.5, lineHeight: 1.5, maxWidth: 900, textWrap: "pretty" }}>
                                        {note.summary}
                                        <span style={{ ...EYE, fontSize: 9, marginLeft: 8 }}>imagery note · {note.model}</span>
                                    </p>
                                ) : (
                                    <span style={{ fontSize: 12, color: "var(--txt4)" }}>
                                        {scene.image_b64 ? "Writing the imagery note…" : "This pass's image has been retired; its detections are kept."}
                                    </span>
                                )}
                                {note?.quality && <span style={{ fontSize: 12, color: "var(--amber)" }}>{note.quality}</span>}
                                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                                    <button onClick={showOnMap} style={PRIMARY} disabled={!scene.image_b64}>Show on the map</button>
                                    <button onClick={() => { setMode("swipe"); if (!scene.reference_image_b64) setAgainst("hires") }} style={BTN}>
                                        {scene.reference_image_b64 ? `Compare with ${fmtDay(scene.reference_date)}` : "Compare with the sharp reference"}
                                    </button>
                                    <button onClick={exportPixels} style={BTN}>Export PNG</button>
                                    <button onClick={fileScene} style={BTN}>Save for briefing</button>
                                    <button onClick={deleteScene} style={{ ...BTN, color: "var(--txt3)" }}>Delete pass</button>
                                </div>
                            </>
                        )}
                    </div>
                    <ContextCard context={context} />
                    </div>

                    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                        {/* THE SCENE */}
                        {/* The card is the scene's own size: as wide as the image at
                            76% of the window's height, never a dark frame around it. */}
                        <div style={{ ...CARD, display: "flex", flexDirection: "column", minWidth: 0, flex: "0 1 auto",
                                      width: `min(calc(100% - 354px), max(560px, calc(76vh * ${ar.toFixed(4)})))` }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "8px 10px", borderBottom: "1px solid var(--gline)" }}>
                                <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                                    {MODES.map(([k, v]) => (
                                        <button key={v} onClick={() => setMode(v)} style={{
                                            height: 26, padding: "0 10px", border: 0, background: mode === v ? ON : "transparent",
                                            color: mode === v ? "var(--txt)" : "var(--txt3)", font: "inherit", fontSize: 11.5, cursor: "pointer",
                                        }}>{k}</button>
                                    ))}
                                </div>
                                {mode !== "scene" && (
                                    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--txt3)" }}>
                                        against
                                        <select value={against} onChange={(e) => setAgainst(e.target.value)} style={{ ...FIELD, width: 230, height: 26, fontSize: 11.5 }}>
                                            <option value="prev">{scene?.reference_date ? `Previous pass · ${fmtDay(scene.reference_date)}` : "Previous pass (none with an image)"}</option>
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
                                    </label>
                                )}
                                {mode === "fade" && (
                                    <input type="range" min={0} max={100} value={fadeOpacity} onChange={(e) => setFadeOpacity(Number(e.target.value))}
                                        title="How much of this pass shows over the comparison" style={{ width: 110, accentColor: "var(--acchi)" }} />
                                )}
                                <button onClick={() => setShowBoxes((v) => !v)} style={{ ...BTN, height: 26, fontSize: 11.5, background: showBoxes ? ON : "transparent" }}>Outlines</button>
                                <button onClick={() => setChangesOnly((v) => !v)} style={{ ...BTN, height: 26, fontSize: 11.5, background: changesOnly ? ON : "transparent" }}>Changes only</button>
                                <span style={{ marginLeft: "auto", display: "flex", gap: 10, fontSize: 11, color: "var(--txt3)" }}>
                                    {["new", "removed", "existing"].map((k) => (
                                        <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                                            <i style={{ width: 10, height: 0, borderTop: `2px ${k === "removed" ? "dashed" : "solid"} ${KIND_C[k]}` }} />{KIND_WORD[k]}
                                        </span>
                                    ))}
                                </span>
                            </div>
                            {mode !== "scene" && (
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "5px 12px", fontSize: 11, color: "var(--txt3)", borderBottom: "1px solid var(--gline)" }}>
                                    <span>{mode === "split" ? "Left" : mode === "swipe" ? "Right of the handle" : mode === "blink" ? (blinkOn ? "Showing this pass" : "Showing") : "Under"}:{" "}
                                        <b style={{ fontWeight: 600, color: mode === "blink" && blinkOn ? "var(--txt4)" : "var(--txt)" }}>
                                            {compareImg?.loading ? "loading…" : compareImg?.error ? `unavailable — ${compareImg.error}` : compareLabel || "no earlier image — choose another"}
                                        </b></span>
                                    <span>{mode === "split" ? "Right" : mode === "swipe" ? "Left" : mode === "blink" ? "" : "Over"}{mode === "blink" ? "" : ": "}
                                        <b style={{ fontWeight: 600, color: "var(--txt)" }}>{mode === "blink" ? (blinkOn ? `this pass · ${whenFull(pass?.when)}` : "") : `this pass · ${whenFull(pass?.when)}`}</b></span>
                                </div>
                            )}
                            <div>
                                {compareScene && (
                                    // The frame takes the area's own shape, so the scene fills it
                                    // edge to edge — no bars either side.
                                    <div style={{ position: "relative", width: "100%", aspectRatio: `${ar.toFixed(4)}` }}>
                                        <SceneComparison
                                            scene={compareScene} view={view} showBoxes={showBoxes} changes={changes}
                                            swipePos={pos} onSwipePos={setSwipePos}
                                            fadeOn={mode === "fade"} fadeOpacity={fadeOpacity}
                                            swipeHandle={mode === "swipe"} refLabel={compareLabel}
                                            clipRef={clipRef} fadeRef={fadeRef} viewerRef={viewerRef}
                                            onSelectDet={setSelectedDet} selectedDet={selectedDet}
                                        />
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* PASSES, TRENDS, DETECTIONS */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 340, flex: "1 1 340px" }}>
                            <div style={CARD}>
                                <div style={{ padding: "10px 12px 6px", display: "flex", justifyContent: "space-between" }}>
                                    <span style={EYE}>Passes</span>
                                    <span style={{ ...EYE, letterSpacing: ".04em" }}>{passes.length} · every {zone.scan_interval_hours} h checked</span>
                                </div>
                                <div style={{ maxHeight: 220, overflow: "auto" }}>
                                    {passes.map((p) => (
                                        <button key={p.key} onClick={() => setScanId(p.scanId)} style={{
                                            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 8px", width: "100%",
                                            padding: "8px 12px", border: 0, borderTop: "1px solid var(--gline)",
                                            background: p.scanId === scanId ? ON : "transparent", color: "var(--txt)", font: "inherit",
                                            textAlign: "left", cursor: "pointer",
                                        }}>
                                            <span style={{ fontSize: 12.5, fontWeight: 600 }}>{whenFull(p.when)}</span>
                                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: (p.cloud ?? 0) > 30 ? "var(--amber)" : "var(--txt4)" }}>
                                                {p.instrument === "SAR" ? "radar" : `${Math.round(p.cloud ?? 0)}% cloud`}
                                            </span>
                                            <span style={{ gridColumn: "1 / 3", fontSize: 11, color: "var(--txt3)" }}>
                                                {Object.entries(p.byType).map(([k, v]) => `${v} ${noun(k, v)}`).join(" · ") || "nothing detected"}
                                                {p.fire ? " · fire-triggered" : ""}
                                                {!p.hasImage ? " · image retired" : ""}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {series.length > 0 && passes.length > 1 && (
                                <div style={{ ...CARD, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                                    <span style={EYE}>Counts across passes</span>
                                    {series.slice(0, 5).map((s) => <Bars key={s.label} s={s} selectedKey={pass?.key} onPick={(k) => {
                                        const p = passes.find((x) => x.key === k); if (p) setScanId(p.scanId)
                                    }} />)}
                                </div>
                            )}

                            <div style={{ ...CARD, flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                                <div style={{ padding: "10px 12px 6px", display: "flex", justifyContent: "space-between" }}>
                                    <span style={EYE}>What the detector found</span>
                                    <span style={{ ...EYE, letterSpacing: ".04em" }}>{allChanges.length}</span>
                                </div>
                                <div style={{ overflow: "auto", maxHeight: 420 }}>
                                    {groups.map((g) => {
                                        const open = openGroup === g.label || groups.length === 1
                                        return (
                                            <div key={g.label} style={{ borderTop: "1px solid var(--gline)" }}>
                                                <button onClick={() => setOpenGroup(open ? null : g.label)} style={{
                                                    display: "flex", alignItems: "baseline", gap: 8, width: "100%", padding: "8px 12px",
                                                    border: 0, background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer", textAlign: "left",
                                                }}>
                                                    <span style={{ fontWeight: 600, fontSize: 13 }}>{g.items.length} {noun(g.label, g.items.length)}</span>
                                                    <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                                                        {[g.new && `${g.new} new`, g.removed && `${g.removed} gone`].filter(Boolean).join(" · ") || "unchanged"}
                                                    </span>
                                                    <span style={{ marginLeft: "auto", color: "var(--txt4)", fontSize: 11 }}>{open ? "–" : "+"}</span>
                                                </button>
                                                {open && g.items.map((d) => (
                                                    <div key={d.id} onClick={() => setSelectedDet(d)} style={{
                                                        display: "grid", gridTemplateColumns: "10px minmax(0,1fr) auto auto", gap: "2px 8px",
                                                        alignItems: "center", padding: "7px 12px 7px 20px", cursor: "pointer",
                                                        background: selectedDet?.id === d.id ? ON : "transparent",
                                                    }}>
                                                        <i style={{ width: 10, height: 0, borderTop: `2px ${d.type === "removed" ? "dashed" : "solid"} ${KIND_C[d.type] || "var(--txt4)"}` }} />
                                                        <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                                            {d.length_m ? `${Math.round(d.length_m)} × ${Math.round(d.width_m || 0)} m` : noun(d.label, 1)}
                                                            <span style={{ color: "var(--txt3)" }}> · {KIND_WORD[d.type] || d.type}</span>
                                                        </span>
                                                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt3)" }}>{Math.round((d.conf ?? 0) * 100)}%</span>
                                                        {!String(d.id).startsWith("removed-") ? (
                                                            <button onClick={(e) => { e.stopPropagation(); deleteDetection(d) }} title="Delete this detection"
                                                                style={{ border: 0, background: "transparent", color: "var(--txt4)", font: "inherit", cursor: "pointer" }}>✕</button>
                                                        ) : <span />}
                                                        {(d.note || d.doubtful) && (
                                                            <span style={{ gridColumn: "2 / 5", fontSize: 11, color: d.doubtful ? "var(--amber)" : "var(--txt2)" }}>
                                                                {d.doubtful ? "Doubtful — the imagery note does not think this is what the detector says. " : ""}{d.note}
                                                            </span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )
                                    })}
                                    {scene && !allChanges.length && (
                                        <div style={{ padding: 12, fontSize: 12, color: "var(--txt3)" }}>Nothing detected in this pass.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </section>
    )
}

/** What this place is about now, and what to look for in its imagery. */
function ContextCard({ context }) {
    const sur = context?.surroundings || {}
    const sigs = safeArray(sur.signals)
    return (
        <div style={{ ...CARD, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <span style={EYE}>What matters here</span>
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

/** One kind's count at each pass: a bar per pass, the shown pass marked. */
function Bars({ s, selectedKey, onPick }) {
    const max = Math.max(1, ...s.points.map((p) => p.n))
    const last = s.points[s.points.length - 1]?.n ?? 0
    return (
        <div style={{ display: "grid", gridTemplateColumns: "110px minmax(0,1fr) 28px", gap: 8, alignItems: "end" }}>
            <span style={{ fontSize: 11.5, color: "var(--txt2)", alignSelf: "center" }}>{noun(s.label, 2)}</span>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 28 }}>
                {s.points.map((p) => (
                    <button key={p.key} onClick={() => onPick(p.key)} title={`${fmtDay(p.when)}: ${p.n}`} style={{
                        flex: 1, minWidth: 3, height: `${Math.max(6, (p.n / max) * 100)}%`, padding: 0, border: 0, cursor: "pointer",
                        background: p.key === selectedKey ? "var(--acchi)" : p.n ? "var(--txt4)" : "var(--gline2)",
                    }} />
                ))}
            </div>
            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, textAlign: "right", alignSelf: "center" }}>{last}</span>
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
    const [sensor, setSensor] = useState("sentinel2_optical")
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
                    scan_interval_hours: every, sensor_preference: sensor, priority: "high", alert_threshold: "medium",
                }),
            })
            const d = await r.json().catch(() => ({}))
            if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`)
            toast(`Watching ${place.name} — the first pass is being fetched`, { icon: "i-check" })
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
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={EYE}>Sensor</span>
                <select value={sensor} onChange={(e) => setSensor(e.target.value)} style={FIELD}>
                    <option value="sentinel2_optical">Optical — sees what things are, not through cloud</option>
                    <option value="sentinel1_sar">Radar — ships through cloud and at night</option>
                </select>
            </label>
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
                    <span>Sensor</span><span>Last pass</span><span />
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
                                    <select value={draft.sensor_preference || "sentinel2_optical"} style={FIELD}
                                        onChange={(e) => setDraft((d) => ({ ...d, sensor_preference: e.target.value }))}>
                                        {SENSOR_OPTIONS.map((s) => (
                                            <option key={s.key || s} value={s.key || s}>{s.label || s}</option>
                                        ))}
                                    </select>
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
                                        {z.sensor_preference?.replace(/_/g, " ")}
                                    </span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt3)" }}>
                                        {z.last_scanned_at ? fmtDate(z.last_scanned_at) : "never"}
                                    </span>
                                    <span style={{ display: "flex", gap: 4 }}>
                                        <button onClick={() => start(z)} style={BTN}>Edit</button>
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
