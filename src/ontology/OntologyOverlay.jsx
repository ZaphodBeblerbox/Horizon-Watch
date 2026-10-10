/**
 * OntologyOverlay.jsx — the full ontology of one thing, over the screen.
 *
 * Opened from the sidebar's graph ("Full ontology"); closed with ✕, Esc or
 * a click outside. Left, the graph two steps out (pan with a drag, zoom
 * with the wheel). Right, whatever is picked in it: what it is, everything
 * it connects to with how each link is known, and — for a military unit —
 * its order of battle: the chain of command above it and the units under
 * it, each one a click away. Walking ("Open its ontology") re-centres the
 * overlay on that thing, with the trail back along the top.
 */
import { useEffect, useMemo, useState } from "react"
import { createPortal } from "react-dom"
import OntologyGraph, { Legend, KINDS } from "./OntologyGraph.jsx"
import { fetchOntology } from "./ontologyApi.js"
import API_BASE from "../apiBase.js"

const KLABEL = Object.fromEntries(KINDS.map((k) => [k.key, k.label]))
const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt-2)",
    font: "500 12px var(--font)", cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const EYE = { font: "500 10px var(--mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt-4)" }

export function attrs(n) {
    const out = []
    if (!n) return out
    if (n.country) out.push(["Country", n.country])
    for (const [k, v] of Object.entries(n.props || {})) {
        if (v == null || v === "" || typeof v === "object" || /^(id|_|raw|geom)/i.test(k)) continue
        out.push([k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), String(v).slice(0, 240)])
    }
    return out.slice(0, 10)
}

export const flyToNode = (n) => {
    if (n?.lat == null || n?.lon == null) return
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: n.lat, lon: n.lon, altitude: 250_000 } })), 300)
}

export function OrbatTree({ orbat, onWalk, compact = false }) {
    if (!orbat) return null
    const { unit, chain, children, n_children: nc, siblings } = orbat
    const kids = compact ? children.slice(0, 6) : children
    return (
        <div data-testid="orbat" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 4, font: "400 11.5px var(--font)", color: "var(--txt-3)" }}>
                {chain.map((c) => (
                    <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <button onClick={() => onWalk?.(`orbat:${c.id}`, c.name)} style={LINK}>{c.name}</button><span aria-hidden="true">›</span>
                    </span>
                ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {unit.emblem && !compact && <img src={unit.emblem} alt="" width="40" height="40" style={{ objectFit: "contain", flex: "none" }} onError={(e) => { e.currentTarget.style.display = "none" }} />}
                <div>
                    <b style={{ font: "600 13.5px var(--font)", color: "var(--txt)" }}>{unit.name}</b>
                    <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                        {[unit.disbanded ? "disbanded" : null, nc ? `${nc} unit${nc === 1 ? "" : "s"} under it` : "no units recorded under it",
                          siblings ? `${siblings} beside it` : null].filter(Boolean).join(" · ")}
                    </div>
                </div>
            </div>
            {kids.length > 0 && (
                <div role="list" style={{ borderLeft: "1px solid var(--gline2)", marginLeft: 6, paddingLeft: 10, display: "flex", flexDirection: "column" }}>
                    {kids.map((k) => (
                        <button key={k.id} role="listitem" onClick={() => onWalk?.(`orbat:${k.id}`, k.name)}
                                style={{ ...LINK, display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", textAlign: "left", opacity: k.disbanded ? 0.6 : 1 }}>
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.name}{k.disbanded ? " (disbanded)" : ""}</span>
                            {k.under > 0 && <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)", flex: "none" }}>{k.under} under</span>}
                        </button>
                    ))}
                    {compact && nc > kids.length && <span style={{ font: "400 11px var(--font)", color: "var(--txt-4)", paddingTop: 2 }}>and {nc - kids.length} more in the full view</span>}
                </div>
            )}
            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>{orbat.source}</div>
        </div>
    )
}
const LINK = { border: 0, background: "none", padding: 0, cursor: "pointer", font: "400 12px var(--font)", color: "var(--txt-2)" }

export default function OntologyOverlay({ start, onClose }) {
    const [trail, setTrail] = useState(() => [start])       // [{id?, entityType?, data?, label}]
    const [graph, setGraph] = useState(null)
    const [loading, setLoading] = useState(true)
    const [picked, setPicked] = useState(null)
    const here = trail[trail.length - 1]

    useEffect(() => {
        let live = true
        setLoading(true); setPicked(null)
        fetchOntology({ ...here, hops: 2 }).then((g) => { if (live) { setGraph(g); setLoading(false) } })
            .catch(() => { if (live) { setGraph(null); setLoading(false) } })
        return () => { live = false }
    }, [here])
    useEffect(() => {
        const k = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    // the system's guesses, for a graph entity: kept apart and marked
    const [inferred, setInferred] = useState([])
    useEffect(() => {
        const id = graph?.root?.walk
        setInferred([])
        if (!id || id.includes("orbat:") || id.includes("conflict:")) return undefined
        let live = true
        fetch(`${API_BASE}/api/ontology/predict?root=${encodeURIComponent(id)}&limit=8`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setInferred(Array.isArray(d?.predictions) ? d.predictions : []) })
            .catch(() => {})
        return () => { live = false }
    }, [graph])

    const walk = (id, label) => setTrail((t) => [...t, { id, label }])
    const nodes = useMemo(() => (graph ? [graph.root, ...(graph.nodes || [])] : []), [graph])
    const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes])
    const sel = (picked && byId.get(picked)) || graph?.root
    const conns = useMemo(() => {
        if (!graph || !sel) return []
        const out = (graph.links || []).filter((l) => l.src === sel.id || l.dst === sel.id).map((l) => {
            const other = byId.get(l.src === sel.id ? l.dst : l.src)
            return other ? { ...l, other, out: l.src === sel.id } : null
        }).filter(Boolean)
        const g = new Map()
        for (const c of out) { const k = c.relation; if (!g.has(k)) g.set(k, []); g.get(k).push(c) }
        return [...g.entries()].sort((a, b) => b[1].length - a[1].length)
    }, [graph, sel, byId])

    return createPortal(
        <div data-testid="ontology-overlay" role="dialog" aria-modal="true" aria-label={`Ontology of ${here.label || graph?.root?.label || ""}`}
             onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
             style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(5,8,14,.55)", backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
                      display: "flex", alignItems: "stretch", justifyContent: "center", padding: "min(4vh, 36px) min(3vw, 40px)" }}>
            <div style={{ flex: 1, maxWidth: 1500, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0,
                          background: "var(--glass, rgba(14,18,32,.94))", border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                          backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)" }}>
                <header style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--gline)" }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={EYE}>Ontology{graph?.root ? ` · ${KLABEL[graph.root.group] || graph.root.type}` : ""}</div>
                        <h2 style={{ margin: "3px 0 0", font: "600 20px var(--font)", color: "var(--txt)", overflowWrap: "anywhere" }}>{graph?.root?.label || here.label || "…"}</h2>
                        {trail.length > 1 && (
                            <nav aria-label="Trail" style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4, font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>
                                {trail.slice(0, -1).map((t, i) => (
                                    <span key={i}><button style={{ ...LINK, fontSize: 11.5, color: "var(--acc-hi, var(--acchi))" }} onClick={() => setTrail((x) => x.slice(0, i + 1))}>{t.label || "start"}</button> ›</span>
                                ))}
                            </nav>
                        )}
                    </div>
                    <button onClick={onClose} aria-label="Close the ontology" data-testid="ontology-close" style={{ ...BTN, width: 32, padding: 0, fontSize: 15 }}>✕</button>
                </header>
                <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 360px)" }}>
                    <div style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", padding: "10px 14px", gap: 6 }}>
                        <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                            {loading ? <span style={{ color: "var(--txt-4)", fontSize: 13 }}>Reading the ontology…</span>
                                : !graph ? <span style={{ color: "var(--txt-3)", fontSize: 13 }}>Nothing recorded about this yet.</span>
                                : <div style={{ width: "100%", maxHeight: "100%", aspectRatio: "1000 / 680", maxWidth: "calc((100vh - 220px) * 1000 / 680)" }}>
                                    <OntologyGraph graph={graph} big width={1000} height={680} selected={sel?.id} labelChars={26}
                                                   onPick={(n) => setPicked(n.id)} />
                                  </div>}
                        </div>
                        {graph && <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                            <Legend graph={graph} />
                            <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)" }}>Drag to move · wheel to zoom · click a node for its links</span>
                        </div>}
                    </div>
                    <aside style={{ borderLeft: "1px solid var(--gline)", overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
                        {sel && (
                            <section>
                                <div style={EYE}>{KLABEL[sel.group] || sel.type}{sel.type && sel.type !== sel.group ? ` · ${sel.type}` : ""}</div>
                                <b data-testid="ontology-picked" style={{ display: "block", font: "600 15px var(--font)", color: "var(--txt)", margin: "2px 0 6px", overflowWrap: "anywhere" }}>{sel.label}</b>
                                {attrs(sel).map(([k, v]) => (
                                    <div key={k} style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 8, padding: "2px 0", font: "400 11.5px var(--font)" }}>
                                        <span style={{ color: "var(--txt-4)" }}>{k}</span><span style={{ color: "var(--txt-2)", overflowWrap: "anywhere" }}>{v}</span>
                                    </div>
                                ))}
                                {sel.sample?.length > 0 && <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-3)" }}>Among them: {sel.sample.join(", ")}</div>}
                                <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                                    {sel.walk && sel.id !== graph.root.id && <button style={BTN} onClick={() => walk(sel.walk, sel.label)}>Open its ontology</button>}
                                    {sel.lat != null && sel.lon != null && <button style={BTN} onClick={() => { flyToNode(sel); onClose() }}>Show on the map</button>}
                                </div>
                            </section>
                        )}
                        {graph?.orbat && (
                            <section>
                                <div style={{ ...EYE, marginBottom: 6 }}>Order of battle</div>
                                <OrbatTree orbat={graph.orbat} onWalk={walk} />
                            </section>
                        )}
                        {graph?.root && ["faction", "unit"].includes(graph.root.type) && !graph.orbat && (
                            <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-3)" }}>
                                No order of battle on record for this unit. The GeoConfirmed ORBAT covers Ukraine, Israel, Iran, Venezuela, Myanmar, Yemen and the DRC.
                            </div>
                        )}
                        {conns.length > 0 && (
                            <section>
                                <div style={{ ...EYE, marginBottom: 4 }}>Connections</div>
                                {conns.map(([rel, cs]) => (
                                    <div key={rel} style={{ marginBottom: 8 }}>
                                        <div style={{ font: "600 11.5px var(--font)", color: "var(--txt-2)" }}>{rel} <span style={{ fontWeight: 400, color: "var(--txt-4)" }}>· {cs.length}</span></div>
                                        {cs.slice(0, 30).map((c, i) => (
                                            <button key={i} onClick={() => setPicked(c.other.id)} title={c.basis || undefined}
                                                    style={{ ...LINK, display: "block", width: "100%", textAlign: "left", padding: "3px 0", borderBottom: "1px solid var(--gline)",
                                                             fontStyle: c.inferred ? "italic" : "normal" }}>
                                                <span style={{ color: "var(--txt-4)" }}>{c.out ? "→ " : "← "}</span>{c.other.label}
                                                {c.inferred && <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}> · inferred {Math.round((c.conf || 0) * 100)}%</span>}
                                                {c.basis && <span style={{ display: "block", font: "400 10.5px var(--font)", color: "var(--txt-4)" }}>{c.basis}</span>}
                                            </button>
                                        ))}
                                    </div>
                                ))}
                            </section>
                        )}
                        {inferred.length > 0 && (
                            <section>
                                <div style={{ ...EYE, marginBottom: 4 }}>Inferred · not observed, check each step</div>
                                {inferred.map((p) => (
                                    <div key={`${p.src}-${p.dst}`} style={{ padding: "3px 0", borderBottom: "1px dashed var(--gline2)", fontStyle: "italic", font: "italic 400 12px var(--font)", color: "var(--txt-3)" }}>
                                        {p.dst_label} <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{Math.round((p.conf || 0) * 100)}% · {p.paths} route{p.paths === 1 ? "" : "s"}</span>
                                        {p.basis && <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)", fontStyle: "normal" }}>{p.basis}</div>}
                                    </div>
                                ))}
                            </section>
                        )}
                    </aside>
                </div>
            </div>
        </div>,
        document.body,
    )
}
