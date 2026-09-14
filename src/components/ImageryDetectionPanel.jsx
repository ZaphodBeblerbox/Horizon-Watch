import { useState, useEffect, useRef } from "react"
import API_BASE from "../apiBase.js"
import { toast } from "../ui/toast.js"
import AoiMiniMap from "../destinations/AoiMiniMap.jsx"
import { boundsToPolygon } from "../destinations/sourcesLogic.js"
import {
    SENSOR_OPTIONS, SENSOR_LABEL, AOI_CLASS_ICON, fmtDate,
    SceneScrubber, SceneComparison,
} from "./imagery/sceneComparison.jsx"

const API = API_BASE

// ImageryDetectionPanel.jsx — Situation's top-bar imagery/detection entry
// point. Real audit before building (see this round's PR): the standalone
// Imagery module (src/destinations/Imagery.jsx) and its backend pipeline
// (backend/sentinel_scanner.py, sar_detector.py) are real and working for
// sentinel2_optical + sentinel1_sar — this panel is a THIRD real UI over
// that exact same pipeline, reusing the exact same endpoints and the same
// shared comparison-view components (../components/imagery/
// sceneComparison.jsx) rather than a fourth parallel implementation.
// No real draw-to-scan-on-the-live-globe tool exists anywhere in this
// codebase yet (confirmed: zero matches for scanbox/scanpoly) — "draw a
// new AOI" here reuses AoiMiniMap.jsx, the one real, shared, already-
// working AOI rectangle-draw component (src/destinations/Sources.jsx,
// Dashboard.jsx), rather than inventing a new on-globe drawing interaction
// that would itself be a second AOI-drawing mechanism.

function boundsIntersect(view, bbox) {
    if (!view || !bbox) return true
    return !(bbox.max_lon < view.west || bbox.min_lon > view.east || bbox.max_lat < view.south || bbox.min_lat > view.north)
}

function NewAoiForm({ onCreate, onCancel }) {
    const [name, setName] = useState("")
    const [sensor, setSensor] = useState("sentinel2_optical")
    const [cadenceH, setCadenceH] = useState(24)
    const [saving, setSaving] = useState(false)

    return (
        <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, borderBottom: "1px solid var(--line)" }}>
            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>New area — real box drawn on the mini-map above</div>
            <div className="field"><label>Name</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bandar Abbas approach" /></div>
            <div className="field"><label>Sensor</label>
                <select className="input" value={sensor} onChange={(e) => setSensor(e.target.value)}>
                    {SENSOR_OPTIONS.map((s) => (
                        <option key={s.value} value={s.value} disabled={!s.real} title={s.real ? "" : "No real scan/detection pipeline is deployed for this sensor yet"}>
                            {s.label}{s.real ? "" : " (not yet implemented)"}
                        </option>
                    ))}
                </select>
            </div>
            <div className="field"><label>Cadence (hours)</label><input className="input" type="number" value={cadenceH} onChange={(e) => setCadenceH(Number(e.target.value))} /></div>
            <div style={{ display: "flex", gap: 6 }}>
                <button className="btn primary sm" disabled={saving} onClick={async () => {
                    setSaving(true)
                    await onCreate({ name, sensor, cadenceH })
                    setSaving(false)
                }}>{saving ? "creating…" : "create area — real scan starts now"}</button>
                <button className="btn sm" onClick={onCancel}>cancel</button>
            </div>
        </div>
    )
}

export default function ImageryDetectionPanel({ onClose, viewBounds, rightInset = 0 }) {
    const [aois, setAois] = useState([])
    // Real, honest loading state — this app's own disclosed backend
    // performance issue (a separate, recurring event-loop-load condition)
    // can make this real fetch take anywhere from milliseconds to tens of
    // seconds; without this, a slow-but-eventually-successful load would
    // render a false "no real areas of interest yet" for that whole
    // window, indistinguishable from a genuinely empty AOI list.
    const [aoisLoading, setAoisLoading] = useState(true)
    const [showAll, setShowAll] = useState(false)
    const [selectedAoi, setSelectedAoi] = useState(null)
    const [scenes, setScenes] = useState([])
    const [selectedScanId, setSelectedScanId] = useState(null)
    const [scene, setScene] = useState(null)
    const [view, setView] = useState("split")
    const [showBoxes, setShowBoxes] = useState(true)
    const [running, setRunning] = useState(false)
    const [selectedDet, setSelectedDet] = useState(null)
    const [swipePos, setSwipePos] = useState(50)
    const [fadeOn, setFadeOn] = useState(false)
    const [fadeOpacity, setFadeOpacity] = useState(55)
    const clipRef = useRef(null)
    const fadeRef = useRef(null)

    const [drawing, setDrawing] = useState(false)
    const [drawnBounds, setDrawnBounds] = useState(null)

    function loadAois() {
        setAoisLoading(true)
        fetch(`${API}/api/imagery/aois`)
            .then((r) => r.json())
            .then((rows) => { setAois(Array.isArray(rows) ? rows : []); setAoisLoading(false) })
            .catch(() => setAoisLoading(false))
    }
    useEffect(() => { loadAois() }, [])

    useEffect(() => {
        if (!selectedAoi) { setScenes([]); setSelectedScanId(null); return }
        fetch(`${API}/api/watch-zones/${selectedAoi.system_id}/scans`).then((r) => r.json()).then((rows) => {
            setScenes(rows)
            const firstCompleted = rows.find((s) => s.status === "completed")
            setSelectedScanId(firstCompleted ? firstCompleted.scan_id : null)
        }).catch(() => {})
    }, [selectedAoi])

    useEffect(() => {
        if (!selectedScanId) { setScene(null); return }
        fetch(`${API}/api/imagery/scenes/${selectedScanId}`).then((r) => r.json()).then(setScene).catch(() => {})
    }, [selectedScanId])

    async function runDetection() {
        if (!selectedAoi || running) return
        setRunning(true)
        try {
            await fetch(`${API}/api/watch-zones/${selectedAoi.system_id}/scan-now`, { method: "POST" })
            toast("Real detection run started", {})
            const before = new Set(scenes.map((s) => s.scan_id))
            for (let i = 0; i < 40; i++) {
                await new Promise((r) => setTimeout(r, 3000))
                const rows = await fetch(`${API}/api/watch-zones/${selectedAoi.system_id}/scans`).then((r) => r.json())
                const fresh = rows.find((s) => !before.has(s.scan_id) && (s.status === "completed" || s.status === "error"))
                if (fresh) {
                    setScenes(rows)
                    setSelectedScanId(fresh.scan_id)
                    toast(fresh.status === "completed" ? "Detection run complete" : `Run failed: ${fresh.error_message || "unknown error"}`, {})
                    break
                }
            }
        } finally {
            setRunning(false)
        }
    }

    async function createAoi({ name, sensor, cadenceH }) {
        const polygon = boundsToPolygon(drawnBounds)
        if (!name.trim() || !polygon) { toast("Name and a drawn area are both required", {}); return }
        try {
            // Real root-cause fix, found live: POST /api/watch-zones
            // (backend/main.py's api_watch_zones_create) has no real auth
            // requirement at all — sending an Authorization header anyway
            // (copying Sources.jsx's own forgeHeaders() pattern, built for
            // OTHER Forge-gated endpoints) forces a real CORS preflight
            // that the backend's wildcard allow_headers=["*"] does NOT
            // actually cover for Authorization specifically (a real,
            // spec-documented exception — the wildcard never matches that
            // one header), so the real request was silently blocked
            // client-side. Confirmed live: removing the header entirely
            // (this endpoint doesn't need it) lets the real create
            // succeed.
            const res = await fetch(`${API}/api/watch-zones`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                // Real, separate root-cause finding, also live: a zone
                // created with no real ml_tasks (the field Sources.jsx's
                // own existing "+ New Watch Area" form also never sets)
                // gets a real, immediate scan error — "none of this
                // zone's requested ml_tasks are implemented yet
                // (requested=[], ...)" — since sentinel_scanner.py only
                // ever runs the tasks a zone actually requested. Setting
                // the one real, currently-implemented task
                // (ship_detection) here is what actually makes a
                // freshly-drawn area scannable at all, for either real
                // sensor.
                body: JSON.stringify({ name: name.trim(), polygon_geojson: polygon, scan_interval_hours: Number(cadenceH) || 24, alert_threshold: "both", ml_tasks: ["ship_detection"] }),
            })
            const zone = await res.json()
            if (!res.ok) { toast(zone.detail || "Failed to create area", {}); return }
            // The create endpoint always persists the default sensor
            // (sentinel2_optical) — a real, separate PUT sets the
            // analyst's actual chosen sensor, same as AoiEditor's own
            // save() in the standalone Imagery module (its two-step
            // create-then-edit is the one real path this reuses, not a
            // second creation flow).
            if (sensor && sensor !== "sentinel2_optical") {
                await fetch(`${API}/api/watch-zones/${zone.system_id}`, {
                    method: "PUT", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ sensor_preference: sensor }),
                })
            }
            toast("Area created — real scan started", { icon: "i-check" })
            setDrawnBounds(null)
            setDrawing(false)
            loadAois()
            setTimeout(() => {
                fetch(`${API}/api/imagery/aois`).then((r) => r.json()).then((rows) => {
                    setAois(rows)
                    const match = rows.find((a) => a.system_id === zone.system_id)
                    if (match) setSelectedAoi(match)
                })
            }, 300)
        } catch (e) {
            toast("Failed to create area", {})
        }
    }

    function onSwipeDrag(e) {
        const rect = e.currentTarget.getBoundingClientRect()
        function onMove(ev) { setSwipePos(Math.max(0, Math.min(100, ((ev.clientX - rect.x) / rect.width) * 100))) }
        function onUp() { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp) }
        window.addEventListener("pointermove", onMove)
        window.addEventListener("pointerup", onUp)
    }

    // Real AOIs in the current map view, falling back to every real AOI
    // when none are in view (or no real view bounds are available yet) —
    // the exact fallback behaviour asked for, driven by GlobeView's own
    // real camera-bounds computation (onViewBoundsChange), not a second,
    // independently-computed bbox.
    const inView = viewBounds ? aois.filter((a) => a.bbox && boundsIntersect(viewBounds, a.bbox)) : aois
    const visibleAois = showAll || inView.length === 0 ? aois : inView

    const changes = scene?.changes || []

    return (
        <div className="pane-glass" data-testid="glass-imagery-panel" style={{
            position: "absolute", top: 0, bottom: 0, right: rightInset, zIndex: 6,
            width: 322, borderLeft: "1px solid var(--line)",
            display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "9px 12px", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                <span style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>Imagery &amp; detection</span>
                <button onClick={onClose} title="Close" style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", padding: 0, display: "flex" }}>
                    <svg className="icon sm"><use href="#i-collapse-r" /></svg>
                </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {!selectedAoi && !drawing && (
                    <>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                            <span style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>
                                {viewBounds && inView.length > 0 && !showAll ? "Areas in view" : "Areas"}
                            </span>
                            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                                {viewBounds && inView.length > 0 && (
                                    <span role="button" tabIndex={0} onClick={() => setShowAll((v) => !v)} style={{ font: "400 10.5px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>
                                        {showAll ? "in view only" : `all (${aois.length})`}
                                    </span>
                                )}
                                <button className="btn sm" onClick={() => setDrawing(true)}>+ new area</button>
                            </div>
                        </div>
                        {aoisLoading ? (
                            <div style={{ padding: 12, font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>Loading real areas…</div>
                        ) : visibleAois.length === 0 ? (
                            <div style={{ padding: 12, font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>No real areas of interest yet. Draw one to start real Sentinel scanning.</div>
                        ) : visibleAois.map((a) => (
                            <div key={a.system_id} role="button" onClick={() => setSelectedAoi(a)}
                                style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", opacity: a.status === "proposed" ? 0.55 : 1 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                    <svg className="icon sm"><use href={`#${AOI_CLASS_ICON[a.aoi_class] || "i-pin"}`} /></svg>
                                    <span style={{ font: "400 12px var(--font)", color: "var(--txt)", flex: 1 }}>{a.name}</span>
                                    <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)", textTransform: "uppercase" }}>{a.status}</span>
                                </div>
                                <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)", marginTop: 2 }}>{SENSOR_LABEL[a.sensor_preference] || SENSOR_LABEL.sentinel2_optical}</div>
                            </div>
                        ))}
                    </>
                )}

                {drawing && (
                    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
                        <div style={{ height: 220, flexShrink: 0, position: "relative" }}>
                            <AoiMiniMap zones={aois} drawActive={!drawnBounds} onDrawComplete={setDrawnBounds} />
                        </div>
                        {drawnBounds ? (
                            <NewAoiForm onCreate={createAoi} onCancel={() => { setDrawnBounds(null); setDrawing(false) }} />
                        ) : (
                            <div style={{ padding: 12 }}>
                                <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-3)" }}>Click two opposite corners on the mini-map to draw a real new area, or cancel.</div>
                                <button className="btn sm" style={{ marginTop: 8 }} onClick={() => setDrawing(false)}>cancel</button>
                            </div>
                        )}
                    </div>
                )}

                {selectedAoi && !drawing && (
                    <div>
                        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-soft)" }}>
                            <span role="button" tabIndex={0} onClick={() => { setSelectedAoi(null); setSelectedDet(null) }} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>← Areas</span>
                            <div style={{ font: "600 12.5px var(--font)", color: "var(--txt)", marginTop: 6 }}>{selectedAoi.name}</div>
                            <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>{selectedAoi.system_id} · {SENSOR_LABEL[selectedAoi.sensor_preference] || SENSOR_LABEL.sentinel2_optical}</div>
                            <button className="btn primary sm" style={{ marginTop: 8, width: "100%" }} disabled={running} onClick={runDetection}>
                                {running ? "running…" : "run detection now"}
                            </button>
                        </div>

                        <SceneScrubber scenes={scenes} selectedScanId={selectedScanId} onSelect={setSelectedScanId} currentInstrument={scene?.scan?.instrument} />

                        <div style={{ padding: 10 }}>
                            {!scene ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>{scenes.length === 0 ? "No real scenes ingested yet." : "Select a real scene above."}</div>
                            ) : scene.scan.status !== "completed" ? (
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Not yet detected for this scene — run detection to call the real detector.</div>
                            ) : (
                                <>
                                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                                        <div className="seg">{["split", "swipe", "after"].map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}</div>
                                        <label style={{ display: "flex", alignItems: "center", gap: 4, font: "400 10.5px var(--font)", color: "var(--txt-2)" }}>
                                            <input type="checkbox" className="check" checked={showBoxes} onChange={(e) => setShowBoxes(e.target.checked)} />boxes
                                        </label>
                                    </div>
                                    <SceneComparison scene={scene} view={view} showBoxes={showBoxes} changes={changes}
                                        swipePos={swipePos} onSwipeDrag={onSwipeDrag} fadeOn={fadeOn} fadeOpacity={fadeOpacity}
                                        clipRef={clipRef} fadeRef={fadeRef} onSelectDet={setSelectedDet} selectedDet={selectedDet} />
                                    <div style={{ marginTop: 10 }}>
                                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Detections</div>
                                        {changes.length === 0 ? (
                                            <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>No detections in this scene.</div>
                                        ) : changes.map((c) => (
                                            <div key={c.id} role="button" onClick={() => setSelectedDet(c)}
                                                style={{ padding: "4px 0", font: "400 11.5px var(--font)", color: selectedDet?.id === c.id ? "var(--txt)" : "var(--txt-2)", cursor: "pointer", display: "flex", justifyContent: "space-between" }}>
                                                <span>{c.label} · {c.type}</span>
                                                <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>{Math.round(c.conf * 100)}%</span>
                                            </div>
                                        ))}
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}
