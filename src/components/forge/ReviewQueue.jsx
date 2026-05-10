import { useState } from "react"

// Base review-queue component for active-learning flows.
// Props:
//   items        : array of items to review (each needs .id)
//   onLabel      : (id, label, extra) => void  — persistence callback
//   renderCard   : (item, labelFn)    => node  — renders card + buttons; call labelFn(label, extra) to advance
//   loading      : bool
//   onGenerate   : () => void  — called by "Generate Batch" button
//   generateLabel: string
export default function ReviewQueue({
    items = [],
    onLabel,
    renderCard,
    loading = false,
    onGenerate,
    generateLabel = "Generate Batch",
}) {
    const [decisions, setDecisions] = useState({})

    const pending = items.filter(i => !decisions[i.id])
    const current = pending[0] ?? null
    const total   = items.length
    const done    = Object.keys(decisions).length
    const pct     = total > 0 ? Math.round((done / total) * 100) : 0

    const advance = (id, label, extra = {}) => {
        setDecisions(prev => ({ ...prev, [id]: { label, ...extra } }))
        onLabel?.(id, label, extra)
    }

    const reset = () => setDecisions({})

    const emptyBox = (children) => (
        <div style={{
            color: "#64748b", fontSize: 13, padding: "32px 20px", textAlign: "center",
            background: "rgba(15,23,42,0.5)", borderRadius: 8,
            border: "1px dashed rgba(56,189,248,0.18)",
        }}>
            {children}
        </div>
    )

    if (loading) return emptyBox(
        <span style={{ color: "#94a3b8" }}>Scanning… this may take up to 30 seconds.</span>
    )

    if (!items.length) return emptyBox(
        <>
            <div style={{ marginBottom: 14 }}>No items in queue.</div>
            {onGenerate && <button onClick={onGenerate} style={btnPrimary}>{generateLabel}</button>}
        </>
    )

    if (!current) return emptyBox(
        <>
            <div style={{ color: "#22c55e", fontSize: 15, fontWeight: 700, marginBottom: 8 }}>✓ Queue complete</div>
            <div style={{ marginBottom: 18 }}>Labeled {done} of {total} items.</div>
            {onGenerate && (
                <button onClick={() => { reset(); onGenerate() }} style={btnPrimary}>{generateLabel}</button>
            )}
        </>
    )

    return (
        <div>
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b", marginBottom: 5 }}>
                    <span>Labeled {done} / {total}</span>
                    <span>{pending.length} remaining</span>
                </div>
                <div style={{ height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
                    <div style={{
                        height: "100%", borderRadius: 2,
                        background: "linear-gradient(90deg, #38bdf8, #818cf8)",
                        width: `${pct}%`, transition: "width 0.25s",
                    }} />
                </div>
            </div>
            {renderCard(current, (label, extra) => advance(current.id, label, extra))}
        </div>
    )
}

const btnPrimary = {
    padding: "8px 18px", borderRadius: 6, border: "none",
    background: "#38bdf8", color: "#0f172a", fontWeight: 700,
    cursor: "pointer", fontSize: 12,
}
