import { buttonStyle } from "../ui/styleHelpers.js"

// Fixed top-level navigation — replaces TabBar.jsx's open-ended, closable,
// drag-reorderable tab strip with exactly these 4 modes. "Reports" is the
// existing "briefing" tab type under a renamed label (it already has real
// content — see the Round 2 report for why this isn't a placeholder rename).
const MODES = [
    { type: "map",      label: "Globe" },
    { type: "news",     label: "News" },
    { type: "briefing", label: "Reports" },
    { type: "forge",    label: "Forge" },
]

export default function TopNav({ activeTabType = "map", onOpenTab, badges = {} }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {MODES.map(m => (
                <button
                    key={m.type}
                    onClick={() => onOpenTab(m.type)}
                    style={{ ...buttonStyle({ variant: "ghost", size: "sm", active: activeTabType === m.type }), position: "relative" }}
                >
                    {m.label}
                    {badges[m.type] && (
                        <span style={{
                            position: "absolute", top: 2, right: 2, width: 6, height: 6,
                            borderRadius: "50%", background: "var(--accent)",
                        }} />
                    )}
                </button>
            ))}
        </div>
    )
}

export { MODES }
