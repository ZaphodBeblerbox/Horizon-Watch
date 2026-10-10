/**
 * OntologyCard.jsx — the sidebar's "In the ontology": a small graph of
 * whatever the sidebar shows, every entity, place, object, action and
 * signal alike (owner, 2026-10-10).
 *
 * The graph: the thing in the middle, what it connects to around it. Click
 * a node to walk to it here, with the way back; "Full ontology" opens the
 * overlay (two steps out, every link with its basis, ORBAT for units).
 * A military unit shows where it sits in its order of battle right here.
 */
import { useEffect, useState } from "react"
import SectionLabel from "../inspector/SectionLabel.jsx"
import OntologyGraph, { Legend } from "./OntologyGraph.jsx"
import OntologyOverlay, { OrbatTree } from "./OntologyOverlay.jsx"
import { fetchOntology } from "./ontologyApi.js"
import { summarise } from "./radialLayout.js"

export default function OntologyCard({ entityType, data }) {
    const [stack, setStack] = useState([])            // walked-to graph ids: [{id, label}]
    const [graph, setGraph] = useState(undefined)     // undefined: loading; null: nothing
    const [open, setOpen] = useState(false)
    useEffect(() => { setStack([]) }, [entityType, data])
    const here = stack.length ? stack[stack.length - 1] : null

    useEffect(() => {
        let live = true
        setGraph(undefined)
        const q = here ? { id: here.id } : { entityType, data }
        if (!here && (!entityType || !data)) { setGraph(null); return undefined }
        fetchOntology(q).then((g) => { if (live) setGraph(g && (g.nodes?.length || g.orbat) ? g : null) })
            .catch(() => { if (live) setGraph(null) })
        return () => { live = false }
    }, [here, entityType, data])

    if (graph === undefined) {
        return (
            <div data-testid="ontology-card" style={{ marginBottom: "var(--space-4)" }}>
                <SectionLabel>In the ontology</SectionLabel>
                <div style={{ height: 120, display: "grid", placeItems: "center", font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>Reading…</div>
            </div>
        )
    }
    if (!graph) return null
    const start = here ? { id: here.id, label: here.label } : { entityType, data, label: graph.root.label }
    const isUnit = ["faction", "unit"].includes(graph.root.type)
    return (
        <div data-testid="ontology-card" style={{ marginBottom: "var(--space-4)" }}>
            <SectionLabel meta={`${(graph.nodes || []).length} link${(graph.nodes || []).length === 1 ? "" : "s"}`}>In the ontology</SectionLabel>
            {stack.length > 0 && (
                <button onClick={() => setStack((s) => s.slice(0, -1))}
                        style={{ border: 0, background: "none", padding: 0, marginBottom: 4, cursor: "pointer", font: "400 11px var(--font)", color: "var(--acc-hi, var(--acchi))" }}>
                    ← back to {stack.length > 1 ? stack[stack.length - 2].label : "this record"}
                </button>
            )}
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, margin: "2px 0 0" }}>
                <b style={{ font: "600 12.5px var(--font)", color: "var(--txt)", overflowWrap: "anywhere" }}>{graph.root.label}</b>
            </div>
            <OntologyGraph graph={summarise(graph, 10)} width={320} height={240} labelChars={16}
                           onPick={(n) => {
                               if (n.walk && n.id !== graph.root.id) setStack((s) => [...s, { id: n.walk, label: n.label }])
                               else if (n.members) setOpen(true)
                           }} />
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                <Legend graph={graph} />
                <button data-testid="ontology-open" onClick={() => setOpen(true)}
                        style={{ flex: "none", height: 26, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt-2)", font: "500 11.5px var(--font)", cursor: "pointer" }}>
                    Full ontology
                </button>
            </div>
            {graph.orbat && (
                <div style={{ marginTop: 10 }}>
                    <div style={{ font: "600 11px var(--font)", color: "var(--txt-2)", marginBottom: 4 }}>Order of battle</div>
                    <OrbatTree orbat={graph.orbat} compact onWalk={(id, label) => setStack((s) => [...s, { id, label }])} />
                </div>
            )}
            {isUnit && !graph.orbat && (
                <div style={{ marginTop: 8, font: "400 11px var(--font)", color: "var(--txt-4)" }}>No order of battle on record for this unit.</div>
            )}
            {open && <OntologyOverlay start={start} onClose={() => setOpen(false)} />}
        </div>
    )
}
