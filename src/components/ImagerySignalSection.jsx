/**
 * ImagerySignalSection.jsx — an imagery signal, opened: the picture it is
 * about, with its detections, on the map.
 *
 * Opening a SAT-TASK alert fetches the pass it came from and places it on
 * the Situation map (the same akili:map-show-scene the Imagery page sends),
 * so the reader sees the tankers, not a pin that says "tankers". The
 * section says when the image was captured and why this counted.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { agoLabel } from "../utils/formatTime.js"
import { changeHeadline, fmtDay } from "../destinations/imageryModel.js"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }

export default function ImagerySignalSection({ alertId }) {
    const [state, setState] = useState({ loading: true })
    useEffect(() => {
        if (!alertId) return undefined
        let live = true
        ;(async () => {
            try {
                const a = await (await fetch(`${API_BASE}/api/alerts/${alertId}`, { credentials: "include" })).json()
                const raw = a.raw_json || {}
                const inner = raw.raw_json || raw
                const scanId = inner.scan_id || raw.scan_id
                if (!scanId) throw new Error("no pass recorded on this signal")
                const sc = await fetch(`${API_BASE}/api/imagery/scenes/${scanId}`, { credentials: "include" })
                if (!sc.ok) throw new Error(`the pass is no longer stored (HTTP ${sc.status})`)
                const scene = await sc.json()
                if (!live) return
                const b = scene.zone?.bbox
                if (scene.image_b64 && b) {
                    window.__plxMapScene = {
                        name: scene.zone.name, systemId: scene.zone.system_id,
                        bounds: { north: b.max_lat, south: b.min_lat, east: b.max_lon, west: b.min_lon },
                        instrument: scene.scan?.instrument || "OPTICAL",
                        after: { b64: scene.image_b64, date: scene.scan?.image_timestamp_utc },
                        before: scene.reference_image_b64 ? { b64: scene.reference_image_b64, date: scene.reference_date } : null,
                        changes: scene.changes || [], headline: changeHeadline(scene.counts, scene.reference_date),
                    }
                    window.dispatchEvent(new CustomEvent("akili:map-show-scene", { detail: window.__plxMapScene }))
                }
                setState({ scene, reason: inner.reason, kind: inner.kind, systemId: scene.zone?.system_id, scanId })
            } catch (e) {
                if (live) setState({ error: e.message })
            }
        })()
        return () => { live = false }
    }, [alertId])

    if (state.loading) return <div style={{ padding: "8px 0", fontSize: 12, color: "var(--txt4)" }}>Loading the image…</div>
    if (state.error) return <div style={{ padding: "8px 0", fontSize: 12, color: "var(--txt3)" }}>Image unavailable — {state.error}</div>
    const when = state.scene?.scan?.image_timestamp_utc
    return (
        <section style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 0", borderTop: "1px solid var(--gline)" }}>
            <span style={EYE}>The image</span>
            {when && (
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                    Captured {fmtDay(when)} {String(when).slice(0, 4)}, {String(when).slice(11, 16)} UTC
                    <span style={{ fontWeight: 400, color: "var(--txt3)" }}> · {agoLabel(when)}</span>
                </span>
            )}
            {state.reason && <span style={{ fontSize: 12, color: "var(--txt2)", lineHeight: 1.45 }}>{state.reason}</span>}
            <span style={{ fontSize: 11.5, color: "var(--txt3)" }}>
                On the map now, with its detections{state.scene?.reference_image_b64 ? " and the previous pass to swipe against" : ""}.
            </span>
            <button onClick={() => {
                window.dispatchEvent(new CustomEvent("akili:imagery-open-scene", { detail: { systemId: state.systemId, scanId: state.scanId } }))
            }} style={{ alignSelf: "flex-start", height: 26, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent",
                        color: "var(--txt)", font: "inherit", fontSize: 12, cursor: "pointer" }}>
                Open in Imagery →
            </button>
        </section>
    )
}
