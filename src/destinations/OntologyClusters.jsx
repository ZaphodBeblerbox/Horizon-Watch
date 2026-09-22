/**
 * OntologyClusters.jsx — the ontology as country plates and what bridges them.
 *
 * WHY THIS VIEW EXISTS. Drawn flat, this graph says "country — located
 * in — thing" forever, because that is what it mostly is: 50,450
 * `located in` and 30,115 `flagged in` edges terminating on 243 country
 * nodes. Membership wins on volume and buries every actual finding.
 *
 * So membership is counted, not drawn. A country is one plate saying
 * "828 vessels · 9 facilities"; what gets drawn is the links BETWEEN
 * countries and the entities that bridge them. A Shahed originates in
 * Iran and is observed in Ukraine — it is a member of neither, so it
 * sits in the gap between those two plates, which is both literally
 * where it belongs and where the eye should go.
 *
 * SMOOTH IS A REQUIREMENT, NOT A GOAL. The server ships a few hundred
 * summarised rows however large the graph grows; the layout runs a
 * bounded number of passes over the connected core only; and the whole
 * thing is one memoised computation keyed on the payload, so panning
 * and hovering never re-solve it.
 *
 * Greyscale and hairline per spec rules 3 and 4 — shades, not hues. The
 * one exception is the inferred/observed distinction, which is carried
 * by a dash rather than a colour for the same reason.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { layout, bridgePosition, summarise } from "./clusterLayout.js"

const W = 1200
const H = 760

// Above this many links the diagram stops being readable long before it
// stops being fast, so the weakest are dropped and the count is stated.
const MAX_DRAWN_LINKS = 400

const PLATE_W = 120
const PLATE_H = 34

export default function OntologyClusters({ bridgeType = "equipment",
                                           confFloor = 0,
                                           onPickCountry = null }) {
    const [data, setData] = useState(null)
    const [error, setError] = useState(null)
    const [hover, setHover] = useState(null)
    const [focus, setFocus] = useState(null)

    useEffect(() => {
        let cancelled = false
        setData(null); setError(null)
        const q = `min_conf=${confFloor}&bridge_types=${encodeURIComponent(bridgeType)}`
                + `&bridge_limit=80&link_limit=${MAX_DRAWN_LINKS * 2}`
        fetch(`${API_BASE}/api/ontology/clusters?${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (cancelled) return
                if (!d?.available) { setError(d?.error || "unavailable"); return }
                setData(d)
            })
            .catch((e) => { if (!cancelled) setError(String(e.message || e)) })
        return () => { cancelled = true }
    }, [bridgeType, confFloor])

    // One computation per payload. Hover and focus must never re-solve
    // the layout — that is the difference between smooth and not.
    const solved = useMemo(() => {
        if (!data) return null
        const clusters = safeArray(data.clusters)
        const links = safeArray(data.links)
            .slice()
            .sort((a, b) => (b.conf || 0) - (a.conf || 0) || (b.events || 0) - (a.events || 0))
        const drawn = links.slice(0, MAX_DRAWN_LINKS)
        const bridges = safeArray(data.bridges)
        const { positions, core, rest } = layout(clusters, drawn, bridges,
                                                 { width: W, height: H })
        const bpos = bridges
            .map((b) => ({ bridge: b, at: bridgePosition(b, positions) }))
            .filter((x) => x.at)
        return { positions, core, rest, drawn, hidden: links.length - drawn.length, bpos }
    }, [data])

    // What the focused plate connects to, so everything else can recede.
    const lit = useMemo(() => {
        if (!focus || !solved) return null
        const set = new Set([focus])
        for (const l of solved.drawn) {
            if (l.src === focus) set.add(l.dst)
            if (l.dst === focus) set.add(l.src)
        }
        for (const { bridge } of solved.bpos) {
            if ((bridge.countries || []).includes(focus)) {
                for (const c of bridge.countries) set.add(c)
            }
        }
        return set
    }, [focus, solved])

    if (error) {
        return <Note>Could not load the clustered graph — {error}</Note>
    }
    if (!solved) {
        return <Note>Building the clustered graph…</Note>
    }

    const { positions, core, rest, drawn, hidden, bpos } = solved
    const at = (id) => positions.get(id)
    const dim = (id) => (lit && !lit.has(id) ? 0.12 : 1)

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{ padding: "6px 12px", font: "400 10px var(--font)",
                          color: "var(--txt-4)", display: "flex", gap: 10, flexWrap: "wrap" }}>
                <span>{core.length} connected countries · {drawn.length} links · {bpos.length} bridging {bridgeType}</span>
                {/* Membership is the thing NOT drawn, so the diagram has
                    to say how much of it there is or it looks like the
                    graph is smaller than it is. */}
                <span>{(data.counts?.members_summarised || 0).toLocaleString()} memberships counted, not drawn</span>
                {hidden > 0 ? <span>{hidden} weaker links hidden</span> : null}
                {rest.length ? <span>{rest.length} countries with no link in this window</span> : null}
                {focus ? (
                    <span role="button" tabIndex={0}
                          onClick={() => setFocus(null)}
                          onKeyDown={(e) => { if (e.key === "Enter") setFocus(null) }}
                          style={{ color: "var(--acc-hi)", cursor: "pointer" }}>
                        clear focus
                    </span>
                ) : null}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "100%" }}
                     role="img" aria-label="Country clusters and the entities bridging them">
                    {/* Country-to-country links. Dashed where inferred,
                        per the same discipline the rest of the system
                        uses for conf < 0.8. */}
                    {drawn.map((l) => {
                        const a = at(l.src), b = at(l.dst)
                        if (!a || !b) return null
                        const o = Math.min(dim(l.src), dim(l.dst))
                        return (
                            <line key={l.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                                  stroke="var(--txt-4)"
                                  strokeWidth={l.conf >= 0.8 ? 1.2 : 0.8}
                                  strokeDasharray={l.inferred ? "3 3" : undefined}
                                  opacity={0.5 * o}>
                                <title>{`${l.relation} · ${l.basis || ""}`.trim()}</title>
                            </line>
                        )
                    })}

                    {/* Bridges: drawn BETWEEN the plates they touch, with a
                        hairline to each, because the claim is that they
                        belong to none of them. */}
                    {bpos.map(({ bridge, at: p }) => {
                        const o = lit
                            ? ((bridge.countries || []).some((c) => lit.has(c)) ? 1 : 0.12)
                            : 1
                        return (
                            <g key={bridge.id} opacity={o}>
                                {(bridge.countries || []).map((c) => {
                                    const cp = at(c)
                                    if (!cp) return null
                                    return (
                                        <line key={c} x1={p.x} y1={p.y} x2={cp.x} y2={cp.y}
                                              stroke="var(--txt-4)" strokeWidth={0.6}
                                              strokeDasharray="2 4" opacity={0.45} />
                                    )
                                })}
                                <g transform={`translate(${p.x},${p.y})`}
                                   onMouseEnter={() => setHover({
                                       title: bridge.label,
                                       lines: [
                                           `${bridge.type} bridging ${bridge.country_count} countries`,
                                           "Belongs to none of them — that is why it is drawn between.",
                                       ],
                                   })}
                                   onMouseLeave={() => setHover(null)}
                                   style={{ cursor: "default" }}>
                                    <rect x={-5} y={-5} width={10} height={10} rx={2}
                                          transform="rotate(45)"
                                          fill="var(--bg-2)" stroke="var(--txt-2)" strokeWidth={1} />
                                    <text x={0} y={-10} textAnchor="middle"
                                          style={{ font: "500 9px var(--font)", fill: "var(--txt-2)" }}>
                                        {bridge.label}
                                    </text>
                                </g>
                            </g>
                        )
                    })}

                    {/* The plates. Summarised, never expanded. */}
                    {core.map((c) => {
                        const p = at(c.id)
                        if (!p) return null
                        return (
                            <g key={c.id} transform={`translate(${p.x - PLATE_W / 2},${p.y - PLATE_H / 2})`}
                               opacity={dim(c.id)}
                               role="button" tabIndex={0}
                               onClick={() => setFocus(focus === c.id ? null : c.id)}
                               onDoubleClick={() => onPickCountry?.(c)}
                               onKeyDown={(e) => {
                                   if (e.key === "Enter") setFocus(focus === c.id ? null : c.id)
                               }}
                               onMouseEnter={() => setHover({
                                   title: c.label,
                                   lines: [
                                       summarise(c.counts),
                                       `${c.links} link${c.links === 1 ? "" : "s"} to other countries`,
                                       "Click to focus · double-click to walk from here",
                                   ],
                               })}
                               onMouseLeave={() => setHover(null)}
                               style={{ cursor: "pointer" }}>
                                <rect width={PLATE_W} height={PLATE_H} rx={2}
                                      fill="var(--bg-2)"
                                      stroke={focus === c.id ? "var(--txt-2)" : "var(--line)"}
                                      strokeWidth={focus === c.id ? 1.5 : 1} />
                                <text x={8} y={14}
                                      style={{ font: "600 11px var(--font)", fill: "var(--txt)" }}>
                                    {c.label.length > 18 ? `${c.label.slice(0, 17)}…` : c.label}
                                </text>
                                <text x={8} y={26}
                                      style={{ font: "400 9px var(--font)", fill: "var(--txt-4)" }}>
                                    {summarise(c.counts, 1)}
                                </text>
                            </g>
                        )
                    })}
                </svg>
            </div>

            {/* A floating readout rather than a native title: a tooltip
                that takes a second to appear and cannot hold two lines
                is not an explanation. */}
            {hover ? (
                <div style={{
                    position: "absolute", bottom: 14, left: 14, maxWidth: 380,
                    background: "var(--bg-2)", border: "1px solid var(--line)",
                    borderRadius: 2, padding: "8px 10px", pointerEvents: "none",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
                }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>
                        {hover.title}
                    </div>
                    {hover.lines.filter(Boolean).map((l, i) => (
                        <div key={i} style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginTop: 2 }}>
                            {l}
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

function Note({ children }) {
    return (
        <div style={{ padding: 16, font: "400 12px var(--font)", color: "var(--txt-3)" }}>
            {children}
        </div>
    )
}
