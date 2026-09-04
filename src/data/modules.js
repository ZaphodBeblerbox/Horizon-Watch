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
//   Replay     -> Stage 7, placeholder — was the "Director Mode"
//                 tools-flyout toggle, not yet rebuilt to lanes/playhead
//   Ontology   -> Stage 8, placeholder — genuinely new, doesn't exist yet
//   Imagery    -> Stage 9, placeholder — genuinely new, doesn't exist yet
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
    { key: "replay",    label: "Replay",    icon: "i-clock",    built: false },
    { key: "ontology",  label: "Ontology",  icon: "i-onto",    built: false },
    { key: "imagery",   label: "Imagery",   icon: "i-sat",     built: false },
    { key: "briefings", label: "Briefings", icon: "i-read",    built: true },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)
export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]))
