import { useState } from "react"
import API_BASE from "../apiBase.js"
import { toast } from "../ui/toast.js"
import { boundsToPolygon } from "../destinations/sourcesLogic.js"
import { SENSOR_OPTIONS } from "./imagery/sceneComparison.jsx"

const API = API_BASE

// ImagerySidebar.jsx — Situation's real top-bar Imagery/detection entry
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
    const [maxCloud, setMaxCloud] = useState(20)
    const [daysBack, setDaysBack] = useState(30)
    const [exactDate, setExactDate] = useState("")
    const [name, setName] = useState("")
    const [busy, setBusy] = useState({ receiving: false, detecting: false, saving: false })

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
        if (!scene) return
        setBusy((b) => ({ ...b, detecting: true }))
        try {
            const body = scene.sensor === "sentinel1_sar"
                ? { bounds: scene.bounds, sensor: scene.sensor, capture_timestamp: scene.capture_timestamp }
                : { bounds: scene.bounds, sensor: scene.sensor, image_b64: scene.image_b64 }
            const res = await fetch(`${API}/api/imagery/detect-scene`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            })
            const data = await res.json()
            if (!res.ok || data.error) { toast(data.error || "Real detection failed", { icon: "i-alert" }); return }
            const dets = data.detections || []
            onDetectionsChange(dets)
            toast(`${dets.length} real detection${dets.length === 1 ? "" : "s"}`, {})
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
                body: JSON.stringify({ name: name.trim(), polygon_geojson: polygon, scan_interval_hours: 24, alert_threshold: "both", ml_tasks: ["ship_detection"] }),
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
                <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Imagery &amp; detection</span>
                <button onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                    <svg className="icon sm"><use href="#i-collapse-r" /></svg>
                </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="field">
                    <label>Shape</label>
                    <div className="seg">
                        <button aria-pressed={drawMode === "rectangle"} onClick={() => armDraw("rectangle")}>square</button>
                        <button aria-pressed={drawMode === "polygon"} onClick={() => armDraw("polygon")}>polygon</button>
                    </div>
                </div>

                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                    {drawMode === "rectangle" ? "Click two opposite corners on the globe." : "Click vertices on the globe, double-click to close."}
                    {" "}Right-click cancels.
                </div>

                <div className="field"><label>Sensor</label>
                    <select className="input" value={sensor} onChange={(e) => setSensor(e.target.value)}>
                        {SENSOR_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value} disabled={!s.real} title={s.real ? "" : "No real scan/detection pipeline is deployed for this sensor yet"}>
                                {s.label}{s.real ? "" : " (not yet implemented)"}
                            </option>
                        ))}
                    </select>
                </div>

                {sensor === "sentinel2_optical" && (
                    <div className="field"><label>Max cloud coverage (%)</label>
                        <input className="input" type="number" min={0} max={100} value={maxCloud} onChange={(e) => setMaxCloud(Number(e.target.value))} />
                    </div>
                )}

                <div className="field"><label>Date range (days back)</label>
                    <input className="input" type="number" min={1} max={365} value={daysBack} onChange={(e) => setDaysBack(Number(e.target.value))} />
                </div>

                {sensor === "sentinel2_optical" && (
                    <div className="field"><label>Exact date (optional)</label>
                        <input className="input" type="date" value={exactDate} onChange={(e) => setExactDate(e.target.value)} />
                    </div>
                )}

                {drawn && (
                    <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>
                        Area: {b.south.toFixed(3)}°–{b.north.toFixed(3)}°N, {b.west.toFixed(3)}°–{b.east.toFixed(3)}°E
                        {drawn.polygonVertices ? ` · ${drawn.polygonVertices.length} vertices` : ""}
                    </div>
                )}

                <button className="btn primary sm" disabled={!drawn || busy.receiving} onClick={receiveImage}>
                    {busy.receiving ? "receiving…" : "receive image"}
                </button>

                {scene && (
                    <>
                        <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                            Loaded · {fmtCaptureLabel(scene.capture_timestamp)}
                            {scene.cloud_cover != null ? ` · ${Math.round(scene.cloud_cover)}% cloud` : ""}
                        </div>
                        <button className="btn sm" disabled={busy.detecting} onClick={detectOnScene}>
                            {busy.detecting ? "detecting…" : "run detection"}
                        </button>
                        {detections.length > 0 && (
                            <div style={{ font: "400 11px var(--font)", color: "var(--txt-2)" }}>{detections.length} detection(s) on the globe</div>
                        )}
                    </>
                )}

                {drawn && (
                    <div style={{ borderTop: "1px solid var(--line-soft)", paddingTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
                        <div className="field"><label>Save this scan area</label>
                            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bandar Abbas approach" />
                        </div>
                        <button className="btn sm" disabled={busy.saving} onClick={saveArea}>
                            {busy.saving ? "saving…" : "save — adds to Imagery module's AOI list"}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
