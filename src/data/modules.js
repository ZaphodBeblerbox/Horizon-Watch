// The 7 real top-level modules — redesign Round 2, replacing the old 5-item
// DESTINATIONS model (data/destinations.js) entirely. Exactly this order,
// exactly these 7. Each maps onto real, already-existing app surfaces (or a
// later-round placeholder — see `built: false` below) rather than being
// invented fresh:
//   Situation  -> the globe home screen this round rebuilds (was the
//                 "Globe / Maritime Operational View" default screen)
//   Inbox      -> the alert/Watchlists console, rebuilt in Round 3
//                 (was destinations.js's "watchlists")
//   Dossiers   -> new AOI/entity exposure-profile module, built in Round 3
//                 (genuinely new — no prior equivalent)
//   Analytics  -> existing stats, rebuilt in Round 3
//                 (was AnalyticsPanel.jsx's flyout panel)
//   Generate   -> the snapshot/task report-creation flow already built,
//                 restyled in Round 4 (was destinations.js's "reports",
//                 the task-creation half of ReportsPage.jsx)
//   Briefings  -> the report reading/document register, switching to a
//                 white-paper look in Round 4 (was ReportsPage.jsx's
//                 "Briefings" tab + the reading/editing workspaces)
//   Replay     -> Director Mode, rebuilt in Round 4 to match the lanes/
//                 playhead structure (was the "Director Mode" tools-flyout
//                 toggle)
export const MODULES = [
    { key: "situation", label: "Situation", icon: "icon-globe",     built: true },
    { key: "inbox",     label: "Inbox",     icon: "icon-inbox",     built: false },
    { key: "dossiers",  label: "Dossiers",  icon: "icon-dossier",   built: false },
    { key: "analytics", label: "Analytics", icon: "icon-chart",     built: false },
    { key: "generate",  label: "Generate",  icon: "icon-add-brief", built: false },
    { key: "briefings", label: "Briefings", icon: "icon-doc",       built: false },
    { key: "replay",    label: "Replay",    icon: "icon-play",      built: false },
]

export const MODULE_KEYS = MODULES.map((m) => m.key)
export const MODULE_BY_KEY = Object.fromEntries(MODULES.map((m) => [m.key, m]))
