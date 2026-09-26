/**
 * SidePanel.jsx — a side panel that collapses to a grip.
 *
 * One component rather than the same open/closed logic written into each
 * pane: that is how the app ended up with panes that collapsed differently,
 * or not at all, and none of which remembered.
 *
 * Collapsed it keeps a 16px grip carrying the panel's name, never zero
 * width. A pane that disappears completely leaves nothing to click to get
 * it back, and the reader has to know it existed to go looking for it.
 *
 * `storageKey` persists the state per user through settingsStore; without
 * one the panel is open-by-default and forgets, which is right for a panel
 * that only exists for part of a session.
 */

import { useState } from "react"
import { useChrome } from "../state/useChrome.js"

function Grip({ side, label, onClick }) {
    return (
        <div
            role="button"
            tabIndex={0}
            onClick={onClick}
            title={`Show ${label}`}
            style={{
                width: 16, flexShrink: 0, cursor: "pointer",
                background: "var(--bg-1)",
                [side === "left" ? "borderRight" : "borderLeft"]: "1px solid var(--line)",
                display: "flex", alignItems: "center", justifyContent: "center",
            }}
        >
            <span style={{
                writingMode: "vertical-rl",
                transform: side === "left" ? "rotate(180deg)" : "none",
                font: "500 10px var(--font)", color: "var(--txt-3)",
                letterSpacing: ".08em", textTransform: "uppercase", userSelect: "none",
            }}>{label}</span>
        </div>
    )
}

export default function SidePanel({
    side = "left", label, width = 250, storageKey = null,
    defaultOpen = true, children, style = {},
}) {
    // Two hooks, one used: a hook cannot be called conditionally, and a
    // panel with no storageKey must not write to a settings key named
    // after nothing.
    const stored = useChrome(storageKey || "__unused__")
    const local = useState(defaultOpen)
    const [open, setOpen] = storageKey
        ? [stored[0], stored[2]]
        : [local[0], local[1]]

    if (!open) return <Grip side={side} label={label} onClick={() => setOpen(true)} />

    return (
        <div style={{
            width, flexShrink: 0,
            [side === "left" ? "borderRight" : "borderLeft"]: "1px solid var(--line)",
            display: "flex", flexDirection: "column", minHeight: 0, ...style,
        }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 10px",
                borderBottom: "1px solid var(--line)", flexShrink: 0,
            }}>
                <span style={{
                    flex: 1, font: "600 10px var(--font)", color: "var(--txt-3)",
                    textTransform: "uppercase", letterSpacing: ".06em",
                }}>{label}</span>
                <button
                    onClick={() => setOpen(false)}
                    title={`Hide ${label}`}
                    aria-label={`Hide ${label}`}
                    style={{
                        width: 18, height: 18, display: "flex", alignItems: "center",
                        justifyContent: "center", background: "transparent", border: "none",
                        color: "var(--txt-3)", cursor: "pointer", padding: 0,
                    }}
                >
                    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"
                         style={{ transform: side === "left" ? "rotate(90deg)" : "rotate(-90deg)" }}>
                        <path d="M1.5 6.5 L5 3 L8.5 6.5" fill="none" stroke="currentColor"
                              strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </button>
            </div>
            {children}
        </div>
    )
}
