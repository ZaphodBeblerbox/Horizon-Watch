import { useState, useEffect, useRef, useCallback } from "react"
import SectionLabel from "../../inspector/SectionLabel.jsx"
import { getCurrentUser } from "../../state/authStore.js"
import { registerInspectorExtension } from "../../inspector/extensionRegistry.js"
import {
    listComments, createComment, resolveComment, reopenComment,
    getAssignment, createAssignment, markAssignmentDone,
    listActivity, presenceHeartbeat, getPresence,
} from "../../lib/collabApi.js"
import API_BASE from "../../apiBase.js"
import { safeArray } from "../../utils/safeArray.js"

/**
 * CollabPanel — Workstation round, Part 8. The one real implementation of
 * comments/@mention, assignment, and presence, injected onto every real
 * record surface through this app's one real UI extension point
 * (src/inspector/extensionRegistry.js) — never a one-off per-surface
 * build. Registered once, below, at module load.
 *
 * Deliberately reads only `recordRef` — audited: `record` (the second
 * prop the registry passes) is NOT a consistently-shaped resolved object
 * across every real owning surface today (some pass a raw click payload,
 * some a normalized profile, some a list row), so relying on it here
 * would silently break on whichever surface doesn't match. Every real
 * fetch below is keyed by the real reference-grammar string alone.
 */

let usersCache = null
async function getUsersCached() {
    if (usersCache) return usersCache
    const r = await fetch(`${API_BASE}/api/users`, { credentials: "include" })
    usersCache = r.ok ? await r.json() : []
    return usersCache
}

function timeAgo(iso) {
    if (!iso) return ""
    const ms = Date.now() - new Date(iso).getTime()
    const mins = Math.floor(ms / 60000)
    if (mins < 1) return "just now"
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    return `${Math.floor(hrs / 24)}d ago`
}

function Avatar({ user, size = 20 }) {
    if (!user) return null
    return (
        <div title={user.name} style={{
            width: size, height: size, borderRadius: "50%", flexShrink: 0,
            background: user.color || "var(--bg-4)", color: "#fff",
            display: "flex", alignItems: "center", justifyContent: "center",
            font: `700 ${Math.round(size * 0.42)}px var(--font)`,
        }}>
            {user.initials || "?"}
        </div>
    )
}

// ── Presence ──────────────────────────────────────────────────────────────
function Presence({ recordRef }) {
    const [users, setUsers] = useState([])
    useEffect(() => {
        if (!recordRef) return
        let cancelled = false
        const beat = () => { presenceHeartbeat(recordRef).catch(() => {}) }
        const poll = () => { getPresence(recordRef).then((d) => { if (!cancelled) setUsers(d?.users || []) }).catch(() => {}) }
        beat(); poll()
        const hb = setInterval(beat, 15000)
        const pl = setInterval(poll, 15000)
        return () => { cancelled = true; clearInterval(hb); clearInterval(pl) }
    }, [recordRef])

    const me = getCurrentUser()
    const others = users.filter((u) => u.id !== me?.id)
    if (others.length === 0) return null
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "var(--space-2) 0" }}>
            <div style={{ display: "flex", marginRight: 4 }}>
                {others.slice(0, 5).map((u, i) => (
                    <div key={u.id} style={{ marginLeft: i === 0 ? 0 : -6, border: "1.5px solid var(--bg-1)", borderRadius: "50%" }}>
                        <Avatar user={u} size={18} />
                    </div>
                ))}
            </div>
            {/* Honest label — this is a poll-refreshed heartbeat (~15s), never
                claimed as instantly "live" (see backend/main.py's own real
                presence comment for why no live-push channel exists here). */}
            <span style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)" }}>
                viewing now (updates every ~15s)
            </span>
        </div>
    )
}

// ── Assignment ────────────────────────────────────────────────────────────
function Assignment({ recordRef }) {
    const [assignment, setAssignment] = useState(undefined) // undefined = loading, null = none
    const [users, setUsers] = useState([])
    const [picking, setPicking] = useState(false)
    const [dueAt, setDueAt] = useState("")
    const [pendingUserId, setPendingUserId] = useState("")

    const load = useCallback(() => {
        getAssignment(recordRef).then(setAssignment).catch(() => setAssignment(null))
    }, [recordRef])
    useEffect(() => { load() }, [load])
    useEffect(() => { getUsersCached().then((v) => setUsers(safeArray(v))) }, [])

    const usersById = Object.fromEntries(users.map((u) => [u.id, u]))
    const assignee = assignment ? usersById[assignment.assignee_user_id] : null

    const submit = async () => {
        if (!pendingUserId) return
        await createAssignment(recordRef, pendingUserId, dueAt || null)
        setPicking(false)
        setPendingUserId("")
        setDueAt("")
        load()
    }

    if (assignment === undefined) return null

    return (
        <div style={{ padding: "var(--space-2) 0", borderBottom: "1px solid var(--line-soft)" }}>
            {!picking && assignment && (
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Avatar user={assignee} size={22} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt)" }}>
                            Assigned to {assignee?.name || assignment.assignee_user_id}
                        </div>
                        {assignment.due_at && (
                            <div style={{ font: "400 10.5px var(--font)", color: "var(--txt-4)" }}>
                                Due {new Date(assignment.due_at).toLocaleDateString()}
                            </div>
                        )}
                    </div>
                    <button onClick={() => setPicking(true)} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--txt-2)", cursor: "pointer", font: "400 10.5px var(--font)", padding: "3px 7px" }}>
                        Reassign
                    </button>
                    <button onClick={() => markAssignmentDone(assignment.id).then(load)} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--txt-2)", cursor: "pointer", font: "400 10.5px var(--font)", padding: "3px 7px" }}>
                        Mark done
                    </button>
                </div>
            )}
            {!picking && !assignment && (
                <button onClick={() => setPicking(true)} style={{ background: "none", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--acc-hi)", cursor: "pointer", font: "400 11.5px var(--font)", padding: "4px 8px" }}>
                    + Assign
                </button>
            )}
            {picking && (
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                    <select value={pendingUserId} onChange={(e) => setPendingUserId(e.target.value)}
                        style={{ background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--txt)", font: "400 11px var(--font)", padding: "3px 6px" }}>
                        <option value="">Assignee…</option>
                        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                    <input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)}
                        style={{ background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)", color: "var(--txt)", font: "400 11px var(--font)", padding: "3px 6px" }} />
                    <button onClick={submit} disabled={!pendingUserId} style={{ background: "var(--acc)", border: "none", borderRadius: "var(--r)", color: "#fff", cursor: pendingUserId ? "pointer" : "default", font: "400 11px var(--font)", padding: "3px 8px", opacity: pendingUserId ? 1 : 0.5 }}>
                        Save
                    </button>
                    <button onClick={() => setPicking(false)} style={{ background: "none", border: "none", color: "var(--txt-3)", cursor: "pointer", font: "400 11px var(--font)" }}>
                        Cancel
                    </button>
                </div>
            )}
        </div>
    )
}

// ── Mention-aware composer ─────────────────────────────────────────────────
function Composer({ recordRef, users, onPosted }) {
    const [text, setText] = useState("")
    const [mentionedIds, setMentionedIds] = useState([])
    const [popover, setPopover] = useState(null) // {query, at}
    const [selIndex, setSelIndex] = useState(0)
    const taRef = useRef(null)

    const matches = popover
        ? users.filter((u) => u.name?.toLowerCase().includes(popover.query.toLowerCase())).slice(0, 6)
        : []

    const onChange = (e) => {
        const v = e.target.value
        setText(v)
        const caret = e.target.selectionStart
        const upToCaret = v.slice(0, caret)
        const m = upToCaret.match(/@([\w.-]*)$/)
        if (m) {
            setPopover({ query: m[1], at: caret - m[1].length - 1 })
            setSelIndex(0)
        } else {
            setPopover(null)
        }
    }

    const pick = (u) => {
        if (!popover) return
        const before = text.slice(0, popover.at)
        const after = text.slice(taRef.current.selectionStart)
        const inserted = `@${u.name} `
        setText(before + inserted + after)
        setMentionedIds((prev) => (prev.includes(u.id) ? prev : [...prev, u.id]))
        setPopover(null)
        requestAnimationFrame(() => {
            const pos = (before + inserted).length
            taRef.current?.focus()
            taRef.current?.setSelectionRange(pos, pos)
        })
    }

    const send = async () => {
        const body = text.trim()
        if (!body) return
        await createComment(recordRef, body, mentionedIds)
        setText("")
        setMentionedIds([])
        setPopover(null)
        onPosted()
    }

    const onKeyDown = (e) => {
        if (popover && matches.length > 0) {
            if (e.key === "ArrowDown") { e.preventDefault(); setSelIndex((i) => (i + 1) % matches.length); return }
            if (e.key === "ArrowUp") { e.preventDefault(); setSelIndex((i) => (i - 1 + matches.length) % matches.length); return }
            if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[selIndex]); return }
            if (e.key === "Escape") { e.preventDefault(); setPopover(null); return }
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); send() }
    }

    return (
        <div style={{ position: "relative", marginTop: "var(--space-2)" }}>
            <textarea
                ref={taRef}
                value={text}
                onChange={onChange}
                onKeyDown={onKeyDown}
                placeholder="Add a comment — @ to mention, ⌘/Ctrl+Enter to send"
                rows={2}
                style={{
                    width: "100%", resize: "vertical", background: "var(--bg-2)",
                    border: "1px solid var(--line-strong)", borderRadius: "var(--r)",
                    color: "var(--txt)", font: "400 12px var(--font)", padding: "6px 8px", boxSizing: "border-box",
                }}
            />
            {popover && matches.length > 0 && (
                <div style={{
                    position: "absolute", bottom: "100%", left: 0, marginBottom: 2, width: 220, zIndex: 10,
                    background: "var(--bg-2)", border: "1px solid var(--line-strong)", borderRadius: "var(--r)",
                    boxShadow: "var(--shadow)", maxHeight: 160, overflowY: "auto",
                }}>
                    {matches.map((u, i) => (
                        <div key={u.id} onMouseDown={(e) => { e.preventDefault(); pick(u) }}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", cursor: "pointer", background: i === selIndex ? "var(--bg-3)" : "transparent" }}>
                            <Avatar user={u} size={18} />
                            <span style={{ font: "400 11.5px var(--font)", color: "var(--txt)" }}>{u.name}</span>
                        </div>
                    ))}
                </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <button onClick={send} disabled={!text.trim()} style={{
                    background: "var(--acc)", border: "none", borderRadius: "var(--r)", color: "#fff",
                    cursor: text.trim() ? "pointer" : "default", font: "400 11px var(--font)", padding: "4px 10px",
                    opacity: text.trim() ? 1 : 0.5,
                }}>
                    Comment
                </button>
            </div>
        </div>
    )
}

// ── Comments thread ─────────────────────────────────────────────────────────
function Comments({ recordRef }) {
    const [comments, setComments] = useState([])
    const [users, setUsers] = useState([])
    const load = useCallback(() => { listComments(recordRef).then((v) => setComments(safeArray(v))).catch(() => setComments([])) }, [recordRef])
    useEffect(() => { load() }, [load])
    useEffect(() => { getUsersCached().then((v) => setUsers(safeArray(v))) }, [])
    const usersById = Object.fromEntries(users.map((u) => [u.id, u]))

    return (
        <div style={{ padding: "var(--space-2) 0" }}>
            {comments.length === 0 && <div style={{ font: "400 11.5px var(--font)", color: "var(--txt-4)" }}>No comments yet.</div>}
            {comments.map((c) => {
                const author = usersById[c.author_user_id]
                return (
                    <div key={c.comment_id} style={{ display: "flex", gap: 8, padding: "6px 0", opacity: c.resolved ? 0.55 : 1 }}>
                        <Avatar user={author} size={20} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ font: "400 11.5px var(--font)", color: "var(--txt)" }}>
                                <strong style={{ fontWeight: 600 }}>{author?.name || c.author_user_id}</strong>
                                <span style={{ color: "var(--txt-4)", marginLeft: 6, fontSize: 10.5 }}>{timeAgo(c.created_at)}</span>
                                {c.resolved && <span style={{ color: "var(--green)", marginLeft: 6, fontSize: 10.5 }}>· resolved</span>}
                            </div>
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)", whiteSpace: "pre-wrap" }}>{c.body}</div>
                        </div>
                        <button
                            onClick={() => (c.resolved ? reopenComment(c.comment_id) : resolveComment(c.comment_id)).then(load)}
                            style={{ background: "none", border: "none", color: "var(--txt-4)", cursor: "pointer", font: "400 10.5px var(--font)", flexShrink: 0 }}
                        >
                            {c.resolved ? "Reopen" : "Resolve"}
                        </button>
                    </div>
                )
            })}
            <Composer recordRef={recordRef} users={users} onPosted={load} />
        </div>
    )
}

// ── Activity ────────────────────────────────────────────────────────────────
function Activity({ recordRef }) {
    const [entries, setEntries] = useState([])
    const [users, setUsers] = useState([])
    useEffect(() => { listActivity(recordRef).then((v) => setEntries(safeArray(v))).catch(() => setEntries([])) }, [recordRef])
    useEffect(() => { getUsersCached().then((v) => setUsers(safeArray(v))) }, [])
    const usersById = Object.fromEntries(users.map((u) => [u.id, u]))
    if (entries.length === 0) return null

    const label = (e) => {
        const who = usersById[e.actor_user_id]?.name || e.actor_user_id || "Someone"
        if (e.verb === "assigned" || e.verb === "reassigned") {
            const assignee = usersById[e.detail?.assignee_user_id]?.name || e.detail?.assignee_user_id
            return `${who} ${e.verb} this to ${assignee}`
        }
        if (e.verb === "done") return `${who} marked the assignment done`
        if (e.verb === "commented") return `${who} commented`
        if (e.verb === "resolved_comment") return `${who} resolved a comment`
        if (e.verb === "reopened_comment") return `${who} reopened a comment`
        return `${who} ${e.verb}`
    }

    return (
        <div style={{ padding: "var(--space-2) 0", borderTop: "1px solid var(--line-soft)" }}>
            {entries.slice(0, 10).map((e, i) => (
                <div key={i} style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "2px 0" }}>
                    {label(e)} <span style={{ opacity: 0.8 }}>· {timeAgo(e.created_at)}</span>
                </div>
            ))}
        </div>
    )
}

// ── The registered extension ────────────────────────────────────────────────
function CollabPanel({ recordRef }) {
    if (!recordRef) return null
    return (
        <div style={{ marginTop: "var(--space-3)", paddingTop: "var(--space-3)", borderTop: "1px solid var(--line)" }}>
            <SectionLabel>Collaboration</SectionLabel>
            <Presence recordRef={recordRef} />
            <Assignment recordRef={recordRef} />
            <Comments recordRef={recordRef} />
            <Activity recordRef={recordRef} />
        </div>
    )
}

registerInspectorExtension(CollabPanel)

export default CollabPanel
