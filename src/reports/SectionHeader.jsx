/**
 * Shared section header for the 10-fixed-section + Annex document layout —
 * a small circled index number + the section title, per the spec's
 * `--text-section-head` styling. Used identically by Reading mode (read-only
 * document) and Editing mode (editable document), so the two can never
 * visually drift apart on what a section header looks like.
 *
 * Props:
 *   number — section.number ("1".."10" or "A")
 *   title  — section.title
 *   right  — optional node rendered right-aligned in the header row (Editing
 *            mode's per-section weight label uses this slot).
 */
export default function SectionHeader({ number, title, right }) {
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "var(--space-5)", marginBottom: "var(--space-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <span style={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    width: 20, height: 20, borderRadius: "50%",
                    border: "1px solid var(--border-strong)", color: "var(--text-secondary)",
                    fontFamily: "var(--font-mono)", fontSize: "10px", flexShrink: 0,
                }}>{number}</span>
                <span style={{ color: "var(--text-primary)", fontSize: "var(--text-section-head)", fontWeight: "var(--weight-semibold)" }}>
                    {title}
                </span>
            </div>
            {right}
        </div>
    )
}
