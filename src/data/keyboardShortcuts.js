// keyboardShortcuts.js — real Settings round, Keyboard section. The one
// real, audited list of this app's actual current keybindings (never
// invented) — a single source of truth so Settings' Keyboard tab can't
// drift from whatever's really wired. Sourced directly from each real
// handler at the time of the audit; if a shortcut is added/changed, update
// its row here too rather than letting this list go stale.
export const KEYBOARD_SHORTCUTS = [
    { keys: "⌘/Ctrl K", action: "Open command palette / focus search", context: "Global", file: "src/app.jsx, src/components/HeaderSearch.jsx" },
    { keys: "/", action: "Focus header search", context: "Global (not while typing)", file: "src/components/HeaderSearch.jsx" },
    { keys: "1–9", action: "Open the Nth module tab", context: "Global (not while typing)", file: "src/app.jsx" },
    { keys: "Alt W", action: "Toggle Watch / Workstation mode", context: "Global (not in a text field)", file: "src/app.jsx" },
    { keys: "Alt G", action: "Switch to Workstation mode, open My Work", context: "Global (not in a text field)", file: "src/app.jsx" },
    { keys: "Alt T", action: "Cycle theme: auto \u2192 light \u2192 dark", context: "Global (not in a text field)", file: "src/app.jsx" },
    { keys: "L", action: "Toggle the Layers panel", context: "Map control stack", file: "src/components/LayersFlyout.jsx" },
    { keys: "Esc", action: "Close the open flyout / command palette / inspector", context: "Global", file: "src/ui/FlyoutMenu.jsx, src/components/InspectorPanel.jsx" },
    { keys: "↑ / ↓", action: "Previous / next story", context: "Mobile news reels", file: "src/components/NewsReels.jsx" },
    { keys: "→ / Space", action: "Next slide", context: "Deck presentation", file: "src/reports/Deck.jsx" },
    { keys: "←", action: "Previous slide", context: "Deck presentation", file: "src/reports/Deck.jsx" },
    { keys: "Home / End", action: "Jump to first / last slide", context: "Deck presentation", file: "src/reports/Deck.jsx" },
    { keys: "Delete / Backspace", action: "Delete selected node or edge", context: "Forge pipeline canvas", file: "src/components/forge/PipelineCanvas.jsx" },
]
