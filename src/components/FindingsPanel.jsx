/**
 * FindingsPanel.jsx — connections the system worked out, as something to read.
 *
 * WHAT THIS IS FOR, in the operator's own words: "some kind of
 * notification or reading UI where we can get the message that a link
 * has been found between for example Ukraine and Sudan via drones
 * supplied by German manufacturers."
 *
 * The notification tray already receives these, but a tray is for
 * interrupting — it is the wrong surface for sitting and reading
 * through what the graph has inferred, comparing routes, and rejecting
 * the ones that are wrong. That is what this is.
 *
 * EVERY ITEM SHOWS ITS CHAIN, NOT ITS SCORE. A confidence number is
 * unactionable: nobody can check 0.08. The chain — "United States
 * —allied with→ United Kingdom · United Kingdom —hosted visit from→
 * Nigeria" — can be read step by step and the wrong step rejected,
 * which is the only way an inference becomes useful.
 *
 * AND EVERY ITEM SHOWS WHY IT MIGHT BE WRONG. These are routes that
 * exist in reporting, not transfers that happened. An interface that
 * presents them as findings without that sentence is manufacturing
 * confidence the data does not have.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"

export default function FindingsPanel({ limit = 20 }) {
    const [state, setState] = useState({ loading: true, findings: [], error: null })
    const [open, setOpen] = useState(null)

    useEffect(() => {
        let cancelled = false
        fetch(`${API_BASE}/api/ontology/findings?limit=${limit}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (cancelled) return
                if (!d?.available) {
                    setState({ loading: false, findings: [], error: d?.error || "unavailable" })
                    return
                }
                setState({ loading: false, findings: safeArray(d.findings), error: null })
            })
            .catch((e) => {
                if (!cancelled) setState({ loading: false, findings: [], error: String(e.message || e) })
            })
        return () => { cancelled = true }
    }, [limit])

    const { loading, findings, error } = state

    return (
        <div>
            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>
                Connections found
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginLeft: 6 }}>
                    inferred
                </span>
            </div>

            {loading ? (
                <Muted>Walking the graph…</Muted>
            ) : error ? (
                <Muted>Could not load findings — {error}</Muted>
            ) : !findings.length ? (
                /* Rule 5: an empty pane explains itself. "Nothing found"
                   and "the graph has nothing to work with" are different
                   answers and the reader must be able to tell which. */
                <Muted>
                    No routes cleared the filters. A route has to reach somewhere
                    the system is not already recorded, and to contain at least
                    one dated, event-coded step — treaty membership alone only
                    restates the map.
                </Muted>
            ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {findings.map((f) => {
                        const id = `${f.origin}|${(f.via || []).join(">")}|${f.dst}`
                        const isOpen = open === id
                        return (
                            <div key={id}
                                 role="button" tabIndex={0}
                                 onClick={() => setOpen(isOpen ? null : id)}
                                 onKeyDown={(e) => { if (e.key === "Enter") setOpen(isOpen ? null : id) }}
                                 style={{
                                     border: "1px solid var(--line)", borderRadius: 2,
                                     padding: "7px 8px", cursor: "pointer",
                                     background: "var(--bg-2)",
                                 }}>
                                <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)", lineHeight: 1.35 }}>
                                    {f.claim}
                                </div>
                                {/* The chain is the deliverable. */}
                                <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginTop: 4 }}>
                                    {f.chain}
                                </div>
                                <div style={{ display: "flex", gap: 8, marginTop: 4,
                                              font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                                    <span>{Math.round((f.conf || 0) * 100)}% inferred</span>
                                    <span>{f.hops} steps</span>
                                    {f.system_count ? <span>{f.system_count} systems</span> : null}
                                    {f.destination_conflict_weight > 1
                                        ? <span>active conflict at destination</span> : null}
                                </div>
                                {isOpen ? (
                                    <div style={{ marginTop: 6, paddingTop: 6,
                                                  borderTop: "1px solid var(--line-soft)" }}>
                                        {f.systems?.length ? (
                                            <div style={{ font: "400 10px var(--font)", color: "var(--txt-3)", marginBottom: 4 }}>
                                                {f.systems.join(", ")}
                                            </div>
                                        ) : null}
                                        {/* Never hidden behind the expander alone —
                                            see the header comment. */}
                                        <div style={{ font: "400 10px var(--font)", color: "var(--amber)", lineHeight: 1.4 }}>
                                            {f.why_wrong}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )
                    })}
                    <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginTop: 2, lineHeight: 1.4 }}>
                        These are routes that exist in reporting, not transfers
                        that happened. Each step should be checked before it is
                        used.
                    </div>
                </div>
            )}
        </div>
    )
}

function Muted({ children }) {
    return (
        <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", lineHeight: 1.45 }}>
            {children}
        </div>
    )
}
