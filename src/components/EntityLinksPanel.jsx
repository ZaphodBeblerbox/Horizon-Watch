/**
 * EntityLinksPanel.jsx — what this entity is connected to, and what it
 * probably is connected to.
 *
 * WHY IT IS HERE AND NOT ONLY ON THE ONTOLOGY PAGE. The graph was
 * reachable exactly one way: by going to Ontology and searching for
 * something. That is the wrong way round. An operator meets an entity
 * on the map, in the middle of doing something else, and the question
 * "what else is this attached to" arrives there — not on a separate
 * page they have to remember to visit.
 *
 * ONE ENTITY AT A TIME (the owner, 2026-10-10). The ontology stays whole
 * in the background; the sidebar materialises only the node asked for —
 * its type, the attributes actually populated, the relations that have
 * something behind them — and walks: a click on a related entity shows
 * that one instead, with the way back. "See detail" opens the ontology
 * page on the same node: same id, same model, more room.
 *
 * TWO SECTIONS, AND THEY MUST NOT LOOK ALIKE. Known links are recorded
 * facts with a source. Inferred links are this system's guesses: they
 * are drawn dimmer, labelled inferred, carry their confidence and their
 * chain, and can never exceed 0.6 by construction. A reader who cannot
 * tell the two apart at a glance is being misled, so the dashed border
 * and the word "inferred" are not decoration.
 */
import SectionLabel from "../inspector/SectionLabel.jsx"
import { useEffect, useMemo, useState } from "react"
import { BarList } from "../charts/Columns.jsx"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"

/**
 * The graph id for an inspector record, where it can be built directly.
 *
 * Built rather than searched wherever possible: a name search for a
 * vessel called "Pacific" returns a dozen of them, and picking the
 * wrong one would attach another ship's connections to this record.
 */
export function graphIdFor(entityType, data) {
    if (!data) return null
    const mmsi = data.mmsi ?? data.MMSI
    if (entityType === "vessel" && mmsi) return `vessel:${mmsi}`
    if (entityType === "country" && (data.iso2 || data.code)) {
        return `country:${String(data.iso2 || data.code).toUpperCase()}`
    }
    return null
}

/** The label to fall back to searching on. */
export function searchTermFor(data) {
    const t = data?.name || data?.label || data?.title || data?.vessel_name
    const s = String(t || "").trim()
    return s.length >= 3 ? s : null
}

function Row({ children, dim = false, dashed = false }) {
    return (
        <div style={{
            padding: "5px 0",
            borderBottom: "1px solid var(--line)",
            fontStyle: dashed ? "italic" : "normal",
            opacity: dim ? 0.75 : 1,
        }}>{children}</div>
    )
}

/** Open the ontology page standing on this node. */
export function openInOntology(id, label) {
    window.__plxOntologyFocus = { id, label }
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "ontology" } }))
    window.dispatchEvent(new CustomEvent("akili:ontology-focus", { detail: { id, label } }))
}

// Attributes worth a row: populated, not internal plumbing.
const HIDDEN = /^(id|_|source_id|created|updated|raw|geom|props_json)/i
export function attributesOf(node) {
    if (!node) return []
    const out = []
    if (node.country) out.push(["Country", node.country])
    if (node.risk != null && node.risk !== "") out.push(["Risk", String(node.risk)])
    for (const [k, v] of Object.entries(node.props || {})) {
        if (HIDDEN.test(k) || v == null || v === "" || (Array.isArray(v) && !v.length) || typeof v === "object" && !Array.isArray(v)) continue
        out.push([k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), Array.isArray(v) ? v.slice(0, 6).join(", ") : String(v).slice(0, 120)])
    }
    return out.slice(0, 10)
}

async function hood(id) {
    const r = await fetch(`${API_BASE}/api/ontology/graph/neighbourhood?id=${encodeURIComponent(id)}&hops=1&limit_per_hop=60`, { credentials: "include" })
    return r.ok ? r.json() : null
}

export default function EntityLinksPanel({ entityType, data }) {
    const [root, setRoot] = useState(undefined)          // undefined: resolving; null: not in the graph
    const [stack, setStack] = useState([])               // the walk inside the sidebar: [{id, label}]
    const [view, setView] = useState({ loading: true, node: null, known: [] })
    const [inferred, setInferred] = useState([])
    const [relFilter, setRelFilter] = useState(null)

    // Which node this record is.
    useEffect(() => {
        let cancelled = false
        setRoot(undefined); setStack([]); setRelFilter(null)
        const direct = graphIdFor(entityType, data)
        const term = searchTermFor(data)
        if (!direct && !term) { setRoot(null); return undefined }
        const resolve = direct
            ? Promise.resolve(direct)
            : fetch(`${API_BASE}/api/ontology/graph/search?q=${encodeURIComponent(term)}&limit=1`, { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => safeArray(d?.results)[0]?.id || null)
        resolve.then((id) => { if (!cancelled) setRoot(id || null) }).catch(() => { if (!cancelled) setRoot(null) })
        return () => { cancelled = true }
    }, [entityType, data])

    const current = stack.length ? stack[stack.length - 1].id : root

    // The node in view and its recorded links. The parameter is `id`, not
    // `root` (a 422 used to read as "not in the graph"), and the payload
    // calls them `links`, not `edges`.
    useEffect(() => {
        if (!current) { setView({ loading: root === undefined, node: null, known: [] }); return undefined }
        let cancelled = false
        setView((v) => ({ ...v, loading: true }))
        setRelFilter(null)
        hood(current).then((nb) => {
            if (cancelled) return
            const byId = new Map(safeArray(nb?.nodes).map((n) => [n.id, n]))
            const known = safeArray(nb?.links).filter((e) => e.src === current || e.dst === current).map((e) => {
                const other = e.src === current ? e.dst : e.src
                return { id: e.id || `${e.src}>${e.dst}:${e.relation}`, relation: e.relation, other,
                         otherLabel: byId.get(other)?.label || other, otherType: byId.get(other)?.type,
                         outward: e.src === current, basis: e.basis, conf: e.conf }
            })
            setView({ loading: false, node: byId.get(current) || null, known })
        }).catch(() => { if (!cancelled) setView({ loading: false, node: null, known: [] }) })
        return () => { cancelled = true }
    }, [current, root])

    // The system's inferences, for the record itself only.
    useEffect(() => {
        if (!root) { setInferred([]); return undefined }
        let cancelled = false
        fetch(`${API_BASE}/api/ontology/predict?root=${encodeURIComponent(root)}&limit=8`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setInferred(safeArray(d?.predictions)) })
            .catch(() => { if (!cancelled) setInferred([]) })
        return () => { cancelled = true }
    }, [root])

    const { loading, node, known } = view
    const relCounts = useMemo(() => {
        const m = new Map()
        for (const l of known) m.set(l.relation, (m.get(l.relation) || 0) + 1)
        return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k.replace(/_/g, " "), value: v }))
    }, [known])
    const atRoot = !stack.length
    const shownInferred = atRoot ? inferred : []

    // NOTHING TO SHOW, NOTHING SHOWN: most records are outside the graph,
    // and a paragraph explaining absence on each was noise. The folded
    // Record details still says whether the record is traced.
    if (!current || (!loading && !node && !known.length && !shownInferred.length)) return null
    if (loading && !node) return null

    const label = node?.label || current
    const rows = relFilter ? known.filter((l) => l.relation === relFilter) : known
    return (
        <div data-testid="ontology-node" style={{ marginBottom: "var(--space-4)" }}>
            <SectionLabel meta={node?.type || null}>In the ontology</SectionLabel>
            {!atRoot && (
                <button onClick={() => setStack((s) => s.slice(0, -1))}
                        style={{ border: 0, background: "none", padding: 0, marginBottom: 6, cursor: "pointer", font: "400 11px var(--font)", color: "var(--acc-hi, var(--acchi))" }}>
                    ← back to {stack.length > 1 ? stack[stack.length - 2].label : "this record"}
                </button>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <b style={{ flex: 1, minWidth: 0, font: "600 13.5px var(--font)", color: "var(--txt)", overflowWrap: "anywhere" }}>{label}</b>
                <button onClick={() => openInOntology(current, label)} title="Open the ontology page on this entity"
                        style={{ flex: "none", height: 24, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt-2)", font: "500 11px var(--font)", cursor: "pointer" }}>
                    See detail
                </button>
            </div>
            {attributesOf(node).map(([k, v]) => (
                <div key={k} style={{ display: "grid", gridTemplateColumns: "96px 1fr", gap: 8, padding: "3px 0", font: "400 11.5px var(--font)" }}>
                    <span style={{ color: "var(--txt-4)" }}>{k}</span><span style={{ color: "var(--txt-2)", overflowWrap: "anywhere" }}>{v}</span>
                </div>
            ))}

            {known.length > 0 && (
                <>
                    <div style={{ ...subLabel, marginTop: 10 }}>Recorded <span style={{ fontWeight: 400 }}>· {known.length}</span></div>
                    {relCounts.length > 1 && (
                        <div style={{ margin: "2px 0 6px" }}>
                            <BarList rows={relCounts} selected={relFilter} onSelect={setRelFilter} />
                        </div>
                    )}
                    {rows.slice(0, 14).map((l) => (
                        <Row key={l.id}>
                            <button onClick={() => setStack((s) => [...s, { id: l.other, label: l.otherLabel }])} title={[l.basis, l.conf != null ? `confidence ${Math.round(l.conf * 100)}%` : null].filter(Boolean).join(" · ") || "Show this entity"}
                                    style={{ display: "block", width: "100%", border: 0, background: "none", padding: 0, textAlign: "left", cursor: "pointer", font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                <span style={{ color: "var(--txt-4)" }}>{l.outward ? "" : "← "}{l.relation}{l.outward ? " →" : ""}</span>{" "}
                                <span style={{ color: "var(--txt)", textDecoration: "underline", textDecorationColor: "var(--gline2)", textUnderlineOffset: 2 }}>{l.otherLabel}</span>
                                {l.otherType && <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}> · {l.otherType}</span>}
                            </button>
                            {l.basis ? <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>{l.basis}</div> : null}
                        </Row>
                    ))}
                    {rows.length > 14 && <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", paddingTop: 4 }}>and {rows.length - 14} more on the ontology page</div>}
                </>
            )}

            {shownInferred.length > 0 && (
                <>
                    <div style={{ ...subLabel, marginTop: 10 }}>
                        Inferred · {shownInferred.length}
                        <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginLeft: 6 }}>
                            not observed — each step should be checked
                        </span>
                    </div>
                    {shownInferred.map((p) => (
                        <Row key={`${p.src}-${p.dst}`} dim dashed>
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                {p.dst_label}
                                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginLeft: 6 }}>
                                    {Math.round((p.conf || 0) * 100)}% · {p.paths} route{p.paths === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>{p.basis}</div>
                        </Row>
                    ))}
                </>
            )}
        </div>
    )
}

// A sub-heading inside the section: sentence case, smaller than the
// SectionLabel it sits under, so the hierarchy reads at a glance.
const subLabel = { font: "600 11px var(--font)", color: "var(--txt-2)", marginBottom: 2 }
