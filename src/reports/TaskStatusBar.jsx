import { useState } from "react"
import { Button, Panel } from "../ui/index.js"
import { formatTaskRegion, statusBadgeColor } from "./taskDisplay.js"

/**
 * Always-visible status header for a selected ReportTask — adapted from the
 * status badge + status-gated action buttons in ForgePanel.jsx's
 * TaskDataPackage toolbar (~line 2176-2210). The action-gating logic matches
 * the backend's real constraints exactly:
 *   - "Finish Collection" only when status is "queued" or "collecting"
 *     (POST /finish-collection)
 *   - "Start Draft" only when status is "ready_to_draft" (POST /draft)
 *   - "Archive" only when status is "published" (POST /archive)
 *
 * Props:
 *   task    — the real task dict ({focus, region, period_start, period_end,
 *             status, ...}); renders a loading-ish empty state if null.
 *   onAction(actionPath, body) — async; caller performs the real fetch
 *             (POST /api/reports/tasks/{task_id}{actionPath}) and returns the
 *             updated task. This component only calls it and manages local
 *             busy/error/message state.
 *   busy    — bool; when true (caller-driven), all action buttons disable
 *             in addition to this component's own in-flight state.
 */
export default function TaskStatusBar({ task, onAction, busy = false }) {
    const [localBusy, setLocalBusy] = useState(false)
    const [msg, setMsg] = useState("")

    if (!task) {
        return (
            <Panel elevated style={{ display: "flex", alignItems: "center" }}>
                <span style={{ color: "var(--text-dim)", fontSize: "var(--text-sm)" }}>Loading task…</span>
            </Panel>
        )
    }

    const isBusy = busy || localBusy
    const isCollecting = task.status === "queued" || task.status === "collecting"
    const color = statusBadgeColor(task.status)

    const doAction = async (path, body) => {
        setLocalBusy(true); setMsg("")
        try {
            await onAction(path, body)
            setMsg("Done")
        } catch (e) {
            setMsg(e?.message || "Failed")
        } finally {
            setLocalBusy(false)
            setTimeout(() => setMsg(""), 3000)
        }
    }

    return (
        <Panel elevated style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
                <span style={{ color: "var(--text-primary)", fontSize: "var(--text-md)", fontWeight: 600 }}>
                    {task.focus || task.task_id}
                </span>
                <span style={{
                    fontSize: "var(--text-xs)", padding: "2px 8px", borderRadius: 8,
                    background: `color-mix(in srgb, ${color} 18%, transparent)`, color, fontWeight: 700, textTransform: "uppercase",
                    letterSpacing: "0.04em",
                }}>{task.status}</span>
                <div style={{ flex: 1 }} />
                {isCollecting && (
                    <Button size="sm" disabled={isBusy} onClick={() => doAction("/finish-collection")}>
                        Finish Collection
                    </Button>
                )}
                {task.status === "ready_to_draft" && (
                    <Button size="sm" disabled={isBusy} onClick={() => doAction("/draft", {})}>
                        Start Draft
                    </Button>
                )}
                {task.status === "published" && (
                    <Button size="sm" variant="ghost" disabled={isBusy} onClick={() => doAction("/archive")}>
                        Archive
                    </Button>
                )}
                {msg && (
                    <span style={{ color: msg === "Done" ? "var(--sev-low)" : "var(--sev-critical)", fontSize: "var(--text-xs)" }}>
                        {msg}
                    </span>
                )}
            </div>
            <div style={{ display: "flex", gap: "var(--space-4)", flexWrap: "wrap", fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
                <span><span style={{ color: "var(--text-dim)" }}>Region:</span> {formatTaskRegion(task)}</span>
                <span><span style={{ color: "var(--text-dim)" }}>Period start:</span> {task.period_start ? new Date(task.period_start).toLocaleString() : "—"}</span>
                <span><span style={{ color: "var(--text-dim)" }}>Period end:</span> {task.period_end ? new Date(task.period_end).toLocaleString() : "open-ended"}</span>
            </div>
        </Panel>
    )
}
