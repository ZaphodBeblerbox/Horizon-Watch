/**
 * Insight.jsx — PARALLAX v6, Part B ▣ Insight.
 *
 * ONE SURFACE, THREE TABS, in the spec's order: what changed, risk
 * ranking, what happens next. They are tabs and not three rail modes
 * because they are three readings of the same question — is this getting
 * worse — and splitting them put "Analytics" and "Forecast" behind
 * separate icons that nobody could choose between.
 *
 * WHAT THE NUMBERS ACTUALLY ARE. The spec's risk tab says "risk index".
 * We do not compute one. What the backend has is signals per region
 * against that region's own prior window, which is a measure of ATTENTION,
 * not of danger — a quiet war scores lower than a noisy election. The
 * column is therefore labelled signal volume and the header says so.
 * Printing a count under the word "risk" would be the single most
 * misleading thing this screen could do.
 *
 * The forecast tab is the real model: scenarios with their own
 * probability, the base rate they are measured against, the indicators
 * that would move them, and the model's own record — which is empty, and
 * says so.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { splitByTheater, boardCountry } from "../data/theaterScope.js"
import { MODE_SURFACE } from "../plx6/modeWindow.js"

const safeArray = (v) => (Array.isArray(v) ? v : [])
const ON = "var(--accdim)"

const Icon = ({ href, size = 16, color = null }) => (
    <svg width={size} height={size} style={color ? { color } : null} aria-hidden><use href={href} /></svg>
)

const EYEBROW = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const CARD = {
    border: "1px solid var(--gline)", background: "var(--glass2)",
    borderRadius: 0, overflow: "hidden",
}

function Seg({ options, value, onChange }) {
    return (
        <div style={{ display: "flex", border: "1px solid var(--gline2)", borderRadius: 0, overflow: "hidden" }}>
            {options.map(([k, v]) => (
                <button key={v} onClick={() => onChange(v)} style={{
                    height: 26, padding: "0 10px", border: 0,
                    background: value === v ? ON : "transparent",
                    color: value === v ? "var(--txt)" : "var(--txt3)",
                    font: "inherit", cursor: "pointer",
                }}>{k}</button>
            ))}
        </div>
    )
}

export default function Insight({ onOpenModule = () => {}, onFocusSignal = () => {}, theaterKey = null }) {
    const [tab, setTab] = useState("changes")
    const [since, setSince] = useState("30d")
    // A retry has to change something the effect depends on; setSince to
    // the value it already holds is a no-op React bails out of.
    const [reload, setReload] = useState(0)
    const [hz, setHz] = useState(14)
    const [ov, setOv] = useState(null)
    const [boards, setBoards] = useState([])
    const [board, setBoard] = useState(null)
    const [boardId, setBoardId] = useState(null)
    const [err, setErr] = useState(null)

    /* THE WINDOW PICKER REFETCHES. It started as three buttons that
       changed a label and nothing else, which is worse than not offering
       the choice — it answers "last 24h" with thirty days of rows. The
       endpoint takes ?range, so it is passed. */
    useEffect(() => {
        const opts = { credentials: "include" }
        setOv(null); setErr(null)
        fetch(`${API_BASE}/api/analytics/overview?range=${encodeURIComponent(since)}`, opts)
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(setOv).catch((e) => setErr(e.message))
    }, [since, reload])

    useEffect(() => {
        const opts = { credentials: "include" }
        fetch(`${API_BASE}/api/forecast/boards`, opts)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setBoards(safeArray(d?.boards ?? d)))
            .catch(() => {})
    }, [])

    /* WHICH BOARD, AND WHY THAT ONE.
       This used to fetch boards[0] and only boards[0] — which is Ukraine,
       every time, for every theater. There are forty boards; the one worth
       opening is the one the theater you are standing in is about. */
    const { scope, inScope, other } = useMemo(
        () => splitByTheater(boards, theaterKey), [boards, theaterKey])

    useEffect(() => {
        if (!boards.length) return
        const want = inScope[0] || boards[0]
        if (want && !boards.some((b) => b.id === boardId)) setBoardId(want.id)
    }, [boards, inScope, boardId])

    useEffect(() => {
        if (!boardId) return undefined
        let live = true
        setBoard(null)
        fetch(`${API_BASE}/api/forecast/boards/${boardId}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((b) => { if (live) setBoard(b) })
            .catch(() => {})
        return () => { live = false }
    }, [boardId])

    const movers = useMemo(() => {
        const m = safeArray(ov?.movers).filter((x) => x.label)
        return [...m].sort((a, b) => (b.current || 0) - (a.current || 0))
    }, [ov])

    const top = safeArray(ov?.top_signals)

    /* ── header ───────────────────────────────────────────────────── */
    const TABS = [["What changed", "changes"], ["Risk ranking", "risk"], ["What happens next", "forecast"]]

    const body = () => {
        /* THE OVERVIEW IS NOT THE WHOLE SCREEN.
           A failed /api/analytics/overview used to blank all three tabs
           with "Insight is unavailable", including What happens next —
           which is built from the forecast boards and never touches the
           overview at all. A cold overview takes seconds to compute and
           can exceed the client's timeout, so this is a state the screen
           will reach in normal use, not an exotic failure. */
        if (tab !== "forecast") {
            if (err) {
                return (
                    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-start" }}>
                        <b style={{ fontWeight: 600 }}>This window did not come back.</b>
                        <span style={{ color: "var(--txt3)", maxWidth: 620, textWrap: "pretty" }}>
                            {err}. The {since} window is computed on demand and the first request for a
                            window can take longer than the client waits. Try it again, or read a window
                            that has already been built.
                        </span>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button onClick={() => setReload((n) => n + 1)} style={{
                                height: 28, padding: "0 12px", border: 0, background: "var(--acc)",
                                color: "var(--mz-cream)", font: "inherit", fontWeight: 600,
                                cursor: "pointer", borderRadius: 0,
                            }}>Try again</button>
                            <button onClick={() => setTab("forecast")} style={{
                                height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
                                background: "transparent", color: "var(--txt2)", font: "inherit",
                                cursor: "pointer", borderRadius: 0,
                            }}>What happens next →</button>
                        </div>
                    </div>
                )
            }
            if (!ov) return <Loading size={20} inline label="Reading the record" style={{ padding: 16 }} />
        }

        if (tab === "changes") {
            const rows = top.slice(0, 14)
            return (
                <>
                    <div style={{ display: "flex", alignItems: "flex-end", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
                        <h3 style={{
                            margin: 0, fontWeight: 600, fontSize: 28, lineHeight: 1.05,
                            letterSpacing: "-.01em", textWrap: "balance",
                        }}>
                            {rows.length} {rows.length === 1 ? "signal" : "signals"} worth a second look, last {since}
                        </h3>
                        <div style={{ flex: 1 }} />
                        <Seg options={[["24 h", "24h"], ["7 d", "7d"], ["30 d", "30d"]]} value={since} onChange={setSince} />
                    </div>
                    <div style={CARD}>
                        {rows.map((r) => (
                            <div key={r.id} style={{
                                display: "grid",
                                gridTemplateColumns: "46px minmax(0,1fr) auto auto",
                                gap: "3px 14px", alignItems: "center", padding: "12px 14px",
                                borderBottom: "1px solid var(--gline)",
                            }}>
                                {/* created_at, not occurred_at — the latter
                                    is not on this payload, so the column was
                                    a row of em dashes. Date AND time, because
                                    over a 30-day window a bare clock reading
                                    says nothing about which day it was. */}
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                    color: "var(--txt4)", lineHeight: 1.3,
                                }}>
                                    {r.created_at
                                        ? <>{r.created_at.slice(5, 10)}<br />{r.created_at.slice(11, 16)}</>
                                        : "—"}
                                </span>
                                <span style={{ textWrap: "pretty" }}>{r.title}</span>
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 10, padding: "2px 7px",
                                    borderRadius: 0, background: "var(--hov)", whiteSpace: "nowrap",
                                    color: r.severity === "critical" ? "var(--red)"
                                        : r.severity === "high" ? "var(--amber)" : "var(--txt3)",
                                }}>{r.severity}</span>
                                <button onClick={() => onFocusSignal(r)} style={{
                                    border: 0, background: "transparent", color: "var(--acchi)",
                                    font: "inherit", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap",
                                }}>map →</button>
                                <span />
                                <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                                    {[r.region, r.domain].filter(Boolean).join(" · ")}
                                </span>
                            </div>
                        ))}
                        {rows.length === 0 && (
                            <div style={{ padding: "16px 14px", color: "var(--txt3)" }}>
                                No recorded change in this scope for the selected window.
                            </div>
                        )}
                    </div>
                </>
            )
        }

        if (tab === "risk") {
            const first = movers[0]
            const mx = Math.max(1, ...movers.map((m) => m.current || 0))
            const fastest = [...movers].sort((a, b) => Math.abs(b.delta || 0) - Math.abs(a.delta || 0)).slice(0, 4)
            return (
                <>
                    <div style={{
                        display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)",
                        gap: 14, marginBottom: 14,
                    }}>
                        <div style={{ ...CARD, padding: "18px 18px 16px", display: "flex", flexDirection: "column", gap: 8 }}>
                            <span style={EYEBROW}>Busiest region right now</span>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                                <h3 style={{
                                    margin: 0, fontWeight: 600, fontSize: 30, lineHeight: 1.05, letterSpacing: "-.01em",
                                }}>{first?.label || "—"}</h3>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 28, color: "var(--red)" }}>
                                    {(first?.current ?? 0).toLocaleString()}
                                </span>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 12, color: "var(--red)" }}>
                                    {first?.delta > 0 ? "+" : ""}{(first?.delta ?? 0).toLocaleString()}
                                </span>
                            </div>
                            <span style={{ color: "var(--txt2)" }}>
                                Signals recorded in this region over {ov.range}, against the window before it.
                                This counts attention, not danger — a quiet war scores lower than a noisy election.
                            </span>
                            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                                <button onClick={() => setTab("forecast")} style={{
                                    height: 28, padding: "0 12px", border: 0, background: "var(--acc)",
                                    color: "var(--mz-cream)", font: "inherit", fontWeight: 600,
                                    cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
                                }}>What happens next →</button>
                                <button onClick={() => onOpenModule("map")} style={{
                                    height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
                                    background: "transparent", color: "var(--txt2)", font: "inherit",
                                    cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
                                }}>Show on map</button>
                            </div>
                        </div>
                        <div style={{ ...CARD, padding: 18, display: "flex", flexDirection: "column", gap: 8 }}>
                            <span style={EYEBROW}>Moving fastest · {ov.range}</span>
                            {fastest.map((m) => (
                                <div key={m.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                    <span style={{
                                        flex: 1, minWidth: 0, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{m.label}</span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 11,
                                        color: (m.delta || 0) > 0 ? "var(--red)" : "var(--acchi)",
                                    }}>{(m.delta || 0) > 0 ? "+" : ""}{(m.delta ?? 0).toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div style={CARD}>
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "26px minmax(0,1.3fr) minmax(0,1fr) 72px minmax(0,1.4fr)",
                            gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--gline)",
                            ...EYEBROW, fontSize: 9,
                        }}>
                            <span>#</span><span>Region</span><span>Signal volume</span>
                            <span>Δ window</span><span>Share of all signals</span>
                        </div>
                        {movers.map((m, i) => {
                            const pct = Math.round(((m.current || 0) / mx) * 100)
                            const share = ov.kpis?.signals_ingested?.value
                                ? ((m.current || 0) / ov.kpis.signals_ingested.value * 100).toFixed(1) + "%"
                                : "—"
                            return (
                                <div key={m.key} style={{
                                    display: "grid",
                                    gridTemplateColumns: "26px minmax(0,1.3fr) minmax(0,1fr) 72px minmax(0,1.4fr)",
                                    gap: 12, alignItems: "center", padding: "10px 14px",
                                    borderBottom: "1px solid var(--gline)",
                                }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{i + 1}</span>
                                    <b style={{
                                        fontWeight: 600, overflow: "hidden",
                                        textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{m.label}</b>
                                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                        <i style={{ flex: 1, height: 4, background: "var(--gline)" }}>
                                            <i style={{
                                                display: "block", height: 4, width: `${pct}%`,
                                                background: pct >= 70 ? "var(--red)" : pct >= 40 ? "var(--amber)" : "var(--txt3)",
                                            }} />
                                        </i>
                                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11 }}>
                                            {(m.current ?? 0).toLocaleString()}
                                        </span>
                                    </span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 11,
                                        color: (m.delta || 0) > 0 ? "var(--red)" : (m.delta || 0) < 0 ? "var(--acchi)" : "var(--txt3)",
                                    }}>{(m.delta || 0) > 0 ? "+" : ""}{(m.delta ?? 0).toLocaleString()}</span>
                                    <span style={{ fontSize: 11, color: "var(--txt3)" }}>{share}</span>
                                </div>
                            )
                        })}
                    </div>
                </>
            )
        }

        /* ── what happens next ────────────────────────────────────── */
        const scenarios = safeArray(board?.scenarios)
        const outs = scenarios.map((sc) => ({
            t: sc.label, p: Math.round((sc.p ?? 0) * 100),
            base: Math.round((sc.base ?? 0) * 100), note: sc.note,
            ind: safeArray(sc.indicators),
        })).sort((a, b) => b.p - a.p)
        const scaled = (p) => Math.round(100 * (1 - Math.pow(1 - p / 100, hz / 90)))

        const Pill = ({ b, on }) => (
            <button key={b.id} onClick={() => setBoardId(b.id)} style={{
                height: 26, padding: "0 10px", borderRadius: 0,
                border: `1px solid ${on ? "var(--acchi)" : "var(--gline2)"}`,
                background: on ? ON : "transparent",
                color: on ? "var(--txt)" : "var(--txt3)",
                font: "inherit", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap",
            }}>{boardCountry(b)}</button>
        )

        return (
            <>
                {/* WHICH BOARDS THIS THEATER IS ABOUT.
                    The in-scope row comes first and is the default; the rest
                    stay reachable, because a theater is where you are
                    looking, not a filter on what you are allowed to see. */}
                <div style={{
                    display: "flex", flexDirection: "column", gap: 8, marginBottom: 18,
                    paddingBottom: 14, borderBottom: "1px solid var(--gline)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={EYEBROW}>{scope ? `${scope.label} · boards` : "Boards"}</span>
                        {inScope.map((b) => <Pill key={b.id} b={b} on={b.id === boardId} />)}
                        {!inScope.length && (
                            <span style={{ fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>
                                No board covers this theater. The model is built on UCDP's recorded
                                conflict history, which only has boards where organised violence has
                                actually been recorded — so a quiet or purely maritime theater has none.
                            </span>
                        )}
                    </div>
                    {scope && (
                        <span style={{ fontSize: 12, color: "var(--txt4)", textWrap: "pretty", maxWidth: 820 }}>
                            {scope.blurb}
                        </span>
                    )}
                    <details>
                        <summary style={{ cursor: "pointer", fontSize: 12, color: "var(--txt3)" }}>
                            All {boards.length} boards
                        </summary>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                            {other.map((b) => <Pill key={b.id} b={b} on={b.id === boardId} />)}
                        </div>
                    </details>
                </div>

                <div style={EYEBROW}>
                    Forecast · next {hz} days
                    {board?.as_of_month ? ` · model as of ${board.as_of_month}` : ""}
                </div>
                <h3 style={{
                    margin: "8px 0 6px", fontWeight: 600, fontSize: 32, lineHeight: 1.05,
                    letterSpacing: "-.01em", textWrap: "balance",
                }}>{board?.question || (boardId ? "Loading this board…" : "No forecast board is loaded.")}</h3>
                {/* `basis` IS A LIST, NOT A SENTENCE. Five separate
                    provenance statements come back as an array, and React
                    renders an array of strings butted together with no
                    separator — "…1989 onwardescalation measured against a
                    12-month trailing baselinemodel skill 0.1776…". Each
                    one is a distinct claim about where the number came
                    from and deserves its own line. */}
                {(() => {
                    const basis = Array.isArray(board?.basis) ? board.basis
                        : board?.basis ? [board.basis]
                        : ["Built from UCDP conflict history; our own live signals are not yet inputs to it."]
                    return (
                        <ul style={{
                            margin: "0 0 18px", padding: 0, listStyle: "none",
                            display: "flex", flexDirection: "column", gap: 4, maxWidth: 940,
                        }}>
                            {basis.map((b, i) => (
                                <li key={i} style={{
                                    display: "flex", gap: 8, color: "var(--txt3)",
                                    fontSize: 12.5, lineHeight: 1.5, textWrap: "pretty",
                                }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--txt4)" }}>·</span>
                                    <span>{b}</span>
                                </li>
                            ))}
                        </ul>
                    )
                })()}

                <div style={{
                    display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
                    gap: 14, alignItems: "start",
                }}>
                    <div style={CARD}>
                        <div style={{ ...EYEBROW, padding: "12px 14px 6px" }}>Most likely outcomes</div>
                        {outs.map((o) => {
                            const p = scaled(o.p)
                            const c = p >= 50 ? "var(--red)" : p >= 25 ? "var(--amber)" : "var(--txt3)"
                            return (
                                <div key={o.t} style={{
                                    display: "grid", gridTemplateColumns: "56px minmax(0,1fr) 16px",
                                    gap: 14, alignItems: "start", padding: "12px 14px",
                                    borderTop: "1px solid var(--gline)",
                                }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 22, lineHeight: 1.1, color: c }}>
                                        {p}%
                                    </span>
                                    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0, paddingTop: 2 }}>
                                        <span style={{ fontSize: 14, lineHeight: 1.45, textWrap: "pretty" }}>{o.t}</span>
                                        <span style={{ display: "block", height: 3, background: "var(--gline)" }}>
                                            <span style={{ display: "block", height: 3, width: `${p}%`, background: c }} />
                                        </span>
                                        {/* The base rate, always. Without it a
                                            probability on an "escalation vs its
                                            own recent rate" target is unreadable:
                                            50% against a 52% base is a forecast of
                                            slightly LESS than usual. */}
                                        <span style={{ fontSize: 11, color: "var(--txt4)" }}>
                                            base rate {o.base}% · {o.p > o.base ? "above" : o.p < o.base ? "below" : "level with"} it
                                        </span>
                                    </div>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", color: "var(--txt3)",
                                        textAlign: "right", paddingTop: 3,
                                    }}>{o.p > o.base ? "↑" : o.p < o.base ? "↓" : "→"}</span>
                                </div>
                            )
                        })}
                        {outs.length === 0 && (
                            <div style={{ padding: "12px 14px", color: "var(--txt3)" }}>
                                No scenarios on this board.
                            </div>
                        )}
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                        <div style={{ ...CARD, padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                            <span style={EYEBROW}>Why</span>
                            {(outs[0]?.note ? [outs[0].note] : []).map((t) => (
                                <div key={t} style={{ display: "flex", gap: 10 }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--acchi)" }}>+</span>
                                    <span style={{ textWrap: "pretty" }}>{t}</span>
                                </div>
                            ))}
                            {board?.caveat && (
                                <div style={{ display: "flex", gap: 10 }}>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--amber)" }}>!</span>
                                    <span style={{ textWrap: "pretty", color: "var(--txt2)" }}>{board.caveat}</span>
                                </div>
                            )}
                        </div>

                        <div style={CARD}>
                            <div style={{ ...EYEBROW, padding: "12px 14px 6px" }}>What to watch for</div>
                            {safeArray(outs[0]?.ind).map(([text, src, dir, w], i) => (
                                <div key={i} style={{
                                    display: "flex", alignItems: "center", gap: 10,
                                    padding: "9px 14px", borderTop: "1px solid var(--gline)",
                                }}>
                                    <span style={{ flex: 1, textWrap: "pretty" }}>{text}</span>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 10, padding: "2px 7px",
                                        background: "var(--hov)", whiteSpace: "nowrap",
                                        color: dir === "up" ? "var(--red)" : dir === "down" ? "var(--acchi)" : "var(--txt3)",
                                    }}>{src} · {Math.round((w || 0) * 100)}%</span>
                                </div>
                            ))}
                        </div>

                        <div style={{ ...CARD, padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={EYEBROW}>This model's record</span>
                            <span style={{ color: "var(--txt2)", textWrap: "pretty" }}>
                                {board?.record?.calibration || "No record yet."}
                            </span>
                        </div>
                    </div>
                </div>
            </>
        )
    }

    return (
        <section data-screen-label="Insight" style={MODE_SURFACE}>
            <div style={{
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                minHeight: 48, boxSizing: "border-box", padding: "6px 10px 6px 16px",
                borderBottom: "1px solid var(--gline)", flex: "none",
            }}>
                <h2 style={{
                    margin: 0, fontWeight: 600, fontSize: 17,
                    letterSpacing: "-.01em", whiteSpace: "nowrap",
                }}>Insight</h2>
                <nav style={{ display: "flex", gap: 2, padding: 2, border: "1px solid var(--gline)", borderRadius: 0 }}>
                    {TABS.map(([k, v]) => (
                        <button key={v} onClick={() => setTab(v)} style={{
                            height: 26, padding: "0 14px", border: 0, borderRadius: 0,
                            background: tab === v ? ON : "transparent",
                            color: tab === v ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", cursor: "pointer", whiteSpace: "nowrap",
                        }}>{k}</button>
                    ))}
                </nav>
                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                    {ov?.generated_at ? `generated ${ov.generated_at.slice(11, 16)}Z` : ""}
                    {ov?.stale ? " · stale" : ""}
                </span>
                <div style={{ flex: 1 }} />
                <button onClick={() => onOpenModule("briefings")} style={{
                    height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
                    background: "transparent", color: "var(--txt)", font: "inherit",
                    cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
                }}>+ briefing</button>
            </div>

            <div style={{
                position: "relative", zIndex: 3, display: "flex", alignItems: "center",
                gap: 10, flexWrap: "wrap", padding: "10px 16px",
                borderBottom: "1px solid var(--gline)", flex: "none",
            }}>
                <span style={EYEBROW}>Scope</span>
                <span style={{
                    display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 10px",
                    border: "1px solid var(--gline)", color: "var(--txt)",
                    fontWeight: 600, whiteSpace: "nowrap",
                }}>
                    <i style={{ width: 7, height: 7, background: "var(--red)" }} />
                    {ov?.region === "all" ? "All regions" : ov?.region || "—"}
                </span>
                <div style={{ flex: 1 }} />
                {tab === "forecast" && (
                    <>
                        <span style={EYEBROW}>Horizon</span>
                        <Seg options={[["7 d", 7], ["14 d", 14], ["30 d", 30]]} value={hz} onChange={setHz} />
                    </>
                )}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 16px 24px" }}>
                {body()}
            </div>
        </section>
    )
}
