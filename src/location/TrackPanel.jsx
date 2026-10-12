/**
 * TrackPanel.jsx — the shown track's controls, over the map: the range
 * (1 h · 6 h · 24 h · 7 d · 30 d), what the track says (how far, how many
 * stops, from when to when), and a scrubber that replays it — drag it, or
 * press play. Fetches the track (location/track.js trackUrl), refreshes it
 * every two minutes, and appends each live position as it streams in, so
 * the line grows while it is open. The map layers draw from the store.
 */
import { useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { useStream } from "./useLivePositions.js"
import {
    TRACK_RANGES, getTrack, setTrack, subscribeTrack, hideTrack, showTrack, trackUrl, extendTrack, tsOf,
    distanceLabel, stopLabel, dayHm, positionAt,
} from "./track.js"

export function useTrackState() {
    const [s, setS] = useState(getTrack())
    useEffect(() => subscribeTrack(setS), [])
    return s
}

const PANEL = {
    phone: { position: "absolute", left: 10, right: 10, bottom: "calc(env(safe-area-inset-bottom, 0px) + 86px)", zIndex: 900 },
    desktop: { position: "absolute", left: 16, bottom: 52, width: 380, zIndex: 40 },
}
const CHIP = (on) => ({
    height: 28, padding: "0 10px", borderRadius: 14, border: `1px solid ${on ? "#3b8cff" : "rgba(255,255,255,.18)"}`,
    background: on ? "rgba(59,140,255,.22)" : "transparent", color: "#fff", font: "inherit", fontSize: 12.5, cursor: "pointer",
})

export default function TrackPanel({ variant = "desktop" }) {
    const s = useTrackState()
    const t = s.target
    const stream = useStream(!!t)
    const [showStops, setShowStops] = useState(false)
    const play = useRef(null)

    // FETCH on target or range, and every two minutes while open
    useEffect(() => {
        if (!t) return undefined
        let live = true
        const load = (first) => {
            if (first) setTrack({ loading: true, error: null })
            fetch(trackUrl(API_BASE, t, s.range), { credentials: "include" })
                .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`); return d })
                .then((d) => { if (live) setTrack({ data: d, loading: false, error: null }) })
                .catch((e) => { if (live) setTrack({ loading: false, error: e.message || "Could not load the track" }) })
        }
        load(true)
        const id = setInterval(() => load(false), 120_000)
        return () => { live = false; clearInterval(id) }
    }, [t?.kind, t?.id, s.range]) // eslint-disable-line react-hooks/exhaustive-deps

    // LIVE: each streamed position extends the line
    const userId = t?.kind === "person" ? t.id : (s.data?.user_id || t?.userId)
    const livePt = t?.kind === "asset" ? stream.asset(t.id) : null
    const person = userId ? stream.people().find((p) => String(p.user_id) === String(userId)) : null
    const live = livePt || person
    useEffect(() => {
        if (!live || !getTrack().data) return
        const next = extendTrack(getTrack().data, live)
        if (next !== getTrack().data) setTrack({ data: next })
    }, [live?.at, live?.lat, live?.lon]) // eslint-disable-line react-hooks/exhaustive-deps

    // REPLAY: about twenty seconds end to end
    const pts = s.data?.points || []
    const t0 = pts.length ? tsOf(pts[0]) : 0, t1 = pts.length ? tsOf(pts[pts.length - 1]) : 0
    useEffect(() => {
        if (!s.playing) return undefined
        play.current = setInterval(() => {
            const cur = getTrack()
            const p = cur.data?.points || []
            if (p.length < 2) { setTrack({ playing: false }); return }
            const a = tsOf(p[0]), b = tsOf(p[p.length - 1])
            const now = (cur.scrubT ?? a) + (b - a) / 400
            if (now >= b) setTrack({ scrubT: null, playing: false })
            else setTrack({ scrubT: now })
        }, 50)
        return () => clearInterval(play.current)
    }, [s.playing])

    if (!t) return null
    const d = s.data
    const at = s.scrubT != null ? positionAt(pts, s.scrubT) : null
    return (
        <div data-testid="track-panel" style={{
            ...PANEL[variant], background: "rgba(12,16,24,.92)", color: "#fff", borderRadius: 12, padding: "10px 12px",
            boxShadow: "0 6px 24px rgba(0,0,0,.45)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,.1)", fontSize: 13,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ width: 10, height: 10, borderRadius: 5, background: "#3b8cff", flex: "none" }} />
                <b style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Track · {t.name || "asset"}</b>
                <button onClick={hideTrack} aria-label="Hide track" data-testid="track-close"
                        style={{ border: 0, background: "transparent", color: "#fff", fontSize: 18, cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                {TRACK_RANGES.map(([k, label]) => (
                    <button key={k} style={CHIP(s.range === k)} aria-pressed={s.range === k} data-range={k}
                            onClick={() => setTrack({ range: k, scrubT: null, playing: false })}>{label}</button>
                ))}
            </div>
            <div style={{ marginTop: 8, color: "rgba(255,255,255,.75)", lineHeight: 1.45 }} data-testid="track-summary">
                {s.loading && !d ? "Loading the track…"
                    : s.error ? s.error
                    : !pts.length ? `No position in the last ${TRACK_RANGES.find(([k]) => k === s.range)?.[1] || s.range}.`
                    : <>
                        {distanceLabel(d.distance_m)} moved · {d.stops?.length || 0} stop{d.stops?.length === 1 ? "" : "s"} ≥ 10 min
                        {` · ${dayHm(pts[0].at)} → ${dayHm(pts[pts.length - 1].at)}`}
                        {d.raw_count > pts.length ? ` · ${pts.length} of ${d.raw_count} points` : ""}
                        {live ? " · live" : ""}
                    </>}
            </div>
            {pts.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <button onClick={() => setTrack((c) => ({ playing: !c.playing, scrubT: c.playing ? c.scrubT : (c.scrubT == null || c.scrubT >= t1 ? t0 : c.scrubT) }))}
                            aria-label={s.playing ? "Pause" : "Replay"} data-testid="track-play"
                            style={{ ...CHIP(s.playing), width: 34, padding: 0, flex: "none" }}>{s.playing ? "❚❚" : "▶"}</button>
                    <input type="range" min={t0} max={t1} step={Math.max(1000, Math.round((t1 - t0) / 500))} value={s.scrubT ?? t1}
                           aria-label="Replay the track" data-testid="track-scrubber" style={{ flex: 1, accentColor: "#3b8cff" }}
                           onChange={(e) => { const v = +e.target.value; setTrack({ scrubT: v >= t1 ? null : v, playing: false }) }} />
                    <span style={{ minWidth: 70, textAlign: "right", color: "rgba(255,255,255,.8)", fontVariantNumeric: "tabular-nums" }}>
                        {at ? dayHm(new Date(at.at).toISOString()) : "now"}
                    </span>
                </div>
            )}
            {d?.stops?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                    <button onClick={() => setShowStops((v) => !v)} style={{ border: 0, background: "transparent", color: "#8fb4e8", padding: 0, font: "inherit", cursor: "pointer" }}>
                        {showStops ? "Hide stops" : `Show ${d.stops.length} stop${d.stops.length === 1 ? "" : "s"}`}
                    </button>
                    {showStops && (
                        <div style={{ maxHeight: 120, overflowY: "auto", marginTop: 4 }}>
                            {d.stops.map((st, i) => (
                                <div key={i} style={{ padding: "3px 0", borderTop: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.85)" }}>
                                    <span style={{ display: "inline-block", width: 18, color: "#f5a524" }}>{i + 1}</span>{stopLabel(st)}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

/** A "Show track" button for an asset or a person. */
export function ShowTrackButton({ target, style, className, onShown, label = "Show track" }) {
    const s = useTrackState()
    const on = s.target && s.target.kind === target?.kind && String(s.target.id) === String(target?.id)
    return (
        <button className={className} style={style} data-testid="show-track"
                onClick={() => { if (on) hideTrack(); else { showTrack(target); onShown?.() } }}>
            {on ? "Hide track" : label}
        </button>
    )
}
