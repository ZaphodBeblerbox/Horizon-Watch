/**
 * AssistantPanel.jsx — the desktop assistant away from the map. On the map
 * the same conversation is the right column's Assistant tab instead
 * (destinations/Situation.jsx, assistant/assistantDock.js). The
 * conversation itself is src/assistant/AssistantThread.jsx, shared with the
 * phone.
 */
import AssistantThread from "../assistant/AssistantThread.jsx"

/* THE SAME FRAME AS THE INSPECTOR (owner, 2026-10-23): the map's right
   column is 312px (--pane-r), 12px in from the edge, 10px under the top bar,
   down to --pane-bottom, in the same frosted pane-glass; it slides in. */
const PANEL = {
    position: "fixed",
    top: "var(--top, 40px)",
    marginTop: 10,
    right: 12,
    bottom: "calc(var(--status, 0px) + var(--pane-bottom, 22px))",
    width: "var(--pane-r, 312px)",
    maxWidth: "calc(100vw - 24px)",
    zIndex: 620,
    border: "1px solid var(--gline)",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
}

export default function AssistantPanel({ onClose }) {
    return (
        <aside className="pane-glass plx-as-panel" style={PANEL} data-screen-label="Assistant" aria-label="Assistant" data-testid="assistant-panel">
            <AssistantThread platform="desktop" onClose={onClose} />
        </aside>
    )
}
