/**
 * Forecast.jsx — the scenario board (spec addendum F1–F7).
 *
 * THE FOUR RULES ARE THE SPECIFICATION; this is only how they are
 * enforced on screen:
 *
 *   1. the set includes "none of these" — a residual row, dashed and
 *      amber, computed client-side so it moves the moment a proposal
 *      lands, and usually the largest row on the board
 *   2. every bar carries a base-rate tick, because 7% means nothing and
 *      7% against a 2% base rate is a finding
 *   3. every scenario states what to look out for and what would prove
 *      it wrong, before it resolves
 *   4. the model shows its own record — skill, Brier and calibration —
 *      including when it has no record at all
 *
 * Two panes, no inspector: the selected scenario renders BELOW the bars
 * in the main pane, so the distribution and the detail are read together
 * rather than across the screen (F3).
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { pct, rows, departure, tickLeft, barWidth, residualOf } from "./forecastBars.js"

export default function Forecast() {
    const [boards, setBoards] = useState(null)
    const [boardId, setBoardId] = useState(null)
    const [board, setBoard] = useState(null)
    const [error, setError] = useState(null)
    const [sel, setSel] = useState(null)
    const [proposing, setProposing] = useState(false)
    const [local, setLocal] = useState([])     // proposals added this session

    useEffect(() => {
        let dead = false
        fetch(`${API_BASE}/api/forecast/boards?limit=40`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (dead) return
                if (!d?.available) { setError(d?.error || "unavailable"); setBoards([]); return }
                const list = safeArray(d.boards)
                setBoards(list)
                if (list.length) setBoardId((cur) => cur || list[0].id)
            })
            .catch((e) => { if (!dead) setError(String(e.message || e)) })
        return () => { dead = true }
    }, [])

    const load = useCallback((id) => {
        if (!id) return
        setBoard(null); setSel(null); setLocal([])
        fetch(`${API_BASE}/api/forecast/boards/${encodeURIComponent(id)}`,
              { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!d?.available) { setError(d?.error || "unavailable"); return }
                setError(null); setBoard(d)
            })
            .catch((e) => setError(String(e.message || e)))
    }, [])

    useEffect(() => { load(boardId) }, [boardId, load])

    const scenarios = useMemo(
        () => [...safeArray(board?.scenarios), ...local], [board, local])
    const stack = useMemo(() => rows(scenarios), [scenarios])
    const selected = useMemo(
        () => scenarios.find((s) => s.id === sel) || null, [scenarios, sel])

    if (error && !board) return <Empty>Could not load the board — {error}</Empty>
    if (!boards) return <Empty>Reading the model…</Empty>

    return (
        <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--bg-0)" }}>
            {/* ── left pane (F3.1) ─────────────────────────────── */}
            <aside style={{ width: 270, flex: "0 0 270px", borderRight: "1px solid var(--line)",
                            overflow: "auto", minHeight: 0 }}>
                <Head>Forecast<Sub>scenario board</Sub></Head>

                <Sect title="Situation">
                    <select className="input" value={boardId || ""}
                            onChange={(e) => setBoardId(e.target.value)}
                            style={{ width: "100%", font: "400 12px var(--font)" }}>
                        {boards.map((b) => (
                            <option key={b.id} value={b.id}>
                                {b.name} · {b.recent_events} recent
                            </option>
                        ))}
                    </select>
                    {board ? <P>{board.question}</P> : null}
                </Sect>

                {board ? (
                    <>
                        <Sect title="Evidence it rests on">
                            {safeArray(board.basis).map((b, i) => (
                                <div key={i} style={itemS}>{b}</div>
                            ))}
                        </Sect>

                        {/* Rule 4 — including when there is no record yet. */}
                        <Sect title="Model record">
                            <div style={{ display: "flex", gap: 14, marginBottom: 6 }}>
                                <Fig v={board.model?.skill} label="skill vs base rate" />
                                <Fig v={board.model?.brier} label="Brier" />
                                <Fig v={board.record?.n ?? 0} label="resolved" raw />
                            </div>
                            <P>{board.record?.calibration}</P>
                            {safeArray(board.model?.reliability).length ? (
                                <div style={{ marginTop: 6 }}>
                                    {board.model.reliability.map((r) => (
                                        <div key={r.band} style={{ display: "flex", justifyContent: "space-between",
                                                                   font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                                            <span>stated {r.band}</span>
                                            <span>observed {pct(r.observed)}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </Sect>

                        <Sect title="Propose a scenario">
                            {proposing ? (
                                <ProposeForm
                                    boardId={boardId}
                                    onCancel={() => setProposing(false)}
                                    onAdded={(s) => { setLocal((p) => [...p, s]); setProposing(false); setSel(s.id) }}
                                />
                            ) : (
                                <button className="btn sm" style={{ width: "100%" }}
                                        onClick={() => setProposing(true)}>
                                    add a scenario the model missed
                                </button>
                            )}
                            <P>
                                The residual says the set is incomplete. Proposing is how
                                you close the gap when you already know what is missing —
                                and yours is scored on its own record, never averaged
                                with the model's.
                            </P>
                        </Sect>

                        <Sect title="How to read the board">
                            <P>
                                The bar is the probability. The tick on it is the base
                                rate — how often this has actually happened here. A bar
                                sitting on its tick is the model telling you nothing
                                history did not.
                            </P>
                            <P>
                                <b>None of these</b> is a real row and usually the
                                largest. Three named scenarios summing to 100% would be
                                a lie.
                            </P>
                        </Sect>
                    </>
                ) : null}
            </aside>

            {/* ── main pane (F3.2) ─────────────────────────────── */}
            <div style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
                {!board ? <Empty>Building the board…</Empty> : (
                    <>
                        <div style={{ padding: "12px 14px 0" }}>
                            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                                <h2 style={{ font: "600 16px var(--font)", color: "var(--txt)", margin: 0 }}>
                                    {board.name}
                                </h2>
                                <span style={tagS}>{board.horizon}</span>
                                <span style={{ marginLeft: "auto", font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                                    escalation against this locale's own rate
                                </span>
                            </div>
                        </div>

                        <div className="fcstack">
                            {stack.map((s) => (
                                <Bar key={s.id} s={s} selected={sel === s.id}
                                     onSelect={() => !s.residual && setSel(s.id === sel ? null : s.id)} />
                            ))}
                        </div>

                        <p style={{ padding: "0 14px", font: "400 11px var(--font)",
                                    color: "var(--txt-3)", lineHeight: 1.5, margin: "2px 0 10px" }}>
                            Each bar is a probability; the tick on it is how often that has
                            happened here before. Read every bar as a departure from
                            history, never as an absolute.
                        </p>

                        {selected
                            ? <Detail s={selected} board={board} />
                            : <Empty>Pick a scenario to see what to look out for.</Empty>}
                    </>
                )}
            </div>
        </div>
    )
}

/* ── the bar (F5) ─────────────────────────────────────────────── */
function Bar({ s, selected, onSelect }) {
    const dep = s.residual ? null : departure(s.p, s.base)
    const tick = s.residual ? null : tickLeft(s.base)
    return (
        <button className={`fcbar${s.residual ? " res" : ""}${s.mine ? " mine" : ""}`}
                aria-selected={selected} onClick={onSelect}
                disabled={s.residual}>
            <span className="p">{pct(s.p)}</span>
            <span className="b">
                <i style={{ width: barWidth(s.p) }} />
                {tick !== null ? <em style={{ left: tick }} /> : null}
            </span>
            <span className="l">
                {s.label}
                {s.mine ? <span className="mtag">yours</span> : null}
                <em>{s.residual ? s.note : (dep?.text || "")}</em>
            </span>
        </button>
    )
}

/* ── the detail (F6) ──────────────────────────────────────────── */
function Detail({ s, board }) {
    const inds = safeArray(s.indicators)
    return (
        <div style={{ padding: "0 14px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{s.id}</span>
                {s.window ? <span style={tagS}>{s.window}</span> : null}
                <span style={tagS}>p {pct(s.p)}</span>
                {s.base != null ? <span style={tagS}>base {pct(s.base)}</span> : null}
                {s.mine ? <span className="mtag">yours</span> : null}
            </div>
            <h3 style={{ font: "600 15px var(--font)", color: "var(--txt)", margin: "8px 0 4px" }}>
                {s.label}
            </h3>
            {s.note ? <P>{s.note}</P> : null}

            {/* F6.2 — the headline block. The forecast is not the
                product; this list is. */}
            <div style={{ background: "var(--bg-2)", border: "1px solid var(--line)",
                          padding: "10px 12px", margin: "12px 0" }}>
                <div style={{ font: "600 10px var(--font)", letterSpacing: ".08em",
                              textTransform: "uppercase", color: "var(--txt-3)", marginBottom: 8 }}>
                    What to look out for
                </div>
                {inds.length ? inds.map((row, i) => {
                    const [label, source, dir, weight] = row
                    return (
                        <div className="fcind" key={i}>
                            <span className={`d ${dir === "down" ? "down" : "up"}`}>
                                {dir === "down" ? "▼" : "▲"}
                            </span>
                            <span className="n" title={label}>{label}</span>
                            <span className="src">{source}</span>
                            <span className="t"><i style={{ width: `${Math.round((weight || 0) * 100)}%` }} /></span>
                            <span className="v">{(weight || 0).toFixed(2)}</span>
                        </div>
                    )
                }) : (
                    /* F7: a proposal with no indicators says so rather
                       than showing an empty box. */
                    <P>No indicators stated — this forecast cannot be watched.</P>
                )}
            </div>

            {/* F6.4 */}
            <div style={{ borderLeft: "2px solid var(--line-strong)", padding: "2px 0 2px 12px",
                          margin: "12px 0" }}>
                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>
                    What would prove this wrong
                </div>
                <P>{s.falsifier || "No falsifier stated. A forecast that cannot be wrong is not a forecast."}</P>
            </div>

            <P style={{ color: "var(--txt-4)" }}>{board.caveat}</P>
        </div>
    )
}

/* ── propose (F7) ─────────────────────────────────────────────── */
function ProposeForm({ boardId, onAdded, onCancel }) {
    const [label, setLabel] = useState("")
    const [p, setP] = useState(20)
    const [window_, setWindow] = useState("0-3 months")
    const [obs, setObs] = useState("")
    const [fals, setFals] = useState("")
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)

    const submit = () => {
        const indicators = obs.split("\n").map((l) => l.trim()).filter(Boolean)
            .map((l) => [l, "Analyst", "up", 0.2])
        setBusy(true); setErr(null)
        fetch(`${API_BASE}/api/forecast/proposals`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ board: boardId, label, p: p / 100,
                                   window: window_, indicators, falsifier: fals }),
        })
            .then((r) => r.json())
            .then((d) => {
                if (!d?.ok) { setErr(d?.error || "could not save"); return }
                onAdded({ id: d.id, origin: "analyst", mine: true, label,
                          p: p / 100, base: null, window: window_,
                          indicators, falsifier: fals || null })
            })
            .catch((e) => setErr(String(e.message || e)))
            .finally(() => setBusy(false))
    }

    return (
        <div style={{ display: "grid", gap: 7 }}>
            <input className="input" placeholder="What happens" value={label}
                   onChange={(e) => setLabel(e.target.value)} />
            <label style={{ font: "400 10px var(--font)", color: "var(--txt-3)" }}>
                Your probability — {p}%
                <input type="range" min={1} max={80} value={p}
                       onChange={(e) => setP(Number(e.target.value))}
                       style={{ width: "100%" }} />
            </label>
            <input className="input" placeholder="Window" value={window_}
                   onChange={(e) => setWindow(e.target.value)} />
            <textarea className="input" rows={3} placeholder="What to look out for — one per line"
                      value={obs} onChange={(e) => setObs(e.target.value)} />
            <input className="input" placeholder="What would prove you wrong" value={fals}
                   onChange={(e) => setFals(e.target.value)} />
            {err ? <div style={{ font: "400 10px var(--font)", color: "var(--amber)" }}>{err}</div> : null}
            <div style={{ display: "flex", gap: 6 }}>
                <button className="btn sm primary" disabled={busy || !label.trim()} onClick={submit}>
                    {busy ? "saving…" : "add"}
                </button>
                <button className="btn sm" onClick={onCancel}>cancel</button>
            </div>
        </div>
    )
}

/* ── small pieces ─────────────────────────────────────────────── */
const tagS = { font: "400 10px var(--mono)", color: "var(--txt-3)",
               border: "1px solid var(--line)", borderRadius: 2, padding: "1px 5px" }
const itemS = { font: "400 11px var(--font)", color: "var(--txt-3)",
                padding: "3px 0", borderBottom: "1px solid var(--line-soft)", lineHeight: 1.4 }

function Head({ children }) {
    return (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)",
                      font: "600 12px var(--font)", color: "var(--txt)" }}>{children}</div>
    )
}
function Sub({ children }) {
    return <span style={{ float: "right", font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{children}</span>
}
function Sect({ title, children }) {
    return (
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line-soft)" }}>
            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>{title}</div>
            {children}
        </div>
    )
}
function P({ children, style }) {
    return <p style={{ font: "400 11px var(--font)", color: "var(--txt-3)",
                       lineHeight: 1.5, margin: "4px 0 0", ...style }}>{children}</p>
}
function Fig({ v, label, raw }) {
    const text = v === null || v === undefined ? "—" : (raw ? String(v) : Number(v).toFixed(3))
    return (
        <div>
            <div style={{ font: "400 15px var(--mono)", color: "var(--txt)" }}>{text}</div>
            <div style={{ font: "400 9px var(--font)", color: "var(--txt-4)" }}>{label}</div>
        </div>
    )
}
function Empty({ children }) {
    return <div style={{ padding: 16, font: "400 12px var(--font)", color: "var(--txt-3)" }}>{children}</div>
}
