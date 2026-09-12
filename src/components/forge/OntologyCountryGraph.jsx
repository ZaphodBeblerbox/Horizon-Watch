/**
 * OntologyCountryGraph.jsx — the Ontology Graph tab's country-clustered
 * rebuild (fix/geoconfirmed-markers-and-ontology-graph-rebuild, Part 5).
 *
 * Real, server-scoped structure, never a client-side crop of one big
 * in-memory graph:
 *   - Top level: GET /api/forge/ontology/countries — real Country nodes
 *     (with a real flag when GeoConfirmed provides one) + real claim-
 *     sourced inter-country relationship edges (today: none exist, since
 *     no OntologyClaim of that kind has been approved yet — an honest
 *     empty state, not a bug).
 *   - Expand a country: GET /api/forge/ontology/country/{iso}/subgraph —
 *     that country's real Faction children only (small, real, never
 *     truncated at today's real data scale).
 *   - Expand a faction: GET /api/forge/ontology/faction/{id}/subgraph —
 *     that faction's real ORBAT parent/child hierarchy + real Locations,
 *     capped and disclosed via `truncated` (a major theatre's faction can
 *     have thousands of real linked locations/units).
 *   - Any node click: GET /api/forge/ontology/node/{id}/connections — the
 *     real entity panel (name, real attributes, real connected-entity
 *     list, each itself clickable to re-center).
 *
 * Legible at real global scale by construction: countries render as a
 * wrapping card grid (never a dense force layout), and only a clicked
 * country's/faction's own real children ever render — nothing more is
 * fetched or drawn until requested.
 */
import { useState, useEffect, useCallback } from "react"
import API_BASE from "../../apiBase.js"

function headers() {
    return { Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}` }
}

const TYPE_COLOR = {
    country: "#60a5fa", faction: "#f59e0b", org: "#a78bfa", event: "#4ade80",
    vessel: "#38bdf8", aircraft: "#38bdf8", cable: "#f472b6", chokepoint: "#f87171",
    alert: "#ef4444", correlation: "#facc15",
}
const REL_STYLE = {
    allied_with:     { color: "#4ade80", dash: "none" },
    adversarial_to:  { color: "#ef4444", dash: "6,3" },
    neutral_with:    { color: "#94a3b8", dash: "2,4" },
}

function typeColor(t) { return TYPE_COLOR[t] || "#94a3b8" }

export default function OntologyCountryGraph() {
    const [countries, setCountries]         = useState([])
    const [relationships, setRelationships] = useState([])
    const [loaded, setLoaded]               = useState(false)
    const [expandedCountry, setExpandedCountry] = useState(null) // {id, iso_code, nodes, edges}
    const [expandedFaction, setExpandedFaction] = useState(null) // {id, nodes, edges, truncated}
    const [selected, setSelected]           = useState(null)     // {id, type, label, attributes, connections}
    const [panelLoading, setPanelLoading]   = useState(false)
    const [search, setSearch]               = useState("")
    const [searchResults, setSearchResults] = useState([])
    const [searchOpen, setSearchOpen]       = useState(false)

    const reload = useCallback(() => {
        fetch(`${API_BASE}/api/forge/ontology/countries`, { headers: headers() })
            .then(r => r.ok ? r.json() : { countries: [], relationships: [] })
            .then(d => { setCountries(d.countries || []); setRelationships(d.relationships || []); setLoaded(true) })
            .catch(() => setLoaded(true))
    }, [])

    useEffect(() => { reload() }, [reload])

    // Real entity panel — fetched fresh for whatever node was just clicked.
    // Returns the fetched data so callers (e.g. search selection) can use
    // its real connection list without a second round-trip.
    const openEntity = useCallback((nodeId) => {
        setPanelLoading(true)
        return fetch(`${API_BASE}/api/forge/ontology/node/${encodeURIComponent(nodeId)}/connections`, { headers: headers() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { setSelected(d); setPanelLoading(false); return d })
            .catch(() => { setPanelLoading(false); return null })
    }, [])

    function expandCountry(country, { selectPanel = true } = {}) {
        if (expandedCountry?.id === country.id) { setExpandedCountry(null); setExpandedFaction(null); return }
        setExpandedFaction(null)
        fetch(`${API_BASE}/api/forge/ontology/country/${encodeURIComponent(country.iso_code)}/subgraph`, { headers: headers() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setExpandedCountry({ ...country, ...d }) })
            .catch(() => {})
        if (selectPanel) openEntity(country.id)
    }

    function expandFaction(faction, { selectPanel = true } = {}) {
        if (expandedFaction?.id === faction.id) { setExpandedFaction(null); return }
        fetch(`${API_BASE}/api/forge/ontology/faction/${encodeURIComponent(faction.id)}/subgraph`, { headers: headers() })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setExpandedFaction(d) })
            .catch(() => {})
        if (selectPanel) openEntity(faction.id)
    }

    function runSearch(q) {
        setSearch(q)
        if (!q.trim()) { setSearchResults([]); setSearchOpen(false); return }
        fetch(`${API_BASE}/api/forge/ontology/search?q=${encodeURIComponent(q)}&limit=25`, { headers: headers() })
            .then(r => r.ok ? r.json() : { results: [] })
            .then(d => { setSearchResults(d.results || []); setSearchOpen(true) })
            .catch(() => {})
    }

    function selectSearchResult(res) {
        setSearchOpen(false)
        setSearch("")
        if (res.type === "country") {
            openEntity(res.id)
            const c = countries.find(c => c.id === res.id)
            if (c) expandCountry(c)
            return
        }
        if (res.type === "faction") {
            // Find this faction's real parent country from its own real
            // connections (located_in / same_polity_as -> a country node),
            // rather than assuming one is already expanded.
            openEntity(res.id).then(d => {
                const countryConn = (d?.connections || []).find(c => c.type === "country")
                if (countryConn) {
                    const c = countries.find(c => c.id === countryConn.id)
                    if (c) expandCountry(c, { selectPanel: false })
                }
                expandFaction({ id: res.id }, { selectPanel: false })
            })
            return
        }
        // Any other real entity (event/org/vessel/etc.) — open its real
        // panel directly; drilling the full country->faction ancestry for
        // an arbitrary deep node is real future work, not attempted here.
        openEntity(res.id)
    }

    // Real connected-id set for the currently selected entity, used to
    // highlight/dim whatever is currently rendered on screen.
    const connectedIds = new Set((selected?.connections || []).map(c => c.id))
    const isDimmed = (id) => selected && id !== selected.id && !connectedIds.has(id)

    return (
        <div style={{ display: "flex", height: "100%" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: 16, position: "relative" }}>
                <div style={{ position: "relative", marginBottom: 14 }}>
                    <input
                        value={search}
                        onChange={e => runSearch(e.target.value)}
                        placeholder="Search any real entity by name or id…"
                        style={{
                            width: "100%", maxWidth: 360, padding: "6px 10px", borderRadius: 5,
                            border: "1px solid rgba(148,163,184,0.2)", background: "#0a0e1a",
                            color: "#e2e8f0", fontSize: 12,
                        }}
                    />
                    {searchOpen && searchResults.length > 0 && (
                        <div style={{
                            position: "absolute", top: 30, left: 0, width: 360, maxHeight: 260, overflowY: "auto",
                            background: "#0d1422", border: "1px solid rgba(148,163,184,0.15)", borderRadius: 5, zIndex: 20,
                        }}>
                            {searchResults.map(r => (
                                <div key={r.id} onClick={() => selectSearchResult(r)}
                                    style={{ padding: "6px 10px", cursor: "pointer", fontSize: 11, color: "#cbd5e1", borderBottom: "1px solid rgba(148,163,184,0.06)" }}
                                    onMouseEnter={e => e.currentTarget.style.background = "#141b2b"}
                                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                                    <span style={{ color: typeColor(r.type), fontWeight: 600, marginRight: 6, fontSize: 9, textTransform: "uppercase" }}>{r.type}</span>
                                    {r.label}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {!loaded && <div style={{ color: "#475569", fontSize: 12 }}>Loading…</div>}
                {loaded && countries.length === 0 && (
                    <div style={{ color: "#334155", fontSize: 12 }}>No real Country entities yet — sync GeoConfirmed data first.</div>
                )}

                {/* Real inter-country relationships legend — only shown once at
                    least one real claim-sourced relationship edge exists. */}
                {relationships.length > 0 && (
                    <div style={{ display: "flex", gap: 14, marginBottom: 10, fontSize: 10, color: "#64748b" }}>
                        {Object.entries(REL_STYLE).map(([type, s]) => (
                            <div key={type} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <div style={{ width: 16, height: 2, background: s.color }} />
                                <span style={{ textTransform: "capitalize" }}>{type.replace(/_/g, " ")}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                    {countries.map(c => {
                        const dim = isDimmed(c.id)
                        const isSel = selected?.id === c.id
                        return (
                            <div key={c.id}>
                                <div
                                    onClick={() => expandCountry(c)}
                                    style={{
                                        width: 168, padding: "10px 12px", borderRadius: 6, cursor: "pointer",
                                        background: expandedCountry?.id === c.id ? "#12213a" : "#0d1422",
                                        border: `1.5px solid ${isSel ? "#60a5fa" : dim ? "rgba(148,163,184,0.08)" : "rgba(148,163,184,0.18)"}`,
                                        opacity: dim ? 0.4 : 1, transition: "opacity 0.15s",
                                    }}>
                                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                                        {c.flag_path
                                            ? <img src={c.flag_path} alt="" style={{ width: 20, height: 14, objectFit: "cover", borderRadius: 2 }} />
                                            : <div style={{ width: 20, height: 14, borderRadius: 2, background: "rgba(148,163,184,0.15)" }} />}
                                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{c.label}</span>
                                    </div>
                                    <div style={{ fontSize: 10, color: "#64748b" }}>{c.faction_count} real faction{c.faction_count === 1 ? "" : "s"}</div>
                                </div>

                                {expandedCountry?.id === c.id && (
                                    <div style={{ marginTop: 6, marginLeft: 14, paddingLeft: 10, borderLeft: "2px solid rgba(96,165,250,0.25)", display: "flex", flexDirection: "column", gap: 6 }}>
                                        {expandedCountry.nodes.filter(n => n.type === "faction").length === 0 && (
                                            <div style={{ fontSize: 10, color: "#475569" }}>No real factions linked to this country yet.</div>
                                        )}
                                        {expandedCountry.nodes.filter(n => n.type === "faction").map(f => {
                                            const fDim = isDimmed(f.id)
                                            const fSel = selected?.id === f.id
                                            return (
                                                <div key={f.id}>
                                                    <div onClick={() => expandFaction(f)}
                                                        style={{
                                                            padding: "5px 9px", borderRadius: 4, cursor: "pointer", fontSize: 11,
                                                            background: expandedFaction?.id === f.id ? "#1a2438" : "transparent",
                                                            border: `1px solid ${fSel ? "#f59e0b" : "rgba(245,158,11,0.2)"}`,
                                                            color: "#fbbf24", opacity: fDim ? 0.4 : 1,
                                                        }}>
                                                        {f.label}
                                                    </div>
                                                    {expandedFaction?.id === f.id && (
                                                        <FactionDetail data={expandedFaction} isDimmed={isDimmed} selectedId={selected?.id}
                                                            onNodeClick={openEntity} />
                                                    )}
                                                </div>
                                            )
                                        })}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            </div>

            <EntityPanel selected={selected} loading={panelLoading} onSelectConnection={openEntity} onClose={() => setSelected(null)} />
        </div>
    )
}

function FactionDetail({ data, isDimmed, selectedId, onNodeClick }) {
    const orbatUnits = data.nodes.filter(n => n.type === "org")
    const locations   = data.nodes.filter(n => n.type === "event")
    return (
        <div style={{ marginTop: 6, marginLeft: 10, paddingLeft: 10, borderLeft: "2px solid rgba(245,158,11,0.2)", display: "flex", flexDirection: "column", gap: 8 }}>
            {data.truncated && (
                <div style={{ fontSize: 9, color: "#f59e0b" }}>Showing a real bounded subset — this faction has more real linked data than fits here.</div>
            )}
            {orbatUnits.length > 0 && (
                <div>
                    <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>ORBAT units ({orbatUnits.length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, maxHeight: 120, overflowY: "auto" }}>
                        {orbatUnits.slice(0, 60).map(u => (
                            <div key={u.id} onClick={() => onNodeClick(u.id)}
                                style={{ padding: "2px 7px", borderRadius: 10, fontSize: 9.5, cursor: "pointer",
                                    background: "rgba(167,139,250,0.1)", color: "#c4b5fd",
                                    border: `1px solid ${selectedId === u.id ? "#a78bfa" : "transparent"}`,
                                    opacity: isDimmed(u.id) ? 0.4 : 1 }}>
                                {u.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {locations.length > 0 && (
                <div>
                    <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>Locations ({locations.length})</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 140, overflowY: "auto" }}>
                        {locations.slice(0, 40).map(loc => (
                            <div key={loc.id} onClick={() => onNodeClick(loc.id)}
                                style={{ fontSize: 10, cursor: "pointer", color: selectedId === loc.id ? "#4ade80" : "#94a3b8",
                                    opacity: isDimmed(loc.id) ? 0.4 : 1 }}>
                                · {loc.label}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}

function EntityPanel({ selected, loading, onSelectConnection, onClose }) {
    return (
        <div style={{
            width: 300, flexShrink: 0, borderLeft: "1px solid rgba(148,163,184,0.08)",
            background: "#080c16", overflowY: "auto", padding: selected || loading ? 14 : 0,
        }}>
            {loading && <div style={{ color: "#475569", fontSize: 11 }}>Loading real entity data…</div>}
            {!loading && !selected && (
                <div style={{ padding: 14, color: "#334155", fontSize: 11 }}>Click any entity to inspect its real connections and attributes.</div>
            )}
            {!loading && selected && (
                <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                        <div>
                            <div style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: typeColor(selected.type) }}>{selected.type}</div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0" }}>{selected.label}</div>
                        </div>
                        <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15 }}>✕</button>
                    </div>

                    {Object.keys(selected.attributes || {}).length > 0 && (
                        <div style={{ marginBottom: 14 }}>
                            <SectionLabel>Real held information</SectionLabel>
                            {Object.entries(selected.attributes).map(([k, v]) => (
                                k === "flag_path"
                                    ? <div key={k} style={{ marginBottom: 6 }}><img src={v} alt="" style={{ maxWidth: 80, borderRadius: 3 }} /></div>
                                    : (
                                        <div key={k} style={{ fontSize: 10.5, color: "#94a3b8", marginBottom: 3 }}>
                                            <span style={{ color: "#475569" }}>{k.replace(/_/g, " ")}: </span>
                                            {String(v).slice(0, 240)}
                                        </div>
                                    )
                            ))}
                        </div>
                    )}

                    <SectionLabel>Real connected entities ({selected.connections?.length || 0})</SectionLabel>
                    {(!selected.connections || selected.connections.length === 0) && (
                        <div style={{ fontSize: 10.5, color: "#334155" }}>No real connections recorded for this entity.</div>
                    )}
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {(selected.connections || []).map((c, i) => (
                            <div key={i} onClick={() => onSelectConnection(c.id)}
                                style={{ fontSize: 11, cursor: "pointer", color: "#cbd5e1", padding: "3px 0", borderBottom: "1px solid rgba(148,163,184,0.05)" }}>
                                <span style={{ color: typeColor(c.type), fontSize: 9, fontWeight: 600, textTransform: "uppercase", marginRight: 6 }}>{c.type}</span>
                                {c.label}
                                <span style={{ color: "#475569", fontSize: 9.5, marginLeft: 6 }}>
                                    ({c.relationship_type}{c.auto ? ", auto-derived" : c.claim_id ? ", reviewed claim" : ""})
                                </span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}

function SectionLabel({ children }) {
    return <div style={{ fontSize: 9, fontWeight: 700, color: "rgba(148,163,184,0.5)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>{children}</div>
}
