import { useState, useEffect, useMemo, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { toast } from "../ui/toast.js"
import { boundsToPolygon } from "../destinations/sourcesLogic.js"
import { SENSOR_OPTIONS } from "./imagery/sceneComparison.jsx"
import { usablePasses, isSar, bboxAreaKm2, cornerCount, fmtArea, confidenceBand, detectionDiamond } from "./imagery/taskingMath.js"

const API = API_BASE

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

export default function ImagerySidebar({
    onClose,
    drawMode, onDrawModeChange,
    onDrawActiveChange,
    drawn,
    scene, onSceneChange,
    detections, onDetectionsChange,
}) {
    const [sensor, setSensor] = useState("sentinel2_optical")
    const [superres, setSuperres] = useState(false)
    const [superresReady, setSuperresReady] = useState(false)
    const [superresNote, setSuperresNote] = useState("checking super-resolution availability…")
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

    // Whether super-resolution can actually run. A toggle that silently
    // does nothing is worse than one that explains why it is unavailable.
    useEffect(() => {
        let cancelled = false
        fetch(`${API}/api/imagery/superres/status`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (cancelled || !d) return
                setSuperresReady(Boolean(d.available))
                setSuperresNote(d.available
                    ? "Satlas ESRGAN, 4× (10 m/px → ~2.5 m/px). Generated detail: "
                      + "sharpens what a sensor found, never a finding on its own."
                    : (d.reason || "super-resolution unavailable"))
            })
            .catch(() => { if (!cancelled) setSuperresNote("could not reach the backend") })
        return () => { cancelled = true }
    }, [])

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
                    superres, max_cloud: maxCloud, days_back: daysBack }
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
            toast(`${dets.length} detection${dets.length === 1 ? "" : "s"}`
                  + (data.superres ? " — on SUPER-RESOLVED imagery (candidates, not observations)" : ""),
                  {})
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

    const b = drawn?.bounds

    return (
        <div className="pane-glass" data-testid="glass-imagery-sidebar" style={{
            position: "absolute", top: 0, bottom: 0, right: 0, zIndex: 6,
            width: "var(--pane-r)", borderLeft: "1px solid var(--line)",
            display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 6, font: "600 11px var(--font)", color: "var(--txt)" }}>
                    <svg className="icon sm" style={{ width: 13, height: 13 }}><use href="#i-sat" /></svg>
                    Imagery detection
                </span>
                <button onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                    <svg className="icon sm"><use href="#i-collapse-r" /></svg>
                </button>
            </div>

            {/* §12 — one control, three tabs. */}
            <div className="seg scantabs">
                {["tasking", "detections", "areas"].map((t) => (
                    <button key={t} type="button" aria-pressed={tab === t} onClick={() => setTab(t)}>{t}</button>
                ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
              {tab === "tasking" && (<>
                {/* §12.1 — GEOMETRY FIRST. The old flow made you draw and then
                    discover which controls the shape had committed you to. */}
                <div className="field">
                    <label>Geometry</label>
                    <div className="seg">
                        <button aria-pressed={drawMode === "rectangle"} onClick={() => armDraw("rectangle")}>square</button>
                        <button aria-pressed={drawMode === "polygon"} onClick={() => armDraw("polygon")}>polygon</button>
                    </div>
                </div>

                {!drawn ? (
                    <div className="scanhint">
                        Pick a shape, then drag or click it out on the map.
                        {" "}{drawMode === "rectangle" ? "Two opposite corners." : "Click vertices, double-click to close."}
                        {" "}Right-click cancels.
                    </div>
                ) : (
                    <>
                        <div className="scanmetric">
                            <div><b>{fmtArea(areaKm2)}</b><span>km² covered</span></div>
                            <div><b>{corners}</b><span>corners</span></div>
                            <div><b>{passes == null ? "—" : passes}</b><span>archive tiles</span></div>
                            {/* §12.1 — USABLE passes, not total. The cloud
                                ceiling is what actually decides how much of
                                the archive you get. */}
                            <div><b>{passes == null ? "—" : usable}</b><span>usable passes</span></div>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button className="btn sm" onClick={() => armDraw(drawMode)}>redraw area</button>
                            <button className="btn sm" onClick={() => { onDrawModeChange(drawMode); onSceneChange(null); onDetectionsChange([]); onDrawActiveChange(false) }}>clear</button>
                        </div>
                    </>
                )}

                <div className="field"><label>Sensor</label>
                    <select className="input" value={sensor} onChange={(e) => setSensor(e.target.value)}>
                        {SENSOR_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value} disabled={!s.real} title={s.real ? "" : "No real scan/detection pipeline is deployed for this sensor yet"}>
                                {s.label}{s.real ? "" : " (not yet implemented)"}
                            </option>
                        ))}
                    </select>
                </div>

                {/* §12.1 — SHOWN AND DISABLED for SAR, never hidden. A hidden
                    control reads as a missing feature; a disabled one that
                    says why teaches the sensor. */}
                <div className="field">
                    <label>Max cloud cover ({maxCloud}%)</label>
                    <input type="range" min={0} max={100} step={5} value={maxCloud}
                           disabled={sar}
                           onChange={(e) => setMaxCloud(Number(e.target.value))} />
                    {sar && (
                        <span className="fieldnote">
                            SAR sees through cloud. This control does nothing for a radar pass.
                        </span>
                    )}
                </div>

                <div className="field"><label>Date range (days back)</label>
                    <input className="input" type="number" min={1} max={365} value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))} />
                </div>

                {!sar && (
                    <div className="field"><label>Exact date (optional)</label>
                        <input className="input" type="date" value={exactDate} onChange={(e) => setExactDate(e.target.value)} />
                    </div>
                )}

                {/* §12.1 · detector */}
                <div className="field">
                    <label>Confidence floor ({confFloor}%)</label>
                    <input type="range" min={40} max={95} step={5} value={confFloor}
                           onChange={(e) => setConfFloor(Number(e.target.value))} />
                </div>

                {/* §12.1 · standing task */}
                <div className="field">
                    <label>Re-scan cadence</label>
                    <select className="input" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                        {["daily", "3-day", "weekly", "monthly", "on demand"].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>
                <label className="chk">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    <span>Active — the scheduler runs this area</span>
                </label>
                <span className="fieldnote">
                    Saving without activating keeps the area on file without consuming tasking budget.
                </span>

                {drawn && (
                    <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>
                        {b.south.toFixed(3)}°–{b.north.toFixed(3)}°N, {b.west.toFixed(3)}°–{b.east.toFixed(3)}°E
                    </div>
                )}

                <div className="field"><label>Area name</label>
                    <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bandar Abbas approach" />
                </div>

                {scene && (
                    <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                        Loaded · {fmtCaptureLabel(scene.capture_timestamp)}
                        {scene.cloud_cover != null ? ` · ${Math.round(scene.cloud_cover)}% cloud` : ""}
                        {detections.length > 0 ? ` · ${detections.length} detection(s) on the globe` : ""}
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
                <input className="input" placeholder="Filter by type or id"
                       value={detFilter} onChange={(e) => setDetFilter(e.target.value)} />
                <div className="field">
                    <label>Confidence floor ({confFloor}%)</label>
                    <input type="range" min={40} max={95} step={5} value={confFloor}
                           onChange={(e) => setConfFloor(Number(e.target.value))} />
                </div>
                {!visibleDetections.length ? (
                    <div className="scanhint">
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
            {tab === "tasking" && (
                <div className="scanfoot">
                    <button className="btn primary sm" disabled={busy.receiving}
                            onClick={() => (drawn ? receiveImage() : toast("Draw an area first — a pass needs a footprint", { icon: "i-alert" }))}>
                        {busy.receiving ? "receiving…" : "run pass"}
                    </button>
                    <button className="btn sm" disabled={busy.saving}
                            onClick={() => (drawn ? saveArea() : toast("Draw an area first — there is nothing to save", { icon: "i-alert" }))}>
                        {busy.saving ? "saving…" : "save area"}
                    </button>
                    {/* DETECT WITHOUT LOADING FIRST. This button only
                        existed once a scene had been fetched, so the panel
                        could load an image and nothing else — running a
                        detection is the point, and having already fetched
                        the pixels is an implementation detail. The endpoint
                        now fetches them itself when they are missing. */}
                    <button className="btn sm" disabled={busy.detecting}
                            onClick={() => (drawn || scene
                                ? detectOnScene()
                                : toast("Draw an area first — detection needs a footprint", { icon: "i-alert" }))}>
                        {busy.detecting ? "detecting…" : "run detection"}
                    </button>
                    {/* SATLAS super-resolution, opt-in and never automatic.
                        It is generative: it invents plausible detail from
                        the same Sentinel pixels, so it sharpens what another
                        sensor found and may not originate a finding. The
                        label says which, rather than leaving the reader to
                        assume the extra detail was observed. */}
                    <label className="lbl" title={superresNote}
                           style={{ display: "flex", alignItems: "center", gap: 4, opacity: superresReady ? 1 : 0.5 }}>
                        <input type="checkbox" className="check" checked={superres}
                               disabled={!superresReady || busy.detecting}
                               onChange={(e) => setSuperres(e.target.checked)} />
                        SATLAS 4×
                    </label>
                </div>
            )}
        </div>
    )
}
