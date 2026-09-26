import { useState, useMemo } from "react"
import { useChrome } from "../state/useChrome.js"
import { classifyAll, summarise, ageLabel, STATE } from "../lib/feedHealth.js"
import { useBriefingCount } from "../state/briefingBasket.js"

function Cell({ label, value, mono = true }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "0 10px",
            borderRight: "1px solid var(--line)", height: "100%", flexShrink: 0,
        }}>
            <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>{label}</span>
            <span style={{ font: `400 11px ${mono ? "var(--mono)" : "var(--font)"}`, color: "var(--txt-2)" }}>{value}</span>
        </div>
    )
}

/**
 * StatusBar.jsx — redesign Round 2, §4. Replaces AppFooter.jsx. Every cell
 * is real or omitted, per the ground rule — no randomized fake latency, no
 * "sample corpus" label:
 *   - connection: backend.status from GET /api/health/detailed
 *   - data volume: real sum of every data_sources[].record_count/
 *     vessel_count field present in that same response — not a hardcoded
 *     source list, so it stays honest if sources are added/removed
 *   - latency: backend.ping_ms, actually measured server-side, never
 *     randomized client-side
 *   - tasks: real GET /api/reports/tasks length
 *   - briefing basket: real live count from state/briefingBasket.js
 *   - build: __APP_VERSION__ (package.json's real version, vite.config.js)
 */
export default function StatusBar({ health, taskCount = null }) {
    const briefingCount = useBriefingCount()
    const [feedsOpen, setFeedsOpen] = useState(false)
    // Collapsed, the bar keeps a thin grip rather than disappearing: a bar
    // that vanishes entirely leaves nothing to click to get it back, and
    // the connection state is the thing you most want at a glance.
    const [open, toggleOpen] = useChrome("bottomBar")

    // §33.3 — each adapter reports live | degraded | stale(age) | off, and a
    // stale feed's detectors are SUSPENDED rather than left firing on old
    // data. "The smallest piece of work in the whole spec with the largest
    // effect on whether analysts trust the system."
    const feeds = useMemo(() => summarise(classifyAll(health?.data_sources)), [health])

    const backendStatus = health?.backend?.status
    const connectionLabel = backendStatus === "ok" ? "Connected" : backendStatus === "degraded" ? "Degraded" : backendStatus === "error" ? "Down" : "—"
    const pingMs = health?.backend?.ping_ms
    const dataVolume = Array.isArray(health?.data_sources)
        ? health.data_sources.reduce((sum, s) => {
            const n = s.record_count ?? s.vessel_count ?? s.event_count
            return typeof n === "number" ? sum + n : sum
        }, 0)
        : null

    return (
        <div id="statusbar" className={open ? "" : "collapsed"} style={{
            // Height comes from --status, which the rule in index.html
            // drops to the grip height when this carries .collapsed. Every
            // panel pinned to `bottom: var(--status)` follows automatically
            // — otherwise collapsing the bar leaves a hole where it was.
            height: "var(--status)", flexShrink: 0, background: "var(--bg-2)",
            borderTop: "1px solid var(--line)", display: "flex", alignItems: "stretch",
            overflow: "hidden", transition: "height 140ms var(--ease, ease)",
        }}>
            <button
                onClick={toggleOpen}
                aria-expanded={open}
                aria-label={open ? "Collapse status bar" : "Expand status bar"}
                title={open ? "Collapse status bar" : "Expand status bar"}
                style={{
                    width: 26, flexShrink: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", background: "transparent", border: "none",
                    borderRight: open ? "1px solid var(--line)" : "none",
                    color: "var(--txt-3)", cursor: "pointer", padding: 0,
                }}
            >
                <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
                     style={{ transform: open ? "none" : "rotate(180deg)", transition: "transform 140ms" }}>
                    <path d="M1.5 6.5 L5 3 L8.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
            {open && <>
            <Cell label="Connection" value={connectionLabel} mono={false} />
            {dataVolume != null && <Cell label="Data volume" value={dataVolume.toLocaleString()} />}
            {typeof pingMs === "number" && <Cell label="Latency" value={`${pingMs.toFixed(0)}ms`} />}
            {feeds.total > 0 && (
                <button type="button" className="feedcell" onClick={() => setFeedsOpen((v) => !v)}
                        aria-expanded={feedsOpen}
                        title="Feed health — click for the per-adapter state">
                    <span className="lbl">Feeds</span>
                    <span className="v">
                        <i className="dia" style={{ background: STATE[feeds.worst].color }} />
                        {feeds.counts.live}/{feeds.total} live
                        {feeds.suspended.length > 0 && (
                            <em>· {feeds.suspended.length} suspended</em>
                        )}
                    </span>
                </button>
            )}
            {taskCount != null && <Cell label="Tasks" value={taskCount} />}
            <div style={{ flex: 1 }} />
            <Cell label="Briefing basket" value={briefingCount} />
            <div style={{ display: "flex", alignItems: "center", padding: "0 10px", flexShrink: 0 }}>
                <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>
                    Parallax v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"}
                </span>
            </div>

            {feedsOpen && (
                <div className="feedpop" role="dialog" aria-label="Feed health">
                    <div className="feedpop-head">
                        <b>Feed health</b>
                        <button type="button" onClick={() => setFeedsOpen(false)}>✕</button>
                    </div>
                    {classifyAll(health?.data_sources).map(({ source, state }) => (
                        <div key={source.id} className="feedrow">
                            <i className="dia" style={{ background: state.color }} />
                            <span className="n">{source.name || source.id}</span>
                            <span className="s" style={{ color: state.color }}>
                                {state.key === "stale" ? `stale(${ageLabel(state.age)})` : state.label}
                            </span>
                        </div>
                    ))}
                    {feeds.suspended.length > 0 && (
                        <p className="feednote">
                            {feeds.suspended.length} feed{feeds.suspended.length === 1 ? "" : "s"} suspended.
                            Detectors built on {feeds.suspended.length === 1 ? "it" : "them"} are not firing —
                            what those layers do not show may simply be unreported, not absent.
                        </p>
                    )}
                </div>
            )}
            </>}
        </div>
    )
}
