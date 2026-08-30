import { panelStyle } from "./styleHelpers.js"

/**
 * Shared Panel/Card shell — Round 1 of the UI rebuild.
 *
 * A real replacement for the ad-hoc per-file "WorkspaceBody"-style wrapper
 * objects found across the app (e.g. WorkspacesPanel.jsx's GLASS_DARK).
 * Elevation is expressed as a border (var(--elevation-1)/var(--elevation-2))
 * rather than a soft box-shadow, by construction.
 *
 * @param {keyof JSX.IntrinsicElements} [as="div"] - element/tag to render
 * @param {boolean} [elevated=false] - use the next surface step up
 *   (var(--bg-elevated)) instead of the default panel surface
 * @param {boolean} [padded=true] - apply the default padding
 * @param {1|2} [elevation=1] - border weight: 1 for panels/cards in normal
 *   flow, 2 for modals/popups that float over arbitrary content
 */
export default function Panel({
    as: Tag = "div",
    elevated = false,
    padded = true,
    elevation = 1,
    style,
    className,
    children,
    ...rest
}) {
    return (
        <Tag
            className={className}
            style={{ ...panelStyle({ elevated, padded, elevation }), ...style }}
            {...rest}
        >
            {children}
        </Tag>
    )
}
