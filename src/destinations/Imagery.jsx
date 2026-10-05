/**
 * Imagery.jsx — PARALLAX v6. Looking at what was photographed.
 *
 * THIS SCREEN AND THE MAP PANEL ARE DIFFERENT JOBS. The panel on the map
 * is for tasking: draw a box, pull the latest frame, run the detector,
 * file it. This is for LOOKING — at a scene, at the one before it, at what
 * moved between them, and at the areas being watched on a schedule.
 *
 * WHAT WAS ALREADY GOOD AND IS KEPT. The comparison machinery is real and
 * does the hard part: ZoomPanViewer gives a shared scale and pan, so the
 * split view zooms into the same quay on both sides instead of two
 * independent pictures; the swipe clips one over the other at a single
 * geometry; the detection boxes are drawn in screen space over whichever
 * frame is showing. None of that is rewritten here — it is wrapped in the
 * v6 shell and given what it was missing.
 *
 * WHAT WAS MISSING AND IS ADDED:
 *   · the scene on the globe, georeferenced, instead of only in a frame
 *   · export as actual pixels — the bytes are already in the payload, so
 *     the PDF export was the long way round to a worse file
 *   · deleting a scene, and deleting a single detection
 *   · the whole thing in the v6 surface rather than the old grey panels
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { toast } from "../ui/toast.js"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import Minimap from "../components/Minimap.jsx"
import { fileSignal } from "../state/filing.js"
import {
    SENSOR_OPTIONS, AOI_CLASSES, fmtDate, SceneScrubber, SceneComparison,
} from "../components/imagery/sceneComparison.jsx"

const safeArray = (v) => (Array.isArray(v) ? v : [])
const ON = "var(--accdim)"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
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
const KIND_C = { new: "var(--red)", removed: "var(--acchi)", existing: "var(--txt3)", expanded: "var(--amber)" }

const VIEWS = [["Current", "after"], ["Swipe", "swipe"], ["Split", "split"]]

export default function Imagery({ onOpenGenerate = () => {} }) {
    const [tab, setTab] = useState("scenes")
    const [zones, setZones] = useState(null)
    const [zoneId, setZoneId] = useState(null)
    const [scans, setScans] = useState([])
    const [scanId, setScanId] = useState(null)
    const [scene, setScene] = useState(null)
    const [loadingScene, setLoadingScene] = useState(false)
    const [err, setErr] = useState(null)

    // comparison controls — the existing machinery's inputs
    const [view, setView] = useState("after")
    const [showBoxes, setShowBoxes] = useState(true)
    const [swipePos, setSwipePos] = useState(50)
    const [fadeOn, setFadeOn] = useState(false)
    const [fadeOpacity, setFadeOpacity] = useState(55)
    const [confFloor, setConfFloor] = useState(0)
    const [kinds, setKinds] = useState({ new: true, existing: true, removed: true, expanded: true })
    const [selectedDet, setSelectedDet] = useState(null)
    const clipRef = useRef(null)
    const fadeRef = useRef(null)
    const viewerRef = useRef(null)

    const zone = useMemo(
        () => safeArray(zones).find((z) => z.system_id === zoneId) || null, [zones, zoneId])

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
                setScanId(list[0]?.scan_id || null)
            })
            .catch(() => setScans([]))
    }, [])
    useEffect(() => { loadScans(zoneId) }, [zoneId, loadScans])

    useEffect(() => {
        if (!scanId) { setScene(null); return undefined }
        let live = true
        setLoadingScene(true); setScene(null); setSelectedDet(null)
        fetch(`${API_BASE}/api/imagery/scenes/${scanId}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live) setScene(d) })
            .catch(() => {})
            .finally(() => { if (live) setLoadingScene(false) })
        return () => { live = false }
    }, [scanId])

    /* Detections, filtered the way the controls say. */
    const changes = useMemo(() => {
        const all = safeArray(scene?.changes)
        return all.filter((c) => (kinds[c.type] ?? true) && (c.conf ?? 0) >= confFloor)
    }, [scene, kinds, confFloor])

    const byKind = useMemo(() => {
        const m = { new: 0, existing: 0, removed: 0, expanded: 0 }
        for (const c of safeArray(scene?.changes)) m[c.type] = (m[c.type] || 0) + 1
        return m
    }, [scene])

    /* ── the three things this screen could not do ──────────────────── */

    /** Export the frame you are looking at, as pixels, with its boxes. */
    const exportPixels = useCallback(async () => {
        const b64 = view === "after" || !scene?.reference_image_b64
            ? scene?.image_b64 : scene?.reference_image_b64
        if (!b64) { toast("No image to export", { icon: "i-alert" }); return }
        try {
            const img = new Image()
            await new Promise((res, rej) => {
                img.onload = res; img.onerror = () => rej(new Error("image did not decode"))
                img.src = `data:image/jpeg;base64,${b64}`
            })
            const c = document.createElement("canvas")
            c.width = img.naturalWidth; c.height = img.naturalHeight
            const ctx = c.getContext("2d")
            ctx.drawImage(img, 0, 0)
            if (showBoxes) {
                // The boxes are normalised to the frame, so they scale to
                // whatever the real pixel size is — the export is the full
                // resolution, not what happened to fit on screen.
                ctx.lineWidth = Math.max(2, Math.round(c.width / 500))
                ctx.font = `${Math.max(11, Math.round(c.width / 90))}px monospace`
                for (const d of changes) {
                    const [x, y, w, h] = d.bbox || []
                    if (![x, y, w, h].every(Number.isFinite)) continue
                    ctx.strokeStyle = d.type === "new" ? "#f46043"
                        : d.type === "removed" ? "#a0b2d2"
                        : d.type === "expanded" ? "#d8a24a" : "#b5b9c3"
                    ctx.strokeRect(x * c.width, y * c.height, w * c.width, h * c.height)
                    ctx.fillStyle = ctx.strokeStyle
                    ctx.fillText(`${d.label} ${Math.round((d.conf ?? 0) * 100)}%`,
                        x * c.width, Math.max(12, y * c.height - 4))
                }
            }
            const url = c.toDataURL("image/png")
            const a = document.createElement("a")
            a.href = url
            a.download = `${zone?.system_id || "scene"}-${(scene?.scan?.image_timestamp_utc || "").slice(0, 10)}.png`
            document.body.appendChild(a); a.click(); a.remove()
            toast("Exported as PNG")
        } catch (e) {
            toast(`Export failed — ${e.message || e}`, { icon: "i-alert" })
        }
    }, [scene, view, showBoxes, changes, zone])

    /** Put the scene on the globe, where it belongs geographically. */
    const showOnMap = useCallback(() => {
        if (!scene?.image_b64 || !zone?.bbox) { toast("This scene has no bounds", { icon: "i-alert" }); return }
        const b = zone.bbox
        window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", {
            detail: {
                image_b64: scene.image_b64,
                bounds: { north: b.max_lat, south: b.min_lat, east: b.max_lon, west: b.min_lon },
                detections: changes,
            },
        }))
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        window.dispatchEvent(new CustomEvent("akili:fly-to", {
            detail: {
                lat: (b.min_lat + b.max_lat) / 2, lon: (b.min_lon + b.max_lon) / 2,
                altitude: 60000,
            },
        }))
    }, [scene, zone, changes])

    const deleteScene = useCallback(async () => {
        if (!zone || !scanId) return
        if (!window.confirm(
            `Delete this scene of "${zone.name}"?\n\n`
            + `Its ${safeArray(scene?.changes).length} detections go with it. `
            + `If it is the reference for a later comparison, that comparison loses its baseline.`
        )) return
        try {
            const r = await fetch(`${API_BASE}/api/watch-zones/${zone.system_id}/scans/${scanId}`,
                { method: "DELETE", credentials: "include" })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            toast("Scene deleted")
            loadScans(zone.system_id)
        } catch (e) { toast(`Could not delete it — ${e.message}`, { icon: "i-alert" }) }
    }, [zone, scanId, scene, loadScans])

    const deleteDetection = useCallback(async (det) => {
        const id = det?.id
        if (!id) return
        try {
            const r = await fetch(`${API_BASE}/api/imagery/detections/${id}`,
                { method: "DELETE", credentials: "include" })
            if (!r.ok) throw new Error(`HTTP ${r.status}`)
            setScene((s) => (s ? { ...s, changes: safeArray(s.changes).filter((c) => c.id !== id) } : s))
            toast("Detection deleted")
        } catch (e) { toast(`Could not delete it — ${e.message}`, { icon: "i-alert" }) }
    }, [])

    const fileScene = useCallback(async () => {
        if (!scene || !zone) return
        const out = await fileSignal({
            id: scanId, kind: "signal", source: "sentinel",
            headline: `${zone.name} — ${safeArray(scene.changes).length} detections, ${fmtDate(scene.scan?.image_timestamp_utc)}`,
            region: zone.name, severity: byKind.new > 0 ? "significant" : "routine",
            lat: zone.bbox ? (zone.bbox.min_lat + zone.bbox.max_lat) / 2 : null,
            lon: zone.bbox ? (zone.bbox.min_lon + zone.bbox.max_lon) / 2 : null,
            imageUrl: `data:image/jpeg;base64,${scene.image_b64}`,
            when: scene.scan?.image_timestamp_utc || null,
        })
        toast(out.path ? `Filed to ${out.path.join(" / ")}` : "Saved for briefing")
    }, [scene, zone, scanId, byKind])

    /* ── render ─────────────────────────────────────────────────────── */
    if (err) return (
        <section data-screen-label="Overwatch" style={MODE_SURFACE}>
            <div style={{ padding: 20, color: "var(--txt3)" }}>Overwatch is unavailable ({err}).</div>
        </section>
    )
    if (!zones) return (
        <section data-screen-label="Overwatch" style={MODE_SURFACE}>
            <Loading size={22} inline label="Reading the watched areas" style={{ padding: 20 }} />
        </section>
    )

    const meta = zone
        ? `${zone.name} · ${scans.length} ${scans.length === 1 ? "scene" : "scenes"}`
          + (scene ? ` · ${safeArray(scene.changes).length} detections` : "")
        : `${zones.length} areas`

    return (
        <section data-screen-label="Overwatch" style={MODE_SURFACE}>
            <header style={{
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                minHeight: 48, boxSizing: "border-box", flex: "none",
                padding: "6px 10px 6px 16px", borderBottom: "1px solid var(--gline)",
            }}>
                <h2 style={{ margin: 0, fontWeight: 600, fontSize: 17, letterSpacing: "-.01em" }}>Overwatch</h2>
                <nav style={{ display: "flex", gap: 2, padding: 2, border: "1px solid var(--gline)" }}>
                    {[["Scenes", "scenes"], ["Areas", "areas"]].map(([k, v]) => (
                        <button key={v} onClick={() => setTab(v)} style={{
                            height: 26, padding: "0 14px", border: 0, borderRadius: 0,
                            background: tab === v ? ON : "transparent",
                            color: tab === v ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", cursor: "pointer",
                        }}>{k}</button>
                    ))}
                </nav>
                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{meta}</span>
                <div style={{ flex: 1 }} />
                {tab === "scenes" && scene && (
                    <>
                        <button onClick={showOnMap} style={BTN}>Show on map →</button>
                        <button onClick={exportPixels} style={BTN}>Export PNG</button>
                        <button onClick={fileScene} style={BTN}>File to case</button>
                        <button onClick={deleteScene} style={{ ...BTN, color: "var(--red)" }}>Delete scene</button>
                    </>
                )}
            </header>

            {tab === "areas" ? (
                <AreasTab zones={zones} onChanged={loadZones} onOpen={(z) => { setZoneId(z); setTab("scenes") }} />
            ) : (
                <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "230px minmax(0,1fr) 300px" }}>
                    {/* areas + scenes */}
                    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--gline)" }}>
                        <div style={{ padding: "10px 12px 6px" }}><span style={EYE}>Watched areas</span></div>
                        <div style={{ maxHeight: 180, overflow: "auto", borderBottom: "1px solid var(--gline)" }}>
                            {zones.map((z) => (
                                <button key={z.system_id} onClick={() => setZoneId(z.system_id)} style={{
                                    display: "grid", gridTemplateColumns: "8px minmax(0,1fr)",
                                    gap: "2px 8px", width: "100%", padding: "8px 12px", border: 0,
                                    borderTop: "1px solid var(--gline)",
                                    background: z.system_id === zoneId ? ON : "transparent",
                                    color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                                }}>
                                    <i style={{
                                        width: 8, height: 8,
                                        background: z.status === "active" ? "var(--green)" : "var(--txt4)",
                                    }} />
                                    <span style={{
                                        fontWeight: 600, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{z.name}</span>
                                    <span />
                                    <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                                        every {z.scan_interval_hours}h · {z.sensor_preference?.replace(/_/g, " ")}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div style={{ padding: "10px 12px 6px" }}>
                            <span style={EYE}>Scenes</span>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                            {scans.map((s) => (
                                <button key={s.scan_id} onClick={() => setScanId(s.scan_id)} style={{
                                    display: "grid", gridTemplateColumns: "minmax(0,1fr) auto",
                                    gap: "2px 8px", width: "100%", padding: "8px 12px", border: 0,
                                    borderTop: "1px solid var(--gline)",
                                    background: s.scan_id === scanId ? ON : "transparent",
                                    color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                                }}>
                                    <span style={{ fontSize: 12.5 }}>{fmtDate(s.image_timestamp_utc)}</span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                        color: (s.cloud_cover_percent ?? 0) > 30 ? "var(--amber)" : "var(--txt4)",
                                    }}>{Math.round(s.cloud_cover_percent ?? 0)}% cloud</span>
                                    <span style={{ gridColumn: "1 / 3", fontSize: 11, color: "var(--txt3)" }}>
                                        {Object.entries(s.result_summary?.by_type || {})
                                            .map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(" · ") || "no detections"}
                                    </span>
                                </button>
                            ))}
                            {!scans.length && (
                                <div style={{ padding: "12px", fontSize: 12, color: "var(--txt3)" }}>
                                    This area has not been scanned yet.
                                </div>
                            )}
                        </div>
                    </div>

                    {/* the scene */}
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
                        <div style={{
                            display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
                            minHeight: 40, flex: "none", padding: "6px 12px",
                            borderBottom: "1px solid var(--gline)",
                        }}>
                            <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                                {VIEWS.map(([k, v]) => (
                                    <button key={v} onClick={() => setView(v)} style={{
                                        height: 26, padding: "0 10px", border: 0,
                                        background: view === v ? ON : "transparent",
                                        color: view === v ? "var(--txt)" : "var(--txt3)",
                                        font: "inherit", fontSize: 11.5, cursor: "pointer",
                                    }}>{k}</button>
                                ))}
                            </div>
                            <button onClick={() => setShowBoxes((v) => !v)}
                                style={{ ...BTN, background: showBoxes ? ON : "transparent" }}>boxes</button>
                            <button onClick={() => setFadeOn((v) => !v)}
                                style={{ ...BTN, background: fadeOn ? ON : "transparent" }}>fade</button>
                            {fadeOn && (
                                <input type="range" min={0} max={100} value={fadeOpacity}
                                    onChange={(e) => setFadeOpacity(Number(e.target.value))}
                                    style={{ width: 90, accentColor: "var(--acchi)" }} />
                            )}
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--txt3)" }}>
                                conf ≥ {confFloor.toFixed(2)}
                                <input type="range" min={0} max={0.9} step={0.05} value={confFloor}
                                    onChange={(e) => setConfFloor(Number(e.target.value))}
                                    style={{ width: 80, accentColor: "var(--acchi)" }} />
                            </label>
                            {["new", "existing", "removed"].map((k) => (
                                <button key={k} onClick={() => setKinds((p) => ({ ...p, [k]: !p[k] }))} style={{
                                    ...BTN, height: 24, padding: "0 8px",
                                    borderColor: kinds[k] ? KIND_C[k] : "var(--gline2)",
                                    color: kinds[k] ? KIND_C[k] : "var(--txt4)",
                                }}>{k} {byKind[k] || 0}</button>
                            ))}
                        </div>

                        <div style={{ flex: 1, minHeight: 0, background: "var(--sea)", padding: 10 }}>
                            {loadingScene && <Loading size={20} inline label="Reading the scene" style={{ padding: 16 }} />}
                            {!loadingScene && !scene && (
                                <div style={{ padding: 16, color: "var(--txt3)", fontSize: 13, textWrap: "pretty" }}>
                                    Pick a scene on the left. Each one is a pass over this area, with the
                                    detector's findings against the pass before it.
                                </div>
                            )}
                            {!loadingScene && scene && (
                                <SceneComparison
                                    scene={scene} view={view} showBoxes={showBoxes} changes={changes}
                                    swipePos={swipePos} onSwipePos={setSwipePos}
                                    fadeOn={fadeOn} fadeOpacity={fadeOpacity}
                                    clipRef={clipRef} fadeRef={fadeRef} viewerRef={viewerRef}
                                    onSelectDet={setSelectedDet} selectedDet={selectedDet}
                                />
                            )}
                        </div>

                        {scans.length > 1 && (
                            <div style={{ flex: "none", borderTop: "1px solid var(--gline)" }}>
                                <SceneScrubber scenes={scans} selectedScanId={scanId} onSelect={setScanId} />
                            </div>
                        )}
                    </div>

                    {/* detections + where it is */}
                    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderLeft: "1px solid var(--gline)" }}>
                        <div style={{ height: 180, flex: "none", borderBottom: "1px solid var(--gline)", background: "var(--sea)" }}>
                            {zone?.bbox && (
                                <Minimap
                                    focus={{ lat: (zone.bbox.min_lat + zone.bbox.max_lat) / 2,
                                             lon: (zone.bbox.min_lon + zone.bbox.max_lon) / 2 }}
                                    framing="scene" width={298} height={180}
                                    label={zone.name} title="Where this is"
                                    subtitle={fmtDate(scene?.scan?.image_timestamp_utc)}
                                />
                            )}
                        </div>
                        <div style={{
                            display: "flex", alignItems: "center", gap: 8, minHeight: 36, flex: "none",
                            padding: "0 12px", borderBottom: "1px solid var(--gline)",
                        }}>
                            <b style={{ fontWeight: 600, fontSize: 12.5 }}>Detections</b>
                            <span style={{
                                marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                                fontSize: 10, color: "var(--txt4)",
                            }}>{changes.length} shown</span>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                            {changes.map((d) => (
                                <div key={d.id} onClick={() => setSelectedDet(d.id)} style={{
                                    display: "grid", gridTemplateColumns: "8px minmax(0,1fr) auto auto",
                                    gap: "2px 8px", alignItems: "center", padding: "9px 12px",
                                    borderBottom: "1px solid var(--gline)",
                                    background: d.id === selectedDet ? ON : "transparent", cursor: "pointer",
                                }}>
                                    <i style={{ width: 8, height: 8, background: KIND_C[d.type] || "var(--steel)" }} />
                                    <span style={{
                                        fontSize: 13, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{d.label?.replace(/_/g, " ")}</span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt3)" }}>
                                        {Math.round((d.conf ?? 0) * 100)}%
                                    </span>
                                    <button onClick={(e) => { e.stopPropagation(); deleteDetection(d) }}
                                        title="Delete this detection — not the same as rejecting it"
                                        style={{
                                            border: 0, background: "transparent", color: "var(--txt4)",
                                            font: "inherit", cursor: "pointer",
                                        }}>✕</button>
                                    <span />
                                    <span style={{ gridColumn: "2 / 5", fontSize: 11, color: "var(--txt3)" }}>
                                        {d.type}{d.note ? ` · ${d.note}` : ""}
                                    </span>
                                </div>
                            ))}
                            {scene && !changes.length && (
                                <div style={{ padding: "12px", fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>
                                    Nothing above {confFloor.toFixed(2)} in the kinds you have on.
                                    This pass found {safeArray(scene.changes).length} in total.
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </section>
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
