/**
 * IconSprite.jsx — redesign Round 1, §4: the one real icon sprite for UI
 * chrome (navigation, tool buttons, empty-state icons, palette rows).
 * Monochrome, stroke-only, 24x24, referenced everywhere via
 * `<svg class="icon"><use href="#icon-<name>" /></svg>` rather than a
 * third-party icon font/library or emoji.
 *
 * This is a DIFFERENT, narrower set than ui/Icon.jsx's existing per-entity
 * lucide-react icons (aircraft/vessel/poi/facility): under the new spec,
 * an entity on the map or in a list no longer gets its own icon at all —
 * it gets the .dia severity diamond (see designSystem.css) plus text. This
 * sprite is chrome-only. ui/Icon.jsx and its entity glyphs are NOT touched
 * by this round — deleting them is explicitly later-round work, once every
 * real reference to them is removed from actual screens (out of scope for
 * a tokens/typography/component-library-only round).
 *
 * Mount <IconSprite /> once near the app root. Render an icon anywhere with:
 *   <svg className="icon"><use href="#icon-globe" /></svg>
 */
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }

export default function IconSprite() {
    return (
        <svg style={{ display: "none" }} aria-hidden="true">
            <symbol id="icon-globe" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <ellipse cx="12" cy="12" rx="4" ry="9" {...STROKE} />
                <line x1="3" y1="12" x2="21" y2="12" {...STROKE} />
            </symbol>

            <symbol id="icon-inbox" viewBox="0 0 24 24">
                <path d="M4 12h4l2 3h4l2-3h4" {...STROKE} />
                <path d="M4 12V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6" {...STROKE} />
                <path d="M4 12v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" {...STROKE} />
            </symbol>

            <symbol id="icon-dossier" viewBox="0 0 24 24">
                <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" {...STROKE} />
            </symbol>

            <symbol id="icon-chart" viewBox="0 0 24 24">
                <path d="M4 20V4" {...STROKE} />
                <path d="M4 20h16" {...STROKE} />
                <path d="M8 20v-6" {...STROKE} />
                <path d="M13 20v-10" {...STROKE} />
                <path d="M18 20v-4" {...STROKE} />
            </symbol>

            <symbol id="icon-spark" viewBox="0 0 24 24">
                <path d="M3 15l4-3 3 4 5-9 6 5" {...STROKE} />
            </symbol>

            <symbol id="icon-doc" viewBox="0 0 24 24">
                <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...STROKE} />
                <path d="M15 3v4h4" {...STROKE} />
                <path d="M8 13h8" {...STROKE} />
                <path d="M8 17h8" {...STROKE} />
            </symbol>

            <symbol id="icon-clock" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <path d="M12 7v5l4 2" {...STROKE} />
            </symbol>

            <symbol id="icon-search" viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6.5" {...STROKE} />
                <path d="M20 20l-5-5" {...STROKE} />
            </symbol>

            <symbol id="icon-plus" viewBox="0 0 24 24">
                <path d="M12 5v14" {...STROKE} />
                <path d="M5 12h14" {...STROKE} />
            </symbol>

            <symbol id="icon-bell" viewBox="0 0 24 24">
                <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" {...STROKE} />
                <path d="M10 19a2 2 0 0 0 4 0" {...STROKE} />
            </symbol>

            <symbol id="icon-layers" viewBox="0 0 24 24">
                <path d="M12 3l9 5-9 5-9-5z" {...STROKE} />
                <path d="M3 13l9 5 9-5" {...STROKE} />
                <path d="M3 18l9 5 9-5" {...STROKE} />
            </symbol>

            <symbol id="icon-eye" viewBox="0 0 24 24">
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" {...STROKE} />
                <circle cx="12" cy="12" r="2.6" {...STROKE} />
            </symbol>

            <symbol id="icon-eye-off" viewBox="0 0 24 24">
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" {...STROKE} />
                <circle cx="12" cy="12" r="2.6" {...STROKE} />
                <path d="M3 3l18 18" {...STROKE} />
            </symbol>

            <symbol id="icon-print" viewBox="0 0 24 24">
                <path d="M6 9V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5" {...STROKE} />
                <rect x="3" y="9" width="18" height="8" rx="1" {...STROKE} />
                <path d="M6 14h12v7H6z" {...STROKE} />
            </symbol>

            <symbol id="icon-play" viewBox="0 0 24 24">
                <path d="M6 4l14 8-14 8z" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="icon-pause" viewBox="0 0 24 24">
                <path d="M7 4v16" {...STROKE} />
                <path d="M17 4v16" {...STROKE} />
            </symbol>

            <symbol id="icon-target" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <circle cx="12" cy="12" r="5" {...STROKE} />
                <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
            </symbol>

            <symbol id="icon-grid" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" {...STROKE} />
                <rect x="14" y="3" width="7" height="7" {...STROKE} />
                <rect x="3" y="14" width="7" height="7" {...STROKE} />
                <rect x="14" y="14" width="7" height="7" {...STROKE} />
            </symbol>

            <symbol id="icon-reset" viewBox="0 0 24 24">
                <path d="M4 4v6h6" {...STROKE} />
                <path d="M4.5 15a8 8 0 1 0 2-8.5L4 10" {...STROKE} />
            </symbol>

            <symbol id="icon-add-brief" viewBox="0 0 24 24">
                <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...STROKE} />
                <path d="M15 3v4h4" {...STROKE} />
                <path d="M9 15h6" {...STROKE} />
                <path d="M12 12v6" {...STROKE} />
            </symbol>

            <symbol id="icon-flag" viewBox="0 0 24 24">
                <path d="M5 21V4" {...STROKE} />
                <path d="M5 4h13l-3 4 3 4H5" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="icon-check" viewBox="0 0 24 24">
                <path d="M4 12l6 6L20 6" {...STROKE} />
            </symbol>

            <symbol id="icon-export" viewBox="0 0 24 24">
                <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" {...STROKE} />
                <path d="M12 3v12" {...STROKE} />
                <path d="M7 8l5-5 5 5" {...STROKE} />
            </symbol>

            <symbol id="icon-link" viewBox="0 0 24 24">
                <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" {...STROKE} />
                <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" {...STROKE} />
            </symbol>

            {/* Build spec v2 — panel minimize/restore chevrons. */}
            <symbol id="icon-collapse-l" viewBox="0 0 24 24">
                <path d="M15 5l-7 7 7 7" {...STROKE} />
            </symbol>
            <symbol id="icon-collapse-r" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" {...STROKE} />
            </symbol>
        </svg>
    )
}
