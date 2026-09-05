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
export const MODULES = [
    { key: "situation", label: "Situation", icon: "i-globe",   built: true },
    { key: "inbox",     label: "Inbox",     icon: "i-inbox",   built: false },
    { key: "dossiers",  label: "Dossiers",  icon: "i-dossier", built: true },
    { key: "analytics", label: "Analytics", icon: "i-chart",   built: true },
    { key: "generate",  label: "Generate",  icon: "i-spark", built: true },
    { key: "replay",    label: "Replay",    icon: "i-clock",    built: true },
    { key: "ontology",  label: "Ontology",  icon: "i-onto",    built: true },
    { key: "imagery",   label: "Imagery",   icon: "i-sat",     built: true },
    { key: "briefings", label: "Briefings", icon: "i-read",    built: true },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)
export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]))
