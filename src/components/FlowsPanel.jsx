/**
 * FlowsPanel.jsx — what is actually moving on the trade corridors.
 *
 * The Flows layer drew corridors and said nothing about them. A route is not
 * interesting because it exists — everyone knows there is a route through
 * Hormuz — it is interesting when something is happening on it.
 *
 * FOUR MEASURES, SHOWN SEPARATELY, NEVER SUMMED. Traffic against the
 * corridor's own baseline, incidents in it, navigation interference over it,
 * and the state of the chokepoints it runs through. A corridor at a third of
 * its usual traffic is a different thing from one with normal traffic and a
 * jamming cell over it, and one "disruption score" would call them the same
 * while being impossible to argue with. The reasons are listed instead, so
 * every one can be checked against the numbers beside it.
 *
 * A BASELINE THAT DOES NOT EXIST IS NOT 1.0. The server withholds the
 * comparison until it has watched a corridor long enough, and this says so
 * rather than drawing a bar at "normal" — "we have not looked long enough"
 * and "this is normal" are different answers.
 */
import { useEffect, useState, useCallback } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import { subscribeLive } from "../state/liveEvents.js"

const STATE_COLOR = {
    quiet:  "var(--sev-high)",
    busy:   "var(--sev-moderate)",
    normal: "var(--txt-4)",
    unknown: "var(--txt-4)",
}

/** Traffic against baseline, as a bar you can read at a glance. */
function TrafficBar({ traffic }) {
    const { vessels, baseline, ratio, state } = traffic
    if (!baseline) {
        return (
            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", lineHeight: 1.5 }}>
                {vessels} vessel{vessels === 1 ? "" : "s"} now · no baseline yet
            </div>
        )
    }
    // Two marks on one track: where it usually sits, and where it is. The
    // track is twice baseline so "normal" lands in the middle and both
    // halves of the story — quieter and busier — have room to show.
    const full = Math.max(baseline * 2, vessels, 1)
    const pctNow = Math.min(100, (vessels / full) * 100)
    const pctBase = Math.min(100, (baseline / full) * 100)
    return (
        <div>
            <div style={{ position: "relative", height: 8, background: "var(--chart-bar-track)",
                          borderRadius: 2, marginBottom: 4 }}>
                <div style={{ width: `${pctNow}%`, height: "100%", borderRadius: 2,
                              background: STATE_COLOR[state] || "var(--chart-bar)" }} />
                {/* The baseline is a tick, not a second bar: it is the thing
                    the bar is being compared against, not another quantity. */}
                <div title={`usually about ${baseline}`}
                     style={{ position: "absolute", left: `${pctBase}%`, top: -2, bottom: -2,
                              width: 1, background: "var(--txt-2)", opacity: 0.8 }} />
            </div>
            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>
                {vessels} now · usually {baseline} · {ratio}× ({state})
            </div>
        </div>
    )
}

export default function FlowsPanel({ onSelectRoute = null }) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [open, setOpen] = useState(null)

    const load = useCallback(() => {
        fetch(`${API_BASE}/api/flows/status`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(setData)
            .catch((e) => setError(e.message))
    }, [])

    useEffect(() => {
        load()
        // Corridor traffic moves on the AIS feed's own cadence; this also
        // feeds the server's rolling baseline, so a panel left open makes
        // the comparison better rather than just refreshing it.
        const iv = setInterval(load, 60_000)
        const off = subscribeLive(() => load(), ["alert.created", "signal.created"])
        return () => { clearInterval(iv); off() }
    }, [load])

    if (error) {
        return <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "8px 12px" }}>
            Corridor status unavailable ({error}).
        </div>
    }
    if (!data) return <Loading size={18} inline label="Reading corridors" style={{ padding: "8px 12px" }} />

    const routes = [...(data.routes || [])].sort((a, b) => {
        if (a.disrupted !== b.disrupted) return a.disrupted ? -1 : 1
        return (b.incidents?.count || 0) - (a.incidents?.count || 0)
    })

    return (
        <div>
            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)",
                          padding: "0 12px 6px", lineHeight: 1.5 }}>
                {data.disrupted} of {data.total} corridors have something on them.
            </div>

            {routes.map((r) => {
                const isOpen = open === r.id
                return (
                    <div key={r.id} style={{ borderTop: "1px solid var(--line-soft)" }}>
                        <div role="button"
                             onClick={() => { setOpen(isOpen ? null : r.id); onSelectRoute?.(r) }}
                             style={{ display: "flex", alignItems: "center", gap: 8,
                                      padding: "6px 12px", cursor: "pointer" }}>
                            <span style={{
                                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                                background: r.disrupted ? "var(--sev-high)" : "var(--txt-4)",
                                opacity: r.disrupted ? 1 : 0.5,
                            }} />
                            <span style={{ flex: 1, minWidth: 0, font: "400 11.5px var(--font)",
                                           color: "var(--txt)", overflow: "hidden",
                                           textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {r.name}
                            </span>
                            <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", flexShrink: 0 }}>
                                {r.traffic.vessels}
                            </span>
                        </div>

                        {isOpen && (
                            <div style={{ padding: "2px 12px 10px 26px" }}>
                                <TrafficBar traffic={r.traffic} />

                                {r.why?.length > 0 && (
                                    <ul style={{ margin: "8px 0 0", padding: "0 0 0 14px",
                                                 font: "400 10.5px var(--font)", color: "var(--txt-2)",
                                                 lineHeight: 1.6 }}>
                                        {r.why.map((w) => <li key={w}>{w}</li>)}
                                    </ul>
                                )}

                                <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap",
                                              font: "400 10px var(--font)", color: "var(--txt-4)" }}>
                                    <span>incidents <b style={{ color: "var(--txt-2)" }}>{r.incidents.count}</b></span>
                                    {r.incidents.by_severity?.critical ? (
                                        <span style={{ color: "var(--sev-critical)" }}>
                                            critical {r.incidents.by_severity.critical}
                                        </span>
                                    ) : null}
                                    <span>nav interference <b style={{ color: "var(--txt-2)" }}>{r.interference_cells}</b></span>
                                    <span>under way <b style={{ color: "var(--txt-2)" }}>{r.traffic.under_way}</b></span>
                                </div>

                                {r.chokepoints?.length > 0 && (
                                    <div style={{ marginTop: 6, font: "400 10px var(--font)", color: "var(--txt-4)" }}>
                                        through: {r.chokepoints.map((c) => c.id).join(", ")}
                                    </div>
                                )}

                                {r.traffic.note && (
                                    <div style={{ marginTop: 6, font: "400 10px var(--font)",
                                                  color: "var(--txt-4)", lineHeight: 1.5 }}>
                                        {r.traffic.note}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )
            })}

            <div style={{ padding: "8px 12px", font: "400 10px var(--font)",
                          color: "var(--txt-4)", lineHeight: 1.5 }}>
                {data.method}
            </div>
        </div>
    )
}
