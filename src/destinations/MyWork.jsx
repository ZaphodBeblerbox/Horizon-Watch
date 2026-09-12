// MyWork.jsx — Workstation round, Part 5. The real 7 My Work queues
// (assigned to me / mentions / RFIs to answer / my cases / awaiting my
// review / urgent mail / unreviewed signals), each a real query against
// GET /api/workstation/queues (backend/main.py) — never a static or
// placeholder list. The mine/team/unassigned scope segment re-runs the
// SAME real query with the ownership filter swapped, one real backend
// implementation shared by all three, not three parallel ones.
//
// Honest, disclosed gaps carried straight through from the backend (see
// that endpoint's own comments for the real reasoning behind each):
// "Urgent mail" is a real, honest zero until a real Mail model exists.
// "Mentions" scans real existing note text for a real "@firstname" match
// (no dedicated mentions schema exists yet) — near-certain to be empty
// today since no note composer offers @mention entry. "Awaiting my
// review" is a real capability-based read of the same CASE_STAGE_GATE
// Cases.jsx's own advance button already gates on, not a per-user
// reviewer-assignment field (none exists). "Unreviewed signals" can't
// really support mine/team/unassigned scope (Alert has no owner column
// at all) — the same real result returns for every scope value.
import { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"
import { open as openRef } from "../lib/ref.js"

async function getJSON(path, params) {
    const qs = params ? `?${new URLSearchParams(params)}` : ""
    const r = await fetch(`${API_BASE}${path}${qs}`, { credentials: "include" })
    if (!r.ok) return null
    return r.json()
}

const QUEUES = [
    { key: "assigned_to_me", label: "Assigned to me" },
    { key: "mentions", label: "Mentions" },
    { key: "rfis_to_answer", label: "RFIs to answer" },
    { key: "my_cases", label: "My cases" },
    { key: "awaiting_my_review", label: "Awaiting my review" },
    { key: "urgent_mail", label: "Urgent mail" },
    { key: "unreviewed_signals", label: "Unreviewed signals" },
]

const SCOPES = [
    { key: "mine", label: "Mine" },
    { key: "team", label: "Team" },
    { key: "unassigned", label: "Unassigned" },
]

// Case.priority is already critical|high|moderate|low (designSystem.css's
// real .dia classes); Alert.severity uses "medium" rather than "moderate"
// for the same middle tier — normalized here rather than adding a second
// severity vocabulary.
function diaClass(severity) {
    const s = (severity || "").toLowerCase()
    if (s === "critical") return "critical"
    if (s === "high") return "high"
    if (s === "medium" || s === "moderate") return "moderate"
    return "low"
}

const DUE_WARNING_DAYS = 4

function dueColor(dueAt) {
    if (!dueAt) return "var(--txt-4)"
    const days = (new Date(dueAt).getTime() - Date.now()) / 86400000
    return days <= DUE_WARNING_DAYS ? "var(--amber)" : "var(--txt-4)"
}

function formatDue(dueAt) {
    if (!dueAt) return null
    const d = new Date(dueAt)
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function Avatar({ user }) {
    if (!user) return <div style={{ width: 22, height: 22, flexShrink: 0 }} />
    return (
        <div title={user.name} style={{
            width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
            background: user.color || "var(--bg-4)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            font: "700 9.5px var(--font)",
        }}>
            {user.initials || "?"}
        </div>
    )
}

function QueueRow({ item, usersById }) {
    const assignee = item.assignee_user_id ? usersById[item.assignee_user_id] : null
    return (
        <div
            onClick={() => openRef(item.ref)}
            style={{
                display: "flex", alignItems: "center", gap: "var(--space-3)",
                padding: "var(--space-2) var(--space-3)", cursor: "pointer",
                borderBottom: "1px solid var(--line-soft)",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-2)" }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
        >
            <span className={`dia ${diaClass(item.severity)}`} style={{ flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "400 12.5px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {item.title}
                </div>
                <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>
                    {item.ref}{item.sub ? ` · ${item.sub}` : ""}
                </div>
            </div>
            {item.due_at && (
                <span style={{ font: "400 10.5px var(--font)", color: dueColor(item.due_at), flexShrink: 0 }}>
                    {formatDue(item.due_at)}
                </span>
            )}
            <Avatar user={assignee} />
        </div>
    )
}

function QueueSection({ def, data, usersById }) {
    const items = data?.items || []
    return (
        <div style={{ marginBottom: "var(--space-4)" }}>
            <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "var(--space-2) var(--space-3)", background: "var(--bg-2)",
                borderBottom: "1px solid var(--line)",
            }}>
                <span style={{ font: "600 11px var(--font)", color: "var(--txt-2)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    {def.label}
                </span>
                <span style={{ font: "400 11px var(--mono)", color: "var(--txt-4)" }}>{data?.total ?? 0}</span>
            </div>
            {items.length === 0 && (
                <div style={{ padding: "var(--space-3)", font: "400 12px var(--font)", color: "var(--txt-4)" }}>
                    Nothing here.
                </div>
            )}
            {items.map((item, i) => <QueueRow key={item.ref + i} item={item} usersById={usersById} />)}
        </div>
    )
}

function Sidebar() {
    const [data, setData] = useState(null)
    useEffect(() => {
        getJSON("/api/workstation/sidebar").then(setData)
    }, [])

    return (
        <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid var(--line)", overflowY: "auto", background: "var(--bg-1)" }}>
            <div style={{ padding: "var(--space-3)" }}>
                <div style={{ font: "600 10px var(--font)", color: "var(--acc-hi)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "var(--space-2)" }}>
                    Calendar
                </div>
                {(data?.calendar || []).length === 0 && <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)", marginBottom: "var(--space-3)" }}>Nothing scheduled.</div>}
                {(data?.calendar || []).map((e, i) => (
                    <div key={i} onClick={() => openRef(e.ref)} style={{ cursor: "pointer", padding: "6px 0", borderBottom: "1px solid var(--line-soft)" }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>{e.label}</div>
                        <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>{formatDue(e.at)}</div>
                    </div>
                ))}

                <div style={{ font: "600 10px var(--font)", color: "var(--acc-hi)", textTransform: "uppercase", letterSpacing: "0.08em", margin: "var(--space-4) 0 var(--space-2)" }}>
                    Recent activity
                </div>
                {(data?.activity || []).length === 0 && <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>No recent activity.</div>}
                {(data?.activity || []).map((e, i) => (
                    <div key={i} onClick={() => openRef(e.ref)} style={{ cursor: "pointer", padding: "6px 0", borderBottom: "1px solid var(--line-soft)" }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>{e.label}</div>
                        <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>{formatDue(e.at)}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}

export default function MyWork() {
    const [scope, setScope] = useState("mine")
    const [queues, setQueues] = useState(null)
    const [usersById, setUsersById] = useState({})

    const load = useCallback(() => {
        getJSON("/api/workstation/queues", { scope }).then((d) => setQueues(d?.queues || null))
    }, [scope])

    useEffect(() => { load() }, [load])
    useEffect(() => {
        getJSON("/api/users").then((rows) => {
            setUsersById(Object.fromEntries((rows || []).map((u) => [u.id, u])))
        })
    }, [])

    return (
        <div style={{ display: "flex", height: "100%", background: "var(--bg-0)" }}>
            <div style={{ flex: 1, minWidth: 0, overflowY: "auto" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-3)", borderBottom: "1px solid var(--line)" }}>
                    <span style={{ font: "700 13px var(--font)", color: "var(--txt)" }}>My work</span>
                    <div style={{ display: "flex", gap: 4 }}>
                        {SCOPES.map((s) => (
                            <button
                                key={s.key}
                                onClick={() => setScope(s.key)}
                                style={{
                                    padding: "4px 10px", font: "400 11px var(--font)", cursor: "pointer",
                                    borderRadius: "var(--r)", border: "1px solid var(--line-strong)",
                                    background: scope === s.key ? "var(--acc)" : "var(--bg-2)",
                                    color: scope === s.key ? "#fff" : "var(--txt-2)",
                                }}
                            >
                                {s.label}
                            </button>
                        ))}
                    </div>
                </div>
                {!queues && <div style={{ padding: "var(--space-4)", font: "400 12px var(--font)", color: "var(--txt-4)" }}>Loading…</div>}
                {queues && QUEUES.map((def) => (
                    <QueueSection key={def.key} def={def} data={queues[def.key]} usersById={usersById} />
                ))}
            </div>
            <Sidebar />
        </div>
    )
}
