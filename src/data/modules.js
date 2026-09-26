// The 9 real top-level modules — page-by-page rebuild, Stage 0. Exactly this
// order, exactly these 9 (the print layout is a real 10th view, reachable
// only from Briefings/Generate, never from the rail itself, per the build
// spec's own "hidden module" note).
//   Situation  -> the globe home screen (built, Stage 1)
//   Inbox      -> the alert/Watchlists console (Stage 2, not yet rebuilt —
//                 still the pre-redesign WatchlistsPage)
//   Dossiers   -> rebuilt (src/destinations/Dossiers.jsx) — real entity
//                 exposure-profile module (WatchZone + StrategicZone),
//                 backed by GET /api/dossiers/*
//   Analytics  -> rebuilt onto the real design system (src/destinations/
//                 Analytics.jsx), backed by GET /api/analytics/overview
//   Generate   -> rebuilt (src/reports/Generate.jsx) — real 3-column run
//                 screen with a live 7-step checklist, replacing ReportsPage
//   Replay     -> rebuilt (src/destinations/Replay.jsx) — real timeline
//                 ruler/lanes/playhead/transport over GET /api/analytics/
//                 timeline, replacing the old "Director Mode" tools-flyout
//                 (deleted in full, see src/services/replayOnMap.js)
//   Ontology   -> rebuilt (src/destinations/Ontology.jsx) — fixed four-tier
//                 diagram backed by GET /api/ontology/diagram
//   Imagery    -> rebuilt (src/destinations/Imagery.jsx) — real satellite
//                 change-detection UI wired to the Sentinel/YOLO-OBB pipeline
//   Briefings  -> rebuilt (src/reports/Briefings.jsx) — the real interactive
//                 reader/editor, genuinely split from Generate; the print
//                 layout (src/reports/PrintLayout.jsx) is the shared hidden
//                 10th view both lead to
// Mode, not modules (V3 Workstation round, §7.1) — every module now
// carries a real `set` ("watch" | "work") so the rail can be filtered by a
// single, correct-by-construction data field rather than any imperative
// re-application after render. This app's rail is already real React
// (MODULES.map() in TopBar.jsx, re-evaluated fresh every render from
// current props) — the reference document's own "Bug A" (an innerHTML
// rebuild silently discarding a previously-applied inline style.display)
// is a vanilla-DOM failure mode that cannot occur here structurally, since
// React always re-derives the rendered set from real current data on every
// render. The underlying PRINCIPLE the doc's fix embodies — filter off one
// real registry field, never re-derive/patch after the fact — is what's
// applied below regardless.
export const MODULES = [
    { key: "situation", label: "Situation", icon: "i-globe",   built: true, set: "watch" },
    { key: "inbox",     label: "Inbox",     icon: "i-inbox",   built: true, set: "watch" },
    { key: "dossiers",  label: "Dossiers",  icon: "i-dossier", built: true, set: "watch" },
    { key: "analytics", label: "Analytics", icon: "i-chart",   built: true, set: "watch" },
    // Hidden on purpose (PARALLAX spec §1.3): Generate is the second face of
    // Briefings, reached by a `read | generate` control inside the Briefings
    // toolbar — not a rail entry. It stays in MODULES so the command palette
    // and openTab() can still reach it; `hidden` only removes the rail button.
    { key: "generate",  label: "Generate",  icon: "i-spark",   built: true, set: "watch", hidden: true },
    { key: "replay",    label: "Replay",    icon: "i-clock",    built: true, set: "watch" },
    { key: "ontology",  label: "Ontology",  icon: "i-onto",    built: true, set: "watch" },
    { key: "imagery",   label: "Imagery",   icon: "i-sat",     built: true, set: "watch" },
    // Scenario board (spec addendum F2) — between Imagery and Briefings.
    // A forecast belongs next to the evidence it rests on and before the
    // document it ends up in.
    { key: "forecast",  label: "Forecast",  icon: "i-orb",     built: true, set: "watch" },
    { key: "briefings", label: "Briefings", icon: "i-read",    built: true, set: "watch" },
    // Workstation modules — §7.1. Cases absorbed "My work" and "Mail":
    // three windows over the same job meant an analyst had to remember
    // which of them a document, a message or a file had been left in.
    { key: "cases",     label: "Cases",     icon: "i-case",    built: true, set: "work" },
    { key: "team",      label: "Team",      icon: "i-team",    built: true, set: "work" },
]

// `hidden` modules draw no rail button and are reached from inside another
// surface (PARALLAX spec §1.3). They remain in MODULES so every other
// consumer — the command palette, openTab(), keyboard shortcuts — still
// resolves them.
export const WATCH_MODULES = MODULES.filter((m) => m.set === "watch" && !m.hidden)
export const WORK_MODULES = MODULES.filter((m) => m.set === "work" && !m.hidden)

export const MODULE_KEYS = MODULES.map((m) => m.key)
export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]))
