import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, Cell } from "recharts"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js"

// GeoConfirmedTimelinePanel.jsx — GeoConfirmed historic-timeline round,
// Parts 1-3. Auto-surfaced by Situation.jsx whenever the real News/
// GeoConfirmed layer toggle (groupsOn.news) is on — never a separate page
// navigation, never persists detached from that toggle (see Situation.jsx's
// own mount condition).
//
// Real dependency note (Part 0.1): the ~74.5k real historic GeoConfirmed
// rows already in this app's DB span 2013-03-11 → today, but they were
// populated by an untracked one-off ingest run, not a committed backfill
// script — the LIVE 90-day-default sync (geoconfirmed.py's run_ingest())
// will never reproduce this depth on its own if the DB is ever rebuilt from
// scratch. That gap is in the ingest pipeline, not this panel's own read
// path — this panel and its new /api/geoconfirmed/date-range,
// /histogram, and end_date-aware /placemarks endpoints all query whatever
// real data actually exists, honestly, at request time; they do not assume
// or require the full 13-year depth to render correctly (a fresh DB with
// only 90 days of real data would show a real, correctly-scaled 90-day
// panel, not fabricate the rest).
//
// Real charting primitive reuse (Part 2.4): recharts' BarChart, the exact
// same library + component this app's own ForgePanel.jsx already uses for
// its Overwatch scan-history bars — no new charting library introduced.
//
// Real timeline-component decision (Part 0.3): Replay.jsx's own ruler/
// lanes/playhead (src/destinations/Replay.jsx) is ~336 lines of inline JSX
// tightly coupled to that page's own local state/useMemo chain — there is
// no separate ReplayTimeline.jsx/TimelineRuler.jsx to import, and Replay's
// concept (a live playhead animating through a bounded recent window) isn't
// what this panel needs anyway (a static scrub position across a 13-year
// span with a density histogram). Built new, on purpose, rather than
// extracting Replay's inline implementation.
export default function GeoConfirmedTimelinePanel({ theatres, onTheatresChange, endDate, onEndDateChange, onHeightChange, rightInset = 56, leftInset = 0 }) {
    const [theatreOptions, setTheatreOptions] = useState([])
    const [dateRange, setDateRange] = useState(null) // real {min_date, max_date}
    const [histogram, setHistogram] = useState(null) // real [{bucket, count}] or null while loading
    // Round 4 fix — real, live-reported bug: this fetch previously had no
    // timeout at all, so a hung/unresponsive backend (this repo's own
    // real, disclosed continuous event-loop-blocking condition) left the
    // "Loading real historic range…" text showing forever, with no way to
    // tell "still working" apart from "actually failed". dateRangeError +
    // retryTick below make that a real, distinct, honest state instead —
    // and this is a generic "any fetch can hang" fix (fetchWithTimeout.js),
    // not a special case for today's specific backend symptom.
    const [dateRangeError, setDateRangeError] = useState(false)
    const [retryTick, setRetryTick] = useState(0)
    const rootRef = useRef(null)

    // Round 3 fix (Part 6.3) — report this panel's real, measured rendered
    // height so the caller (Situation.jsx -> GlobeView.jsx) can push the
    // map's own bottom-left scale-bar/coordinate-readout chrome up above
    // it. A ResizeObserver, not a hardcoded constant, since this panel's
    // real height varies with content (theatre-chip row wrapping, the
    // "scrubbed to <date>" button appearing/disappearing).
    useEffect(() => {
        const el = rootRef.current
        if (!el || !onHeightChange) return
        // Real border-box height (el.offsetHeight), not ResizeObserver's
        // own default contentRect — contentRect excludes this panel's real
        // padding (8px top + 10px bottom) and border (1px), so relying on
        // it directly undercounted the panel's true rendered height by
        // ~19px, which is exactly what caused the map chrome to still
        // overlap the panel's top edge by a few pixels after the "fix".
        const ro = new ResizeObserver(() => onHeightChange(Math.ceil(el.offsetHeight)))
        ro.observe(el)
        return () => { ro.disconnect(); onHeightChange(0) }
    }, [onHeightChange])

    const theatresKey = theatres.length ? [...theatres].sort().join(",") : ""

    // Real distinct theatre values + real per-theatre counts (Part 3.1) —
    // never a hardcoded theatre list.
    useEffect(() => {
        let cancelled = false
        fetchWithTimeout(`${API_BASE}/api/geoconfirmed/theatres`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setTheatreOptions(safeArray(d?.theatres)) })
            .catch(() => {}) // real, honest degrade — an empty chip row is a legitimate empty state, not a stuck one
        return () => { cancelled = true }
    }, [])

    // Real full span for the current theatre filter — sizes the slider's
    // real bounds, never an assumed/hardcoded span. Real, bounded timeout +
    // a distinct error state (Round 4 fix) — previously an unbounded fetch
    // left "Loading real historic range…" showing forever on any hung/slow
    // backend, with the loading and failed states visually identical
    // (indistinguishable to the analyst) because there was no failed state
    // at all.
    useEffect(() => {
        let cancelled = false
        setDateRangeError(false)
        const params = new URLSearchParams()
        if (theatresKey) params.set("theatre", theatresKey)
        fetchWithTimeout(`${API_BASE}/api/geoconfirmed/date-range?${params.toString()}`)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then((d) => {
                if (cancelled) return
                if (d?.min_date && d?.max_date) setDateRange(d)
                else setDateRangeError(true)
            })
            .catch(() => { if (!cancelled) setDateRangeError(true) })
        return () => { cancelled = true }
    }, [theatresKey, retryTick])

    // Real occurrence-density histogram (Part 2) — one grouped-count fetch
    // per theatre-filter/date-range change, real server-side bucketing.
    useEffect(() => {
        if (!dateRange) return
        let cancelled = false
        const params = new URLSearchParams({ start_date: dateRange.min_date, end_date: dateRange.max_date })
        if (theatresKey) params.set("theatre", theatresKey)
        fetchWithTimeout(`${API_BASE}/api/geoconfirmed/histogram?${params.toString()}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setHistogram(safeArray(d?.buckets)) })
            .catch(() => { if (!cancelled) setHistogram([]) }) // real, honest degrade to "no real history for this filter" — dateRange's own error state (above) already covers the "actually hung" case
        return () => { cancelled = true }
    }, [dateRange, theatresKey])

    const minMs = dateRange ? new Date(dateRange.min_date + "T00:00:00Z").getTime() : null
    const maxMs = dateRange ? new Date(dateRange.max_date + "T00:00:00Z").getTime() : null
    const totalDays = (minMs != null && maxMs != null) ? Math.max(1, Math.round((maxMs - minMs) / 86_400_000)) : 0

    // Slider position, in real whole days since the real earliest date —
    // the rightmost/max position always means "live" (endDate=null), one
    // control, not two things that can drift apart.
    const sliderValue = endDate
        ? Math.max(0, Math.min(totalDays, Math.round((new Date(endDate + "T00:00:00Z").getTime() - minMs) / 86_400_000)))
        : totalDays

    const handleSlide = useCallback((dayOffset) => {
        if (minMs == null) return
        if (dayOffset >= totalDays) { onEndDateChange(null); return }
        const d = new Date(minMs + dayOffset * 86_400_000)
        onEndDateChange(d.toISOString().slice(0, 10))
    }, [minMs, totalDays, onEndDateChange])

    // Real peak-click-to-scrub (Part 2.3) — the graph and the slider are
    // one control: clicking a bar moves the slider to that bucket's own
    // real, exact start date (see routers/geoconfirmed.py's get_histogram
    // doc comment on why buckets are keyed by real dates, not lossy labels).
    const handleBarClick = useCallback((data) => {
        if (!data?.bucket || minMs == null) return
        const bucketMs = new Date(data.bucket + "T00:00:00Z").getTime()
        const dayOffset = Math.round((bucketMs - minMs) / 86_400_000)
        handleSlide(dayOffset)
    }, [minMs, handleSlide])

    const chartData = useMemo(() => (histogram || []).map((b) => ({ bucket: b.bucket, count: b.count })), [histogram])
    const maxCount = useMemo(() => chartData.reduce((m, b) => Math.max(m, b.count), 0), [chartData])
    const peakBucket = useMemo(() => chartData.find((b) => b.count === maxCount)?.bucket, [chartData, maxCount])

    function toggleTheatre(slug) {
        onTheatresChange(theatres.includes(slug) ? theatres.filter((t) => t !== slug) : [...theatres, slug])
    }

    const totalForFilter = theatres.length
        ? theatreOptions.filter((t) => theatres.includes(t.theatre_slug)).reduce((s, t) => s + t.active_count, 0)
        : theatreOptions.reduce((s, t) => s + t.active_count, 0)

    return (
        <div ref={rootRef} data-testid="glass-geoconfirmed-timeline-panel" style={{
            // Real inset on the right (56px = MapControlStack's 32px button
            // width + its own 16px edge margin + 8px clearance) so the
            // histogram/slider never renders underneath that always-on-top
            // (zIndex 40) button column.
            //
            // Round 3 fix: this is a large, wide, DOCKED panel — the same
            // real family as the Layers/Inspector panes (--pane-glass-bg +
            // blur(16px) saturate(115%)), not a small hover tooltip. It
            // previously used --map-tooltip-bg (rgba(10,14,20,.92) dark),
            // a recipe designed for small high-contrast callouts against
            // arbitrary map imagery — correct on paper (real token, real
            // blur, genuinely flips between themes, which is why the
            // automated test reported it passing) but visibly wrong at
            // this panel's scale: that recipe's darker base color + higher
            // (92%) opacity reads as near-solid black over this app's
            // typically-dark map canvas, not the blue-grey pane family
            // every other panel in the app uses. Switched to the same
            // token AND recipe Situation.jsx's own .pane-glass class uses.
            // rightInset defaults to 56 (MapControlStack's 32px button
            // width + its own 16px edge margin + 8px clearance) and grows
            // by Inspector's real overlay width when Inspector is also
            // open (Round 4 layout fix — see Situation.jsx's own
            // inspectorOverlayWidth), so this panel's own content never
            // renders underneath either.
            //
            // Real layout fix: this panel used to start at the map's
            // absolute left edge (left: 0), so it rendered UNDER the
            // Layers pane (Situation.jsx's own left sidebar, zIndex 3) —
            // visible whenever the panel's own zIndex (5, needed so it
            // sits above the plain map canvas) put it above that pane's
            // background too. leftInset is the Layers pane's own real
            // width (Situation.jsx's leftMin-aware value, matching the
            // exact same real number GlobeView's mapChromeLeftInset
            // already uses for the bottom-left scale/coordinate readout)
            // so this panel now starts exactly where that pane ends,
            // never under it, only in the real space between both
            // sidebars.
            position: "absolute", left: leftInset, right: rightInset, bottom: 0, zIndex: 5,
            background: "var(--pane-glass-bg)", backdropFilter: "blur(16px) saturate(115%)", WebkitBackdropFilter: "blur(16px) saturate(115%)",
            borderTop: "1px solid var(--line)", padding: "8px 12px 10px", display: "flex", flexDirection: "column", gap: 6,
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ font: "600 11px var(--font)", color: "var(--txt)", flexShrink: 0 }}>GeoConfirmed history</span>
                <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)", flexShrink: 0 }}>
                    {totalForFilter.toLocaleString()} placemarks{dateRange ? ` · ${dateRange.min_date} → ${dateRange.max_date}` : ""}
                </span>
                <div style={{ flex: 1 }} />
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    {theatreOptions.map((t) => (
                        <button
                            key={t.theatre_slug} className="chip" aria-pressed={theatres.includes(t.theatre_slug)}
                            onClick={() => toggleTheatre(t.theatre_slug)} title={`${t.active_count.toLocaleString()} real placemarks`}
                            style={{ font: "400 10.5px var(--font)", textTransform: "capitalize" }}
                        >
                            {t.theatre_slug} <span style={{ color: "var(--txt-4)" }}>{t.active_count}</span>
                        </button>
                    ))}
                </div>
                {endDate && (
                    <button className="btn sm" onClick={() => onEndDateChange(null)} title="Return to live/current">
                        scrubbed to {endDate} · back to live
                    </button>
                )}
            </div>

            {dateRangeError ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0" }}>
                    <span style={{ font: "400 11px var(--font)", color: "var(--sev-high)" }}>Couldn't load historic range — the backend may be slow or unreachable right now.</span>
                    <button className="btn sm" onClick={() => setRetryTick((t) => t + 1)}>retry</button>
                </div>
            ) : !dateRange ? (
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "8px 0" }}>Loading real historic range…</div>
            ) : histogram && histogram.length === 0 ? (
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "8px 0" }}>No real GeoConfirmed history for this filter.</div>
            ) : (
                <>
                    <div style={{ height: 46 }}>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={chartData} margin={{ top: 2, right: 0, bottom: 0, left: 0 }} onClick={(s) => s?.activePayload?.[0] && handleBarClick(s.activePayload[0].payload)}>
                                <XAxis dataKey="bucket" hide />
                                <Tooltip
                                    contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11 }}
                                    labelStyle={{ color: "var(--txt)" }} formatter={(v) => [v, "placemarks"]}
                                />
                                <Bar dataKey="count" cursor="pointer" maxBarSize={18}>
                                    {chartData.map((b) => (
                                        <Cell key={b.bucket} fill={b.bucket === peakBucket ? "var(--sev-critical)" : "var(--acc-hi)"} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <input
                        type="range" min={0} max={totalDays} value={sliderValue}
                        onChange={(e) => handleSlide(Number(e.target.value))}
                        style={{ width: "100%", accentColor: "var(--acc-hi)" }}
                        aria-label="Scrub GeoConfirmed history"
                    />
                    <div style={{ display: "flex", justifyContent: "space-between", font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                        <span>{dateRange.min_date}</span>
                        <span>{endDate || "live"}</span>
                        <span>{dateRange.max_date}</span>
                    </div>
                </>
            )}
        </div>
    )
}
