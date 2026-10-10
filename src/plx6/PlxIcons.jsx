/**
 * PlxIcons.jsx — PARALLAX v6 Part F, verbatim.
 *
 * Every symbol id here is the one the build spec uses (`#g-globe`,
 * `#g-onto`, …), so markup transliterated out of Part B references these
 * without translation. They inherit `currentColor`; there are no icon
 * fonts and no third-party sets.
 *
 * Mounted once, near the root. The old sprite used `i-*` ids and a
 * different, smaller set — both are present during the port so nothing
 * that still speaks `i-*` breaks while the shell moves over.
 */
export default function PlxIcons() {
    return (
        <svg style={{ display: "none" }} xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <symbol id="g-logo" viewBox="0 0 24 24" fill="none" strokeWidth="2.2" strokeLinecap="butt"><path d="M4 4 L15 20 M15 4 L4 20" stroke="currentColor"></path><path d="M19 4 L13.5 12 M23 4 L20.25 8" stroke="var(--acchi)"></path></symbol>
            <symbol id="g-fusion" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 4c4.5.5 6.8 3.6 8.5 8.5M20.5 4c-4.5.5-6.8 3.6-8.5 8.5M12 3v9.5"></path><path d="M12 13.5l3.2 3.5-3.2 3.5-3.2-3.5z" fill="currentColor" fillOpacity=".18"></path></symbol>
            <symbol id="g-tune" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"></path><circle cx="15" cy="7" r="2"></circle><circle cx="9" cy="17" r="2"></circle></symbol>
            <symbol id="g-report" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3.5h10.5L19 7v13.5H5z"></path><path d="M15.5 3.5V7H19"></path><path d="M8 17v-3M11 17v-5.5M14 17v-2"></path><path d="M8 8.5h4"></path></symbol>
            <symbol id="g-orb" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="10.5" r="7"></circle><path d="M7.5 20.5h9M8.6 17.9l-1.1 2.6M15.4 17.9l1.1 2.6"></path><path d="M9 9a3.4 3.4 0 012.6-2.4"></path><path d="M14.3 11.2l.5 1.1 1.1.5-1.1.5-.5 1.1-.5-1.1-1.1-.5 1.1-.5z" fill="currentColor"></path></symbol>
            <symbol id="g-home" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 10.5L12 4l8 6.5V19a1 1 0 01-1 1h-4.5v-5.5h-5V20H5a1 1 0 01-1-1z"></path></symbol>
            <symbol id="g-globe" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="9"></circle><path d="M3 12h18M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9z"></path></symbol>
            <symbol id="g-onto" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="12" cy="5" r="2.4"></circle><circle cx="5" cy="17" r="2.4"></circle><circle cx="19" cy="17" r="2.4"></circle><path d="M10.4 6.9L6.6 15M13.6 6.9l3.8 8.1M7.4 17h9.2"></path></symbol>
            <symbol id="g-inbox" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 13l2.4-7.2A1.5 1.5 0 016.8 4.8h10.4a1.5 1.5 0 011.4 1L21 13v5.4a1.6 1.6 0 01-1.6 1.6H4.6A1.6 1.6 0 013 18.4z"></path><path d="M3 13h5l1.2 2.2h5.6L16 13h5"></path></symbol>
            <symbol id="g-dossier" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 5.5h6l1.6 2.2H20v10.8H4z"></path><path d="M8 12h8M8 15h5"></path></symbol>
            <symbol id="g-layers" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l9 4.8-9 4.8L3 7.8z"></path><path d="M3 12.4l9 4.8 9-4.8M3 16.6l9 4.8 9-4.8"></path></symbol>
            <symbol id="g-sat" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"><rect x="10" y="8.4" width="4" height="7.2" rx=".5"></rect><path d="M10 10.2H3.6v3.6H10M14 10.2h6.4v3.6H14M5.4 10.2v3.6M7.7 10.2v3.6M16.3 10.2v3.6M18.6 10.2v3.6M12 8.4V5.6M9.4 4.2a3.6 3.6 0 015.2 0M12 15.6v2.3"></path></symbol>
            <symbol id="g-select" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3.5" y="3.5" width="17" height="17" rx="1.2"></rect><path d="M3.5 9h17M3.5 14.5h17M9 3.5v17"></path></symbol>
            <symbol id="g-chart" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 20V9M10 20V4M16 20v-8M22 20H2"></path></symbol>
            <symbol id="g-search" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="10.5" cy="10.5" r="6.5"></circle><path d="M15.4 15.4L21 21"></path></symbol>
            <symbol id="g-bell" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 16V11a6 6 0 1112 0v5l1.6 2.4H4.4z"></path><path d="M10 20.5a2.2 2.2 0 004 0"></path></symbol>
            <symbol id="g-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="4"></circle><path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.4 5.4l1.9 1.9M16.7 16.7l1.9 1.9M18.6 5.4l-1.9 1.9M7.3 16.7l-1.9 1.9"></path></symbol>
            <symbol id="g-comment" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M20.5 4.5H3.5v12h4v3.5l4-3.5h9z"></path><path d="M7 9h10M7 12h6"></path></symbol>
            <symbol id="g-plus" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 5v14M5 12h14"></path></symbol>
            <symbol id="g-ship" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3.5 14.5l1.8 5a1.6 1.6 0 001.5 1h10.4a1.6 1.6 0 001.5-1l1.8-5z"></path><path d="M6 14.5V9h12v5.5M12 9V5.5M9.5 5.5h5"></path></symbol>
            <symbol id="g-plane" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M12 2.5l1.6 6.4 7.4 3.4v1.8l-7.4-1.8-.7 4.4 2.7 2v1.3L12 19l-3.6.9v-1.3l2.7-2-.7-4.4L3 14v-1.8l7.4-3.4z"></path></symbol>
            <symbol id="g-event" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3.5l8.5 8.5-8.5 8.5L3.5 12z"></path></symbol>
            <symbol id="g-pie" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M11 4a8 8 0 1 0 8 8h-8z"></path><path d="M14 2a8 8 0 0 1 8 8h-8z"></path></symbol>
            <symbol id="g-trend" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 17l5-5 4 3 8-8"></path><path d="M15 7h5v5"></path></symbol>
            <symbol id="g-asset" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7.5 3v5.6c0 4.4-3.1 7.6-7.5 9.4-4.4-1.8-7.5-5-7.5-9.4V6z"></path><path d="M12 8.2l3 3.3-3 3.3-3-3.3z"></path></symbol>
            <symbol id="g-brief" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 3.5h8.5L19 8v12.5H6z"></path><path d="M14 3.5V8h5M9 12h7M9 15h7M9 18h4"></path></symbol>
            <symbol id="g-work" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="4" width="16" height="16" rx="1"></rect><path d="M8 9l1.5 1.5L12 8M8 15l1.5 1.5L12 14M14 9.5h3M14 15.5h3"></path></symbol>
            <symbol id="g-cursor" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M6 3.5l12.5 8.2-5.6 1.2 3.2 6-2.4 1.2-3.2-6-4.5 3.6z"></path></symbol>
            <symbol id="g-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 21s6.5-6.4 6.5-11A6.5 6.5 0 005.5 10c0 4.6 6.5 11 6.5 11z"></path><circle cx="12" cy="10" r="2.3"></circle></symbol>
            <symbol id="g-path" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 19c5-1 6-6 9-9s5-3 7-3"></path><circle cx="4" cy="19" r="2"></circle><circle cx="20" cy="7" r="2"></circle></symbol>
            <symbol id="g-poly" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M4 8.5l7-4.5 9 4v8l-7 4.5-9-4z"></path></symbol>
            <symbol id="g-measure" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><path d="M3 14.5L14.5 3l6.5 6.5L9.5 21z"></path><path d="M7 11l2 2M10 8l2 2M13 5l2 2"></path></symbol>
            <symbol id="g-silh-ship" viewBox="0 0 120 60" fill="currentColor"><path d="M10 40h100l-6 13a4 4 0 01-3.6 2.2H19.6A4 4 0 0116 53z"></path><path d="M22 38V24h34v14zM60 38V17h22l4 21z" opacity=".8"></path><path d="M66 15V6h2v9zM40 22h10v3H40zM26 30h24v3H26z" opacity=".5"></path></symbol>
            <symbol id="g-silh-plane" viewBox="0 0 120 60" fill="currentColor"><path d="M59 4c2.6 0 4 3 4.6 7l1.4 12.5 26 9.5c1.6.6 2.6 1.6 2.6 3v3l-28-5.4-1.6 15.6 8.6 5.2v3.2L60 54.5 47.4 57.6v-3.2l8.6-5.2-1.6-15.6-28 5.4v-3c0-1.4 1-2.4 2.6-3l26-9.5L56.4 11C57 7 58.4 4 59 4z"></path></symbol>
            <symbol id="g-doc" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M5.5 3.5h9l4 4v13h-13z"></path><path d="M14.5 3.5v4h4M8.5 17l5.5-5.5 1.6 1.6-5.5 5.5H8.5z"></path></symbol>
            <symbol id="g-deck" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="12" rx="1"></rect><path d="M12 16v4M8 20.5h8M7 12.5l3-3 2 2 4-4"></path></symbol>
            <symbol id="g-folder" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 6.5h6l1.8 2H20.5v10h-17z"></path></symbol>
            <symbol id="g-camera" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 8h3.5l1.5-2.5h6L16.5 8H20v11H4z"></path><circle cx="12" cy="13.2" r="3.4"></circle></symbol>
            <symbol id="g-gear" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="3"></circle><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"></path><circle cx="12" cy="12" r="6.2"></circle></symbol>
            <symbol id="g-help" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="8.5"></circle><path d="M9.6 9.6a2.5 2.5 0 114 2c-1 .6-1.6 1.1-1.6 2.3M12 16.8v.4"></path></symbol>
            <symbol id="g-feed" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="4.5" width="17" height="15" rx="1.2"></rect><path d="M7 9h7M7 12.5h10M7 16h5"></path></symbol>
            <symbol id="g-user" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8.5" r="3.6"></circle><path d="M4.8 20c.8-3.6 3.6-5.6 7.2-5.6s6.4 2 7.2 5.6"></path></symbol>
            <symbol id="g-tabs" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3.5" y="7.5" width="13" height="12" rx="1"></rect><path d="M7.5 7.5V4.5h13v12h-4"></path></symbol>
                {/* ── Constellation · Part H symbols ──────────────────────
                Added verbatim from the spec's Constellation.dc.html so its
                markup references them untranslated, exactly as the other
                Part F1 symbols above. */}
            <symbol id="g-link" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M10 14l4-4M8.5 16.5l-1.5 1.5a3 3 0 01-4.2-4.2l3.5-3.5a3 3 0 014.2 0M15.5 7.5l1.5-1.5a3 3 0 014.2 4.2l-3.5 3.5a3 3 0 01-4.2 0"></path></symbol>
            <symbol id="g-org" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="3.5" width="10" height="17"></rect><path d="M14 9h6v11.5h-6M7 7h4M7 10.5h4M7 14h4M9 20.5v-3"></path></symbol>
            <symbol id="g-person" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="8.5" r="3.6"></circle><path d="M4.8 20c.8-3.6 3.6-5.6 7.2-5.6s6.4 2 7.2 5.6"></path></symbol>
            <symbol id="g-gate" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 5c4 2 4 12 0 14M21 5c-4 2-4 12 0 14"></path><path d="M12 4v16" strokeDasharray="2 2"></path></symbol>
            <symbol id="g-route" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="5" cy="18" r="2"></circle><circle cx="19" cy="6" r="2"></circle><path d="M7 18h6a3 3 0 000-6h-2a3 3 0 010-6h6" strokeDasharray="2 2"></path></symbol>
            <symbol id="g-anchor" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="5.5" r="2"></circle><path d="M12 7.5V20M8 11h8M4.5 14a7.5 7.5 0 0015 0"></path></symbol>
            <symbol id="g-shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3l7.5 3v5.6c0 4.4-3.1 7.6-7.5 9.4-4.4-1.8-7.5-5-7.5-9.4V6z"></path><path d="M8.5 12h7"></path></symbol>
            <symbol id="g-schema" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="3.5" y="4" width="7" height="5"></rect><rect x="13.5" y="4" width="7" height="5"></rect><rect x="8.5" y="15" width="7" height="5"></rect><path d="M7 9v3h10V9M12 12v3"></path></symbol>
            <symbol id="g-play" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l10.5-6.5z"></path></symbol>
            <symbol id="g-pause" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z"></path></symbol>
            <symbol id="g-map" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3.5 6.5l5.5-2.5 6 2.5 5.5-2.5v13.5l-5.5 2.5-6-2.5-5.5 2.5z"></path><path d="M9 4v13.5M15 6.5V20"></path></symbol>
            <symbol id="g-merge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M6 4v4c0 3 6 4 6 8v4M18 4v4c0 3-6 4-6 8"></path><path d="M9 17l3 3 3-3"></path></symbol>
            <symbol id="g-ban" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="4" y="3.5" width="16" height="17"></rect><path d="M8 8h8M8 11.5h8M8 15h5"></path><path d="M14.5 15.5l4 4M18.5 15.5l-4 4"></path></symbol>
            <symbol id="g-flame" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 3c1 3.5 5 5.4 5 10a5 5 0 01-10 0c0-2.4 1.2-3.8 2.4-5 .2 1.8 1 2.8 2 3.2C11 9 11.3 5.8 12 3z"></path></symbol>
            <symbol id="g-trace" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2.5" y="9" width="5" height="6"></rect><rect x="9.5" y="9" width="5" height="6"></rect><rect x="16.5" y="4" width="5" height="5"></rect><rect x="16.5" y="15" width="5" height="5"></rect><path d="M7.5 12h2M14.5 12l2-5.5M14.5 12l2 5.5"></path></symbol>
    </svg>
    )
}
