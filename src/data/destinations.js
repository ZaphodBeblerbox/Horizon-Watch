// The 5 real, always-visible top-level destinations (full UI rebuild spec,
// section 3.1) — exactly this order, exactly these 5, nothing else. Globe/
// Maritime Operational View (section 4) is deliberately NOT one of these —
// it's the default/home screen reached via the header wordmark/icon mark,
// existing "behind" these 5 the same way it's the base layer of the app.
export const DESTINATIONS = [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "reports", label: "Reports", icon: "reports" },
    { key: "watchlists", label: "Watchlists", icon: "bell" },
    // label "Intel" per the UI correction pass (Part 11.5) — key/icon/tab-type
    // stay "sources" deliberately: src/app.jsx (off-limits this round) keys
    // tab state, its MODE_LABELS "SOURCES" string, and its openTab() LABELS
    // "Sources" string all off this literal key, so renaming it would touch
    // app.jsx just to keep those maps working — a bigger blast radius than
    // this destination's own display text warrants. See Sources.jsx's own
    // top comment for the resulting (documented) inconsistency this leaves.
    { key: "sources", label: "Intel", icon: "sources" },
    { key: "aiCouncil", label: "AI Council", icon: "aiCouncil" },
]

export const DESTINATION_KEYS = DESTINATIONS.map((d) => d.key)
