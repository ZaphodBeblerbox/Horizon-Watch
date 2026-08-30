import { useState, useEffect } from "react"
import API_BASE from "../apiBase.js"
import { FOCUS_REGIONS } from "../constants/profile.js"
import { Button, Panel } from "../ui/index.js"
import { formatTaskRegion, statusBadgeColor } from "./taskDisplay.js"

const API = API_BASE

function forgeHeaders() {
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${localStorage.getItem("hw-auth-token") || ""}`,
    }
}

const inputStyle = {
    padding: "6px 10px",
    background: "var(--bg-elevated)",
    border: "1px solid var(--border-subtle)",
    borderRadius: "var(--radius)",
    color: "var(--text-primary)",
    fontSize: "var(--text-sm)",
    fontFamily: "var(--font-sans)",
    outline: "none",
}

/**
 * "+ New Task" creation form — adapted from ForgePanel.jsx's TaskCreateForm
 * (~line 1896). Same real submit shape: POST /api/reports/tasks with
 * { focus, region: "auto"|string[], period_start?, period_end? }.
 */
function TaskCreateForm({ onSaved, onCancel }) {
    const [focus, setFocus] = useState("")
    const [regionMode, setRegionMode] = useState("auto")   // "auto" | "explicit"
    const [regions, setRegions] = useState([])
    const [periodStart, setPeriodStart] = useState("")
    const [periodEnd, setPeriodEnd] = useState("")
    const [saving, setSaving] = useState(false)
    const [err, setErr] = useState("")

    const toggleRegion = (r) => setRegions(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r])
    const canSubmit = regionMode === "auto" || regions.length > 0

    const submit = async () => {
        if (!canSubmit) return
        setSaving(true); setErr("")
        const body = { focus: focus.trim() || null, region: regionMode === "auto" ? "auto" : regions }
        if (periodStart) body.period_start = new Date(periodStart).toISOString()
        if (periodEnd)   body.period_end   = new Date(periodEnd).toISOString()
        try {
            const res = await fetch(`${API}/api/reports/tasks`, { method: "POST", headers: forgeHeaders(), body: JSON.stringify(body) })
            const d = await res.json()
            if (res.ok) onSaved(d)
            else setErr(d.detail || "Failed to create task")
        } catch (e) { setErr(e.message) }
        finally { setSaving(false) }
    }

    return (
        <Panel elevated style={{ marginBottom: "var(--space-4)" }}>
            <div style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)", fontWeight: 600, marginBottom: "var(--space-3)" }}>New Mission Task</div>
            <input
                value={focus}
                onChange={e => setFocus(e.target.value)}
                placeholder="Focus — what should this task watch for? (optional)"
                style={{ ...inputStyle, width: "100%", boxSizing: "border-box", marginBottom: "var(--space-3)" }}
            />
            <div style={{ display: "flex", gap: "var(--space-4)", marginBottom: "var(--space-3)" }}>
                <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-secondary)", fontSize: "var(--text-xs)", cursor: "pointer" }}>
                    <input type="radio" checked={regionMode === "auto"} onChange={() => setRegionMode("auto")} /> Auto (Mission Profile's focus regions)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 5, color: "var(--text-secondary)", fontSize: "var(--text-xs)", cursor: "pointer" }}>
                    <input type="radio" checked={regionMode === "explicit"} onChange={() => setRegionMode("explicit")} /> Choose regions
                </label>
            </div>
            {regionMode === "explicit" && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: "var(--space-3)", maxHeight: 100, overflowY: "auto" }}>
                    {FOCUS_REGIONS.map(r => (
                        <button
                            key={r}
                            onClick={() => toggleRegion(r)}
                            style={{
                                padding: "3px 8px", borderRadius: 10,
                                border: `1px solid ${regions.includes(r) ? "var(--accent-border)" : "var(--border-subtle)"}`,
                                background: regions.includes(r) ? "var(--accent-faint)" : "transparent",
                                color: regions.includes(r) ? "var(--accent)" : "var(--text-secondary)",
                                fontSize: "var(--text-xs)", cursor: "pointer",
                            }}
                        >{r}</button>
                    ))}
                </div>
            )}
            <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-3)" }}>
                <div style={{ flex: 1 }}>
                    <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginBottom: 3 }}>Period start (optional — blank = now)</div>
                    <input type="datetime-local" value={periodStart} onChange={e => setPeriodStart(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginBottom: 3 }}>Period end (optional — blank = open-ended)</div>
                    <input type="datetime-local" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)} style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }} />
                </div>
            </div>
            {err && <div style={{ color: "var(--sev-critical)", fontSize: "var(--text-xs)", marginBottom: "var(--space-2)" }}>{err}</div>}
            <div style={{ display: "flex", gap: "var(--space-2)" }}>
                <Button variant="ghost" onClick={onCancel}>Cancel</Button>
                <Button variant="primary" onClick={submit} disabled={saving || !canSubmit}>
                    {saving ? "Creating…" : "Create Task"}
                </Button>
            </div>
        </Panel>
    )
}

/**
 * Task row — restyled from ForgePanel.jsx's TasksPanel row (~line 1994) using
 * Round 1 tokens instead of inline hex colors. The status-color left border +
 * badge both come from the shared statusBadgeColor() mapping.
 */
function TaskRow({ task, onSelectTask }) {
    const color = statusBadgeColor(task.status)
    return (
        <Panel
            as="div"
            onClick={() => onSelectTask(task.task_id)}
            style={{ marginBottom: "var(--space-2)", cursor: "pointer", borderLeft: `3px solid ${color}` }}
        >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "var(--text-primary)", fontSize: "var(--text-sm)", fontWeight: 600 }}>{task.focus || task.task_id}</span>
                <span style={{
                    fontSize: "var(--text-xs)", padding: "1px 7px", borderRadius: 8,
                    background: `color-mix(in srgb, ${color} 18%, transparent)`, color, fontWeight: 700, textTransform: "uppercase",
                }}>{task.status}</span>
            </div>
            <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginTop: 6 }}>
                {formatTaskRegion(task)}
                {task.period_start && <> · from {new Date(task.period_start).toLocaleString()}</>}
                {task.period_end && <> to {new Date(task.period_end).toLocaleString()}</>}
            </div>
        </Panel>
    )
}

/**
 * Task list workspace — adapted from ForgePanel.jsx's TasksPanel (~line
 * 1963-2009). Owns loading the real GET /api/reports/tasks list and the
 * new-task creation form; the caller owns which task is "open" via the
 * required onSelectTask(taskId) prop (no detail view is built here).
 *
 * Props:
 *   onSelectTask(taskId: string) — required, called when a task row is clicked.
 */
export default function TaskList({ onSelectTask }) {
    const [tasks, setTasks] = useState([])
    const [loaded, setLoaded] = useState(false)
    const [showForm, setShowForm] = useState(false)

    const reload = () =>
        fetch(`${API}/api/reports/tasks`, { headers: forgeHeaders() })
            .then(r => r.ok ? r.json() : [])
            .then(d => { setTasks(Array.isArray(d) ? d : []); setLoaded(true) })
            .catch(() => setLoaded(true))

    useEffect(() => { reload() }, [])

    return (
        <div style={{ fontFamily: "var(--font-sans)" }}>
            <div style={{ color: "var(--text-dim)", fontSize: "var(--text-xs)", marginBottom: "var(--space-3)", maxWidth: 720 }}>
                Task the system to watch a region — or let it infer one from Mission Profile — over a time window, with a given focus. Click a task to see its Original Data Package: everything actually collected so far, before anything is drafted.
            </div>
            <div style={{ marginBottom: "var(--space-4)" }}>
                <Button variant={showForm ? "ghost" : "primary"} size="sm" onClick={() => setShowForm(v => !v)}>
                    {showForm ? "Cancel" : "+ New Task"}
                </Button>
            </div>
            {showForm && <TaskCreateForm onSaved={() => { setShowForm(false); reload() }} onCancel={() => setShowForm(false)} />}
            {!loaded && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Loading…</div>}
            {loaded && tasks.length === 0 && <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No mission tasks yet.</div>}
            {tasks.map(t => <TaskRow key={t.task_id} task={t} onSelectTask={onSelectTask} />)}
        </div>
    )
}
