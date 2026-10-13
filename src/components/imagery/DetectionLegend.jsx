/**
 * DetectionLegend.jsx — the key to imagery detection outlines.
 *
 * Colour is the class (imageryModel.CLASS_COLORS), the line is what changed
 * since the last pass. The class part lists only the classes present in the
 * pass being shown, so it is read, not skimmed.
 */
import { legendClasses } from "../../destinations/imageryModel.js"

const swatch = (color, dash, opacity = 1) => (
    <svg width="14" height="8" aria-hidden="true" style={{ flex: "none" }}>
        <line x1="1" y1="4" x2="13" y2="4" stroke="rgba(0,0,0,.75)" strokeWidth="5" />
        <line x1="1" y1="4" x2="13" y2="4" stroke={color} strokeWidth="2.6" strokeDasharray={dash || undefined} strokeOpacity={opacity} />
    </svg>
)

export function ClassLegend({ changes, size = 11, style }) {
    const classes = legendClasses(changes)
    if (!classes.length) return null
    return (
        <span data-class-legend={classes.map((c) => c.key).join(" ")}
            style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: size, color: "var(--txt2)", ...style }}>
            {classes.map((c) => (
                <span key={c.key} data-class={c.key} style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                    {swatch(c.color)}{c.label}<span style={{ color: "var(--txt4)" }}>{c.count}</span>
                </span>
            ))}
        </span>
    )
}

/** The line styles. `kinds` limits it (radar passes have no "new"). */
export function KindLegend({ kinds = ["new", "existing", "removed", "unconfirmed"], size = 11, style }) {
    const ROW = {
        new: ["new", null, 1], existing: ["there before", null, 0.7],
        removed: ["gone", "6 4", 1], unconfirmed: ["one model only", "2 3", 1],
    }
    return (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", fontSize: size, color: "var(--txt3)", ...style }}>
            {kinds.filter((k) => ROW[k]).map((k) => (
                <span key={k} style={{ display: "flex", alignItems: "center", gap: 5, whiteSpace: "nowrap" }}>
                    {swatch("var(--txt2)", ROW[k][1], ROW[k][2])}{ROW[k][0]}
                </span>
            ))}
        </span>
    )
}
