// The 9 real top-level modules — page-by-page rebuild, Stage 0. Exactly this
// order, exactly these 9 (the print layout is a real 10th view, reachable
// only from Briefings/Generate, never from the rail itself, per the build
// spec's own "hidden module" note).
//   Situation  -> the globe home screen (built, Stage 1)
//   Inbox      -> the alert/Watchlists console (Stage 2, not yet rebuilt —
//                 still the pre-redesign WatchlistsPage)
//   Dossiers   -> AOI/entity exposure-profile module (Stage 3, placeholder —
//                 genuinely new, no prior equivalent)
//   Analytics  -> rebuilt onto the real design system (src/destinations/
//                 Analytics.jsx), backed by GET /api/analytics/overview
//   Generate   -> Stage 5, not yet restyled — still the pre-redesign
//                 ReportsPage (Tasks view)
//   Replay     -> Stage 7, placeholder — was the "Director Mode"
//                 tools-flyout toggle, not yet rebuilt to lanes/playhead
//   Ontology   -> Stage 8, placeholder — genuinely new, doesn't exist yet
//   Imagery    -> Stage 9, placeholder — genuinely new, doesn't exist yet
//   Briefings  -> Stage 6, not yet rebuilt — still the pre-redesign
//                 ReportsPage (Briefings view)
export const MODULES = [
    { key: "situation", label: "Situation", icon: "i-globe",   built: true },
    { key: "inbox",     label: "Inbox",     icon: "i-inbox",   built: false },
    { key: "dossiers",  label: "Dossiers",  icon: "i-dossier", built: false },
    { key: "analytics", label: "Analytics", icon: "i-chart",   built: false },
    { key: "generate",  label: "Generate",  icon: "i-spark", built: false },
    { key: "replay",    label: "Replay",    icon: "i-clock",    built: false },
    { key: "ontology",  label: "Ontology",  icon: "i-onto",    built: false },
    { key: "imagery",   label: "Imagery",   icon: "i-sat",     built: false },
    { key: "briefings", label: "Briefings", icon: "i-read",    built: false },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)
export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]))
