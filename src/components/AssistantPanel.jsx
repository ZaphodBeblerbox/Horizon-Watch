/**
 * AssistantPanel.jsx — the desktop assistant: a glass panel on the right,
 * between the top bar and the status bar, over the map (so a fly is seen).
 * Replaces ChatPanel.jsx, the mission chat that had no access to our data.
 * The conversation itself is src/assistant/AssistantThread.jsx, shared with
 * the phone.
 */
import AssistantThread from "../assistant/AssistantThread.jsx"

const PANEL = {
    position: "fixed",
    top: "var(--top, 40px)",
    right: 0,
    bottom: "var(--status, 0px)",
    width: 380,
    maxWidth: "calc(100vw - 60px)",
    zIndex: 620,
    background: "var(--glass, rgba(14,17,23,.86))",
    backdropFilter: "blur(22px) saturate(1.15)",
    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
    borderLeft: "1px solid var(--gline, rgba(255,255,255,.08))",
    boxShadow: "var(--gshadow, none)",
    display: "flex",
    flexDirection: "column",
}

export default function AssistantPanel({ mode = null, onClose }) {
    return (
        <aside style={PANEL} data-screen-label="Assistant" aria-label="Assistant">
            <AssistantThread platform="desktop" mode={mode} onClose={onClose} />
        </aside>
    )
}
