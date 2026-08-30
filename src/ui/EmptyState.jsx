import { emptyStateStyle } from "./styleHelpers.js"

/**
 * Shared EmptyState primitive — Round 1 of the UI rebuild.
 *
 * Left-aligned, terse, functional — matching the style already used
 * correctly at most existing empty-state call sites (e.g. the "No alerts"/
 * "No data" messages scattered across panels), rather than the one
 * genuinely centered outlier (NotificationsDrawer.jsx). Existing call
 * sites are NOT migrated to this component in this round.
 *
 * @param {string} [title]
 * @param {string} [description]
 * @param {import("react").ReactNode} [icon]
 * @param {import("react").ReactNode} [action] - e.g. a <Button/>
 */
export default function EmptyState({ title, description, icon, action, style, className }) {
    return (
        <div className={className} style={{ ...emptyStateStyle(), ...style }}>
            {icon && (
                <div style={{ marginBottom: "var(--space-2)", fontSize: "var(--text-lg)", color: "var(--text-dim)" }}>
                    {icon}
                </div>
            )}
            {title && (
                <div style={{ color: "var(--text-primary)", fontWeight: "var(--weight-semibold)", marginBottom: "var(--space-1)" }}>
                    {title}
                </div>
            )}
            {description && (
                <div style={{ color: "var(--text-secondary)", lineHeight: 1.5 }}>
                    {description}
                </div>
            )}
            {action && <div style={{ marginTop: "var(--space-3)" }}>{action}</div>}
        </div>
    )
}
