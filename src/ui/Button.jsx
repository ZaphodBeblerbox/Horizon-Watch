import { buttonStyle } from "./styleHelpers.js"

/**
 * Shared Button primitive — Round 1 of the UI rebuild.
 *
 * Replaces the pattern of hand-rolled per-file button style objects
 * (ForgePanel.jsx's tabBtn/actionBtn/ghostBtn, OverwatchSidebar.jsx's
 * modeBtn) with one real component built on design tokens. Existing
 * call sites are NOT migrated in this round — see Round 1 scope notes.
 *
 * @param {"primary"|"ghost"|"danger"} [variant="primary"]
 * @param {"sm"|"md"} [size="md"]
 * @param {boolean} [active=false] - selected/active look for a ghost
 *   button used as a tab or mode toggle
 * @param {boolean} [disabled=false]
 */
export default function Button({
    variant = "primary",
    size = "md",
    active = false,
    disabled = false,
    style,
    className,
    children,
    ...rest
}) {
    return (
        <button
            className={className}
            disabled={disabled}
            style={{ ...buttonStyle({ variant, size, active, disabled }), ...style }}
            {...rest}
        >
            {children}
        </button>
    )
}
