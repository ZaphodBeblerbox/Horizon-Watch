// sceneComparison.jsx — the one real, shared AOI scene-comparison UI
// (sensor vocabulary, scene-history date-scrubber, before/after/swipe
// comparison view with detection boxes). Extracted from
// src/destinations/Imagery.jsx (the standalone Imagery module).
//
// Round 2 UX correction: Situation's top-bar imagery entry point
// (src/components/ImagerySidebar.jsx) now renders its loaded scene +
// detections directly on the main globe (GlobeOverwatchLayer.jsx), not in
// a side panel — so it only reuses this file's real SENSOR_OPTIONS
// vocabulary, not SceneScrubber/SceneComparison (which stay real and used
// solely by the standalone Imagery module's own scene-history/before-
// after view, out of scope for that round).
//
// Real #sc-sensor options — only sentinel2_optical and sentinel1_sar have
// a real deployed fetch+detect pipeline in this codebase today (backend/
// main.py's _SENSOR_PIPELINES_DEPLOYED). commercial_eo/commercial_sar are
// real, selectable, persisted choices (an analyst's stated intent is never
// silently dropped), but a real scan attempt against one of them is
// honestly rejected server-side.
import ZoomPanViewer, { DetectionArrow, useViewerScale, useViewerView } from "./ZoomPanViewer.jsx"

export const SENSOR_OPTIONS = [
    { value: "sentinel2_optical", label: "Sentinel-2 · optical 10m", real: true },
    { value: "sentinel1_sar",     label: "Sentinel-1 · SAR 20m",     real: true },
    { value: "commercial_eo",     label: "Commercial EO · 0.5m",     real: false },
    { value: "commercial_sar",    label: "Commercial SAR · 1m",      real: false },
]
export const SENSOR_LABEL = Object.fromEntries(SENSOR_OPTIONS.map((s) => [s.value, s.label]))

// Real AOI-class -> icon mapping, shared between the standalone Imagery
// module's AOI list and Situation's top-bar imagery/detection panel.
export const AOI_CLASS_ICON = { airport: "i-plane", port: "i-anchor", military: "i-target", energy: "i-grid", urban: "i-pin", border: "i-poly", custom: "i-pin" }
export const AOI_CLASSES = ["airport", "port", "military", "energy", "urban", "border", "custom"]

export function fmtDate(iso) { return iso ? iso.slice(0, 10) : "—" }

// Real date-scrubber through an AOI's real scene history, reusing the SAME
// real "Scenes" data the caller already queries (GET /api/watch-zones/
// {system_id}/scans) rather than a second query. Mode chosen: slide only
// the "current" endpoint — this app's real AOI editor has no explicit,
// separately-settable "reference scene" concept; imagery_pipeline.
// reference_scan() always auto-resolves a scene's real reference as its
// zone's own most recent OTHER completed scan of the SAME real instrument.
export function SceneScrubber({ scenes, selectedScanId, onSelect, currentInstrument }) {
    if (!scenes || scenes.length === 0) return null
    if (scenes.length === 1) {
        return (
            <div style={{ padding: "6px 12px", font: "400 11px var(--font)", color: "var(--txt-4)", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                No history yet — only one real capture on record for this area.
            </div>
        )
    }
    const ordered = [...scenes].sort((a, b) => (a.image_timestamp_utc || "").localeCompare(b.image_timestamp_utc || ""))
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", borderBottom: "1px solid var(--line)", overflowX: "auto", flexShrink: 0 }}>
            {ordered.map((s) => {
                const active = s.scan_id === selectedScanId
                // A scene from a DIFFERENT real instrument than the
                // currently-active one would auto-resolve to a different
                // (or no) reference at comparison time (imagery_pipeline.
                // reference_scan()'s same-instrument filter) — visibly
                // flagged here, not silently equivalent.
                const mismatched = currentInstrument && s.instrument && s.instrument !== currentInstrument
                return (
                    <button
                        key={s.scan_id}
                        onClick={() => onSelect(s.scan_id)}
                        title={mismatched ? `${s.instrument} — different instrument than the active scene; will pair against its own real reference, if any` : `${s.instrument || "OPTICAL"} · ${s.status}`}
                        style={{
                            flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                            padding: "4px 8px", borderRadius: "var(--r)", cursor: "pointer",
                            border: `1px solid ${active ? "var(--acc-hi)" : "var(--line-strong)"}`,
                            background: active ? "var(--acc)" : "var(--bg-2)",
                            opacity: mismatched ? 0.5 : 1,
                        }}
                    >
                        <span style={{ font: "400 10.5px var(--mono)", color: active ? "#fff" : "var(--txt-2)" }}>{fmtDate(s.image_timestamp_utc)}</span>
                        <span style={{ font: "400 9px var(--font)", color: active ? "#fff" : "var(--txt-4)", textTransform: "uppercase" }}>{s.instrument || "OPTICAL"}</span>
                    </button>
                )
            })}
        </div>
    )
}

export function EmptyFrame() {
    return <div style={{ width: 400, height: 300, background: "var(--bg-2)", display: "flex", alignItems: "center", justifyContent: "center", font: "400 11px var(--font)", color: "var(--txt-4)" }}>No real image persisted for this scene</div>
}

// Real before/after/swipe comparison view with detection boxes — renders
// actual base64 scene imagery (scene.image_b64/reference_image_b64), never
// placeholder art.

/**
 * ScreenBoxes — detection boxes drawn OUTSIDE the zoom transform.
 *
 * Positions come from the view (`tx + scale * x * frameW`), so the boxes
 * still sit exactly on their objects, but their strokes and labels are
 * ordinary screen pixels and keep a constant weight at any zoom. Counter-
 * scaling inside the transform cannot achieve this: the browser rounds a
 * sub-pixel outline up to 1px before magnifying it, which at 15x produced a
 * 15px slab over the imagery.
 */
export function ScreenBoxes({ changes, selectedDet, onSelectDet, arrowFor, arrowLabel }) {
    const { scale, tx, ty, frameW, frameH } = useViewerView()
    if (!frameW || !frameH) return null

    const toScreen = (b) => ({
        x: tx + scale * b[0] * frameW,
        y: ty + scale * b[1] * frameH,
        w: scale * b[2] * frameW,
        h: scale * b[3] * frameH,
    })
    const strokeFor = (c) => (c.type === "new" ? "var(--sev-high)"
        : c.type === "removed" ? "var(--sev-critical)" : "var(--acc-hi)")

    // A caption earns its place by on-screen size; on a dense scene every
    // box carrying one is an unreadable mass over the imagery.
    const LABEL_MIN_PX = 44

    return (
        <svg width="100%" height="100%" style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
            {changes.map((c) => {
                if (!c.bbox) return null
                const r = toScreen(c.bbox)
                // Nothing offscreen, and nothing so small it is invisible.
                if (r.x + r.w < 0 || r.y + r.h < 0 || r.x > frameW || r.y > frameH) return null
                const isSel = selectedDet?.id === c.id
                const w = Math.max(r.w, 3), h = Math.max(r.h, 3)
                return (
                    <g key={c.id}>
                        <rect x={r.x} y={r.y} width={w} height={h}
                            fill={isSel ? "rgba(95,149,208,0.12)" : "transparent"}
                            stroke={strokeFor(c)} strokeWidth={isSel ? 2 : 1.2}
                            strokeDasharray={c.type === "removed" ? "4 3" : undefined}
                            style={{ pointerEvents: "auto", cursor: "pointer" }}
                            onClick={(e) => { e.stopPropagation(); onSelectDet && onSelectDet(c) }}>
                            <title>{`${c.label} · ${Math.round(c.conf * 100)}%`}</title>
                        </rect>
                        {isSel || w >= LABEL_MIN_PX ? (
                            <text x={r.x} y={r.y - 3}
                                style={{ font: "400 9px var(--mono)", fill: "var(--txt)" }}>
                                {`${c.id.slice(0, 8)} · ${Math.round(c.conf * 100)}%`}
                            </text>
                        ) : null}
                    </g>
                )
            })}
            {arrowFor ? (() => {
                const r = toScreen([arrowFor.x, arrowFor.y, arrowFor.w, arrowFor.h])
                const cx = r.x + r.w / 2, cy = r.y + r.h / 2
                // Approach from whichever side has room in the FRAME, so the
                // arrow never points in from outside the visible area.
                const room = { left: r.x, right: frameW - (r.x + r.w), top: r.y, bottom: frameH - (r.y + r.h) }
                const side = Object.keys(room).reduce((a, b) => (room[b] > room[a] ? b : a))
                const L = 70
                const tail = { left: { x: r.x - L, y: cy }, right: { x: r.x + r.w + L, y: cy },
                               top: { x: cx, y: r.y - L }, bottom: { x: cx, y: r.y + r.h + L } }[side]
                const head = { left: { x: r.x - 4, y: cy }, right: { x: r.x + r.w + 4, y: cy },
                               top: { x: cx, y: r.y - 4 }, bottom: { x: cx, y: r.y + r.h + 4 } }[side]
                return (
                    <g>
                        <defs>
                            <marker id="det-arrow-head" markerWidth="7" markerHeight="7"
                                    refX="6" refY="3.5" orient="auto">
                                <path d="M0,0 L7,3.5 L0,7 z" fill="var(--acc-hi)" />
                            </marker>
                        </defs>
                        <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}
                              stroke="var(--acc-hi)" strokeWidth={2}
                              markerEnd="url(#det-arrow-head)" />
                        {arrowLabel ? (
                            <text x={tail.x} y={tail.y - 6}
                                textAnchor={side === "right" ? "start" : side === "left" ? "end" : "middle"}
                                style={{ font: "500 11px var(--mono)", fill: "var(--acc-hi)" }}>
                                {arrowLabel}
                            </text>
                        ) : null}
                    </g>
                )
            })() : null}
        </svg>
    )
}

export function SceneComparison({ scene, view, showBoxes, changes, swipePos, onSwipeDrag, fadeOn, fadeOpacity, clipRef, fadeRef, onSelectDet, selectedDet, fullscreen = false, viewerRef = null, showArrow = true }) {
    const refSrc = scene.reference_image_b64 ? `data:image/jpeg;base64,${scene.reference_image_b64}` : null
    const curSrc = scene.image_b64 ? `data:image/jpeg;base64,${scene.image_b64}` : null
    // Real size caps — fullscreen genuinely renders the same real image
    // bigger (not just inside a bigger container that still shrinks it).
    const soloMaxH = fullscreen ? "94vh" : "70vh"
    const splitMaxW = fullscreen ? "46vw" : 420
    const splitMaxH = fullscreen ? "88vh" : "60vh"

    function Boxes() {
        if (!showBoxes) return null
        // Counter-scale so outlines and labels keep a constant ON-SCREEN
        // size however far the image is zoomed. Without this the transform
        // multiplies them too: at 8.7x a 9px caption renders at 78px and the
        // labels cover the scene they are annotating.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const z = useViewerScale() || 1
        const k = 1 / z

        // DECLUTTER. On a dense SAR scene every box carrying a caption
        // produces an unreadable mass of overlapping text that hides the
        // imagery underneath — observed on a real scan with ~40 detections.
        //
        // A caption earns its place when the object is big enough on screen
        // to look at. Since box width is a fraction of the frame, that
        // fraction times the zoom IS the on-screen share, so labels reveal
        // themselves naturally as the person zooms in and the boxes spread
        // apart. The selected detection is always labelled: it is the one
        // the person asked about.
        const LABEL_MIN_SHARE = 0.05
        const labelled = (c) =>
            selectedDet?.id === c.id || (c.bbox?.[2] || 0) * z >= LABEL_MIN_SHARE
        const strokeFor = (c) => (c.type === "new" ? "var(--sev-high)"
            : c.type === "removed" ? "var(--sev-critical)" : "var(--acc-hi)")

        return (<>
            {/* OUTLINES AS SVG, not CSS outline.
                A CSS outline-width below 1px is rounded UP to 1px by the
                browser BEFORE the container's transform magnifies it, so at
                15x a correctly counter-scaled 0.08px border rendered as a
                15px slab that buried the imagery. Observed in the browser;
                the arithmetic had been right. vector-effect keeps the stroke
                at a constant device width at any zoom, which is what it
                exists for. */}
            <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                         pointerEvents: "none", overflow: "visible" }}>
                {changes.map((c) => (
                    <rect key={`r-${c.id}`}
                        x={c.bbox[0]} y={c.bbox[1]} width={c.bbox[2]} height={c.bbox[3]}
                        fill={selectedDet?.id === c.id ? "rgba(95,149,208,0.12)" : "none"}
                        stroke={strokeFor(c)}
                        strokeWidth={selectedDet?.id === c.id ? 2 : 1.2}
                        strokeDasharray={c.type === "removed" ? "4 3" : undefined}
                        vectorEffect="non-scaling-stroke" />
                ))}
            </svg>
            {changes.map((c) => (
            <div key={c.id} role="button" onClick={(e) => { e.stopPropagation(); onSelectDet(c) }}
                title={`${c.label} · ${Math.round(c.conf * 100)}%`}
                style={{
                    position: "absolute", left: `${c.bbox[0] * 100}%`, top: `${c.bbox[1] * 100}%`,
                    width: `${c.bbox[2] * 100}%`, height: `${c.bbox[3] * 100}%`,
                    // No visible border here — the SVG above draws it. This
                    // element is the click target and the label's anchor.
                    background: "transparent", cursor: "pointer",
                }}
            >
                {labelled(c) ? (
                    <span style={{
                        position: "absolute", top: `${-14 * k}px`, left: 0,
                        font: `400 ${(9 * k).toFixed(3)}px var(--mono)`,
                        color: "var(--txt)", background: "var(--bg-0)",
                        padding: `0 ${(2 * k).toFixed(3)}px`, whiteSpace: "nowrap",
                    }}>
                        {c.id.slice(0, 8)} · {Math.round(c.conf * 100)}%
                    </span>
                ) : null}
            </div>
            ))}
        </>)
    }

    if (view === "after") {
        // The single-scene view is where a scan is actually inspected, so it
        // is the one that must be zoomable: a tiled scan is tens of
        // megapixels and a 100m vessel is about one screen pixel when the
        // whole scene is fitted to a pane. The detection boxes are
        // percentage-positioned inside the same transformed stack, so they
        // stay welded to their objects at every zoom level.
        if (!curSrc) return <EmptyFrame />
        const sel = selectedDet && selectedDet.bbox
            ? { x: selectedDet.bbox[0], y: selectedDet.bbox[1], w: selectedDet.bbox[2], h: selectedDet.bbox[3] }
            : null
        return (
            <ZoomPanViewer
                ref={viewerRef}
                src={curSrc}
                alt="current scene"
                fill
                onBackgroundClick={() => onSelectDet && onSelectDet(null)}
                overlay={
                    <ScreenBoxes changes={showBoxes ? changes : []} selectedDet={selectedDet}
                                 onSelectDet={onSelectDet} arrowFor={showArrow ? sel : null}
                                 arrowLabel={selectedDet?.label} />
                }
            />
        )
    }
    if (view === "swipe") {
        return (
            <div style={{ position: "relative", maxWidth: "100%", cursor: "ew-resize" }} onPointerDown={onSwipeDrag}>
                {refSrc ? <img src={refSrc} alt="reference" style={{ display: "block", maxWidth: "100%", maxHeight: soloMaxH, filter: fadeOn ? "grayscale(.35)" : "none" }} /> : <EmptyFrame />}
                <div ref={clipRef} style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - swipePos}% 0 0)` }}>
                    <div ref={fadeRef} style={{ opacity: fadeOn ? fadeOpacity / 100 : 1 }}>
                        {curSrc ? <img src={curSrc} alt="current" style={{ display: "block", maxWidth: "100%", maxHeight: soloMaxH }} /> : <EmptyFrame />}
                        <Boxes />
                    </div>
                </div>
                <div style={{ position: "absolute", top: 0, bottom: 0, left: `${swipePos}%`, width: 2, background: "var(--acc-hi)" }} />
            </div>
        )
    }
    return (
        <div style={{ display: "flex", gap: 10 }}>
            <div style={{ position: "relative" }}>
                <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginBottom: 3 }}>Reference · {fmtDate(scene.reference_date)}</div>
                {refSrc ? <img src={refSrc} alt="reference" style={{ display: "block", maxWidth: splitMaxW, maxHeight: splitMaxH }} /> : <EmptyFrame />}
            </div>
            <div style={{ position: "relative" }}>
                <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginBottom: 3 }}>Current · {fmtDate(scene.scan.image_timestamp_utc)}</div>
                {curSrc ? <img src={curSrc} alt="current" style={{ display: "block", maxWidth: splitMaxW, maxHeight: splitMaxH }} /> : <EmptyFrame />}
                <div style={{ position: "absolute", top: 18, left: 0, right: 0, bottom: 0 }}><Boxes /></div>
            </div>
        </div>
    )
}
