/**
 * TimeStrip.jsx — PARALLAX §11. Two faces, one element.
 *
 * Replaces two things that used to be separate and disagreed about their own
 * geometry: a fixed 56px density bar rendered inline by Situation, and
 * GeoConfirmedTimelinePanel, a floating overlay that measured itself with a
 * ResizeObserver and pushed the map chrome around from the outside. §11 makes
 * both faces of one strip, so `--strip-h` is a fact about the layout rather
 * than something reported after the fact.
 *
 * A scrub bar tells you where the playhead is and nothing about whether moving
 * it is worth the gesture. The archive face answers HOW MUCH, WHEN and WHAT
 * KIND before the analyst drags anything.
 *
 * `#strip-range` HAS TWO WRITERS, and §11 is explicit about which one yields:
 * the density renderer runs on every map redraw, so the archive renderer
 * always loses the race. The fix belongs in the density writer, and that is
 * why the label below is computed from `face` rather than written by whoever
 * rendered last.
 */
import { useChrome } from "../state/useChrome.js"
import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"

const TIMELINE_START = "2022-01-01"
import { publishArchiveState } from "../state/archiveState.js"
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js"
import {
    CAT, CAT_KEYS, UNCATEGORISED, BUCKETS,
    foldBuckets, stackSegments, calendarTicks,
    advance, barOpacity, spanDays, SPEEDS, TICK_MS,
    dayOffsetToMs, msToDayOffset,
} from "./timeStripMath.js"

const zulu = (ms) => {
    const d = new Date(ms)
    return `${d.toISOString().slice(0, 10)} ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`
}
const iso = (ms) => new Date(ms).toISOString().slice(0, 10)


/** How wide one density bar is, in words rather than minutes. */
export function formatBucket(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return ""
    if (minutes < 60) return `${minutes} min`
    const h = minutes / 60
    return Number.isInteger(h) ? `${h} h` : `${h.toFixed(1)} h`
}

/**
 * The hover text for one density bar.
 *
 * The old one said "14 signals" and nothing else, which is a count
 * without a subject: it does not say when, how bad, or where, so there
 * is nothing to do with it.
 */
export function densityTooltip(cell) {
    if (!cell) return ""
    const when = `${new Date(cell.from).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
              + `–${new Date(cell.to).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    if (!cell.count) return `${when} · nothing reported`
    const parts = [`${when} · ${cell.count} signal${cell.count === 1 ? "" : "s"}`]
    if (cell.critical) parts.push(`${cell.critical} critical or high`)
    if (cell.topRegion) {
        parts.push(cell.topRegionCount === cell.count
            ? `all in ${cell.topRegion}`
            : `most in ${cell.topRegion} (${cell.topRegionCount})`)
    }
    return parts.join("\n")
}

export default function TimeStrip({
    // density face
    densityBuckets,
    windowHours = 72,
    nowMs = Date.now(),
    // archive face
    theatres = null,
    endDate = null,
    onEndDateChange,
}) {
    // The timeline, always (owner: "event density is useless"). The density
    // face's code stays below, unreachable, until it is removed for good.
    const [face, setFace] = useState("timeline")
    // Collapsed the strip keeps its header row, so the face buttons and the
    // collapse control stay reachable; only the chart body goes. --strip-h
    // follows the .collapsed class (index.html), so the panes and the
    // notification stack reclaim the space rather than leaving a gap where
    // the chart used to be.
    // Opening the strip opens it — no second collapse control inside it.
    const stripOpen = true
    void useChrome
    // THE PANES CLEAR THE STRIP'S REAL HEIGHT. --strip-h was a fixed 76px
    // while the timeline face is 150px, so the strip slid under both side
    // panels. Measured and published on the root, so every consumer of
    // --pane-bottom follows it.
    const stripRef = useRef(null)
    useEffect(() => {
        const el = stripRef.current
        if (!el || typeof ResizeObserver === "undefined") return undefined
        const root = document.documentElement
        const set = () => root.style.setProperty("--strip-h", `${Math.round(el.getBoundingClientRect().height)}px`)
        set()
        const ro = new ResizeObserver(set)
        ro.observe(el)
        return () => { ro.disconnect(); root.style.removeProperty("--strip-h") }
    }, [])
    const [range, setRange] = useState(null)      // { min_date, max_date }
    const [rows, setRows] = useState([])          // histogram buckets, with categories
    const [loadError, setLoadError] = useState(false)
    const [playing, setPlaying] = useState(false)
    const [speed, setSpeed] = useState(1)
    const [winMode, setWinMode] = useState("window")   // window | all
    const [winDays, setWinDays] = useState(45)
    const [catsOff, setCatsOff] = useState(() => new Set())
    const theatreKey = theatres && theatres.length ? theatres.join(",") : ""

    // ── Archive bounds + histogram ────────────────────────────────────────
    useEffect(() => {
        if (face !== "timeline") return
        let cancelled = false
        const q = theatreKey ? `?theatre=${encodeURIComponent(theatreKey)}` : ""
        fetchWithTimeout(`${API_BASE}/api/geoconfirmed/date-range${q}`)
            .then((r) => (r.ok ? r.json() : null))
            // FROM 2022 (owner). The archive reaches back to 2013, which
            // squeezed the years that matter into the right-hand edge.
            .then((d) => {
                if (cancelled) return
                const ok = d?.min_date
                setRange(ok ? { ...d, min_date: d.min_date < TIMELINE_START ? TIMELINE_START : d.min_date } : null)
                setLoadError(!ok)
            })
            .catch(() => { if (!cancelled) setLoadError(true) })
        return () => { cancelled = true }
    }, [face, theatreKey])

    useEffect(() => {
        if (face !== "timeline" || !range?.min_date) return
        let cancelled = false
        const p = new URLSearchParams({
            start_date: range.min_date, end_date: range.max_date, with_categories: "true",
        })
        if (theatreKey) p.set("theatre", theatreKey)
        fetchWithTimeout(`${API_BASE}/api/geoconfirmed/histogram?${p}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setRows(safeArray(d?.buckets)) })
            .catch(() => {})
        return () => { cancelled = true }
    }, [face, range, theatreKey])

    const minMs = range ? Date.parse(`${range.min_date}T00:00:00Z`) : null
    const maxMs = range ? Date.parse(`${range.max_date}T00:00:00Z`) : null
    const totalDays = minMs != null ? spanDays(minMs, maxMs) : 1

    // The playhead lives in the URL-ish `endDate` the map already filters by,
    // so scrubbing here and the pins on the globe cannot disagree.
    const playheadMs = endDate ? Date.parse(`${endDate}T00:00:00Z`) : maxMs
    const dayOffset = minMs != null && playheadMs != null ? msToDayOffset(minMs, playheadMs) : 0

    const setOffset = useCallback((off) => {
        if (minMs == null) return
        const clamped = Math.max(0, Math.min(totalDays, off))
        onEndDateChange?.(iso(dayOffsetToMs(minMs, clamped)))
    }, [minMs, totalDays, onEndDateChange])

    // ── Transport ─────────────────────────────────────────────────────────
    const offsetRef = useRef(dayOffset)
    offsetRef.current = dayOffset
    useEffect(() => {
        if (!playing || face !== "timeline" || minMs == null) return
        const id = setInterval(() => {
            const { offset, done } = advance(offsetRef.current, speed, totalDays)
            setOffset(offset)
            if (done) setPlaying(false)
        }, TICK_MS)
        return () => clearInterval(id)
    }, [playing, speed, face, minMs, totalDays, setOffset])

    // Playing while the face is hidden would scrub the map from a surface
    // nobody can see.
    useEffect(() => { if (face !== "timeline") setPlaying(false) }, [face])

    const cols = useMemo(
        () => (minMs == null ? [] : foldBuckets(rows, minMs, maxMs)),
        [rows, minMs, maxMs],
    )
    const colMax = useMemo(() => Math.max(1, ...cols.map((c) => c.total)), [cols])
    const ticks = useMemo(() => (minMs == null ? [] : calendarTicks(minMs, maxMs)), [minMs, maxMs])

    const shown = useMemo(() => {
        if (minMs == null) return 0
        const from = winMode === "all" ? minMs : playheadMs - winDays * 86_400_000
        return cols.reduce((a, c) => a + (c.t0 >= from && c.t0 <= playheadMs ? c.total : 0), 0)
    }, [cols, winMode, winDays, playheadMs, minMs])

    const pct = minMs != null && maxMs > minMs ? ((playheadMs - minMs) / (maxMs - minMs)) * 100 : 0
    const winFracPct = winMode === "all" ? pct : Math.min(pct, (winDays / totalDays) * 100)

    const jumpFromClientX = (el, clientX) => {
        const r = el.getBoundingClientRect()
        if (!r.width) return
        // §11.1 — click anywhere on the chart to jump. "Dragging a 1px handle
        // across 18 months is a tax on people who already know roughly when
        // the thing happened."
        setOffset(Math.round(((clientX - r.left) / r.width) * totalDays))
    }

    const toggleCat = (k) =>
        setCatsOff((prev) => {
            const next = new Set(prev)
            next.has(k) ? next.delete(k) : next.add(k)
            return next
        })

    // §16 — publish the strip's own state so a saved view can carry the
    // apparatus, not just the lens. The playhead (`at`) is geoConfirmedEndDate,
    // which the map already filters by, so a restored view draws the same
    // evidence rather than the same filters over today's pins.
    useEffect(() => {
        publishArchiveState({
            face, at: endDate, win: winDays, mode: winMode,
            cats: CAT_KEYS.concat(UNCATEGORISED.key).filter((k) => !catsOff.has(k)),
        })
    }, [face, endDate, winDays, winMode, catsOff])

    // The restore channel. Only fields the saved view actually carried are
    // applied — a view saved before a control existed must not reset it.
    useEffect(() => {
        const onApply = (e) => {
            const g = e.detail || {}
            if (g.face === "density" || g.face === "timeline") setFace(g.face)
            if (typeof g.win === "number") setWinDays(g.win)
            if (g.mode === "window" || g.mode === "all") setWinMode(g.mode)
            if (Array.isArray(g.cats)) {
                const all = CAT_KEYS.concat(UNCATEGORISED.key)
                setCatsOff(new Set(all.filter((k) => !g.cats.includes(k))))
            }
            if (g.at !== undefined) onEndDateChange?.(g.at)
        }
        window.addEventListener("akili:apply-archive-state", onApply)
        return () => window.removeEventListener("akili:apply-archive-state", onApply)
    }, [onEndDateChange])

    const rangeLabel = face === "timeline"
        ? (range ? `${range.min_date} → ${range.max_date}` : loadError ? "archive range unavailable" : "reading archive range…")
        : `${zulu(nowMs - windowHours * 3600000)} → ${zulu(nowMs)}`

    return (
        <div ref={stripRef} className={`timestrip${stripOpen ? "" : " collapsed"}`} id="timestrip">
            <div className="head">
                <span className="lbl" id="strip-range">{rangeLabel}</span>
                <div className="right" id="strip-tools">
                    {/* §11.1 — in archive face this holds ONLY the source tag.
                        It sits under the inspector column; anything else
                        clips. */}
                    {face === "timeline" && (
                        <span className="srctag" data-real={!loadError}>
                            {loadError ? "archive unavailable" : "GeoConfirmed"}
                        </span>
                    )}
                </div>
            </div>

            {/* ── density face ─────────────────────────────────────────── */}
            {face === "density" && (
                <div style={{ position: "relative" }}>
                    <svg id="stripsvg" preserveAspectRatio="none" viewBox="0 0 100 40" aria-label="Event density">
                        {(densityBuckets?.cells || []).map((cell, i, arr) => {
                            const w = 100 / arr.length
                            const h = Math.max(cell.count ? 1.5 : 0.4,
                                               (cell.count / (densityBuckets.max || 1)) * 36)
                            return (
                                <rect key={i} x={i * w + w * 0.12} width={w * 0.76}
                                      y={40 - h} height={h}
                                      className={cell.hot ? "dbar hot" : "dbar"}>
                                    {/* WHAT THE BAR IS MADE OF. "14 signals" is
                                        not something anybody can act on; the
                                        hours it covers, how much of it was
                                        critical and where it happened are. */}
                                    <title>{densityTooltip(cell)}</title>
                                </rect>
                            )
                        })}
                    </svg>
                    {/* The strip had no axis at all, so a bar's position
                        carried no meaning beyond "further right is newer". */}
                    <div style={{
                        display: "flex", justifyContent: "space-between",
                        font: "400 9px var(--mono)", color: "var(--txt-4)",
                        padding: "0 2px", marginTop: 1,
                    }}>
                        <span>{densityBuckets?.windowHours ? `−${densityBuckets.windowHours}h` : ""}</span>
                        <span>
                            {densityBuckets?.bucketMinutes
                                ? `${formatBucket(densityBuckets.bucketMinutes)} per bar · hover for detail`
                                : ""}
                        </span>
                        <span>now</span>
                    </div>
                </div>
            )}

            {/* ── archive face ─────────────────────────────────────────── */}
            <div className={`gcstrip${face === "timeline" ? "" : " hidden"}`} id="gcstrip">
                {minMs == null ? (
                    <div className="gcempty">{loadError ? "No archive range available." : "Reading archive range…"}</div>
                ) : (
                    <>
                        <div className="gcx">
                            <div className="gcx-tr">
                                <button className="gcb" type="button" title="Back one day"
                                        onClick={() => setOffset(dayOffset - 1)}>◀</button>
                                <button className={`gcb play${playing ? " on" : ""}`} type="button"
                                        title={playing ? "Pause" : "Play"}
                                        onClick={() => setPlaying((p) => !p)}>
                                    <svg className="icon sm"><use href={playing ? "#i-pause" : "#i-play"} /></svg>
                                </button>
                                <button className="gcb" type="button" title="Forward one day"
                                        onClick={() => setOffset(dayOffset + 1)}>▶</button>
                                <select className="gcspeed" value={speed} title="Playback speed"
                                        onChange={(e) => setSpeed(Number(e.target.value))}>
                                    {SPEEDS.map((s) => <option key={s} value={s}>{s}×</option>)}
                                </select>
                            </div>

                            <div className="gcx-track"
                                 onClick={(e) => jumpFromClientX(e.currentTarget, e.clientX)}>
                                <svg className="gchist" preserveAspectRatio="none" viewBox={`0 0 ${BUCKETS} 100`}>
                                    <rect className="gcwin" x={(winFracPct / 100) * BUCKETS >= 0 ? ((pct - winFracPct) / 100) * BUCKETS : 0}
                                          y="0" width={Math.max(0, (winFracPct / 100) * BUCKETS)} height="100" />
                                    {cols.map((c) => {
                                        if (!c.total) return null
                                        const segs = stackSegments(c).filter((s) => !catsOff.has(s.key))
                                        const visible = segs.reduce((a, s) => a + s.value, 0)
                                        if (!visible) return null
                                        const full = (visible / colMax) * 100
                                        let acc = 0
                                        return (
                                            <g key={c.i} opacity={barOpacity(c.t0, playheadMs)}>
                                                {segs.map((s) => {
                                                    const h = (s.value / visible) * full
                                                    const y = 100 - acc - h
                                                    acc += h
                                                    return <rect key={s.key} x={c.i + 0.12} width={0.76}
                                                                 y={y} height={h} fill={s.color} />
                                                })}
                                            </g>
                                        )
                                    })}
                                </svg>
                                <div className="gcaxis">
                                    {ticks.map((t) => (
                                        <span key={t.t} className={t.year ? "y" : ""} style={{ left: `${t.pct}%` }}>{t.label}</span>
                                    ))}
                                </div>
                                <div className="gcplay" style={{ left: `${pct}%` }} />
                                <input type="range" min={0} max={totalDays} value={dayOffset}
                                       aria-label="Archive playhead"
                                       onChange={(e) => setOffset(Number(e.target.value))}
                                       onClick={(e) => e.stopPropagation()} />
                            </div>

                            <div className="gcx-read">
                                <b>{iso(playheadMs)}</b>
                                <span className="n">{shown.toLocaleString()} shown</span>
                                <div className="gcwinctl">
                                    <div className="seg">
                                        <button type="button" aria-pressed={winMode === "window"}
                                                onClick={() => setWinMode("window")}>window</button>
                                        <button type="button" aria-pressed={winMode === "all"}
                                                onClick={() => setWinMode("all")}>all</button>
                                    </div>
                                    <input type="range" min={1} max={180} value={winDays}
                                           aria-label="Window length in days"
                                           disabled={winMode === "all"}
                                           onChange={(e) => setWinDays(Number(e.target.value))} />
                                    <span className="lbl">{winMode === "all" ? "all" : `${winDays}d`}</span>
                                </div>
                            </div>
                        </div>

                        <div className="gccats">
                            {CAT_KEYS.concat(UNCATEGORISED.key).map((k) => {
                                const meta = CAT[k] || UNCATEGORISED
                                return (
                                    <button key={k} type="button"
                                            className={`gccat${catsOff.has(k) ? "" : " on"}`}
                                            aria-pressed={!catsOff.has(k)}
                                            onClick={() => toggleCat(k)}>
                                        <i style={{ background: meta.color }} />{meta.name}
                                    </button>
                                )
                            })}
                            <span className="gcmeta lbl">
                                {cols.length ? `peak ${colMax.toLocaleString()} · ${totalDays.toLocaleString()} days` : ""}
                            </span>
                        </div>
                    </>
                )}
            </div>

            {/* §11's DOM also carries a #timecursor band between the faces and
                the bottom edge. It is absent here: in this build it drew
                nothing at all, so it was 26px of empty strip covering 26px of
                map. Its height is returned to the strip's total rather than
                kept as a reservation for a thing that does not exist. */}
        </div>
    )
}
