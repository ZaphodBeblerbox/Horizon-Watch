/**
 * FindingThumb.jsx — a finding cut out of its image, small, with its box:
 * After (and Before, when the radar comparison's images are held) on one
 * window, so the two read as the same ground. Used in Imagery's list of
 * findings. Every state is visible: loading, failed, none held.
 */
import { useEffect, useState } from "react"
import { fetchCrop, isRadarFinding, TONE } from "../../lib/findings.js"

export function CropImage({ b64, box, tone, size, label, dashed }) {
    return (
        <span style={{ position: "relative", width: size, height: size, flex: "none", display: "inline-block", background: "#000", overflow: "hidden" }}>
            <img src={`data:image/png;base64,${b64}`} alt={label || ""} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", imageRendering: "pixelated" }} />
            {box && <i style={{
                position: "absolute", left: `${box[0] * 100}%`, top: `${box[1] * 100}%`,
                width: `${Math.max(box[2] * 100, 4)}%`, height: `${Math.max(box[3] * 100, 4)}%`,
                border: `1.5px ${dashed ? "dashed" : "solid"} ${TONE[tone] || TONE.amber}`, boxShadow: "0 0 0 1px rgba(0,0,0,.7)",
            }} />}
            {label && <span style={{ position: "absolute", left: 2, bottom: 2, fontSize: 9, lineHeight: "11px", padding: "0 3px", background: "rgba(0,0,0,.65)", color: "#fff" }}>{label}</span>}
        </span>
    )
}

export default function FindingThumb({ zoneId, finding, size = 52 }) {
    const [st, setSt] = useState({ loading: true })
    const radar = isRadarFinding(finding)
    useEffect(() => {
        if (!zoneId || !finding?.box) { setSt({ none: true }); return undefined }
        let live = true
        setSt({ loading: true })
        fetchCrop(zoneId, finding.box, { scanId: radar ? finding.scan_id : null })
            .then((d) => { if (live) setSt(d?.image_b64 ? { data: d } : { none: true }) })
            .catch(() => { if (live) setSt({ error: true }) })
        return () => { live = false }
    }, [zoneId, finding?.id, finding?.radar_images]) // eslint-disable-line react-hooks/exhaustive-deps

    const box = (txt, title) => (
        <span title={title} style={{ width: size, height: size, flex: "none", display: "grid", placeItems: "center", fontSize: 9.5, color: "var(--txt4)", border: "1px dashed var(--gline2)", textAlign: "center", lineHeight: 1.2 }}>{txt}</span>
    )
    if (st.loading) return <span data-thumb="loading" style={{ display: "flex", gap: 3 }}>{box("…", "Loading the cut-out")}</span>
    if (st.error) return <span data-thumb="error" style={{ display: "flex", gap: 3 }}>{box("failed", "The cut-out could not be loaded")}</span>
    if (st.none) return <span data-thumb="none" style={{ display: "flex", gap: 3 }}>{box("no image", "No image of this place is held yet")}</span>
    const d = st.data
    const dashed = finding.box_source === "area_estimate"
    return (
        <span data-thumb={d.source === "radar_images" ? "radar" : "image"} style={{ display: "flex", gap: 3 }}>
            {d.before_b64 && <CropImage b64={d.before_b64} box={d.box} tone={finding.tone} size={size} label="Before" dashed={dashed} />}
            <CropImage b64={d.after_b64 || d.image_b64} box={d.box} tone={finding.tone} size={size}
                label={d.before_b64 ? "After" : d.instrument === "SAR" ? "Radar" : "Optical"} dashed={dashed} />
        </span>
    )
}
