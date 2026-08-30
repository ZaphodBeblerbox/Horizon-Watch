// The 5 real, always-visible top-level destinations (full UI rebuild spec,
// section 3.1) — exactly this order, exactly these 5, nothing else. Globe/
// Maritime Operational View (section 4) is deliberately NOT one of these —
// it's the default/home screen reached via the header wordmark/icon mark,
// existing "behind" these 5 the same way it's the base layer of the app.
export const DESTINATIONS = [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "reports", label: "Reports", icon: "reports" },
    { key: "watchlists", label: "Watchlists", icon: "bell" },
    { key: "sources", label: "Sources", icon: "sources" },
    { key: "aiCouncil", label: "AI Council", icon: "aiCouncil" },
]

export const DESTINATION_KEYS = DESTINATIONS.map((d) => d.key)
