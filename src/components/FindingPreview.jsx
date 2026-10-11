/**
 * FindingPreview.jsx — the finding itself, in the signal view (the desktop
 * inspector and the phone's signal sheet): a cut-out of the newest image of
 * the place with the box drawn on it, and every finding of the notification
 * listed with its size and date. "Show on the map" puts the boxes on the
 * map and flies there.
 *
 * Every image has a visible state — loading, failed (with the reason and a
 * retry), or none held yet — because a blank square reads as "nothing there".
 */
import { useCallback, useEffect, useState } from "react"
import { fetchCrop, findingCaption, findingsForAlert, alertRaw, TONE } from "../lib/findings.js"

const BOX = { border: "1px solid var(--gline2, rgba(255,255,255,.16))", background: "var(--glass2, rgba(255,255,255,.04))" }
const BTN = { height: 30, padding: "0 12px", border: "1px solid var(--gline2, rgba(255,255,255,.2))", background: "transparent",
              color: "inherit", font: "inherit", fontSize: 12.5, cursor: "pointer" }

export default function FindingPreview({ alert, onShowOnMap, onOpenImagery, compact = false }) {
    const [state, setState] = useState({ loading: true, findings: [], zoneId: null })
    const [pick, setPick] = useState(0)
    const [crop, setCrop] = useState({ loading: false })
    const [tryN, setTryN] = useState(0)
    const id = alert?.alert_id || alert?.id

    useEffect(() => {
        let live = true
        setState({ loading: true, findings: [], zoneId: null }); setPick(0)
        findingsForAlert(alert).then((d) => { if (live) setState({ loading: false, ...d }) })
            .catch(() => { if (live) setState({ loading: false, findings: [], zoneId: null }) })
        return () => { live = false }
    }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

    const f = state.findings[pick] || null
    useEffect(() => {
        if (!f || !state.zoneId) { setCrop({ loading: false }); return undefined }
        let live = true
        setCrop({ loading: true })
        fetchCrop(state.zoneId, f.box)
            .then((d) => { if (live) setCrop(d?.image_b64 ? { data: d } : { none: d?.why || "No image of this place is held yet." }) })
            .catch((e) => { if (live) setCrop({ error: e instanceof TypeError ? "The server did not answer (network or server error)." : e.message }) })
        return () => { live = false }
    }, [f?.id, state.zoneId, tryN]) // eslint-disable-line react-hooks/exhaustive-deps

    const showOnMap = useCallback(() => onShowOnMap?.({ zoneId: state.zoneId, findings: state.findings, focusId: f?.id }),
        [onShowOnMap, state, f])

    const caveat = alertRaw(alert).caveat
        || (f?.kind === "sweep_find" ? "At 10–20 m a field hospital, a tent camp and a vehicle park look alike — identify on high-resolution imagery." : null)

    if (state.loading) return <div data-finding-preview="loading" style={{ fontSize: 12.5, opacity: 0.7, margin: "6px 0 12px" }}>Reading what was found…</div>
    if (!state.findings.length) return null
    return (
        <div data-finding-preview={state.findings.length} style={{ display: "flex", flexDirection: "column", gap: 8, margin: "4px 0 12px" }}>
            <div style={{ ...BOX, position: "relative", width: "100%", aspectRatio: "1 / 1", maxHeight: compact ? 260 : 300, overflow: "hidden", display: "grid", placeItems: "center" }}>
                {crop.data ? (
                    <>
                        <img data-finding-crop src={`data:image/jpeg;base64,${crop.data.image_b64}`} alt={f?.label || "finding"}
                            onError={() => setCrop({ error: "The image arrived but could not be decoded." })}
                            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "fill", imageRendering: "pixelated" }} />
                        <i style={{
                            position: "absolute", left: `${crop.data.box[0] * 100}%`, top: `${crop.data.box[1] * 100}%`,
                            width: `${Math.max(crop.data.box[2] * 100, 1.5)}%`, height: `${Math.max(crop.data.box[3] * 100, 1.5)}%`,
                            border: `2px ${f?.box_source === "area_estimate" ? "dashed" : "solid"} ${TONE[f?.tone] || TONE.amber}`,
                            boxShadow: "0 0 0 1px rgba(0,0,0,.7)",
                        }} />
                        <span style={{ position: "absolute", left: 6, bottom: 6, fontSize: 11, padding: "1px 6px", background: "rgba(0,0,0,.65)", color: "#fff" }}>
                            {crop.data.instrument === "SAR" ? "Radar" : "Optical"} · {String(crop.data.date || "").slice(0, 10)} · box drawn on the newest image held
                        </span>
                    </>
                ) : crop.loading ? (
                    <span data-image-state="loading" style={{ fontSize: 12, opacity: 0.75 }}>Loading the image of the place…</span>
                ) : crop.error ? (
                    <span data-image-state="error" role="alert" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 12, textAlign: "center", fontSize: 12 }}>
                        <span>The image could not be loaded — {crop.error}</span>
                        <button style={BTN} onClick={() => setTryN((n) => n + 1)}>Try again</button>
                    </span>
                ) : (
                    <span data-image-state="none" style={{ fontSize: 12, opacity: 0.75, padding: 12, textAlign: "center" }}>{crop.none || "No image held."}</span>
                )}
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
                {state.findings.slice(0, 8).map((x, i) => (
                    <button key={x.id} onClick={() => setPick(i)} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "5px 6px", border: 0, textAlign: "left",
                        background: i === pick ? "var(--accdim, rgba(95,149,208,.18))" : "transparent", color: "inherit", font: "inherit", fontSize: 12.5, cursor: "pointer",
                    }}>
                        <i style={{ width: 10, height: 10, flex: "none", border: `2px solid ${TONE[x.tone] || TONE.amber}` }} />
                        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{findingCaption(x)}</span>
                        {x.box_source === "area_estimate" && <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.6 }}>size estimated</span>}
                    </button>
                ))}
                {state.findings.length > 8 && <span style={{ fontSize: 11.5, opacity: 0.6, padding: "2px 6px" }}>and {state.findings.length - 8} more on the map</span>}
            </div>
            {caveat && <span style={{ fontSize: 11.5, opacity: 0.7, lineHeight: 1.4 }}>{caveat}</span>}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {onShowOnMap && <button data-show-findings onClick={showOnMap} style={{ ...BTN, border: 0, background: "var(--acc, #2f6fb3)", color: "var(--mz-cream, #fff)", fontWeight: 600 }}>Show on the map with the boxes</button>}
                {onOpenImagery && state.zoneId && <button onClick={() => onOpenImagery({ systemId: state.zoneId, scanId: null })} style={BTN}>Open in Imagery</button>}
            </div>
        </div>
    )
}
