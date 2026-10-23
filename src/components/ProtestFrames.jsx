/**
 * ProtestFrames.jsx — the Protests layer's three frames (Live now / Today / Upcoming) and its one-line note,
 * the same control on the phone (m2.css .m2-segs) and the desktop (designSystem .seg), sharing one choice
 * (lib/protests.js frame store). The note is the server's plain sentence when the frame is empty in the
 * user's areas ("Nothing live in your areas right now. 3 protests today, 2 upcoming.").
 */
import { useEffect, useState } from "react"
import { FRAMES, getFrame, setFrame, subscribeFrame, getMeta, subscribeMeta } from "../lib/protests.js"

export function useProtestFrame() {
    const [frame, set] = useState(getFrame)
    useEffect(() => subscribeFrame(set), [])
    return frame
}

export function useProtestMeta() {
    const [meta, set] = useState(getMeta)
    useEffect(() => subscribeMeta((m) => set({ ...m })), [])
    return meta
}

export function noteOf(meta, frame) {
    if (!meta || meta.frame !== frame) return "Loading…"
    if (meta.note) return meta.note
    const n = meta.counts?.[frame] ?? meta.items ?? 0
    const word = { live: "live now", today: "today", upcoming: "upcoming" }[frame]
    return `${n} ${n === 1 ? "protest" : "protests"} ${word} in your areas`
}

export default function ProtestFrames({ variant = "desktop", compact = false }) {
    const frame = useProtestFrame()
    const meta = useProtestMeta()
    const phone = variant === "phone"
    const count = (k) => (meta?.counts && Number.isFinite(meta.counts[k]) ? meta.counts[k] : null)
    const buttons = FRAMES.map((f) => {
        const n = count(f.key)
        return (
            <button key={f.key} type="button" aria-pressed={frame === f.key} data-frame={f.key}
                    onClick={(e) => { e.stopPropagation(); setFrame(f.key) }}
                    style={phone ? undefined : { font: "500 11px var(--font)", padding: "3px 8px", flex: 1 }}>
                {f.label}{n != null ? ` ${n}` : ""}
            </button>
        )
    })
    return (
        <div data-testid="protest-frames" data-variant={variant} data-frame={frame}
             style={phone ? { padding: compact ? 0 : "4px 0 10px" } : { padding: "2px 12px 8px 27px" }}>
            {phone
                ? <div className="m2-segs" role="group" aria-label="Protests: when">{buttons}</div>
                : <div className="seg" role="group" aria-label="Protests: when" style={{ display: "flex", width: "100%" }}>{buttons}</div>}
            <div data-testid="protest-note"
                 style={phone ? { fontSize: 12.5, lineHeight: 1.4, color: "var(--txt3)", marginTop: 6 }
                              : { font: "400 10.5px var(--font)", lineHeight: 1.4, color: "var(--txt-3)", marginTop: 4 }}>
                {noteOf(meta, frame)}
            </div>
        </div>
    )
}
