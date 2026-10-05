/**
 * SectionLabel.jsx — the one section heading inside a side panel.
 *
 * The inspector alone had three: "ATTRIBUTES" in tracked capitals,
 * "Connections" in sentence-case bold, "RECORDED · 1" in a third size, and
 * the collaboration block a fourth in accent colour. Same job, so one look:
 * small tracked capitals in secondary ink, with an optional count or note
 * after a middle dot in the same line.
 */
export default function SectionLabel({ children, meta = null, style = null }) {
    return (
        <div style={{
            display: "flex", alignItems: "baseline", gap: 6, marginBottom: 8,
            font: "600 10.5px var(--font)", letterSpacing: ".08em", textTransform: "uppercase",
            color: "var(--txt-3, var(--txt3))", ...style,
        }}>
            <span>{children}</span>
            {meta != null && meta !== "" && (
                <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: "none", color: "var(--txt-4, var(--txt4))" }}>
                    · {meta}
                </span>
            )}
        </div>
    )
}
