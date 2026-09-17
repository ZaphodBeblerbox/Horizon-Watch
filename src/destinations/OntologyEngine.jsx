/**
 * OntologyEngine.jsx — PARALLAX §17.3, the five layers in pipeline order:
 * Provenance · Ingestion · Detectors · Discovery · Exposure.
 *
 * Only Provenance is populated here, and it is populated FROM REAL ROWS: the
 * origin_class × licence_tier matrix is counted over what this database
 * actually holds, not declared. The other four layers are named with what
 * they would carry and marked as not built, because the alternative — four
 * panes of plausible-looking numbers — is the failure this whole app's
 * "never fabricate a field" rule exists to prevent.
 *
 * §18's rule for the matrix: origin_class is an EVIDENCE judgement,
 * licence_tier is a LEGAL one. NEVER ONE FIELD.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { ORIGIN_CLASS, LICENCE_TIER } from "../inspector/ontologyRecord.js"

const LAYERS = [
    { n: 1, key: "provenance", name: "Provenance", sub: "origin class × licence tier", built: true },
    { n: 2, key: "ingestion", name: "Ingestion", sub: "the nine-stage contract", built: false },
    { n: 3, key: "detectors", name: "Detectors", sub: "23 baselines (§18)", built: false },
    { n: 4, key: "discovery", name: "Discovery", sub: "candidate structures, BH-corrected q", built: false },
    { n: 5, key: "exposure", name: "Exposure", sub: "per client, per profile", built: false },
]

const CLASSES = ["A", "B", "C", "D"]
const TIERS = ["T1", "T2", "T3", "T4"]

export default function OntologyEngine() {
    const [layer, setLayer] = useState("provenance")
    const [matrix, setMatrix] = useState(null)

    useEffect(() => {
        if (layer !== "provenance") return
        let cancelled = false
        fetch(`${API_BASE}/api/ontology/provenance-matrix`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (!cancelled) setMatrix(d) })
            .catch(() => { if (!cancelled) setMatrix({ error: true }) })
        return () => { cancelled = true }
    }, [layer])

    return (
        <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", height: "100%", overflow: "hidden" }}>
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", padding: 10 }}>
                {LAYERS.map((l) => (
                    <button key={l.key} type="button" onClick={() => setLayer(l.key)}
                            style={{
                                display: "block", width: "100%", textAlign: "left", background: layer === l.key ? "var(--bg-3)" : "none",
                                border: 0, padding: "6px 8px", cursor: "pointer", color: "inherit",
                                opacity: l.built ? 1 : 0.55,
                            }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>{l.n} {l.name}</div>
                        <div style={{ font: "9.5px var(--mono)", color: "var(--txt-4)" }}>
                            {l.sub}{l.built ? "" : " · not built"}
                        </div>
                    </button>
                ))}
            </div>

            <div style={{ overflowY: "auto", padding: 14 }}>
                {layer !== "provenance" ? (
                    <div className="scanhint" style={{ maxWidth: 520 }}>
                        This layer is not built. It is listed because §17.3 defines the
                        pipeline and the order matters; showing it with invented figures
                        would make the engine look complete while telling you nothing true.
                    </div>
                ) : !matrix ? (
                    <div className="risknote">Counting rows…</div>
                ) : matrix.error ? (
                    <div className="risknote">Provenance matrix unavailable.</div>
                ) : (
                    <>
                        <p className="risknote" style={{ padding: 0, maxWidth: 560 }}>
                            <b style={{ color: "var(--txt-2)" }}>origin_class</b> is an evidence judgement —
                            who observed this, and how directly. <b style={{ color: "var(--txt-2)" }}>licence_tier</b> is
                            a legal one, about what may be redistributed. Never one field: collapsing them
                            loses the ability to answer either question.
                        </p>
                        <table style={{ borderCollapse: "collapse", margin: "12px 0", font: "11px var(--mono)" }}>
                            <thead>
                                <tr>
                                    <th style={cell(true)}></th>
                                    {TIERS.map((t) => (
                                        <th key={t} style={cell(true)} title={LICENCE_TIER[t]}>{t}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {CLASSES.map((c) => (
                                    <tr key={c}>
                                        <th style={cell(true)} title={ORIGIN_CLASS[c]}>{c}</th>
                                        {TIERS.map((t) => {
                                            const v = matrix.matrix?.[c]?.[t] || 0
                                            return (
                                                <td key={t} style={{ ...cell(false), color: v ? "var(--txt)" : "var(--txt-4)" }}>
                                                    {v ? v.toLocaleString() : "·"}
                                                </td>
                                            )
                                        })}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ font: "10.5px var(--mono)", color: "var(--txt-4)" }}>
                            {(matrix.tables || []).map((t) => (
                                <div key={t.table}>{t.table} · {t.rows.toLocaleString()} rows
                                    {t.untraceable ? ` · ${t.untraceable.toLocaleString()} with no class` : ""}</div>
                            ))}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

const cell = (head) => ({
    border: "1px solid var(--line)",
    padding: "5px 12px",
    textAlign: head ? "left" : "right",
    background: head ? "var(--bg-2)" : "var(--bg-1)",
    color: "var(--txt-3)",
    cursor: head ? "help" : "default",
})
