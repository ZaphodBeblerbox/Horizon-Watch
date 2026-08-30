// Pure style-resolution helpers for the src/ui/ primitives.
// Kept dependency-free (no React import) so they can be unit-tested in plain
// Node without a DOM — see styleHelpers.test.js.
//
// Every value here is a design token (CSS custom property defined in
// index.html's :root block) rather than a literal color/size, so anything
// built from these helpers automatically follows the Round 1 token system:
// hard-edge borders instead of soft box-shadow, no decorative gradients,
// one real font-stack/spacing/radius scale.

export const BUTTON_VARIANTS = ["primary", "ghost", "danger"]
export const BUTTON_SIZES = ["sm", "md"]

/**
 * Resolve the inline-style object for a <Button>.
 *
 * variant: "primary" (solid accent CTA) | "ghost" (transparent, bordered —
 *          the tabBtn/actionBtn/ghostBtn precedent from ForgePanel.jsx) |
 *          "danger" (destructive actions)
 * active:  true for a ghost button acting as a selected tab/mode toggle
 *          (the modeBtn precedent from OverwatchSidebar.jsx)
 * size:    "sm" | "md"
 * disabled: dims + disables pointer affordance
 */
export function buttonStyle({ variant = "primary", size = "md", active = false, disabled = false } = {}) {
    const base = {
        fontFamily: "var(--font-sans)",
        borderRadius: "var(--radius)",
        fontWeight: "var(--weight-semibold)",
        letterSpacing: "0.02em",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-1)",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background 0.15s ease, border-color 0.15s ease, color 0.15s ease",
        ...(size === "sm"
            ? { padding: "4px 10px", fontSize: "var(--text-xs)" }
            : { padding: "7px 14px", fontSize: "var(--text-sm)" }),
    }

    if (variant === "primary") {
        return {
            ...base,
            background: "var(--accent)",
            color: "var(--bg-primary)",
            border: "1px solid var(--accent)",
        }
    }

    if (variant === "danger") {
        return {
            ...base,
            background: "transparent",
            color: "var(--sev-critical)",
            border: "1px solid var(--sev-critical)",
        }
    }

    // "ghost" — also doubles as the tab/mode-toggle look via `active`
    return {
        ...base,
        background: active ? "var(--accent-faint)" : "transparent",
        color: active ? "var(--accent)" : "var(--text-secondary)",
        border: `1px solid ${active ? "var(--accent-border)" : "var(--border-subtle)"}`,
    }
}

/**
 * Resolve the inline-style object for a <Panel>/<Card> shell.
 * elevation is a border (var(--elevation-1/2)), never a box-shadow.
 */
export function panelStyle({ elevated = false, padded = true, elevation = 1 } = {}) {
    return {
        background: elevated ? "var(--bg-elevated)" : "var(--bg-secondary)",
        border: elevation >= 2 ? "var(--elevation-2)" : "var(--elevation-1)",
        borderRadius: "var(--radius)",
        padding: padded ? "var(--space-4)" : 0,
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
    }
}

/**
 * Resolve the inline-style object for an <EmptyState>.
 * Left-aligned and terse by construction (matches the existing correct
 * empty-state convention rather than the one centered outlier).
 */
export function emptyStateStyle() {
    return {
        padding: "var(--space-4)",
        textAlign: "left",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-sm)",
    }
}
