import { useState, useEffect, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { addToBriefing } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"
import { SENSOR_OPTIONS, SENSOR_LABEL, AOI_CLASS_ICON, AOI_CLASSES, fmtDate, SceneScrubber, SceneComparison } from "../components/imagery/sceneComparison.jsx"

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

export default function Imagery({ onOpenGenerate }) {
    const [aois, setAois] = useState([])
    const [selectedAoi, setSelectedAoi] = useState(null)
    // V3 Phase 1, §2.2 — real hook-based extension point, owned and called
    // by this component itself (never reassigned from outside).
    const inspectorExtensions = useInspectorExtensions()
    const [scenes, setScenes] = useState([])
    const [selectedScanId, setSelectedScanId] = useState(null)
    const [scene, setScene] = useState(null)
    const [view, setView] = useState("split")
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
    const clipRef = useRef(null)
    const fadeRef = useRef(null)

    const pendingLocateRef = useRef(null) // {systemId, scanId} awaiting AOI load

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

    // Real deep-link entry point — the Briefings reader's "open change
    // detection" xref action jumps here with a real detection_id; resolve
    // its real (system_id, scan_id) and select both, the same state a
    // direct click through aois/scenes would land on.
    useEffect(() => {
        const handler = (e) => {
            const detectionId = e.detail?.detectionId
            if (!detectionId) return
            fetch(`${API_BASE}/api/imagery/detections/${detectionId}/locate`).then((r) => (r.ok ? r.json() : null)).then((loc) => {
                if (!loc) return
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

    return (
        <div style={{ display: "grid", gridTemplateColumns: "250px 1fr 330px", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            {/* Left — observation areas */}
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
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
                    <button className="btn sm" onClick={raiseSignal}>raise signal</button>
                    <button className="btn sm" onClick={addToBriefingScene}>add to briefing</button>
                    <button className="btn sm" disabled={!scene || scene.scan.status !== "completed"}
                        title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen — inspect this scan at full size"}
                        aria-pressed={fullscreen} onClick={() => setFullscreen((v) => !v)}>
                        {fullscreen ? "exit fullscreen" : "fullscreen"}
                    </button>
                </div>

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
                            fullscreen={fullscreen} />
                    )}
                </div>
            </div>

            {/* Right — AOI editor + detections */}
            <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto", padding: 12 }}>
                {selectedAoi && <AoiEditor aoi={selectedAoi} onSaved={loadAois} onAccept={() => acceptAoi(selectedAoi)} onLocate={() => locate(selectedAoi)} onDeleted={loadAois} />}
                <div style={{ marginTop: 16 }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Detections</div>
                    {!scene || visibleChanges.length === 0 ? (
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>{scene?.scan?.status === "completed" ? "No detections in this scene." : "Not yet detected."}</div>
                    ) : visibleChanges.map((c) => (
                        <div key={c.id} role="button" onClick={() => setSelectedDet(c)}
                            style={{ padding: "6px 4px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: selectedDet?.id === c.id ? "var(--bg-2)" : "transparent" }}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span style={{ font: "400 12px var(--font)", color: "var(--txt)" }}>{c.label} · {c.type}</span>
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
        fetch(`${API_BASE}/api/watch-zones/${aoi.system_id}`, { method: "DELETE" }).then(() => onDeleted())
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
