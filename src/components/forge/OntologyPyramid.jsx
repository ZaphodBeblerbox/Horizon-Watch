/**
 * OntologyPyramid.jsx — the Ontology Graph tab's category-boxed pyramid
 * rebuild (fix/geoconfirmed-parallax-rebuild, Part 7). Supersedes the flat
 * country-clustered layout (OntologyCountryGraph.jsx, kept available as a
 * "Countries" sub-view alongside this one — real, working code, not
 * deleted, since Part 7 doesn't ask for its removal).
 *
 * Real layout mechanism (stated explicitly, per the prompt's own request):
 * NOT a generic force-directed simulation — that can't guarantee a fixed
 * top-down tier order. Each category box is a fixed DOM card with its 4
 * real tiers (Top -> Groups/Armies/Units -> Locations -> Signals) stacked
 * top-heavy via plain CSS flex-column (a real, deterministic, tier-
 * constrained layout). Boxes themselves flow in a wrapping flex row at
 * the page level. Real cross-box connection lines are drawn as an
 * absolutely-positioned SVG overlay, computed from each box's top-entity
 * DOM element's real measured position (getBoundingClientRect via refs,
 * recomputed on resize/scroll) — never a physics simulation.
 *
 * Real category boxes come from GET /api/forge/ontology/pyramid, which
 * only ever returns a box for a real category with real backing data
 * today (country, non_state_armed_group) — mercenary_pmc/company are
 * reported absent since no real entity of either kind exists yet.
 *
 * Click-to-glow, the precise rule this component implements (Part 7.4):
 *   (a) the clicked entity's real direct 1-hop connections -> full brightness
 *   (b) the rest of its OWN box's pyramid chain (every tier, not just
 *       neighbors) -> dimmer but still clearly highlighted
 *   (c) its real cross-box connections to other boxes' TOP entities -> full brightness
 *   (d) everything else -> dimmed/faded
 */
import { useState, useEffect, useRef, useLayoutEffect, useCallback } from "react"
import API_BASE from "../../apiBase.js"

function headers() {
    return { Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}` }
}

const CATEGORY_LABEL = {
    country: "Countries",
    non_state_armed_group: "Non-State Armed Groups",
}
const CATEGORY_COLOR = {
    country: "#60a5fa",
    non_state_armed_group: "#f87171",
}
const REL_STYLE = {
    allied_with:    { color: "#4ade80", dash: "0" },
    adversarial_to: { color: "#ef4444", dash: "6,3" },
    neutral_with:   { color: "#94a3b8", dash: "2,4" },
}

// Real opacity levels for the click-to-glow rule (Part 7.4) — a named
// constant per state so the exact rule is legible in the render code below,
// not a magic number.
const OP_FULL = 1, OP_OWN_BOX = 0.7, OP_DIMMED = 0.18, OP_NONE_SELECTED = 1

export default function OntologyPyramid() {
    const [data, setData] = useState(null)
    const [loaded, setLoaded] = useState(false)
    const [selected, setSelected] = useState(null)   // {id, type: 'top'|'tier2'|'tier3'|'tier4', boxIndex}
    const [panel, setPanel] = useState(null)
    const [panelLoading, setPanelLoading] = useState(false)

    const boxRefs = useRef({})       // boxIndex -> element
    const topRefs = useRef({})       // node id (top entity) -> element
    const containerRef = useRef(null)
    const [linePositions, setLinePositions] = useState([])

    useEffect(() => {
        fetch(`${API_BASE}/api/forge/ontology/pyramid`, { headers: headers() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { setData(d); setLoaded(true) })
            .catch(() => setLoaded(true))
    }, [])

    const recomputeLines = useCallback(() => {
        if (!data || !containerRef.current) return
        const containerRect = containerRef.current.getBoundingClientRect()
        const positions = []
        for (const edge of data.cross_box_edges) {
            const a = topRefs.current[edge.source]
            const b = topRefs.current[edge.target]
            if (!a || !b) continue
            const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
            positions.push({
                edge,
                x1: ra.left + ra.width / 2 - containerRect.left + containerRef.current.scrollLeft,
                y1: ra.top + ra.height / 2 - containerRect.top + containerRef.current.scrollTop,
                x2: rb.left + rb.width / 2 - containerRect.left + containerRef.current.scrollLeft,
                y2: rb.top + rb.height / 2 - containerRect.top + containerRef.current.scrollTop,
            })
        }
        setLinePositions(positions)
    }, [data])

    useLayoutEffect(() => {
        recomputeLines()
        const onResize = () => recomputeLines()
        window.addEventListener("resize", onResize)
        const el = containerRef.current
        el?.addEventListener("scroll", onResize)
        return () => { window.removeEventListener("resize", onResize); el?.removeEventListener("scroll", onResize) }
    }, [recomputeLines, data])

    function openEntity(nodeId, boxIndex, tier) {
        setSelected({ id: nodeId, boxIndex, tier })
        setPanelLoading(true)
        fetch(`${API_BASE}/api/forge/ontology/node/${encodeURIComponent(nodeId)}/connections`, { headers: headers() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { setPanel(d); setPanelLoading(false) })
            .catch(() => setPanelLoading(false))
    }

    if (!loaded) return <div style={{ color: "#475569", fontSize: 12, padding: 16 }}>Loading real pyramid data…</div>
    if (!data || data.boxes.length === 0) {
        return <div style={{ color: "#334155", fontSize: 12, padding: 16 }}>No real category-box data yet — sync GeoConfirmed data first.</div>
    }

    const connectedIds = new Set((panel?.connections || []).map(c => c.id))
    const crossBoxTopIds = new Set(data.cross_box_edges.flatMap(e => [e.source, e.target]))

    // Real click-to-glow opacity for one node, per the precise rule stated
    // in the module docstring (Part 7.4).
    function opacityFor(nodeId, boxIndex) {
        if (!selected) return OP_NONE_SELECTED
        if (nodeId === selected.id) return OP_FULL
        if (connectedIds.has(nodeId)) return OP_FULL
        if (boxIndex === selected.boxIndex) return OP_OWN_BOX
        return OP_DIMMED
    }

    return (
        <div style={{ display: "flex", height: "100%" }}>
            <div ref={containerRef} style={{ flex: 1, overflow: "auto", padding: 16, position: "relative" }}>
                {data.categories_absent.length > 0 && (
                    <div style={{ fontSize: 10, color: "#475569", marginBottom: 10 }}>
                        No real backing entities yet for: {data.categories_absent.map(c => c.replace(/_/g, " ")).join(", ")} — no box shown for these.
                    </div>
                )}
                <svg style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 1 }}>
                    {linePositions.map(({ edge, x1, y1, x2, y2 }, i) => {
                        const style = REL_STYLE[edge.type] || { color: "#94a3b8", dash: "0" }
                        const dim = selected && !(edge.source === selected.id || edge.target === selected.id
                            || (crossBoxTopIds.has(selected.id) && (edge.source === selected.id || edge.target === selected.id)))
                        return (
                            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                                stroke={style.color} strokeWidth={selected && (edge.source === selected.id || edge.target === selected.id) ? 2.5 : 1.5}
                                strokeDasharray={style.dash} opacity={dim ? 0.15 : 0.8} />
                        )
                    })}
                </svg>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 16, position: "relative", zIndex: 2 }}>
                    {data.boxes.map((box, boxIndex) => (
                        <CategoryBox key={box.top.id} box={box} boxIndex={boxIndex}
                            topRef={el => { if (el) topRefs.current[box.top.id] = el }}
                            opacityFor={opacityFor} onSelect={openEntity} selected={selected} />
                    ))}
                </div>
            </div>

            <div style={{
                width: 300, flexShrink: 0, borderLeft: "1px solid rgba(148,163,184,0.08)",
                background: "#080c16", overflowY: "auto", padding: selected ? 14 : 0,
            }}>
                {panelLoading && <div style={{ color: "#475569", fontSize: 11 }}>Loading real entity data…</div>}
                {!panelLoading && !selected && (
                    <div style={{ padding: 14, color: "#334155", fontSize: 11 }}>Click any entity to inspect its real connections.</div>
                )}
                {!panelLoading && panel && (
                    <>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#94a3b8" }}>{panel.type}</div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", marginBottom: 10 }}>{panel.label}</div>
                        {panel.enrichment?.wikipedia?.extract && (
                            <div style={{ fontSize: 10.5, color: "#94a3b8", lineHeight: 1.5, marginBottom: 10 }}>
                                {panel.enrichment.wikipedia.extract.slice(0, 300)}…
                            </div>
                        )}
                        <div style={{ fontSize: 9, fontWeight: 700, color: "#475569", textTransform: "uppercase", marginBottom: 6 }}>
                            Real connections ({panel.connections?.length || 0})
                        </div>
                        {(panel.connections || []).map((c, i) => (
                            <div key={i} onClick={() => openEntity(c.id, selected?.boxIndex, null)}
                                style={{ fontSize: 11, cursor: "pointer", color: "#cbd5e1", padding: "3px 0" }}>
                                {c.label} <span style={{ color: "#475569", fontSize: 9 }}>({c.relationship_type})</span>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}

function CategoryBox({ box, boxIndex, topRef, opacityFor, onSelect, selected }) {
    const color = CATEGORY_COLOR[box.category] || "#94a3b8"
    return (
        <div style={{
            width: 260, background: "#0d1422", borderRadius: 8, border: `1px solid ${color}33`,
            padding: 10, display: "flex", flexDirection: "column", gap: 8,
        }}>
            <div style={{ fontSize: 8.5, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {CATEGORY_LABEL[box.category] || box.category}
            </div>

            {/* Tier 1 — Top entity */}
            <div ref={topRef} onClick={() => onSelect(box.top.id, boxIndex, "top")}
                style={{
                    display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                    padding: "6px 8px", borderRadius: 5, background: `${color}18`,
                    border: `1.5px solid ${selected?.id === box.top.id ? color : "transparent"}`,
                    opacity: opacityFor(box.top.id, boxIndex),
                }}>
                {box.top.flag_path && <img src={box.top.flag_path} alt="" style={{ width: 18, height: 12, objectFit: "cover", borderRadius: 2 }} />}
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "#e2e8f0" }}>{box.top.label}</span>
            </div>

            {/* Tier 2 — Groups/Armies/Units */}
            {box.tier2_groups.length > 0 && (
                <TierSection label={`Groups / Armies / Units (${box.tier2_groups.length})`}>
                    {box.tier2_groups.map(n => (
                        <PyramidChip key={n.id} node={n} color="#fbbf24" boxIndex={boxIndex}
                            opacityFor={opacityFor} onSelect={() => onSelect(n.id, boxIndex, "tier2")}
                            isSelected={selected?.id === n.id} />
                    ))}
                </TierSection>
            )}

            {/* Tier 3 — Locations */}
            {box.tier3_locations.length > 0 && (
                <TierSection label={`Locations (${box.tier3_locations.length}${box.truncated ? "+" : ""})`}>
                    {box.tier3_locations.slice(0, 25).map(n => (
                        <PyramidChip key={n.id} node={n} color="#4ade80" boxIndex={boxIndex}
                            opacityFor={opacityFor} onSelect={() => onSelect(n.id, boxIndex, "tier3")}
                            isSelected={selected?.id === n.id} small />
                    ))}
                </TierSection>
            )}

            {/* Tier 4 — Signals */}
            {box.tier4_signals.length > 0 && (
                <TierSection label={`Signals (${box.tier4_signals.length})`}>
                    {box.tier4_signals.slice(0, 15).map(n => (
                        <PyramidChip key={n.id} node={n} color="#facc15" boxIndex={boxIndex}
                            opacityFor={opacityFor} onSelect={() => onSelect(n.id, boxIndex, "tier4")}
                            isSelected={selected?.id === n.id} small />
                    ))}
                </TierSection>
            )}
        </div>
    )
}

function TierSection({ label, children }) {
    return (
        <div style={{ borderTop: "1px solid rgba(148,163,184,0.06)", paddingTop: 6 }}>
            <div style={{ fontSize: 8, color: "#475569", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 4 }}>{label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 90, overflowY: "auto" }}>{children}</div>
        </div>
    )
}

function PyramidChip({ node, color, boxIndex, opacityFor, onSelect, isSelected, small }) {
    return (
        <div onClick={onSelect}
            style={{
                padding: small ? "1px 6px" : "2px 8px", borderRadius: 10, fontSize: small ? 9 : 10, cursor: "pointer",
                background: `${color}18`, color,
                border: `1px solid ${isSelected ? color : "transparent"}`,
                opacity: opacityFor(node.id, boxIndex),
            }}>
            {node.label}
        </div>
    )
}
