/**
 * FindingViewer.jsx — a finding of the automatic watch, on the IMAGE it was
 * found in, inside Imagery (owner, 2026-10-12: "why does it redirect us to
 * the map to see new detections? … We want the map to be an option, and the
 * image with the detections seen INSIDE the Imagery UI.").
 *
 *   radar change / sweep find   the comparison's own radar images
 *                               (backend radar_images.py): After with the
 *                               boxes, Before, a Before/After swipe, and
 *                               Change (red brighter now, blue darker now).
 *                               An older comparison whose images were not
 *                               kept offers to fetch them again, with what
 *                               that costs; meanwhile the boxes are shown on
 *                               the newest optical image of the area.
 *   object                      the optical pass it was detected on, with the
 *                               previous pass to compare.
 *
 * Boxes are placed with the image's own georeference (its bounds), the
 * selected one highlighted and zoomed to. "Show on the map" is a secondary
 * button; nothing here leaves Imagery on its own.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../../apiBase.js"
import { authHeaders } from "../../auth.js"
import Loading from "../../ui/Loading.jsx"
import { SceneComparison } from "./sceneComparison.jsx"
import {
    asBounds, datesText, dayText, fetchRadarImages, findingOutlines,
    findingSource, isRadarFinding, sameSource, startRadarImages, strengthText, TONE,
} from "../../lib/findings.js"
import { RADAR_CAVEATS, RADAR_WHAT, radarMeaning } from "../../lib/radarExplain.js"
import AssessWithAI from "../AssessWithAI.jsx"

const ON = "var(--accdim)"
const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt)", font: "inherit", fontSize: 12, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const PRIMARY = { ...BTN, border: 0, background: "var(--acc)", color: "var(--mz-cream)", fontWeight: 600 }
const RADAR_VIEWS = [["After", "after"], ["Before", "before"], ["Before / After", "swipe"], ["Change", "change"]]
const OPTICAL_VIEWS = [["This pass", "after"], ["Previous pass", "before"], ["Swipe", "swipe"]]

/** Width / height of a lon/lat box on the ground. */
function aspectOf(b) {
    if (!b) return 1
    return ((b[2] - b[0]) * Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180)) / Math.max(1e-6, b[3] - b[1])
}

/**
 * The image layers for a finding: {kind: "radar"|"optical"|"fallback", bounds,
 * after, before, change, dateAfter, dateBefore, …} or a status.
 */
function useFindingImage(zone, f, fallback, onImagesReady) {
    const asked = useRef(false)
    const key = findingSource(f)
    const [st, setSt] = useState({ status: "loading" })
    const [tryN, setTryN] = useState(0)
    useEffect(() => {
        if (!key || !zone) { setSt({ status: "none" }); return undefined }
        let live = true, timer = null
        setSt({ status: "loading" })
        if (isRadarFinding(f)) {
            const read = () => fetchRadarImages(zone.system_id, f.scan_id)
                .then((d) => {
                    if (!live) return
                    if (d.status === "ready") {
                        if (asked.current) { asked.current = false; onImagesReady?.(f.scan_id) }
                        setSt({ status: "ready", kind: "radar", bounds: asBounds(d.bounds), after: d.after_b64, before: d.before_b64,
                                change: d.change_b64, datesAfter: d.dates_after, datesBefore: d.dates_before,
                                dateAfter: (d.dates_after || [])[0], dateBefore: (d.dates_before || [])[0], width: d.width, height: d.height,
                                regenerated: d.source === "regenerated" })
                    } else {
                        setSt({ ...d, status: d.status })
                        if (d.status === "running") timer = setTimeout(read, 3000)
                    }
                })
                .catch((e) => { if (live) setSt({ status: "failed", error: e instanceof TypeError ? "the server did not answer (network or server error)" : e.message }) })
            read()
        } else {
            fetch(`${API_BASE}/api/imagery/scenes/${encodeURIComponent(f.scan_id)}`, { credentials: "include", headers: authHeaders() })
                .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(typeof d.detail === "string" ? d.detail : `the server answered ${r.status}`); return d })
                .then((d) => {
                    if (!live) return
                    if (!d.image_b64) { setSt({ status: "none", why: "This pass's image has been retired." }); return }
                    setSt({ status: "ready", kind: "optical", bounds: asBounds(zone.bbox), after: d.image_b64, before: d.reference_image_b64 || null,
                            dateAfter: d.scan?.image_timestamp_utc, dateBefore: d.reference_date || null })
                })
                .catch((e) => { if (live) setSt({ status: "failed", error: e instanceof TypeError ? "the server did not answer (network or server error)" : e.message }) })
        }
        return () => { live = false; clearTimeout(timer) }
    }, [key, zone?.system_id, tryN]) // eslint-disable-line react-hooks/exhaustive-deps

    const load = async () => {
        asked.current = true
        setSt((s) => ({ ...s, status: "running", done: 0, total: s.requests }))
        try {
            await startRadarImages(zone.system_id, f.scan_id)
            setTryN((n) => n + 1)
        } catch (e) {
            setSt((s) => ({ ...s, status: "error", error: e.message }))
        }
    }
    // Radar images not held: the boxes go on the newest optical image of the
    // area meanwhile (every scene of an area is fetched over its own bbox).
    const shown = st.status === "ready" ? st
        : (isRadarFinding(f) && fallback?.image_b64 && ["missing", "error", "running"].includes(st.status))
            ? { kind: "fallback", bounds: asBounds(zone.bbox), after: fallback.image_b64, dateAfter: fallback.date }
            : null
    return { st, shown, retry: () => setTryN((n) => n + 1), load }
}

export default function FindingViewer({ zone, findings, selectedId, onSelect, onClose, onShowOnMap, onImagesReady, fallback = null }) {
    const f = useMemo(() => (findings || []).find((x) => x.id === selectedId) || (findings || [])[0] || null, [findings, selectedId])
    const { st, shown, retry, load } = useFindingImage(zone, f, fallback, onImagesReady)
    const radar = isRadarFinding(f)
    const [view, setView] = useState("after")
    const [swipePos, setSwipePos] = useState(50)
    const [showBoxes, setShowBoxes] = useState(true)
    const [explain, setExplain] = useState(false)
    const viewerRef = useRef(null)
    const clipRef = useRef(null)
    const fadeRef = useRef(null)
    const stageRef = useRef(null)
    const [fit, setFit] = useState({ w: 0, h: 0, cw: 0 })

    const views = shown?.kind === "radar" ? RADAR_VIEWS
        : shown?.kind === "optical" ? OPTICAL_VIEWS.filter(([, v]) => v === "after" || shown.before) : [["Optical", "after"]]
    useEffect(() => { if (!views.some(([, v]) => v === view)) setView("after") }, [shown?.kind]) // eslint-disable-line react-hooks/exhaustive-deps

    const bounds = shown?.bounds || null
    const ar = aspectOf(bounds)
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
    }, [ar, !!shown]) // eslint-disable-line react-hooks/exhaustive-deps

    // The boxes of every finding on this same image, captioned.
    const outlines = useMemo(() => (bounds && f ? findingOutlines(sameSource(findings, f), bounds) : []), [findings, f, bounds])
    const selected = outlines.find((o) => o.finding?.id === f?.id) || null

    // ZOOM TO IT: on a 20 km sweep tile a 4 ha camp is a few pixels across —
    // seen at all only when the viewer goes to it.
    useEffect(() => {
        if (!selected || !fit.w) return undefined
        const [x, y, w, h] = selected.bbox
        // at most ~6× — closer, a 10–20 m radar pixel is a blur with no context
        const fraction = Math.min(0.12, 6 * Math.max(w, h))
        const t = setTimeout(() => viewerRef.current?.focus({ x, y, w, h }, { fraction }), 80)
        return () => clearTimeout(t)
    }, [selected?.id, fit.w, view, shown?.after]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!f) return null
    const img = view === "before" ? shown?.before : view === "change" ? shown?.change : shown?.after
    const scene = shown ? {
        image_b64: img, reference_image_b64: view === "swipe" ? shown.before : null,
        reference_date: shown.dateBefore, scan: { image_timestamp_utc: view === "before" ? shown.dateBefore : shown.dateAfter, instrument: shown.kind === "radar" ? "SAR" : "OPTICAL" },
    } : null
    const meaning = radar ? radarMeaning(f) : null
    const strength = strengthText(f)
    const others = sameSource(findings, f).length - 1

    return (
        <div data-finding-viewer={f.id} style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "10px 14px 10px 18px", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: "none" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <button onClick={onClose} style={{ ...BTN, height: 24, fontSize: 11.5, padding: "0 8px", marginBottom: 6 }}>← Back to the passes</button>
                    <h3 style={{ margin: 0, fontWeight: 600, fontSize: 18, lineHeight: 1.3, letterSpacing: "-.01em", display: "flex", alignItems: "center", gap: 8 }}>
                        <i style={{ width: 12, height: 12, flex: "none", border: `2px solid ${TONE[f.tone] || TONE.amber}` }} />
                        <span style={{ minWidth: 0 }}>{f.label}</span>
                    </h3>
                    <div style={{ fontSize: 12.5, color: "var(--txt3)", marginTop: 3 }}>
                        {[f.size, dayText(f.date), strength, f.landcover ? `on ${f.landcover}` : null, f.sensor].filter(Boolean).join(" · ")}
                        {others > 0 ? ` · ${others} more on this image` : ""}
                    </div>
                </div>
                <div style={{ display: "flex", gap: 6, flex: "none", paddingTop: 30 }}>
                    <button onClick={() => setShowBoxes((v) => !v)} style={{ ...BTN, background: showBoxes ? ON : "transparent" }}>Boxes</button>
                    <button data-finding-map onClick={() => onShowOnMap?.(f.id, shown)} title="Put this image and its boxes on the map (leaves Imagery)" style={BTN}>Show on the map</button>
                </div>
            </div>

            {shown && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", flex: "none" }}>
                    <div role="tablist" aria-label="Which image" style={{ display: "flex", border: "1px solid var(--gline2)" }}>
                        {views.map(([k, v]) => (
                            <button key={v} role="tab" aria-selected={view === v} data-view={v} onClick={() => setView(v)} style={{
                                height: 26, padding: "0 12px", border: 0, background: view === v ? "var(--acc)" : "transparent",
                                color: view === v ? "var(--mz-cream)" : "var(--txt3)", font: "inherit", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                            }}>{k}</button>
                        ))}
                    </div>
                    <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>
                        {shown.kind === "radar"
                            ? view === "change"
                                ? <><Swatch c="#FF3B30" /> brighter now <Swatch c="#4096FF" /> darker now · over the After image, dimmed</>
                                : `Sentinel-1 radar · Before ${datesText(shown.datesBefore) || "—"} · After ${datesText(shown.datesAfter) || "—"}${shown.regenerated ? " · fetched again on request" : ""}`
                            : shown.kind === "optical"
                                ? `Sentinel-2 optical · ${dayText(view === "before" ? shown.dateBefore : shown.dateAfter) || ""}`
                                : `Newest optical image of the area · ${dayText(shown.dateAfter) || ""} — the radar images are not held`}
                    </span>
                </div>
            )}

            {radar && st.status !== "ready" && st.status !== "loading" && (
                <div data-radar-images={st.status} role={st.status === "error" || st.status === "failed" ? "alert" : undefined}
                    style={{ border: "1px solid var(--gline2)", background: "var(--glass2)", padding: "10px 12px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", flex: "none" }}>
                    <span style={{ fontSize: 12.5, flex: "1 1 280px", textWrap: "pretty" }}>
                        {st.status === "running" ? `Fetching the radar frames from Sentinel Hub — ${st.done ?? 0} of ${st.total ?? st.requests ?? "?"}…`
                            : st.status === "failed" ? `The radar images could not be read — ${st.error}`
                            : st.status === "error" ? `The radar images could not be fetched — ${st.error}`
                            : st.why || "The radar images of this comparison are not held."}
                    </span>
                    {st.status === "missing" && st.regenerable && (
                        <button data-load-radar onClick={load} style={PRIMARY}>Load the radar images · {st.requests} requests</button>
                    )}
                    {(st.status === "error" || st.status === "failed") && <button onClick={st.status === "failed" ? retry : load} style={BTN}>Try again</button>}
                    {st.status === "running" && <Loading size={14} inline label="" />}
                </div>
            )}

            <div ref={stageRef} style={{ flex: 1, minHeight: 280, position: "relative" }}>
                {shown && scene && fit.w > 0 && (
                    <div style={{ position: "absolute", left: (fit.cw - fit.w) / 2, top: 0, width: fit.w, height: fit.h }}>
                        <SceneComparison
                            scene={scene} view={view === "swipe" ? "swipe" : "after"} showBoxes={showBoxes} changes={outlines}
                            swipePos={swipePos} onSwipePos={setSwipePos} fadeOn={false} fadeOpacity={50}
                            swipeHandle refLabel={`Before · ${dayText(shown.dateBefore) || ""}`} stretch stamped
                            clipRef={clipRef} fadeRef={fadeRef} viewerRef={viewerRef}
                            onSelectDet={(o) => { if (o?.finding) onSelect?.(o.finding.id) }}
                            selectedDet={selected ? { ...selected, label: "" } : null}
                        />
                    </div>
                )}
                {!shown && (st.status === "loading" || st.status === "running") && (
                    <div data-image-state="loading" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "var(--glass2)" }}>
                        <Loading size={20} inline label={radar ? "Loading the radar images of the comparison" : "Loading the pass"} style={{ padding: 16 }} />
                    </div>
                )}
                {!shown && st.status !== "loading" && st.status !== "running" && (
                    <div data-image-state="none" style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", padding: 24, color: "var(--txt3)", fontSize: 12.5, textAlign: "center" }}>
                        {st.status === "none" ? (st.why || "No image is held for this finding.") : "No optical image of this area is held yet either."}
                    </div>
                )}
            </div>

            {shown && view === "swipe" && (
                <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0,1fr) auto", gap: 12, alignItems: "center", flex: "none", padding: "2px 8px" }}>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>After · {dayText(shown.dateAfter)}</span>
                    <input type="range" min={0} max={100} step={0.5} aria-label="Before and after" value={100 - swipePos}
                        onChange={(e) => setSwipePos(100 - Number(e.target.value))} style={{ width: "100%", accentColor: "var(--acchi)", height: 22 }} />
                    <span style={{ fontSize: 12, fontWeight: 600 }}>Before · {dayText(shown.dateBefore)}</span>
                </div>
            )}

            {radar && (
                <div data-radar-explain style={{ flex: "none", fontSize: 12, color: "var(--txt2)", lineHeight: 1.5, textWrap: "pretty", maxWidth: 900 }}>
                    <span>{RADAR_WHAT} {meaning}</span>{" "}
                    <button onClick={() => setExplain((v) => !v)} aria-expanded={explain} style={{ border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", fontSize: 12, cursor: "pointer", padding: 0 }}>
                        {explain ? "Less" : "What else changes radar brightness?"}
                    </button>
                    {explain && <div style={{ marginTop: 4, color: "var(--txt3)" }}>{RADAR_CAVEATS}</div>}
                </div>
            )}
            {/* a vision model's second opinion on this finding, only when pressed */}
            {f?.id && zone?.system_id && (
                <div style={{ flex: "none", maxWidth: 900 }}>
                    <AssessWithAI key={`${zone.system_id}:${f.id}`} zoneId={zone.system_id} findingId={f.id} />
                </div>
            )}
        </div>
    )
}

function Swatch({ c }) {
    return <i style={{ display: "inline-block", width: 10, height: 10, background: c, margin: "0 4px -1px 6px" }} />
}
