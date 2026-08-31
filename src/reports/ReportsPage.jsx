/**
 * ReportsPage.jsx — the "Reports" top-level destination (full UI rebuild
 * spec, section 8.2). Ties together the pieces this round already built:
 * TaskList -> (once a task with a drafted report is selected) TaskStatusBar
 * + a Reading/Editing mode toggle -> ReadingWorkspace/EditingWorkspace.
 *
 * Both workspace modes keep a live map visible per the spec's "one operating
 * environment" rule — satisfied because both ReadingWorkspace and
 * EditingWorkspace already render a real ReportMapTab internally.
 *
 * UI correction pass, Part 1: also hosts the standalone "Claude Briefings"
 * document library (BriefingPanel.jsx) as a second top-level mode —
 * "Tasks" (everything above, unchanged) vs "Briefings" (mounts
 * BriefingPanel directly). BriefingPanel previously had its own top-nav tab
 * that no longer exists anywhere in the 5-destination nav model; this is
 * its real way back in, reachable without selecting a ReportTask first
 * since Briefings are a separate, lighter concept than ReportTask-driven
 * reports. BriefingPanel's `onMarkRead` was previously wired to clear an
 * unread-briefing badge on the old top-nav tab — that tab and its badge no
 * longer exist (AppHeader.jsx/app.jsx are other agents' parallel work this
 * round, out of scope here), so it's a documented no-op rather than a fake
 * wire-up. `onReplay` (Director Mode replay of a saved Director briefing)
 * is left unset — BriefingPanel already renders its Replay button only
 * when a real handler is passed, so omitting it just hides that action
 * rather than faking a replay this destination has no Director Mode
 * surface to actually perform.
 *
 * Not wired into app.jsx by this file — the integrator renders this when
 * the active destination is "reports".
 */
import { useEffect, useState, useCallback } from "react"
import TaskList from "./TaskList.jsx"
import TaskStatusBar from "./TaskStatusBar.jsx"
import ReadingWorkspace from "./ReadingWorkspace.jsx"
import EditingWorkspace from "./EditingWorkspace.jsx"
import BriefingPanel from "../components/BriefingPanel.jsx"
import Icon from "../ui/Icon.jsx"
import { Button } from "../ui/index.js"
import { getReportTask, getReport, getReportSections, runTaskAction } from "./reportApi.js"

const MODES = [
    { key: "reading", label: "Reading" },
    { key: "editing", label: "Editing" },
]

const TOP_MODES = [
    { key: "tasks", label: "Tasks" },
    { key: "briefings", label: "Briefings" },
]

function TopModeTabs({ topMode, onChange }) {
    return (
        <div style={{
            display: "flex", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)",
            borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-header-2)",
        }}>
            {TOP_MODES.map((m) => (
                <button
                    key={m.key}
                    onClick={() => onChange(m.key)}
                    style={{
                        background: "none", border: "none", cursor: "pointer",
                        padding: "4px 2px", fontFamily: "var(--font-sans)", fontSize: "var(--text-body)",
                        fontWeight: "var(--weight-medium)",
                        color: topMode === m.key ? "var(--text-primary)" : "var(--text-secondary)",
                        borderBottom: topMode === m.key ? "2px solid var(--accent-blue)" : "2px solid transparent",
                    }}
                >
                    {m.label}
                </button>
            ))}
        </div>
    )
}

export default function ReportsPage() {
    const [topMode, setTopMode] = useState("tasks")
    const [taskId, setTaskId] = useState(null)
    const [task, setTask] = useState(null)
    const [report, setReport] = useState(null)
    const [sections, setSections] = useState(null)
    const [mode, setMode] = useState("reading")
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState("")

    const loadTask = useCallback(async (id) => {
        try {
            const t = await getReportTask(id)
            setTask(t)
            return t
        } catch (e) {
            setError(e.message || "Failed to load task")
            return null
        }
    }, [])

    const loadReport = useCallback(async (reportId) => {
        if (!reportId) { setReport(null); setSections(null); return }
        try {
            const [r, s] = await Promise.all([getReport(reportId), getReportSections(reportId)])
            setReport(r)
            setSections(s)
        } catch (e) {
            setError(e.message || "Failed to load report")
        }
    }, [])

    useEffect(() => {
        if (!taskId) { setTask(null); setReport(null); setSections(null); return }
        let cancelled = false
        setError("")
        loadTask(taskId).then((t) => { if (!cancelled && t?.report_id) loadReport(t.report_id) })
        return () => { cancelled = true }
    }, [taskId, loadTask, loadReport])

    const handleTaskAction = async (path, body) => {
        setBusy(true)
        try {
            const updated = await runTaskAction(taskId, path, body)
            setTask(updated)
            if (updated?.report_id && updated.report_id !== report?.report_id) {
                await loadReport(updated.report_id)
            }
            return updated
        } finally {
            setBusy(false)
        }
    }

    const hasReport = !!task?.report_id

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "var(--bg-app)" }}>
            <TopModeTabs topMode={topMode} onChange={setTopMode} />

            {topMode === "briefings" ? (
                <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                    <BriefingPanel onClose={() => setTopMode("tasks")} onMarkRead={() => {}} />
                </div>
            ) : !taskId ? (
                <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-4)" }}>
                    <TaskList onSelectTask={setTaskId} />
                </div>
            ) : (
                <>
                    <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4) 0" }}>
                        <Button variant="ghost" size="sm" onClick={() => setTaskId(null)}>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <Icon name="chevronRight" size={14} style={{ transform: "rotate(180deg)" }} />
                                Back to Tasks
                            </span>
                        </Button>
                    </div>
                    <div style={{ flexShrink: 0 }}>
                        <TaskStatusBar task={task} onAction={handleTaskAction} busy={busy} />
                    </div>

                    {hasReport && (
                        <div style={{
                            display: "flex", gap: "var(--space-2)", padding: "var(--space-2) var(--space-4)",
                            borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--bg-panel)",
                        }}>
                            {MODES.map((m) => (
                                <button
                                    key={m.key}
                                    onClick={() => setMode(m.key)}
                                    style={{
                                        background: "none", border: "none", cursor: "pointer",
                                        padding: "4px 2px", fontFamily: "var(--font-sans)", fontSize: "var(--text-body)",
                                        fontWeight: "var(--weight-medium)",
                                        color: mode === m.key ? "var(--text-primary)" : "var(--text-secondary)",
                                        borderBottom: mode === m.key ? "2px solid var(--accent-blue)" : "2px solid transparent",
                                    }}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    )}

                    {error && (
                        <div style={{ padding: "var(--space-2) var(--space-4)", color: "var(--danger)", fontSize: "var(--text-xs)" }}>
                            {error}
                        </div>
                    )}

                    <div style={{ flex: 1, minHeight: 0 }}>
                        {!hasReport ? (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                                This task has no drafted report yet — finish collection and start a draft from the status bar above.
                            </div>
                        ) : !report || !sections ? (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>
                                Loading report…
                            </div>
                        ) : mode === "reading" ? (
                            <ReadingWorkspace report={report} sections={sections} task={task} />
                        ) : (
                            <EditingWorkspace report={report} sections={sections} task={task} onReportChange={setReport} />
                        )}
                    </div>
                </>
            )}
        </div>
    )
}
