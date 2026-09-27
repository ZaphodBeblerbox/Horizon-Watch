/**
 * IconSprite — the PARALLAX sprite, §3 of the implementation spec.
 *
 * One inline <svg style="display:none"> at the top of the tree. No icon
 * font, no per-icon requests, no flash of missing glyph. Used everywhere as
 * <svg className="icon"><use href="#i-globe" /></svg>.
 *
 * Drawing conventions, held across all 90 symbols:
 *   viewBox="0 0 24 24" · fill="none" · stroke="currentColor"
 *   stroke-width 1.3-1.6 and nothing else
 *   NO stroke-linecap — the console's square terminals are intentional.
 *     (The previous sprite applied stroke-linecap:round globally, which
 *      rounded every terminal in the product and is the single most
 *      visible deviation from the spec.)
 *   Solid fill ONLY for i-play, i-pause and the two silhouettes.
 *
 * The markup is injected verbatim rather than transcribed into JSX, so the
 * path data is byte-identical to the spec and cannot drift through
 * attribute renaming (stroke-width -> strokeWidth, etc.).
 *
 * Four ids at the end are aliases kept for existing callers
 * (i-settings, i-fullscreen-enter/exit). They render the spec
 * symbol of the same meaning rather than a second drawing, so there is one
 * mark per concept.
 */

const SPRITE = `
<symbol id="i-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"/></symbol>
<symbol id="i-inbox" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 13l2.4-7.2A1.5 1.5 0 016.8 4.8h10.4a1.5 1.5 0 011.4 1L21 13v5.4a1.6 1.6 0 01-1.6 1.6H4.6A1.6 1.6 0 013 18.4z"/><path d="M3 13h5l1.2 2.2h5.6L16 13h5"/></symbol>
<symbol id="i-dossier" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 5.5h6l1.6 2.2H20v10.8H4z"/><path d="M8 12h8M8 15h5"/></symbol>
<symbol id="i-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 20V9M10 20V4M16 20v-8M22 20H2"/></symbol>
<symbol id="i-spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6.2 6.2l2.8 2.8M15 15l2.8 2.8M17.8 6.2L15 9M9 15l-2.8 2.8"/><circle cx="12" cy="12" r="2.4"/></symbol>
<symbol id="i-doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5.4l3.4 2"/></symbol>
<symbol id="i-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.4 15.4L21 21"/></symbol>
<symbol id="i-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 5v14M5 12h14"/></symbol>
<symbol id="i-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 16V11a6 6 0 1112 0v5l1.6 2.4H4.4z"/><path d="M10 20.5a2.2 2.2 0 004 0"/></symbol>
<symbol id="i-layers" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3l9 4.8-9 4.8L3 7.8z"/><path d="M3 12.4l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2.4 12S6 6.4 12 6.4 21.6 12 21.6 12 18 17.6 12 17.6 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.6"/></symbol>
<symbol id="i-eye-off" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4l16 16"/><path d="M9.6 6.8A9.6 9.6 0 0112 6.4c6 0 9.6 5.6 9.6 5.6a17 17 0 01-2.6 3.2M6.4 8.4A16.6 16.6 0 002.4 12s3.6 5.6 9.6 5.6c.9 0 1.7-.1 2.5-.4"/></symbol>
<symbol id="i-print" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 9V4h10v5M7 17H4v-6h16v6h-3"/><path d="M7 14h10v6H7z"/></symbol>
<symbol id="i-up" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 19V5M6 11l6-6 6 6"/></symbol>
<symbol id="i-feed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12a8 8 0 018 8M4 17a3 3 0 013 3"/><path d="M4 6.5A13.5 13.5 0 0117.5 20"/><circle cx="4.6" cy="19.4" r="1.1" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-play" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5.5l10 6.5-10 6.5z"/></symbol>
<symbol id="i-pause" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="7.5" y="5.5" width="3.4" height="13"/><rect x="13.1" y="5.5" width="3.4" height="13"/></symbol>
<symbol id="i-target" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/></symbol>
<symbol id="i-grid" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4 4h16v16H4zM4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/></symbol>
<symbol id="i-risk" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.6 16.6a9 9 0 0116.8 0"/><path d="M12 16.6L16.6 9.9"/><circle cx="12" cy="16.6" r="1.25"/><path d="M4.6 12.4l1.5.6M12 7.2V5.6M19.4 12.4l-1.5.6"/></symbol>
<symbol id="i-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><path d="M3.8 11.2V4.6h6.6l9 9-6.6 6.6-9-9z"/><circle cx="7.6" cy="8.4" r="1.35"/></symbol>
<symbol id="i-reset" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 12a8 8 0 1114 5.3"/><path d="M4 6.5V12h5.5"/></symbol>
<symbol id="i-add-brief" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 3h8l4 4v8"/><path d="M14 3v4h4M6 3v18h6"/><path d="M16 17.5h6M19 14.5v6"/></symbol>
<symbol id="i-flag" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 21V4M6 4h11l-2 4 2 4H6"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 12.5l5 5L20 6.5"/></symbol>
<symbol id="i-export" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 16V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v4.5h16V15"/></symbol>
<symbol id="i-onto" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="17" r="2.4"/><circle cx="19" cy="17" r="2.4"/><path d="M10.4 6.9L6.6 15M13.6 6.9l3.8 8.1M7.4 17h9.2"/></symbol>
<symbol id="i-sat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"><rect x="10" y="8.4" width="4" height="7.2" rx=".5"/><path d="M10 10.2H3.6v3.6H10M14 10.2h6.4v3.6H14"/><path d="M5.4 10.2v3.6M7.7 10.2v3.6M16.3 10.2v3.6M18.6 10.2v3.6"/><path d="M12 8.4V5.6"/><path d="M9.4 4.2a3.6 3.6 0 015.2 0"/><path d="M12 15.6v2.3"/></symbol>
<symbol id="i-read" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 5.5h7a2 2 0 012 2v11a2.4 2.4 0 00-2-1.6h-7z"/><path d="M20.5 5.5h-7a2 2 0 00-2 2v11a2.4 2.4 0 012-1.6h7z"/></symbol>
<symbol id="i-ship" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 14.5l1.8 5a1.6 1.6 0 001.5 1h10.4a1.6 1.6 0 001.5-1l1.8-5z"/><path d="M6 14.5V9h12v5.5M12 9V5.5M9.5 5.5h5"/></symbol>
<symbol id="i-plane" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2.5l1.6 6.4 7.4 3.4v1.8l-7.4-1.8-.7 4.4 2.7 2v1.3L12 19l-3.6.9v-1.3l2.7-2-.7-4.4L3 14v-1.8l7.4-3.4z"/></symbol>
<symbol id="i-anchor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="4.6" r="2"/><path d="M12 6.6V21M8 10h8M4 14.5a8 8 0 0016 0"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 21s6.5-6.4 6.5-11A6.5 6.5 0 005.5 10c0 4.6 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/></symbol>
<symbol id="i-poly" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 8.5l7-4.5 9 4v8l-7 4.5-9-4z"/><circle cx="4" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="20" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="13" cy="20.5" r="1.5" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-path" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 19c5-1 6-6 9-9s5-3 7-3"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="7" r="2"/></symbol>
<symbol id="i-text" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M5 6.5V4.5h14v2M12 4.5V19M9 19h6"/></symbol>
<symbol id="i-measure" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3 14.5L14.5 3l6.5 6.5L9.5 21z"/><path d="M7 11l2 2M10 8l2 2M13 5l2 2"/></symbol>
<symbol id="i-cursor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3.5l12.5 8.2-5.6 1.2 3.2 6-2.4 1.2-3.2-6-4.5 3.6z"/></symbol>
<symbol id="i-trash" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4.5 6.5h15M9 6.5V4h6v2.5M6.5 6.5l1 13.5h9l1-13.5M10 10v7M14 10v7"/></symbol>
<symbol id="i-swipe" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 3v18M4 8l-3 4 3 4M20 8l3 4-3 4"/></symbol>
<symbol id="i-node-person" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="8" r="3.6"/><path d="M4.8 20a7.2 7.2 0 0114.4 0"/></symbol>
<symbol id="i-node-org" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 20V6.5l7-3v16.5M11 20h9V10h-9M14 13h3M14 16.5h3M6.5 9h2M6.5 13h2M6.5 16.5h2"/></symbol>
<symbol id="i-node-faction" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3l8 3.5v6c0 4.6-3.4 8-8 9.5-4.6-1.5-8-4.9-8-9.5v-6z"/><path d="M9 12l2 2 4-4"/></symbol>
<symbol id="i-node-facility" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 20.5V11l6-3.5V11l6-3.5v13z"/><path d="M15.5 11h5v9.5h-5M6.5 15h2M11 15h2"/></symbol>
<symbol id="i-node-country" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.4 2.3 3.6 5.3 3.6 8.5s-1.2 6.2-3.6 8.5c-2.4-2.3-3.6-5.3-3.6-8.5S9.6 5.8 12 3.5z"/></symbol>
<symbol id="i-orb" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"><circle cx="12" cy="10" r="6.9"/><path d="M6.6 19.4c1-1.1 2.9-1.8 5.4-1.8s4.4.7 5.4 1.8c.5.6.1 1.5-.7 1.5H7.3c-.8 0-1.2-.9-.7-1.5z"/><path d="M8.8 8.1a3.6 3.6 0 012.6-2.2" stroke-linecap="round" opacity=".85"/><path d="M15.4 13.2l.45 1.25 1.25.45-1.25.45-.45 1.25-.45-1.25-1.25-.45 1.25-.45z" fill="currentColor" stroke="none"/></symbol>
<symbol id="i-node-vessel" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 16l1.6 3.2a2 2 0 0 0 1.8 1.1h11.2a2 2 0 0 0 1.8-1.1L21 16z"/><path d="M5.5 16V10h13v6"/><path d="M12 10V5"/><path d="M9 7.5h6"/></symbol>
<symbol id="i-node-aircraft" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3l1.4 6.2L21 12v1.8l-7.6-1.4L12.8 18l2.2 1.6V21l-3-1-3 1v-1.4L11.2 18l-.6-5.6L3 13.8V12l7.6-2.8z"/></symbol>
<symbol id="i-node-equipment" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 14h5l2-3h6l2 3h3"/><path d="M6 14v3h12v-3"/><circle cx="8.5" cy="18.5" r="1.5"/><circle cx="15.5" cy="18.5" r="1.5"/><path d="M10 11V7h4v4"/></symbol>
<symbol id="i-refresh" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v4h-4"/></symbol>
<symbol id="i-node-corridor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h18M3 17h18"/><path d="M8 12h8M14 9.5l2.5 2.5-2.5 2.5"/></symbol>
<symbol id="i-node-event" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"/></symbol>
<symbol id="i-merge" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6 3.5v5a4 4 0 004 4h8"/><path d="M6 20.5v-5a4 4 0 014-4"/><path d="M15.5 9l3 3.5-3 3.5"/></symbol>
<symbol id="i-silh-plane" viewBox="0 0 120 60" fill="currentColor" stroke="none"><path d="M59 4c2.6 0 4 3 4.6 7l1.4 12.5 26 9.5c1.6.6 2.6 1.6 2.6 3v3l-28-5.4-1.6 15.6 8.6 5.2v3.2L60 54.5 47.4 57.6v-3.2l8.6-5.2-1.6-15.6-28 5.4v-3c0-1.4 1-2.4 2.6-3l26-9.5L56.4 11C57 7 58.4 4 59 4z"/><path d="M4 33h14v3H4zM102 33h14v3h-14z" opacity=".55"/></symbol>
<symbol id="i-silh-ship" viewBox="0 0 120 60" fill="currentColor" stroke="none"><path d="M10 40h100l-6 13a4 4 0 01-3.6 2.2H19.6A4 4 0 0116 53z"/><path d="M22 38V24h34v14zM60 38V17h22l4 21z" opacity=".8"/><path d="M66 15V6h2v9zM40 22h10v3H40zM26 30h24v3H26z" opacity=".5"/></symbol>
<symbol id="i-collapse-l" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.5 6.5L9 12l5.5 5.5M19 4.5v15"/></symbol>
<symbol id="i-collapse-r" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 6.5L15 12l-5.5 5.5M5 4.5v15"/></symbol>
<symbol id="i-north" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 2.5l3.4 9.5H8.6z" fill="currentColor" stroke="none"/><path d="M12 12l3.4 9.5H8.6z" opacity=".55"/><path d="M12 12l3.4 9.5H8.6z"/></symbol>
<symbol id="i-zoom-in" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 6.5v11M6.5 12h11"/></symbol>
<symbol id="i-zoom-out" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M6.5 12h11"/></symbol>
<symbol id="i-recentre" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2v3.2M12 18.8V22M2 12h3.2M18.8 12H22"/></symbol>
<symbol id="i-scan" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 8.5v-5h5M15.5 3.5h5v5M20.5 15.5v5h-5M8.5 20.5h-5v-5"/><path d="M3.5 12h17" stroke-dasharray="2 2"/><rect x="9" y="9" width="6" height="6"/></symbol>
<symbol id="i-crop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M6.5 2.5v15h15"/><path d="M2.5 6.5h15v15"/></symbol>
<symbol id="i-scanbox" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="4" y="6" width="16" height="12"/><path d="M8 10h3M8 13h6"/><circle cx="16.5" cy="10.5" r="1.4"/></symbol>
<symbol id="i-repeat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 12a8 8 0 0113.7-5.6M20 12a8 8 0 01-13.7 5.6"/><path d="M17.5 3.2v3.4h-3.4M6.5 20.8v-3.4h3.4"/></symbol>
<symbol id="i-present" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="4" width="19" height="12.5" rx="1.2"/><path d="M12 16.5V20M8.5 20h7"/></symbol>
<symbol id="i-notes" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M5 3.5h14v17H5z"/><path d="M8 8h8M8 11.5h8M8 15h5"/></symbol>
<symbol id="i-next" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 5l7 7-7 7"/></symbol>
<symbol id="i-prev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 5l-7 7 7 7"/></symbol>
<symbol id="i-send" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 12l16-8-6 8 6 8z"/></symbol>
<symbol id="i-register" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3.5" y="3.5" width="17" height="17" rx="1.2"/><path d="M3.5 9h17M3.5 14.5h17M9 3.5v17"/></symbol>
<symbol id="i-import" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 3.5v11M7.5 10L12 14.5 16.5 10"/><path d="M4 16v4.5h16V16"/></symbol>
<symbol id="i-ring" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="8.5" stroke-dasharray="3 3"/><circle cx="12" cy="12" r="2"/></symbol>
<symbol id="i-mail" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="5" width="19" height="14" rx="1.4"/><path d="M2.8 6l9.2 7 9.2-7"/></symbol>
<symbol id="i-work" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 7h6l1.4 2H20v11H4z"/><path d="M9 4.5h6V7H9z"/><path d="M8 13.5l2 2 4-4"/></symbol>
<symbol id="i-case" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="18" height="13" rx="1.4"/><path d="M9 7V4.5h6V7M3 12h18"/></symbol>
<symbol id="i-team" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0111 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15 19a4.6 4.6 0 015.5-3.6"/></symbol>
<symbol id="i-comment" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M20.5 4.5H3.5v12h4v3.5l4-3.5h9z"/><path d="M7 9h10M7 12h6"/></symbol>
<symbol id="i-rfi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="12" cy="12" r="9"/><path d="M9.4 9.2a2.7 2.7 0 015.2 1c0 1.8-2.6 2-2.6 3.6M12 17.4v.5"/></symbol>
<symbol id="i-handover" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 9h13l-3-3M20.5 15h-13l3 3"/></symbol>
<symbol id="i-attach" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M16.5 8.5l-6.6 6.6a2.6 2.6 0 003.7 3.7l7-7a4.5 4.5 0 00-6.4-6.4l-7.3 7.3a6.4 6.4 0 009 9L20 17"/></symbol>
<symbol id="i-stamp" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 3.5h6v4.2l1.6 3.3H7.4L9 7.7z"/><path d="M4.5 13h15v3.5h-15zM6 19.5h12"/></symbol>
<symbol id="i-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><path d="M10.47 5.17 L10.35 2.54 L13.65 2.54 L13.53 5.17 L15.75 6.09 L17.52 4.15 L19.85 6.48 L17.91 8.25 L18.83 10.47 L21.46 10.35 L21.46 13.65 L18.83 13.53 L17.91 15.75 L19.85 17.52 L17.52 19.85 L15.75 17.91 L13.53 18.83 L13.65 21.46 L10.35 21.46 L10.47 18.83 L8.25 17.91 L6.48 19.85 L4.15 17.52 L6.09 15.75 L5.17 13.53 L2.54 13.65 L2.54 10.35 L5.17 10.47 L6.09 8.25 L4.15 6.48 L6.48 4.15 L8.25 6.09 Z"/><circle cx="12" cy="12" r="3"/></symbol>
<symbol id="i-full" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3.5 9V3.5H9M15 3.5h5.5V9M20.5 15v5.5H15M9 20.5H3.5V15"/></symbol>
<symbol id="i-full-exit" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 3.5V9H3.5M20.5 9H15V3.5M15 20.5V15h5.5M3.5 15H9v5.5"/></symbol>
<symbol id="i-book" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 4.5h6.5a1.5 1.5 0 011.5 1.5v13a1.2 1.2 0 00-1.2-1.2H4z"/><path d="M20 4.5h-6.5A1.5 1.5 0 0012 6v13a1.2 1.2 0 011.2-1.2H20z"/></symbol>
<symbol id="i-keyboard" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="6.5" width="19" height="11" rx="1"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7.5 13.6h9"/></symbol>
<symbol id="i-session" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="5" width="18" height="14" rx="1"/><path d="M3 9h18M7 13h6"/></symbol>
<symbol id="i-view" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 6h16M4 12h10M4 18h13"/><circle cx="18.5" cy="12" r="2"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M12 3.5l9 16H3z"/><path d="M12 9v5M12 16.6v.6"/></symbol>
<symbol id="i-relate" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M8.4 6h7.2M7 8.2l4 7.6M17 8.2l-4 7.6"/></symbol>
<symbol id="i-grip" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/></symbol>
<symbol id="i-pinned" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M9 3.5h6l-.8 6.2 3.3 3.4H6.5l3.3-3.4z"/><path d="M12 13.1V20.5"/></symbol>
<symbol id="i-history" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 12a8.5 8.5 0 108.5-8.5"/><path d="M3.5 5.2v3.6h3.6"/><path d="M12 7.6V12l3.2 2"/></symbol>
<symbol id="i-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9"/></symbol>
<symbol id="i-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 14.4A8.6 8.6 0 019.6 4 8.6 8.6 0 1020 14.4z"/></symbol>
<symbol id="i-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 14a4 4 0 010-5.7l2.8-2.8a4 4 0 015.7 5.7l-1.4 1.4"/><path d="M14 10a4 4 0 010 5.7l-2.8 2.8a4 4 0 01-5.7-5.7l1.4-1.4"/></symbol>

<!-- PARALLAX addendum §A2 — three marks for what an alert IS, not what it is
     about. Stroke 1.45, the addendum's own weight.

     These three carry stroke-linecap/linejoin where the addendum specifies
     them, which is the one place the "NO stroke-linecap" convention above
     bends: a tick with square terminals reads as a broken line, and the
     fusion mark's three converging leaders need round ends to read as
     sourced lines rather than as a cut-off triangle. The addendum writes
     them explicitly in its own markup, so this is the spec's call, not a
     local one.

       i-confirm  a location diamond with a tick through it. Geolocated AND
                  verified — the two things separating a confirmation from a
                  press mention.
       i-surge    ascending bars under a rising trend line with an arrowhead.
                  Volume, and a direction.
       i-fusion   three sourced lines converging on one ringed point. The
                  mark IS the definition, and the tick count is the finding. -->
<symbol id="i-confirm" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linejoin="round"><path d="M12 2.9 L19.6 12 L12 21.1 L4.4 12 Z"/><path d="M8.6 11.9l2.5 2.5 4.4-4.9" stroke-linecap="round"/></symbol>
<symbol id="i-surge" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"><path d="M3.6 19.4h16.8"/><path d="M6.6 19.4v-3.1M10.2 19.4v-5.6M13.8 19.4v-8.4M17.4 19.4v-4.2"/><path d="M5.2 9.4 L9.4 5.6 L13.2 8.2 L19 3.6" stroke-width="1.3"/><path d="M15.4 3.5h3.8v3.7" stroke-width="1.3" stroke-linejoin="round"/></symbol>
<symbol id="i-fusion" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"><path d="M3.4 4.6 L9.9 10.6M20.6 4.6 L14.1 10.6M12 20.8v-4.4"/><circle cx="3.4" cy="4.6" r="1.5"/><circle cx="20.6" cy="4.6" r="1.5"/><circle cx="12" cy="20.8" r="1.5"/><circle cx="12" cy="13.4" r="2.9" stroke-width="1.6"/></symbol>

<!-- Aliases for existing callers. One mark per concept: these reference the
     spec symbol rather than drawing a second, slightly different version. -->
<symbol id="i-settings" viewBox="0 0 24 24"><use href="#i-gear"/></symbol>
<symbol id="i-fullscreen-enter" viewBox="0 0 24 24"><use href="#i-full"/></symbol>
<symbol id="i-fullscreen-exit" viewBox="0 0 24 24"><use href="#i-full-exit"/></symbol>
`

export default function IconSprite() {
    return (
        <svg
            style={{ display: "none" }}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: SPRITE }}
        />
    )
}
