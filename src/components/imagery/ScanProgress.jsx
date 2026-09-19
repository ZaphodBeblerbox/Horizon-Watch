import { useEffect, useState, useRef } from "react"
import API_BASE from "../../apiBase.js"

/**
 * ScanProgress — what the scan is actually doing.
 *
 * WHY. Tiled scans are uncapped by design: a zone-sized AOI is 60 API
 * requests and roughly four minutes. A spinner for four minutes is
 * indistinguishable from a hung request, and this codebase has repeatedly
 * found that rendering "no information" the same as "nothing happening" is
 * how a working feature comes to look broken.
 *
 * So this reports the worker's real state — tiles done, detections so far,
 * elapsed, and a remaining estimate from the OBSERVED rate rather than the
 * plan's up-front guess, which is right at tile zero and wrong at tile
 * forty. Nothing here is animated to look busy.
 */
export function formatEta(seconds) {
    if (seconds == null || !isFinite(seconds)) return null
    if (seconds < 1) return "a moment"
    if (seconds < 90) return `${Math.round(seconds)}s`
    const m = Math.round(seconds / 60)
    return `${m} min`
}

/** The line under the bar. Says what is happening, not merely that it is. */
export function progressLabel(p) {
    if (!p) return "starting…"
    if (p.finished) {
        return `done — ${p.total} tile${p.total === 1 ? "" : "s"}, ` +
               `${p.detections} detection${p.detections === 1 ? "" : "s"}` +
               (p.note ? ` (${p.note})` : "")
    }
    const eta = formatEta(p.eta_s)
    const head = `tile ${p.done} of ${p.total}`
    const dets = p.detections ? ` · ${p.detections} detection${p.detections === 1 ? "" : "s"} so far` : ""
    // Before the first tile completes there is genuinely no rate to
    // extrapolate from, so no estimate is offered rather than a made-up one.
    return eta ? `${head}${dets} · about ${eta} left` : `${head}${dets}`
}

export default function ScanProgress({ jobId, onDone, pollMs = 1200 }) {
    const [p, setP] = useState(null)
    const [gone, setGone] = useState(false)
    const doneFired = useRef(false)

    useEffect(() => {
        if (!jobId) return
        doneFired.current = false
        setGone(false)
        setP(null)
        let stop = false
        const tick = async () => {
            try {
                const r = await fetch(`${API_BASE}/api/imagery/progress?job_id=${encodeURIComponent(jobId)}`,
                                      { credentials: "include" })
                if (r.status === 404) {
                    // Finished and cleared, or never started. Either way it
                    // is not "in progress" and must not spin for ever.
                    if (!stop) setGone(true)
                    return
                }
                const d = await r.json()
                if (stop) return
                setP(d)
                if (d.finished && !doneFired.current) {
                    doneFired.current = true
                    onDone && onDone(jobId)
                }
            } catch {
                /* a dropped poll is not a failed scan; the next tick retries */
            }
        }
        tick()
        const h = setInterval(tick, pollMs)
        return () => { stop = true; clearInterval(h) }
    }, [jobId, pollMs, onDone])

    if (!jobId) return null
    if (gone && !p) return null

    const frac = p?.fraction ?? 0
    const pct = Math.round(frac * 100)

    return (
        <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--bdr)", background: "var(--bg-1)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-dim)" }}>
                    {p?.label || "scanning"}
                </span>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{pct}%</span>
            </div>
            <div
                role="progressbar"
                aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
                aria-label="scan progress"
                style={{ marginTop: 4, height: 3, background: "var(--bg-0)", borderRadius: 2, overflow: "hidden" }}
            >
                <div style={{
                    width: `${pct}%`, height: "100%",
                    background: p?.finished ? "var(--sev-low, #4d8)" : "var(--acc-hi)",
                    transition: "width 300ms linear",
                }} />
            </div>
            <div style={{ marginTop: 3, font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                {progressLabel(p)}
            </div>
        </div>
    )
}
