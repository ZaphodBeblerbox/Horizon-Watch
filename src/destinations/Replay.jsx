/**
 * Replay.jsx — Build spec v2 §8.7 (cross-module behaviors §9). A real
 * timeline-scrubbing/playback view over a real, bounded window of real
 * signals (GET /api/analytics/timeline — the same real Alert/NewsArticle/
 * SentinelDetection normalization + domain/region classification Analytics'
 * own /overview endpoint already established; no second parallel
 * data/classification path). Replaces the old "Director Mode" module slot.
 *
 * Zero Math.random() anywhere on this page — lane contents, the bounded
 * window, and every group are pure functions of the real fetched data, so a
 * reload against the same data reproduces byte-identical lanes.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import { replayOnMap } from "../services/replayOnMap.js"
import LocatorMiniMap from "../globe/LocatorMiniMap.jsx"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"

const API = API_BASE
const WINDOW_HOURS = 168 // real bounded window — 7 days, matching Analytics' own shortest real "range" option
const TICK_COUNT = 13
const SEV_ORDER = ["critical", "high", "moderate", "low"]
const SEV_LABEL = { critical: "Critical", high: "High", moderate: "Moderate", low: "Low" }
const DOMAIN_GROUPS = [
    { key: "maritime", label: "Maritime", icon: "i-ship" },
    { key: "air", label: "Air", icon: "i-plane" },
    { key: "news", label: "News", icon: "i-read" },
    { key: "imagery", label: "Imagery", icon: "i-sat" },
    { key: "zones", label: "Zones", icon: "i-target" },
]
const SEVERITY_GROUPS = SEV_ORDER.map((k) => ({ key: k, label: SEV_LABEL[k] }))
const GROUP_BYS = [
    { key: "region", label: "Region" },
    { key: "domain", label: "Domain" },
    { key: "severity", label: "Severity" },
]
const SPEEDS = [1, 4, 12]
const TICK_MS = 40
function fmtTickLabel(ms) {
    const d = new Date(ms)
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}Z`
}
function fmtCursorLabel(ms) {
    if (ms == null) return "—"
    const d = new Date(ms)
    const p = (n) => String(n).padStart(2, "0")
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}Z`
}
function timeAgoShort(ms, nowMs) {
    const diffMin = Math.floor((nowMs - ms) / 60000)
    if (diffMin < 1) return "just now"
    if (diffMin < 60) return `${diffMin}m ago`
    const h = Math.floor(diffMin / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}


export default function Replay({ isVisible = true }) {
    const [signals, setSignals] = useState(null) // null = loading; [] = real empty
    const [groupBy, setGroupBy] = useState("domain")
    const [selected, setSelected] = useState(null)
    // V3 Phase 1, §2.2 — real hook-based extension point, owned and called
    // by this component itself (never reassigned from outside).
    const inspectorExtensions = useInspectorExtensions()
    const [t, setT] = useState(0) // 0..1 fraction of the real bounded window
    const [playing, setPlaying] = useState(false)
    const [speed, setSpeed] = useState(4)
    const [deviceLoc, setDeviceLoc] = useState(null)
    const scrubbingRef = useRef(false)

    useEffect(() => {
        let cancelled = false
        fetch(`${API}/api/analytics/timeline?hours=${WINDOW_HOURS}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setSignals(Array.isArray(d?.signals) ? d.signals : []) })
            .catch(() => { if (!cancelled) setSignals([]) })
        return () => { cancelled = true }
    }, [])

    // Real device geolocation — first tier of the minimap's honest fallback
    // order when nothing is selected. There is no real stored analyst
    // profile location field in this codebase (checked src/constants/
    // profile.js's emptyProfile() before building this — none exists), so
    // that middle tier is genuinely skipped rather than backed by a
    // fabricated field; the final tier is the honest empty state above.
    useEffect(() => {
        if (!navigator.geolocation) return
        navigator.geolocation.getCurrentPosition(
            (pos) => setDeviceLoc({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => {},
        )
    }, [])

    // Playback tick — exact literal formula, timer-driven (setInterval), never
    // rAF/d3-routed: on each 40ms tick, t += 0.0016 x speed.
    useEffect(() => {
        if (!playing) return
        const id = setInterval(() => {
            setT((prev) => {
                const next = prev + 0.0016 * speed
                if (next >= 1) { setPlaying(false); return 1 }
                return next
            })
        }, TICK_MS)
        return () => clearInterval(id)
    }, [playing, speed])

    // Playback must pause the instant the analyst navigates away from this
    // module — verified live via CDP (console-instrumented interval count),
    // not assumed from the code alone.
    useEffect(() => {
        if (!isVisible) setPlaying(false)
    }, [isVisible])

    const rows = useMemo(() => {
        if (!signals) return []
        return signals
            .map((s) => ({ ...s, ts: new Date(s.created_at).getTime() }))
            .filter((s) => Number.isFinite(s.ts))
    }, [signals])

    const { t0, t1 } = useMemo(() => {
        if (!rows.length) return { t0: null, t1: null }
        let lo = rows[0].ts, hi = rows[0].ts
        for (const r of rows) { if (r.ts < lo) lo = r.ts; if (r.ts > hi) hi = r.ts }
        return { t0: lo, t1: hi === lo ? lo + 1 : hi }
    }, [rows])

    const cursorMs = t0 != null ? t0 + t * (t1 - t0) : null
    const nowMs = Date.now()

    const regionGroups = useMemo(() => {
        const set = new Set(rows.map((r) => r.region).filter(Boolean))
        return Array.from(set).sort().map((r) => ({ key: r, label: r }))
    }, [rows])

    const groupDefs = groupBy === "region" ? regionGroups : groupBy === "severity" ? SEVERITY_GROUPS : DOMAIN_GROUPS

    const lanes = useMemo(() => {
        return groupDefs.map((g) => ({ ...g, items: rows.filter((r) => r[groupBy] === g.key) }))
    }, [groupDefs, rows, groupBy])

    const ticks = useMemo(() => {
        if (t0 == null) return []
        return Array.from({ length: TICK_COUNT }, (_, i) => {
            const frac = i / (TICK_COUNT - 1)
            return { pct: frac * 100, ms: t0 + frac * (t1 - t0) }
        })
    }, [t0, t1])

    const shownCount = cursorMs == null ? 0 : rows.filter((r) => r.ts <= cursorMs).length

    const recentAtCursor = useMemo(() => {
        if (cursorMs == null) return []
        return rows.filter((r) => r.ts <= cursorMs).sort((a, b) => b.ts - a.ts).slice(0, 8)
    }, [rows, cursorMs])

    function handleScrub(e) {
        setPlaying(false)
        setT(Number(e.target.value) / 1000)
    }

    function pctFor(r) {
        if (t0 == null) return 0
        return ((r.ts - t0) / (t1 - t0)) * 100
    }

    const minimapFocus = selected || deviceLoc
    const minimapContext = selected ? rows.filter((r) => r.id !== selected.id) : []

    return (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                {/* Toolbar */}
                <div style={{ height: 28, flexShrink: 0, background: "var(--bg-2)", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", gap: 10, padding: "0 10px" }}>
                    <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>Group by</span>
                    <div className="seg">
                        {GROUP_BYS.map((g) => (
                            <button key={g.key} aria-pressed={groupBy === g.key} onClick={() => setGroupBy(g.key)}>{g.label}</button>
                        ))}
                    </div>
                    <span style={{ marginLeft: "auto", font: "400 11.5px var(--mono)", color: "var(--txt-2)" }}>{fmtCursorLabel(cursorMs)}</span>
                </div>

                {/* Ruler + lanes */}
                {t0 == null ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--txt-4)", font: "400 12px var(--font)" }}>
                        {signals == null ? "Loading real signals…" : "No real signals with a position in the last 7 days."}
                    </div>
                ) : (
                    <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
                        <div style={{ position: "relative" }}>
                            {/* Ruler */}
                            <div style={{ height: 28, display: "flex", position: "sticky", top: 0, background: "var(--bg-1)", zIndex: 2, borderBottom: "1px solid var(--line)" }}>
                                <div style={{ width: 128, flexShrink: 0 }} />
                                <div style={{ flex: 1, position: "relative" }}>
                                    {ticks.map((tk, i) => (
                                        <span key={i} style={{ position: "absolute", left: `${tk.pct}%`, top: 6, transform: i === 0 ? "none" : i === TICK_COUNT - 1 ? "translateX(-100%)" : "translateX(-50%)", font: "400 10px var(--mono)", color: "var(--txt-4)", whiteSpace: "nowrap" }}>
                                            {fmtTickLabel(tk.ms)}
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Lanes */}
                            {lanes.map((lane) => (
                                <div key={lane.key} style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
                                    <div style={{ width: 128, flexShrink: 0, position: "sticky", left: 0, background: "var(--bg-1)", zIndex: 1, padding: "6px 10px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
                                        <span style={{ font: "400 11.5px var(--font)", color: "var(--txt-2)" }}>{lane.label}</span>
                                        <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>{lane.items.length}</span>
                                    </div>
                                    <div style={{ flex: 1, position: "relative", height: 34 }}>
                                        {lane.items.map((r) => {
                                            const isSel = selected?.id === r.id
                                            const after = cursorMs != null && r.ts > cursorMs
                                            return (
                                                <div
                                                    key={r.id}
                                                    role="button"
                                                    title={r.title}
                                                    onClick={() => setSelected(r)}
                                                    style={{
                                                        position: "absolute", left: `${pctFor(r)}%`, top: "50%",
                                                        width: 10, height: 10, marginLeft: -5, marginTop: -5,
                                                        transform: `translateY(-50%) rotate(45deg) scale(${isSel ? 1.4 : 1})`,
                                                        background: `var(--sev-${r.severity})`,
                                                        outline: isSel ? "1.5px solid #fff" : "none",
                                                        opacity: after ? 0.22 : 1,
                                                        cursor: "pointer",
                                                        transition: "transform 120ms ease",
                                                    }}
                                                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.transform = "translateY(-50%) rotate(45deg) scale(1.4)" }}
                                                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.transform = "translateY(-50%) rotate(45deg) scale(1)" }}
                                                />
                                            )
                                        })}
                                    </div>
                                </div>
                            ))}

                            {/* Playhead — 1px amber line + triangular head */}
                            <div style={{ position: "absolute", top: 0, bottom: 0, left: `calc(128px + (100% - 128px) * ${t})`, width: 0, pointerEvents: "none", zIndex: 3 }}>
                                <div style={{ position: "absolute", top: 0, left: -5, width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "6px solid var(--warn)" }} />
                                <div style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: 1, background: "var(--warn)" }} />
                            </div>
                        </div>
                    </div>
                )}

                {/* Transport */}
                <div style={{ height: 44, flexShrink: 0, borderTop: "1px solid var(--line)", background: "var(--bg-2)", display: "flex", alignItems: "center", gap: 12, padding: "0 12px" }}>
                    <button
                        className="btn sm"
                        onClick={() => setPlaying((p) => !p)}
                        disabled={t0 == null}
                        title={playing ? "Pause" : "Play"}
                        style={{ display: "flex", alignItems: "center", gap: 5 }}
                    >
                        <svg className="icon sm"><use href={playing ? "#i-pause" : "#i-play"} /></svg>
                    </button>
                    <input
                        type="range" min={0} max={1000} step={1}
                        value={Math.round(t * 1000)}
                        onChange={handleScrub}
                        disabled={t0 == null}
                        style={{ flex: 1 }}
                        className="replay-scrub"
                    />
                    <div className="seg">
                        {SPEEDS.map((s) => (
                            <button key={s} aria-pressed={speed === s} onClick={() => setSpeed(s)}>{s}×</button>
                        ))}
                    </div>
                    <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)", whiteSpace: "nowrap" }}>{shownCount} shown</span>
                </div>
            </div>

            {/* Right pane */}
            <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto", padding: 12 }}>
                <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                    <LocatorMiniMap focus={minimapFocus} context={minimapContext} height={196} />
                </div>

                {selected ? (
                    <div style={{ marginTop: 12 }}>
                        <span role="button" tabIndex={0} onClick={() => setSelected(null)} style={{ font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer" }}>← Back</span>
                        <div className={`sev ${selected.severity}`} style={{ marginTop: 10 }}>
                            <span className={`dia ${selected.severity}`} />
                            <span>{SEV_LABEL[selected.severity] || selected.severity}</span>
                            <span style={{ marginLeft: "auto", color: "var(--txt-4)" }}>{timeAgoShort(selected.ts, nowMs)}</span>
                        </div>
                        <div style={{ font: "600 14px var(--font)", color: "var(--txt)", margin: "8px 0" }}>{selected.title || "(untitled)"}</div>
                        <div className="card">
                            <span className="lbl">Signal</span>
                            <dl className="kv">
                                <dt>Domain</dt><dd style={{ textTransform: "capitalize" }}>{selected.domain}</dd>
                                <dt>Region</dt><dd>{selected.region}</dd>
                                <dt>Source</dt><dd>{selected.source}</dd>
                                <dt>Time</dt><dd style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{fmtCursorLabel(selected.ts)}</dd>
                            </dl>
                        </div>
                        <button className="btn sm primary" style={{ width: "100%" }} onClick={() => replayOnMap({ ...selected, publishedAt: selected.created_at })}>
                            Replay on map
                        </button>
                        {inspectorExtensions.map((Ext, i) => (
                            <Ext key={i} recordRef={selected.id ? `sig:${selected.id}` : null} record={selected} />
                        ))}
                    </div>
                ) : (
                    <div style={{ marginTop: 12 }}>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>Recent signals at cursor</div>
                        {recentAtCursor.length === 0 ? (
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No real signals at or before this point yet.</div>
                        ) : recentAtCursor.map((r) => (
                            <div key={r.id} className="evrow" onClick={() => setSelected(r)}>
                                <span className={`dia ${r.severity}`} />
                                <div>
                                    <div className="title">{r.title || "(untitled)"}</div>
                                    <div className="meta"><span>{r.region}</span><span>·</span><span style={{ textTransform: "capitalize" }}>{r.domain}</span></div>
                                </div>
                                <span className="time">{timeAgoShort(r.ts, nowMs)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <style>{`
                .replay-scrub { -webkit-appearance: none; appearance: none; height: 4px; background: var(--bg-4); border-radius: 2px; outline: none; }
                .replay-scrub::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; border-radius: 50%; background: var(--warn); cursor: pointer; }
                .replay-scrub::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--warn); border: none; cursor: pointer; }
            `}</style>
        </div>
    )
}
