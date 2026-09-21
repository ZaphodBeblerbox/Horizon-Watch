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
 * TWO SECTIONS, AND THEY MUST NOT LOOK ALIKE. Known links are recorded
 * facts with a source. Inferred links are this system's guesses: they
 * are drawn dimmer, labelled inferred, carry their confidence and their
 * chain, and can never exceed 0.6 by construction. A reader who cannot
 * tell the two apart at a glance is being misled, so the dashed border
 * and the word "inferred" are not decoration.
 */
import { useEffect, useState } from "react"
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
            borderLeft: dashed ? "2px dashed var(--line-2, var(--line))" : "none",
            paddingLeft: dashed ? 8 : 0,
            opacity: dim ? 0.75 : 1,
        }}>{children}</div>
    )
}

export default function EntityLinksPanel({ entityType, data }) {
    const [state, setState] = useState({ loading: true, known: [], inferred: [], node: null })

    useEffect(() => {
        let cancelled = false
        const direct = graphIdFor(entityType, data)
        const term = searchTermFor(data)
        if (!direct && !term) { setState({ loading: false, known: [], inferred: [], node: null }); return }

        const resolve = direct
            ? Promise.resolve(direct)
            : fetch(`${API_BASE}/api/ontology/graph/search?q=${encodeURIComponent(term)}&limit=1`,
                    { credentials: "include" })
                .then((r) => (r.ok ? r.json() : null))
                .then((d) => safeArray(d?.results)[0]?.id || null)

        resolve
            .then((id) => {
                if (!id) { if (!cancelled) setState({ loading: false, known: [], inferred: [], node: null }); return null }
                return Promise.all([
                    fetch(`${API_BASE}/api/ontology/graph/neighbourhood?root=${encodeURIComponent(id)}&hops=1&limit_per_hop=40`,
                          { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
                    fetch(`${API_BASE}/api/ontology/predict?root=${encodeURIComponent(id)}&limit=8`,
                          { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
                ]).then(([nb, pred]) => {
                    if (cancelled) return
                    const labels = {}
                    for (const n of safeArray(nb?.nodes)) labels[n.id] = n.label || n.id
                    const known = safeArray(nb?.edges).map((e) => ({
                        id: e.id,
                        relation: e.relation,
                        other: e.src === id ? e.dst : e.src,
                        otherLabel: labels[e.src === id ? e.dst : e.src] || (e.src === id ? e.dst : e.src),
                        outward: e.src === id,
                        basis: e.basis,
                        conf: e.conf,
                    }))
                    setState({
                        loading: false, node: id, known,
                        inferred: safeArray(pred?.predictions),
                    })
                })
            })
            .catch(() => { if (!cancelled) setState({ loading: false, known: [], inferred: [], node: null }) })

        return () => { cancelled = true }
    }, [entityType, data])

    const { loading, known, inferred, node } = state

    // Rule 5: an empty pane explains itself. "Nothing here" and "this
    // entity is not in the graph at all" are different answers and the
    // reader has to be able to tell which one they got.
    if (loading) {
        return <Block><span style={muted}>Looking for connections…</span></Block>
    }
    if (!node) {
        return <Block><span style={muted}>
            This record is not in the connection graph, so nothing can be said
            about what it links to.
        </span></Block>
    }
    if (!known.length && !inferred.length) {
        return <Block><span style={muted}>
            In the graph, with no connections recorded or inferred yet.
        </span></Block>
    }

    return (
        <Block>
            {known.length > 0 && (
                <>
                    <div style={subLabel}>Recorded · {known.length}</div>
                    {known.slice(0, 12).map((l) => (
                        <Row key={l.id}>
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                <span style={{ color: "var(--txt-4)" }}>
                                    {l.outward ? "" : "← "}{l.relation}{l.outward ? " →" : ""}
                                </span>{" "}
                                {l.otherLabel}
                            </div>
                            {l.basis ? (
                                <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>
                                    {l.basis}
                                </div>
                            ) : null}
                        </Row>
                    ))}
                </>
            )}

            {inferred.length > 0 && (
                <>
                    <div style={{ ...subLabel, marginTop: 10 }}>
                        Inferred · {inferred.length}
                        <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginLeft: 6 }}>
                            not observed — each step should be checked
                        </span>
                    </div>
                    {inferred.map((p) => (
                        <Row key={`${p.src}-${p.dst}`} dim dashed>
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                {p.dst_label}
                                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", marginLeft: 6 }}>
                                    {Math.round((p.conf || 0) * 100)}% · {p.paths} route{p.paths === 1 ? "" : "s"}
                                </span>
                            </div>
                            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>
                                {p.basis}
                            </div>
                        </Row>
                    ))}
                </>
            )}
        </Block>
    )
}

const muted = { font: "400 11px var(--font)", color: "var(--txt-4)" }
const subLabel = { font: "600 10px var(--font)", color: "var(--txt-3)",
                   textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 2 }

function Block({ children }) {
    return (
        <div style={{ padding: "10px 0 2px" }}>
            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>
                Connections
            </div>
            {children}
        </div>
    )
}
