import { useState, useEffect, useMemo, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { toast } from "../ui/toast.js"
import { boundsToPolygon } from "../destinations/sourcesLogic.js"
import { detectionPixels, detectionLabel, provenanceLine } from "./annotateScene.js"
import { detectionCorners } from "../globe/detectionShape.js"
import { SENSOR_OPTIONS } from "./imagery/sceneComparison.jsx"
import { usablePasses, isSar, bboxAreaKm2, cornerCount, fmtArea, confidenceBand, detectionDiamond } from "./imagery/taskingMath.js"
import { fileSignal } from "../state/filing.js"

const API = API_BASE

// The pane's own width, exported because Situation has to shift the map
// chrome left by exactly this much while the pane is open. It was a 312
// literal in two files that then disagreed the moment one changed.
export const IMAGERY_PANE_W = 380

// §12.1 — the cadence select, in the hours the scheduler actually stores.
const CADENCE_HOURS = { "daily": 24, "3-day": 72, "weekly": 168, "monthly": 720, "on demand": 0 }

// ImagerySidebar.jsx — PARALLAX §12: one icon, three tabs.
//
// §12 restructures this into tasking | detections | areas, and its central
// argument is about ORDER: "Geometry first, drawing second. The old flow made
// you draw and then discover which controls the shape had committed you to."
//
// The one behavioural correction worth naming: the cloud control used to be
// HIDDEN for SAR. §12 wants it visible and disabled with the reason on it —
// "SAR sees through cloud. This control does nothing for a radar pass." A
// hidden control reads as a missing feature; a disabled one that says why
// teaches the sensor.
//
// Historical note — Situation's real top-bar Imagery/detection entry
// point (Round 2 UX correction of the prior round's ImageryDetectionPanel.jsx
// floating 322px glass panel + its own mini scene-comparison viewer, deleted
// this round). Every real backend/detector/persistence piece PR #64 built
// is reused unchanged (backend/main.py's real fetch functions, sentinel_ml's
// real optical detector, sar_detector's real SAR detector, POST
// /api/watch-zones for persistence) — the only real change is *where* the
// image and detections render: directly on the main Situation globe via
// GlobeOverwatchLayer.jsx / GlobeOverwatchDrawLayer.jsx (real, already-built
// Cesium plumbing that existed in GlobeView.jsx but had no live consumer
// anywhere in the app until this round), not inside this sidebar or a
// mini-map.
//
// Real datestamp choice: composited directly onto the overlay image's own
// pixels (an offscreen <canvas> bar burned into the bottom before the PNG
// ever reaches GlobeOverwatchLayer's SingleTileImageryProvider) rather than
// a separate HTML/Cesium label tracking screen position — this way the
// datestamp survives at the exact real bottom of the georeferenced image
// itself regardless of camera pan/zoom/tilt, with no extra per-frame
// position-sync code needed.

/* v6 surface tokens. The panel used the pre-v6 class vocabulary
   (.field, .seg, .scanhint, --line, --txt-3), which is a different grey
   from everything floating over the map beside it — Layers and Inspector
   are glass on --gline. These are the same values those use. */
const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".12em", textTransform: "uppercase", color: "var(--txt4)",
}
const BTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt)", font: "inherit",
    fontSize: 11.5, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const FIELD = {
    width: "100%", height: 28, padding: "0 8px", border: "1px solid var(--gline2)",
    background: "var(--glass2)", color: "var(--txt)", font: "inherit",
    fontSize: 12.5, outline: "none", borderRadius: 0,
}
const SEG = { display: "flex", border: "1px solid var(--gline2)" }
const segBtn = (on) => ({
    flex: 1, height: 26, border: 0,
    background: on ? "var(--accdim)" : "transparent",
    color: on ? "var(--txt)" : "var(--txt3)",
    font: "inherit", fontSize: 11.5, cursor: "pointer",
})
const Row = ({ label, hint, children }) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
        <span style={EYE}>{label}</span>
        {children}
        {hint && <span style={{ fontSize: 11, color: "var(--txt4)", textWrap: "pretty" }}>{hint}</span>}
    </label>
)

function compositeDatestamp(base64Png, label) {
    return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
            const canvas = document.createElement("canvas")
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext("2d")
            ctx.drawImage(img, 0, 0)
            const barH = Math.max(22, Math.round(canvas.height * 0.045))
            ctx.fillStyle = "rgba(0,0,0,0.62)"
            ctx.fillRect(0, canvas.height - barH, canvas.width, barH)
            ctx.fillStyle = "#ffffff"
            ctx.font = `${Math.max(11, Math.round(barH * 0.55))}px "SF Mono", Menlo, monospace`
            ctx.textBaseline = "middle"
            ctx.textAlign = "center"
            ctx.fillText(label, canvas.width / 2, canvas.height - barH / 2)
            resolve(canvas.toDataURL("image/png").split(",", 2)[1])
        }
        img.onerror = () => reject(new Error("image decode failed"))
        img.src = `data:image/png;base64,${base64Png}`
    })
}

function fmtCaptureLabel(iso) {
    if (!iso) return "capture date unknown"
    return iso.includes("T") ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : iso.slice(0, 10)
}

function polygonVerticesToGeoJson(vertices) {
    const ring = vertices.map(([lat, lon]) => [lon, lat])
    ring.push(ring[0])
    return { type: "Polygon", coordinates: [ring] }
}


/**
 * The exported image: the scene, its detections, and its provenance,
 * all burned into the pixels.
 *
 * Burned in rather than overlaid because an export gets cropped, pasted
 * into documents and screenshotted, and a floating annotation survives
 * none of that. The datestamp already worked this way; this extends it
 * to the finding itself, which is what the export was losing.
 */
async function renderAnnotatedScene(base64Png, { bounds, detections = [], meta = {} }) {
    const img = await new Promise((resolve, reject) => {
        const i = new Image()
        i.onload = () => resolve(i)
        i.onerror = () => reject(new Error("image decode failed"))
        i.src = `data:image/png;base64,${base64Png}`
    })

    const canvas = document.createElement("canvas")
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext("2d")
    ctx.drawImage(img, 0, 0)

    const scale = Math.max(1, canvas.width / 1000)
    let drawn = 0

    for (const det of detections) {
        const px = detectionPixels(det, bounds, canvas.width, canvas.height, detectionCorners)
        if (!px) continue
        drawn += 1
        ctx.beginPath()
        ctx.moveTo(px.points[0].x, px.points[0].y)
        for (const p of px.points.slice(1)) ctx.lineTo(p.x, p.y)
        ctx.closePath()
        // Amber at low alpha: legible over both bright desert and dark
        // water, which a pure white or black outline is not.
        ctx.fillStyle = "rgba(255,176,32,0.14)"
        ctx.fill()
        ctx.strokeStyle = "rgba(255,176,32,0.95)"
        ctx.lineWidth = Math.max(1.5, 2 * scale)
        ctx.stroke()

        const label = detectionLabel(det)
        const fs = Math.max(11, Math.round(12 * scale))
        ctx.font = `${fs}px "SF Mono", Menlo, monospace`
        const w = ctx.measureText(label).width
        const top = Math.min(...px.points.map((p) => p.y))
        const left = Math.min(...px.points.map((p) => p.x))
        const ly = Math.max(fs + 4, top - 4)
        ctx.fillStyle = "rgba(0,0,0,0.7)"
        ctx.fillRect(left, ly - fs - 2, w + 8, fs + 6)
        ctx.fillStyle = "#FFB020"
        ctx.textBaseline = "alphabetic"
        ctx.textAlign = "left"
        ctx.fillText(label, left + 4, ly)
    }

    // The provenance bar, always — including when nothing was drawn,
    // because "no boxes" and "boxes that failed to project" must not
    // look the same in an exported file.
    const line = provenanceLine({ ...meta, detections: drawn })
    const barH = Math.max(24, Math.round(canvas.height * 0.045))
    ctx.fillStyle = "rgba(0,0,0,0.66)"
    ctx.fillRect(0, canvas.height - barH, canvas.width, barH)
    ctx.fillStyle = "#ffffff"
    ctx.font = `${Math.max(11, Math.round(barH * 0.42))}px "SF Mono", Menlo, monospace`
    ctx.textBaseline = "middle"
    ctx.textAlign = "center"
    ctx.fillText(line, canvas.width / 2, canvas.height - barH / 2)

    return { dataUrl: canvas.toDataURL("image/png"), drawn }
}

export default function ImagerySidebar({
    onClose,
    drawMode, onDrawModeChange,
    onDrawActiveChange,
    drawn,
    scene, onSceneChange,
    detections, onDetectionsChange,
}) {
    const [sensor, setSensor] = useState("sentinel2_optical")
    const [maxCloud, setMaxCloud] = useState(20)
    const [daysBack, setDaysBack] = useState(30)
    const [exactDate, setExactDate] = useState("")
    const [name, setName] = useState("")
    const [busy, setBusy] = useState({ receiving: false, detecting: false, saving: false })
    const [tab, setTab] = useState("tasking")          // §12 — tasking | detections | areas
    const [passes, setPasses] = useState(null)          // real archive scene dates for this box
    const [confFloor, setConfFloor] = useState(40)      // §12.1/§12.2 confidence floor, 40-95
    const [cadence, setCadence] = useState("daily")     // §12.1 standing task
    const [active, setActive] = useState(false)
    const [areas, setAreas] = useState([])
    const [detFilter, setDetFilter] = useState("")

    // §12.1 — archive passes for the drawn box. Real STAC search, so the
    // "usable passes" figure below estimates from something that exists
    // rather than from a plausible-looking constant.
    useEffect(() => {
        if (!drawn?.bounds) { setPasses(null); return }
        let cancelled = false
        fetch(`${API}/api/sentinel/dates`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bounds: drawn.bounds, max_cloud: maxCloud, days_back: daysBack }),
        })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setPasses(Array.isArray(d?.dates) ? d.dates.length : null) })
            .catch(() => { if (!cancelled) setPasses(null) })
        return () => { cancelled = true }
    }, [drawn, maxCloud, daysBack])

    const loadAreas = useCallback(() => {
        fetch(`${API}/api/imagery/aois`)
            .then((r) => (r.ok ? r.json() : []))
            .then((d) => setAreas(Array.isArray(d) ? d : []))
            .catch(() => setAreas([]))
    }, [])
    useEffect(() => { if (tab === "areas") loadAreas() }, [tab, loadAreas])

    const areaKm2 = useMemo(() => bboxAreaKm2(drawn?.bounds), [drawn])
    const corners = cornerCount(drawn)
    const sar = isSar(sensor)
    const usable = usablePasses(passes, maxCloud, sensor)

    // §12.3 — click a row to toggle active/paused, and say which it became.
    const toggleArea = (z) => {
        const next = z.status === "active" ? "paused" : "active"
        fetch(`${API}/api/watch-zones/${z.system_id}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: next }),
        })
            .then((r) => { if (!r.ok) throw new Error(); toast(`${z.name} — ${next}`, { icon: "i-check" }); loadAreas() })
            .catch(() => toast("Could not change the area's state", { icon: "i-alert" }))
    }

    const visibleDetections = useMemo(() => {
        const q = detFilter.trim().toLowerCase()
        return (detections || []).filter((d) => {
            const c = Number(d.confidence) > 1 ? Number(d.confidence) : Number(d.confidence) * 100
            if (isFinite(c) && c < confFloor) return false
            if (!q) return true
            return `${d.object_type || ""} ${d.detection_id || ""}`.toLowerCase().includes(q)
        })
    }, [detections, detFilter, confFloor])

    function armDraw(mode) {
        onDrawModeChange(mode)
        onSceneChange(null)
        onDetectionsChange([])
        onDrawActiveChange(true)
    }

    async function receiveImage() {
        if (!drawn) return
        setBusy((b) => ({ ...b, receiving: true }))
        try {
            const res = await fetch(`${API}/api/imagery/receive-scene`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    bounds: drawn.bounds, sensor,
                    max_cloud: maxCloud, days_back: daysBack,
                    date: sensor === "sentinel2_optical" && exactDate ? exactDate : null,
                }),
            })
            const data = await res.json()
            if (!res.ok || data.error) { toast(data.error || "Failed to receive real scene", { icon: "i-alert" }); return }
            const composited = await compositeDatestamp(data.image_b64, fmtCaptureLabel(data.capture_timestamp))
            onSceneChange({ ...data, sensor, image_b64_composited: composited })
            onDetectionsChange([])
        } catch (e) {
            toast("Failed to receive real scene", { icon: "i-alert" })
        } finally {
            setBusy((b) => ({ ...b, receiving: false }))
        }
    }

    async function detectOnScene() {
        if (!scene && !drawn) return
        setBusy((b) => ({ ...b, detecting: true }))
        try {
            // Fall back to the drawn footprint when no scene has been
            // loaded — the backend fetches the pixels in that case.
            const bounds = scene?.bounds || drawn?.bounds
            const sens = scene?.sensor || sensor
            const body = sens === "sentinel1_sar"
                ? { bounds, sensor: sens, capture_timestamp: scene?.capture_timestamp }
                : { bounds, sensor: sens, image_b64: scene?.image_b64 || undefined,
                    max_cloud: maxCloud, days_back: daysBack }
            const res = await fetch(`${API}/api/imagery/detect-scene`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const data = await res.json()
            if (!res.ok || data.error) { toast(data.error || "Real detection failed", { icon: "i-alert" }); return }
            const dets = data.detections || []
            onDetectionsChange(dets)
            // Say when a count came from generated pixels. A number that
            // looks like an observation and is not is the one thing this
            // must never do silently.
            toast(`${dets.length} detection${dets.length === 1 ? "" : "s"}`, {})
        } catch (e) {
            toast("Real detection failed", { icon: "i-alert" })
        } finally {
            setBusy((b) => ({ ...b, detecting: false }))
        }
    }

    async function saveArea() {
        if (!drawn) return
        const polygon = drawn.polygonVertices ? polygonVerticesToGeoJson(drawn.polygonVertices) : boundsToPolygon(drawn.bounds)
        if (!name.trim() || !polygon) { toast("Name and a drawn area are both required", {}); return }
        setBusy((b) => ({ ...b, saving: true }))
        try {
            // Real create pattern, unchanged from PR #64: no Authorization
            // header (this endpoint needs none, and sending one anyway
            // blocks the real CORS preflight), ml_tasks:["ship_detection"]
            // (the one real, currently-implemented task — an empty list
            // makes a freshly-drawn area unscannable).
            const res = await fetch(`${API}/api/watch-zones`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                // §12.1's standing-task controls are real inputs, not
                // decoration: the cadence and the Active checkbox are what
                // the scheduler reads, so they travel with the create.
                body: JSON.stringify({
                    name: name.trim(), polygon_geojson: polygon,
                    scan_interval_hours: CADENCE_HOURS[cadence] ?? 24,
                    status: active ? "active" : "paused",
                    alert_threshold: "both", ml_tasks: ["ship_detection"],
                }),
            })
            const zone = await res.json()
            if (!res.ok) { toast(zone.detail || "Failed to save real area", { icon: "i-alert" }); return }
            if (sensor !== "sentinel2_optical") {
                await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sensor_preference: sensor }),
                })
            }
            toast("Area saved — it will appear in the Imagery module's real AOI list", { icon: "i-check" })
            setName("")
        } catch (e) {
            toast("Failed to save real area", { icon: "i-alert" })
        } finally {
            setBusy((b) => ({ ...b, saving: false }))
        }
    }

    /**
     * File the frame — and what the detector found in it — into the case.
     *
     * THE PANEL COULD NOT SAVE ANYTHING. You could draw a box, pull a
     * scene and run a detector on it, and then the only way to keep the
     * result was a screenshot. Tasking that cannot be filed is a toy: the
     * whole point of running a detector on a quay is to put the finding in
     * front of someone later.
     *
     * It files the composited frame, so the image carries its own capture
     * datestamp into the case rather than becoming an undated picture.
     */
    async function fileToCase() {
        if (!scene) { toast("Load a scene first", { icon: "i-alert" }); return }
        setBusy((bz) => ({ ...bz, saving: true }))
        try {
            const n = (detections || []).length
            const out = await fileSignal({
                id: `scene-${scene.capture_timestamp || Date.now()}`,
                kind: "signal", source: "sentinel",
                headline: `${name.trim() || "Drawn area"} — ${n} detection${n === 1 ? "" : "s"}, `
                    + fmtCaptureLabel(scene.capture_timestamp),
                severity: n > 0 ? "significant" : "routine",
                lat: b ? (b.south + b.north) / 2 : null,
                lon: b ? (b.west + b.east) / 2 : null,
                when: scene.capture_timestamp || null,
                imageUrl: `data:image/png;base64,${scene.image_b64_composited || scene.image_b64}`,
                context: `${sensor.replace(/_/g, " ")} · ${fmtArea(areaKm2)}`,
            })
            toast(out.path ? `Filed to ${out.path.join(" / ")}` : "Saved for briefing", { icon: "i-check" })
        } catch {
            toast("Could not file it", { icon: "i-alert" })
        } finally {
            setBusy((bz) => ({ ...bz, saving: false }))
        }
    }

    const b = drawn?.bounds

    return (
        /* v6 A4 — IT FLOATS, and it ends where the strip starts.
           This pane was the one right-edge overlay still welded to all
           three edges (top:0 bottom:0 right:0), so it ran the full height
           of the map and the timeline sat on its last 100-174px — the
           detections list and the scan button were underneath the strip
           and unreachable. Layers and Inspector, in the same slot, had
           already been floated. Now all three read the same
           --pane-bottom, so the strip changing face moves all of them.

           It is also wider than the 312px Inspector slot it inherited.
           Inspector shows one record; this shows a two-scene comparison
           with a scrubber and a detection table, and at 312px the
           comparison was the thing being cut. */
        <div className="pane-glass" data-testid="glass-imagery-sidebar" style={{
            position: "absolute", right: 12, top: 10,
            bottom: "var(--pane-bottom)", zIndex: 26,
            width: IMAGERY_PANE_W, maxWidth: "calc(100vw - 72px)",
            border: "1px solid var(--gline)",
            display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden",
        }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 8, minHeight: 36, flexShrink: 0,
                padding: "0 8px 0 12px", borderBottom: "1px solid var(--gline)",
            }}>
                <svg width="13" height="13" style={{ color: "var(--txt3)" }} aria-hidden><use href="#g-sat" /></svg>
                <b style={{ fontWeight: 600, fontSize: 12.5 }}>Task imagery</b>
                <span style={{
                    marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                    fontSize: 10, color: "var(--txt4)",
                }}>{drawn ? fmtArea(areaKm2) : "nothing drawn"}</span>
                <button onClick={onClose} title="Close" aria-label="Close" style={{
                    width: 24, height: 24, border: 0, background: "transparent",
                    color: "var(--txt3)", font: "inherit", cursor: "pointer",
                }}>✕</button>
            </div>

            <nav style={{ display: "flex", flexShrink: 0, borderBottom: "1px solid var(--gline)" }}>
                {[["Task", "tasking"], ["Found", "detections"], ["Standing", "areas"]].map(([k, t]) => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        flex: 1, height: 30, border: 0,
                        borderBottom: `2px solid ${tab === t ? "var(--acchi)" : "transparent"}`,
                        background: "transparent",
                        color: tab === t ? "var(--txt)" : "var(--txt3)",
                        font: "inherit", fontSize: 12, cursor: "pointer",
                    }}>{k}{t === "detections" && detections?.length ? ` ${detections.length}` : ""}</button>
                ))}
            </nav>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {tab === "tasking" && (<>
                {/* §12.1 — GEOMETRY FIRST. The old flow made you draw and then
                    discover which controls the shape had committed you to. */}
                <Row label="Geometry">
                    <div style={SEG}>
                        <button style={segBtn(drawMode === "rectangle")} onClick={() => armDraw("rectangle")}>square</button>
                        <button style={segBtn(drawMode === "polygon")} onClick={() => armDraw("polygon")}>polygon</button>
                    </div>
                </Row>

                {!drawn ? (
                    <div style={{ fontSize: 12, color: "var(--txt3)", lineHeight: 1.5, textWrap: "pretty" }}>
                        Pick a shape, then drag or click it out on the map.
                        {" "}{drawMode === "rectangle" ? "Two opposite corners." : "Click vertices, double-click to close."}
                        {" "}Right-click cancels.
                    </div>
                ) : (
                    <>
                        <div style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1,
                            background: "var(--gline)", border: "1px solid var(--gline)",
                        }}>
                            {[[fmtArea(areaKm2), "km² covered"], [corners, "corners"],
                              [passes == null ? "—" : passes, "archive tiles"],
                              /* USABLE passes, not total — the cloud ceiling
                                 is what decides how much of the archive you
                                 actually get. */
                              [passes == null ? "—" : usable, "usable passes"]].map(([v, k]) => (
                                <div key={k} style={{ padding: "8px 10px", background: "var(--glass2)" }}>
                                    <b style={{ fontFamily: "var(--mz-font-mono)", fontSize: 15, fontWeight: 500 }}>{v}</b>
                                    <div style={{ fontSize: 11, color: "var(--txt3)" }}>{k}</div>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                            <button style={BTN} onClick={() => armDraw(drawMode)}>redraw</button>
                            <button style={BTN} onClick={() => { onDrawModeChange(drawMode); onSceneChange(null); onDetectionsChange([]); onDrawActiveChange(false) }}>clear</button>
                        </div>
                    </>
                )}

                <Row label="Sensor">
                    <select style={FIELD} value={sensor} onChange={(e) => setSensor(e.target.value)}>
                        {SENSOR_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value} disabled={!s.real} title={s.real ? "" : "No real scan/detection pipeline is deployed for this sensor yet"}>
                                {s.label}{s.real ? "" : " (not yet implemented)"}
                            </option>
                        ))}
                    </select>
                </Row>

                {/* SHOWN AND DISABLED for SAR, never hidden. A hidden control
                    reads as a missing feature; a disabled one that says why
                    teaches the sensor. */}
                <Row label={`Max cloud cover · ${maxCloud}%`}
                     hint={sar ? "SAR sees through cloud. This does nothing for a radar pass." : null}>
                    <input type="range" min={0} max={100} step={5} value={maxCloud}
                           disabled={sar} style={{ width: "100%", accentColor: "var(--acchi)" }}
                           onChange={(e) => setMaxCloud(Number(e.target.value))} />
                </Row>

                <Row label="Date range · days back">
                    <input type="number" min={1} max={365} value={daysBack} style={FIELD}
                           onChange={(e) => setDaysBack(Number(e.target.value))} />
                </Row>

                {!sar && (
                    <Row label="Exact date · optional">
                        <input type="date" value={exactDate} style={FIELD}
                               onChange={(e) => setExactDate(e.target.value)} />
                    </Row>
                )}

                <Row label={`Confidence floor · ${confFloor}%`}>
                    <input type="range" min={40} max={95} step={5} value={confFloor}
                           style={{ width: "100%", accentColor: "var(--acchi)" }}
                           onChange={(e) => setConfFloor(Number(e.target.value))} />
                </Row>

                {/* The standing task: how often this gets looked at again. */}
                <Row label="Re-scan cadence"
                     hint="Saving without activating keeps the area on file without consuming tasking budget.">
                    <select style={FIELD} value={cadence} onChange={(e) => setCadence(e.target.value)}>
                        {["daily", "3-day", "weekly", "monthly", "on demand"].map((c) => (
                            <option key={c} value={c}>{c}</option>
                        ))}
                    </select>
                </Row>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, cursor: "pointer" }}>
                    <input type="checkbox" checked={active} style={{ accentColor: "var(--acchi)" }}
                           onChange={(e) => setActive(e.target.checked)} />
                    <span>Active — the scheduler runs this area</span>
                </label>

                {drawn && (
                    <div style={{
                        fontFamily: "var(--mz-font-mono)", fontSize: 10.5, color: "var(--txt4)",
                    }}>
                        {b.south.toFixed(3)}°–{b.north.toFixed(3)}°N, {b.west.toFixed(3)}°–{b.east.toFixed(3)}°E
                    </div>
                )}

                <Row label="Area name">
                    <input value={name} style={FIELD} placeholder="e.g. Bandar Abbas approach"
                           onChange={(e) => setName(e.target.value)} />
                </Row>

                {/* WHEN THE FRAME WAS TAKEN, NOT WHEN YOU FETCHED IT.
                    A satellite frame is only meaningful with its capture
                    time beside it: "latest" over a cloudy fortnight can be
                    eleven days old, and a detection read as current when it
                    is eleven days old is the expensive kind of wrong. */}
                {scene && (
                    <div style={{
                        display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px",
                        border: "1px solid var(--acchi)", background: "var(--accdim)",
                    }}>
                        <span style={EYE}>Frame loaded · captured</span>
                        <b style={{ fontFamily: "var(--mz-font-mono)", fontSize: 14, fontWeight: 500 }}>
                            {fmtCaptureLabel(scene.capture_timestamp)}
                        </b>
                        <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                            {[
                                scene.cloud_cover != null ? `${Math.round(scene.cloud_cover)}% cloud` : null,
                                (scene.sensor || sensor).replace(/_/g, " "),
                                detections.length ? `${detections.length} on the globe` : null,
                            ].filter(Boolean).join(" · ")}
                        </span>
                    </div>
                )}
              </>)}

              {/* ── §12.2 · detections ─────────────────────────────────── */}
              {tab === "detections" && (<>
                <div className="scanmetric">
                    <div><b>{detections.length}</b><span>detections held</span></div>
                    <div><b>{scene ? 1 : 0}</b><span>scenes</span></div>
                    <div><b>{detections.filter((d) => (d.change_type || "").includes("new")).length}</b><span>new objects</span></div>
                    <div><b>{detections.filter((d) => (d.change_type || "").includes("removed")).length}</b><span>removed</span></div>
                </div>
                {/* EXPORT WITH THE FINDING IN IT. The scene could be
                    exported as bare pixels, which lost the entire point:
                    the recipient got a picture of some coastline with no
                    indication of what had been detected, where, how
                    confidently, or when it was taken. */}
                <button className="btn sm" disabled={!scene?.image_b64 || busy.exporting}
                        onClick={async () => {
                            const bounds = scene?.bounds || drawn?.bounds
                            if (!scene?.image_b64) return
                            setBusy((b) => ({ ...b, exporting: true }))
                            try {
                                const { dataUrl, drawn: n } = await renderAnnotatedScene(
                                    scene.image_b64, {
                                        bounds,
                                        detections: visibleDetections,
                                        meta: {
                                            sensor: scene?.sensor || sensor,
                                            captured: fmtCaptureLabel(scene?.capture_timestamp),
                                            cloud: scene?.cloud_cover,
                                        },
                                    })
                                const a = document.createElement("a")
                                a.href = dataUrl
                                a.download = `scene-${(scene?.capture_timestamp || "").slice(0, 10) || "export"}-annotated.png`
                                a.click()
                                // Says how many boxes actually made it in:
                                // "no detections" and "detections that
                                // could not be projected" must not look
                                // the same in a downloaded file.
                                toast(n
                                    ? `Exported with ${n} annotation${n === 1 ? "" : "s"}`
                                    : "Exported — no detections could be placed on this scene",
                                    { icon: "i-export" })
                            } catch (e) {
                                toast("Could not render the annotated image", { icon: "i-alert" })
                            } finally {
                                setBusy((b) => ({ ...b, exporting: false }))
                            }
                        }}>
                    <svg className="icon sm"><use href="#i-export" /></svg>
                    {busy.exporting ? " rendering…" : " export annotated png"}
                </button>
                <input style={FIELD} placeholder="Filter by type or id"
                       value={detFilter} onChange={(e) => setDetFilter(e.target.value)} />
                <Row label={`Confidence floor · ${confFloor}%`}>
                    <input type="range" min={40} max={95} step={5} value={confFloor}
                           style={{ width: "100%", accentColor: "var(--acchi)" }}
                           onChange={(e) => setConfFloor(Number(e.target.value))} />
                </Row>
                {!visibleDetections.length ? (
                    <div style={{ fontSize: 12, color: "var(--txt3)", lineHeight: 1.5, textWrap: "pretty" }}>
                        {detections.length
                            ? "Nothing above this confidence floor."
                            : "No detections held. Run a pass from the tasking tab."}
                    </div>
                ) : visibleDetections.map((d, i) => {
                    const c = Number(d.confidence) > 1 ? Number(d.confidence) : Number(d.confidence) * 100
                    return (
                        <div key={d.detection_id || i} className="detrow">
                            <i className="dia" style={{ background: detectionDiamond(d) }} />
                            <span className="n">{d.object_type || "object"}</span>
                            <b className={`conf ${confidenceBand(d.confidence)}`}>{isFinite(c) ? `${Math.round(c)}%` : "—"}</b>
                            <span className="meta">{d.detection_id || ""}</span>
                        </div>
                    )
                })}
              </>)}

              {/* ── §12.3 · areas ──────────────────────────────────────── */}
              {tab === "areas" && (<>
                <div className="scanmetric">
                    <div><b>{areas.filter((z) => z.status === "active").length}</b><span>active</span></div>
                    <div><b>{areas.filter((z) => z.status === "paused").length}</b><span>paused</span></div>
                    <div><b>{areas.filter((z) => (z.scan_interval_hours ?? 24) <= 24).length}</b><span>daily cadence</span></div>
                    <div><b>{areas.length}</b><span>areas on file</span></div>
                </div>
                {!areas.length ? (
                    <div className="scanhint">No standing areas on file.</div>
                ) : areas.map((z) => (
                    <button key={z.system_id} type="button" className="arearow"
                            title="Click to toggle active / paused"
                            onClick={() => toggleArea(z)}>
                        <span className="n">{z.name}</span>
                        <span className={`st ${z.status}`}>{z.status}</span>
                        <span className="meta">{(z.scan_interval_hours ?? 24)}h</span>
                    </button>
                ))}
              </>)}
            </div>

            {/* §12.1 footer — tasking only. Both refuse without geometry AND
                SAY SO, rather than sitting inert. */}
            {/* The order is the order you do them in: get the frame, look at
                it, run the detector, keep the result, and only then decide
                whether this is worth watching on a schedule. */}
            {tab === "tasking" && (
                <div style={{
                    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, flexShrink: 0,
                    padding: 10, borderTop: "1px solid var(--gline)",
                }}>
                    <button disabled={busy.receiving} style={{
                        ...BTN, height: 30, gridColumn: "1 / 3", border: 0,
                        background: "var(--acc)", color: "var(--mz-cream)", fontWeight: 600,
                    }} onClick={() => (drawn ? receiveImage()
                        : toast("Draw an area first — a pass needs a footprint", { icon: "i-alert" }))}>
                        {busy.receiving ? "Pulling the latest frame…" : "Pull latest frame"}
                    </button>
                    {/* DETECT WITHOUT LOADING FIRST. This only existed once a
                        scene had been fetched, so the panel could load an
                        image and nothing else — running the detector is the
                        point, and having already fetched the pixels is an
                        implementation detail. The endpoint fetches them
                        itself when they are missing. */}
                    <button disabled={busy.detecting} style={{ ...BTN, height: 28 }}
                        onClick={() => (drawn || scene ? detectOnScene()
                            : toast("Draw an area first — detection needs a footprint", { icon: "i-alert" }))}>
                        {busy.detecting ? "Detecting…" : "Run detection"}
                    </button>
                    <button disabled={!scene || busy.saving} style={{
                        ...BTN, height: 28,
                        color: scene ? "var(--txt)" : "var(--txt4)",
                    }} onClick={fileToCase}>
                        {busy.saving ? "Filing…" : "File to case"}
                    </button>
                    <button disabled={busy.saving} style={{ ...BTN, height: 28, gridColumn: "1 / 3" }}
                        onClick={() => (drawn ? saveArea()
                            : toast("Draw an area first — there is nothing to watch", { icon: "i-alert" }))}>
                        {busy.saving ? "Saving…" : `Watch this area · ${cadence}`}
                    </button>
                </div>
            )}
        </div>
    )
}
