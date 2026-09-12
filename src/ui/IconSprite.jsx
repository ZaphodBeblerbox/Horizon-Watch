/**
 * IconSprite.jsx — redesign Round 1, §4: the one real icon sprite for UI
 * chrome (navigation, tool buttons, empty-state icons, palette rows).
 * Monochrome, stroke-only, 24x24, referenced everywhere via
 * `<svg class="icon"><use href="#i-<name>" /></svg>` rather than a
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
 *   <svg className="icon"><use href="#i-globe" /></svg>
 */
const STROKE = { fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" }

export default function IconSprite() {
    return (
        <svg style={{ display: "none" }} aria-hidden="true">
            <symbol id="i-globe" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <ellipse cx="12" cy="12" rx="4" ry="9" {...STROKE} />
                <line x1="3" y1="12" x2="21" y2="12" {...STROKE} />
            </symbol>

            <symbol id="i-inbox" viewBox="0 0 24 24">
                <path d="M4 12h4l2 3h4l2-3h4" {...STROKE} />
                <path d="M4 12V6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v6" {...STROKE} />
                <path d="M4 12v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6" {...STROKE} />
            </symbol>

            <symbol id="i-dossier" viewBox="0 0 24 24">
                <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" {...STROKE} />
            </symbol>

            {/* Workstation module icons — §7.1 */}
            <symbol id="i-mywork" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="14" rx="1" {...STROKE} />
                <path d="M3 10h18" {...STROKE} />
                <path d="M8 3v4M16 3v4" {...STROKE} />
            </symbol>
            <symbol id="i-mail" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="14" rx="1" {...STROKE} />
                <path d="M3 6l9 7 9-7" {...STROKE} />
            </symbol>
            <symbol id="i-case" viewBox="0 0 24 24">
                <rect x="3" y="8" width="18" height="12" rx="1" {...STROKE} />
                <path d="M8 8V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" {...STROKE} />
                <path d="M3 13h18" {...STROKE} />
            </symbol>
            <symbol id="i-team" viewBox="0 0 24 24">
                <circle cx="9" cy="8" r="3" {...STROKE} />
                <path d="M3 20v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1" {...STROKE} />
                <circle cx="17" cy="9" r="2.4" {...STROKE} />
                <path d="M20.5 20v-.8a4 4 0 0 0-2.7-3.8" {...STROKE} />
            </symbol>

            <symbol id="i-chart" viewBox="0 0 24 24">
                <path d="M4 20V4" {...STROKE} />
                <path d="M4 20h16" {...STROKE} />
                <path d="M8 20v-6" {...STROKE} />
                <path d="M13 20v-10" {...STROKE} />
                <path d="M18 20v-4" {...STROKE} />
            </symbol>

            <symbol id="i-spark" viewBox="0 0 24 24">
                <path d="M3 15l4-3 3 4 5-9 6 5" {...STROKE} />
            </symbol>

            <symbol id="i-doc" viewBox="0 0 24 24">
                <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...STROKE} />
                <path d="M15 3v4h4" {...STROKE} />
                <path d="M8 13h8" {...STROKE} />
                <path d="M8 17h8" {...STROKE} />
            </symbol>

            <symbol id="i-clock" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <path d="M12 7v5l4 2" {...STROKE} />
            </symbol>

            <symbol id="i-search" viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6.5" {...STROKE} />
                <path d="M20 20l-5-5" {...STROKE} />
            </symbol>

            <symbol id="i-plus" viewBox="0 0 24 24">
                <path d="M12 5v14" {...STROKE} />
                <path d="M5 12h14" {...STROKE} />
            </symbol>

            <symbol id="i-bell" viewBox="0 0 24 24">
                <path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6z" {...STROKE} />
                <path d="M10 19a2 2 0 0 0 4 0" {...STROKE} />
            </symbol>

            <symbol id="i-layers" viewBox="0 0 24 24">
                <path d="M12 3l9 5-9 5-9-5z" {...STROKE} />
                <path d="M3 13l9 5 9-5" {...STROKE} />
                <path d="M3 18l9 5 9-5" {...STROKE} />
            </symbol>

            <symbol id="i-eye" viewBox="0 0 24 24">
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" {...STROKE} />
                <circle cx="12" cy="12" r="2.6" {...STROKE} />
            </symbol>

            <symbol id="i-eye-off" viewBox="0 0 24 24">
                <path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" {...STROKE} />
                <circle cx="12" cy="12" r="2.6" {...STROKE} />
                <path d="M3 3l18 18" {...STROKE} />
            </symbol>

            <symbol id="i-print" viewBox="0 0 24 24">
                <path d="M6 9V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v5" {...STROKE} />
                <rect x="3" y="9" width="18" height="8" rx="1" {...STROKE} />
                <path d="M6 14h12v7H6z" {...STROKE} />
            </symbol>

            <symbol id="i-play" viewBox="0 0 24 24">
                <path d="M6 4l14 8-14 8z" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="i-pause" viewBox="0 0 24 24">
                <path d="M7 4v16" {...STROKE} />
                <path d="M17 4v16" {...STROKE} />
            </symbol>

            <symbol id="i-target" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <circle cx="12" cy="12" r="5" {...STROKE} />
                <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
            </symbol>

            <symbol id="i-grid" viewBox="0 0 24 24">
                <rect x="3" y="3" width="7" height="7" {...STROKE} />
                <rect x="14" y="3" width="7" height="7" {...STROKE} />
                <rect x="3" y="14" width="7" height="7" {...STROKE} />
                <rect x="14" y="14" width="7" height="7" {...STROKE} />
            </symbol>

            <symbol id="i-reset" viewBox="0 0 24 24">
                <path d="M4 4v6h6" {...STROKE} />
                <path d="M4.5 15a8 8 0 1 0 2-8.5L4 10" {...STROKE} />
            </symbol>

            <symbol id="i-add-brief" viewBox="0 0 24 24">
                <path d="M6 3h9l4 4v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" {...STROKE} />
                <path d="M15 3v4h4" {...STROKE} />
                <path d="M9 15h6" {...STROKE} />
                <path d="M12 12v6" {...STROKE} />
            </symbol>

            <symbol id="i-flag" viewBox="0 0 24 24">
                <path d="M5 21V4" {...STROKE} />
                <path d="M5 4h13l-3 4 3 4H5" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="i-check" viewBox="0 0 24 24">
                <path d="M4 12l6 6L20 6" {...STROKE} />
            </symbol>

            <symbol id="i-export" viewBox="0 0 24 24">
                <path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" {...STROKE} />
                <path d="M12 3v12" {...STROKE} />
                <path d="M7 8l5-5 5 5" {...STROKE} />
            </symbol>

            <symbol id="i-link" viewBox="0 0 24 24">
                <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" {...STROKE} />
                <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" {...STROKE} />
            </symbol>

            {/* Build spec v2 — panel minimize/restore chevrons. */}
            <symbol id="i-collapse-l" viewBox="0 0 24 24">
                <path d="M15 5l-7 7 7 7" {...STROKE} />
            </symbol>
            <symbol id="i-collapse-r" viewBox="0 0 24 24">
                <path d="M9 5l7 7-7 7" {...STROKE} />
            </symbol>

            {/* Page-by-page rebuild, Stage 0 — every remaining required
                symbol from the build spec's icon list, added in this pass. */}
            <symbol id="i-onto" viewBox="0 0 24 24">
                <circle cx="6" cy="6" r="2.4" {...STROKE} />
                <circle cx="18" cy="6" r="2.4" {...STROKE} />
                <circle cx="12" cy="18" r="2.4" {...STROKE} />
                <path d="M8.1 7.2L15.9 7.2" {...STROKE} />
                <path d="M7 8.2L11 16" {...STROKE} />
                <path d="M17 8.2L13 16" {...STROKE} />
            </symbol>

            <symbol id="i-sat" viewBox="0 0 24 24">
                <rect x="9.5" y="9.5" width="5" height="5" rx="0.5" {...STROKE} />
                <path d="M2 5l5 5M2 10l5-5" {...STROKE} />
                <path d="M22 5l-5 5M22 10l-5-5" {...STROKE} />
                <path d="M12 9.5V6" {...STROKE} />
                <path d="M14.5 12L18 15.5" {...STROKE} />
            </symbol>

            <symbol id="i-read" viewBox="0 0 24 24">
                <path d="M12 6c-1.8-1.3-4-2-6.5-2S2 4.3 2 4.3v14S3.7 18 5.5 18 9.7 18.7 12 20" {...STROKE} />
                <path d="M12 6c1.8-1.3 4-2 6.5-2S22 4.3 22 4.3v14S20.3 18 18.5 18 14.3 18.7 12 20" {...STROKE} />
                <path d="M12 6v14" {...STROKE} />
            </symbol>

            <symbol id="i-merge" viewBox="0 0 24 24">
                <circle cx="6" cy="6" r="2" {...STROKE} />
                <circle cx="6" cy="18" r="2" {...STROKE} />
                <circle cx="18" cy="18" r="2" {...STROKE} />
                <path d="M6 8v4a4 4 0 0 0 4 4h6" {...STROKE} />
                <path d="M16 15l2 3-2 3" {...STROKE} transform="translate(0,-3)" />
            </symbol>

            <symbol id="i-trash" viewBox="0 0 24 24">
                <path d="M4 7h16" {...STROKE} />
                <path d="M9 7V4h6v3" {...STROKE} />
                <path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" {...STROKE} />
                <path d="M10 11v6M14 11v6" {...STROKE} />
            </symbol>

            <symbol id="i-swipe" viewBox="0 0 24 24">
                <rect x="3" y="5" width="18" height="14" rx="1" {...STROKE} />
                <path d="M12 5v14" {...STROKE} />
                <path d="M9 10l-2 2 2 2" {...STROKE} />
                <path d="M15 10l2 2-2 2" {...STROKE} />
            </symbol>

            <symbol id="i-ship" viewBox="0 0 24 24">
                <path d="M12 3v8" {...STROKE} />
                <path d="M12 3l3 4" {...STROKE} />
                <path d="M6 11h12l-1.5 6a2 2 0 0 1-2 1.5h-5a2 2 0 0 1-2-1.5z" {...STROKE} />
                <path d="M4 20q4 2 8 0t8 0" {...STROKE} />
            </symbol>

            <symbol id="i-plane" viewBox="0 0 24 24">
                <path d="M12 2v20" {...STROKE} />
                <path d="M2 10l10 3 10-3" {...STROKE} />
                <path d="M9 19l3-2 3 2" {...STROKE} />
            </symbol>

            <symbol id="i-anchor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="2" {...STROKE} />
                <path d="M12 7v14" {...STROKE} />
                <path d="M6 14a6 6 0 0 0 6 7 6 6 0 0 0 6-7" {...STROKE} />
                <path d="M5 11h4M15 11h4" {...STROKE} />
            </symbol>

            <symbol id="i-pin" viewBox="0 0 24 24">
                <path d="M12 22s7-7.5 7-12.5a7 7 0 1 0-14 0C5 14.5 12 22 12 22z" {...STROKE} />
                <circle cx="12" cy="9.5" r="2.2" {...STROKE} />
            </symbol>

            <symbol id="i-poly" viewBox="0 0 24 24">
                <path d="M5 8l6-4 8 3-2 9-9 3-3-8z" {...STROKE} strokeLinejoin="round" />
                <circle cx="5" cy="8" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="11" cy="4" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="19" cy="7" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="17" cy="16" r="1.3" fill="currentColor" stroke="none" />
                <circle cx="8" cy="19" r="1.3" fill="currentColor" stroke="none" />
            </symbol>

            <symbol id="i-path" viewBox="0 0 24 24">
                <path d="M3 19c4 0 4-14 8-14s2 10 6 10 2-6 4-6" {...STROKE} strokeDasharray="2.5 2.5" />
            </symbol>

            <symbol id="i-text" viewBox="0 0 24 24">
                <path d="M5 5h14" {...STROKE} />
                <path d="M12 5v14" {...STROKE} />
                <path d="M9 19h6" {...STROKE} />
            </symbol>

            <symbol id="i-measure" viewBox="0 0 24 24">
                <rect x="2.5" y="9" width="19" height="6" rx="0.5" transform="rotate(-20 12 12)" {...STROKE} />
                <path d="M8.3 9.6l1 2M11.6 8.4l1 2M14.9 7.2l1 2" {...STROKE} />
            </symbol>

            <symbol id="i-cursor" viewBox="0 0 24 24">
                <path d="M5 3l6 17 2.2-6.8L20 11z" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="i-north" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <path d="M12 5l3 9-3-2-3 2z" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="i-zoom-in" viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6.5" {...STROKE} />
                <path d="M20 20l-5-5" {...STROKE} />
                <path d="M10.5 7.5v6M7.5 10.5h6" {...STROKE} />
            </symbol>

            <symbol id="i-fullscreen-enter" viewBox="0 0 24 24">
                <path d="M8 3H5a2 2 0 0 0-2 2v3" {...STROKE} />
                <path d="M21 8V5a2 2 0 0 0-2-2h-3" {...STROKE} />
                <path d="M3 16v3a2 2 0 0 0 2 2h3" {...STROKE} />
                <path d="M16 21h3a2 2 0 0 0 2-2v-3" {...STROKE} />
            </symbol>

            <symbol id="i-fullscreen-exit" viewBox="0 0 24 24">
                <path d="M8 3v3a2 2 0 0 1-2 2H3" {...STROKE} />
                <path d="M21 8h-3a2 2 0 0 1-2-2V3" {...STROKE} />
                <path d="M3 16h3a2 2 0 0 1 2 2v3" {...STROKE} />
                <path d="M16 21v-3a2 2 0 0 1 2-2h3" {...STROKE} />
            </symbol>

            <symbol id="i-settings" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="3" {...STROKE} />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" {...STROKE} />
            </symbol>

            <symbol id="i-sun" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="4" {...STROKE} />
                <path d="M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" {...STROKE} />
            </symbol>

            <symbol id="i-moon" viewBox="0 0 24 24">
                <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" {...STROKE} />
            </symbol>

            <symbol id="i-zoom-out" viewBox="0 0 24 24">
                <circle cx="10.5" cy="10.5" r="6.5" {...STROKE} />
                <path d="M20 20l-5-5" {...STROKE} />
                <path d="M7.5 10.5h6" {...STROKE} />
            </symbol>

            <symbol id="i-recentre" viewBox="0 0 24 24">
                <path d="M4 8V5a1 1 0 0 1 1-1h3" {...STROKE} />
                <path d="M20 8V5a1 1 0 0 0-1-1h-3" {...STROKE} />
                <path d="M4 16v3a1 1 0 0 0 1 1h3" {...STROKE} />
                <path d="M20 16v3a1 1 0 0 1-1 1h-3" {...STROKE} />
                <circle cx="12" cy="12" r="2.2" {...STROKE} />
            </symbol>

            <symbol id="i-node-person" viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="3.2" {...STROKE} />
                <path d="M5 20c0-4 3-6.5 7-6.5s7 2.5 7 6.5" {...STROKE} />
            </symbol>

            <symbol id="i-node-org" viewBox="0 0 24 24">
                <rect x="5" y="4" width="14" height="16" {...STROKE} />
                <path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1" {...STROKE} />
            </symbol>

            <symbol id="i-node-faction" viewBox="0 0 24 24">
                <path d="M6 3v18" {...STROKE} />
                <path d="M6 4h11l-2.5 3.5L17 11H6" {...STROKE} strokeLinejoin="round" />
            </symbol>

            <symbol id="i-node-facility" viewBox="0 0 24 24">
                <path d="M4 20V11l5 3V11l5 3V8l6-3v15z" {...STROKE} strokeLinejoin="round" />
                <path d="M4 20h16" {...STROKE} />
            </symbol>

            <symbol id="i-node-country" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="9" {...STROKE} />
                <path d="M3 10h18M5 16h14" {...STROKE} />
                <path d="M9.5 3a13 13 0 0 0 0 18M14.5 3a13 13 0 0 1 0 18" {...STROKE} />
            </symbol>

            <symbol id="i-node-corridor" viewBox="0 0 24 24">
                <path d="M3 8h14" {...STROKE} />
                <path d="M13 4l4 4-4 4" {...STROKE} />
                <path d="M21 16H7" {...STROKE} />
                <path d="M11 12l-4 4 4 4" {...STROKE} />
            </symbol>

            <symbol id="i-node-event" viewBox="0 0 24 24">
                <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M18.4 5.6l-2.8 2.8M8.4 15.6l-2.8 2.8" {...STROKE} />
                <circle cx="12" cy="12" r="2.6" {...STROKE} />
            </symbol>

            {/* The two permitted filled exceptions — track-detail photo panel
                silhouettes, never used on the map itself. */}
            <symbol id="i-silh-plane" viewBox="0 0 120 60">
                <path d="M5 32 L45 28 L55 6 L62 6 L57 28 L98 28 L112 20 L116 22 L108 32 L116 40 L112 42 L98 34 L57 34 L62 56 L55 56 L45 34 L5 32Z" fill="currentColor" stroke="none" />
            </symbol>
            <symbol id="i-silh-ship" viewBox="0 0 120 60">
                <path d="M14 40 L18 22 L30 22 L30 10 L44 10 L44 22 L96 22 L106 40 Z" fill="currentColor" stroke="none" />
                <path d="M4 44 Q60 58 116 44 L112 50 Q60 62 8 50 Z" fill="currentColor" stroke="none" />
            </symbol>
        </svg>
    )
}
