// sceneComparison.jsx — the one real, shared AOI scene-comparison UI
// (sensor vocabulary, scene-history date-scrubber, before/after/swipe
// comparison view with detection boxes). Extracted from
// src/destinations/Imagery.jsx (the standalone Imagery module) so
// src/components/ImageryDetectionPanel.jsx (Situation's top-bar imagery
// entry point) can reuse the exact same real components rather than a
// second copy — the standalone module and this panel are now the two real
// consumers of one shared implementation, not two parallel ones.
//
// Real #sc-sensor options — only sentinel2_optical and sentinel1_sar have
// a real deployed fetch+detect pipeline in this codebase today (backend/
// main.py's _SENSOR_PIPELINES_DEPLOYED). commercial_eo/commercial_sar are
// real, selectable, persisted choices (an analyst's stated intent is never
// silently dropped), but a real scan attempt against one of them is
// honestly rejected server-side.
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
export function SceneComparison({ scene, view, showBoxes, changes, swipePos, onSwipeDrag, fadeOn, fadeOpacity, clipRef, fadeRef, onSelectDet, selectedDet }) {
    const refSrc = scene.reference_image_b64 ? `data:image/jpeg;base64,${scene.reference_image_b64}` : null
    const curSrc = scene.image_b64 ? `data:image/jpeg;base64,${scene.image_b64}` : null

    function Boxes() {
        if (!showBoxes) return null
        return changes.map((c) => (
            <div key={c.id} role="button" onClick={(e) => { e.stopPropagation(); onSelectDet(c) }}
                title={`${c.label} · ${Math.round(c.conf * 100)}%`}
                style={{
                    position: "absolute", left: `${c.bbox[0] * 100}%`, top: `${c.bbox[1] * 100}%`,
                    width: `${c.bbox[2] * 100}%`, height: `${c.bbox[3] * 100}%`, minWidth: 10, minHeight: 10,
                    outline: `1.2px ${c.type === "removed" ? "dashed" : "solid"} ${c.type === "new" ? "var(--sev-high)" : c.type === "removed" ? "var(--sev-critical)" : "var(--acc-hi)"}`,
                    background: selectedDet?.id === c.id ? "rgba(95,149,208,0.12)" : "transparent", cursor: "pointer",
                }}
            >
                <span style={{ position: "absolute", top: -14, left: 0, font: "400 9px var(--mono)", color: "var(--txt)", background: "var(--bg-0)", padding: "0 2px", whiteSpace: "nowrap" }}>
                    {c.id.slice(0, 8)} · {Math.round(c.conf * 100)}%
                </span>
            </div>
        ))
    }

    if (view === "after") {
        return (
            <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%" }}>
                {curSrc ? <img src={curSrc} alt="current scene" style={{ display: "block", maxWidth: "100%", maxHeight: "70vh" }} /> : <EmptyFrame />}
                <Boxes />
            </div>
        )
    }
    if (view === "swipe") {
        return (
            <div style={{ position: "relative", maxWidth: "100%", cursor: "ew-resize" }} onPointerDown={onSwipeDrag}>
                {refSrc ? <img src={refSrc} alt="reference" style={{ display: "block", maxWidth: "100%", maxHeight: "70vh", filter: fadeOn ? "grayscale(.35)" : "none" }} /> : <EmptyFrame />}
                <div ref={clipRef} style={{ position: "absolute", inset: 0, clipPath: `inset(0 ${100 - swipePos}% 0 0)` }}>
                    <div ref={fadeRef} style={{ opacity: fadeOn ? fadeOpacity / 100 : 1 }}>
                        {curSrc ? <img src={curSrc} alt="current" style={{ display: "block", maxWidth: "100%", maxHeight: "70vh" }} /> : <EmptyFrame />}
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
                {refSrc ? <img src={refSrc} alt="reference" style={{ display: "block", maxWidth: 420, maxHeight: "60vh" }} /> : <EmptyFrame />}
            </div>
            <div style={{ position: "relative" }}>
                <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginBottom: 3 }}>Current · {fmtDate(scene.scan.image_timestamp_utc)}</div>
                {curSrc ? <img src={curSrc} alt="current" style={{ display: "block", maxWidth: 420, maxHeight: "60vh" }} /> : <EmptyFrame />}
                <div style={{ position: "absolute", top: 18, left: 0, right: 0, bottom: 0 }}><Boxes /></div>
            </div>
        </div>
    )
}
