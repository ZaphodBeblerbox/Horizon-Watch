import { useState, useEffect, useCallback } from "react"
import { apiFetch } from "../auth.js"

const ROLE_COLORS = {
    observer: "rgba(255,255,255,0.3)",
    analyst:  "#2d8fe8",
    admin:    "#FFB300",
}
const ROLE_LABEL = { observer: "OBSERVER", analyst: "ANALYST", admin: "ADMIN" }

function RoleBadge({ role }) {
    return (
        <span style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.1em",
            color: ROLE_COLORS[role] || "rgba(255,255,255,0.3)",
            border: `1px solid ${ROLE_COLORS[role] || "rgba(255,255,255,0.15)"}`,
            borderRadius: 3, padding: "2px 5px", whiteSpace: "nowrap",
        }}>
            {ROLE_LABEL[role] || (role || "").toUpperCase()}
        </span>
    )
}

// React error boundary
class AdminErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { error: null } }
    static getDerivedStateFromError(err) { return { error: err } }
    render() {
        if (this.state.error) {
            return (
                <div style={{ padding: 32, color: "#f87171", fontFamily: "Inter, sans-serif", fontSize: 13 }}>
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>Admin panel error</div>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>{String(this.state.error)}</div>
                    <button onClick={() => this.setState({ error: null })} style={{ marginTop: 16, padding: "6px 14px", background: "rgba(26,110,181,0.2)", border: "1px solid rgba(26,110,181,0.4)", borderRadius: 4, color: "#60a5fa", cursor: "pointer", fontSize: 11 }}>
                        Retry
                    </button>
                </div>
            )
        }
        return this.props.children
    }
}

// Import React for the error boundary class
import React from "react"

function AdminPanelInner({ currentUser, onClose }) {
    const [tab,     setTab]     = useState("users")
    const [users,   setUsers]   = useState([])
    const [loading, setLoading] = useState(false)
    const [error,   setError]   = useState("")
    const [notes,   setNotes]   = useState({})
    const [saving,  setSaving]  = useState({})

    const fetchUsers = useCallback(async () => {
        setLoading(true)
        setError("")
        try {
            const res = await apiFetch("/api/admin/users")
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                setError(err.detail || `Error ${res.status}`)
                return
            }
            const data = await res.json()
            const list = Array.isArray(data) ? data : []
            setUsers(list)
            const n = {}
            list.forEach(u => { n[u.id] = u.notes || "" })
            setNotes(n)
        } catch (e) {
            setError("Connection error — check backend.")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { if (tab === "users") fetchUsers() }, [tab, fetchUsers])

    async function approve(id) {
        try {
            await apiFetch(`/api/admin/users/${id}/approve`, { method: "POST" })
            fetchUsers()
        } catch { /* ignore */ }
    }

    async function setRole(id, role) {
        try {
            await apiFetch(`/api/admin/users/${id}`, {
                method: "PUT",
                body: JSON.stringify({ role }),
            })
            fetchUsers()
        } catch { /* ignore */ }
    }

    async function deleteUser(id) {
        if (!window.confirm("Delete this user account? This cannot be undone.")) return
        try {
            await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" })
            fetchUsers()
        } catch { /* ignore */ }
    }

    async function saveNotes(id) {
        setSaving(s => ({ ...s, [id]: true }))
        try {
            await apiFetch(`/api/admin/users/${id}`, {
                method: "PUT",
                body: JSON.stringify({ notes: notes[id] || "" }),
            })
        } catch { /* ignore */ }
        setSaving(s => ({ ...s, [id]: false }))
    }

    const pending  = users.filter(u => !u.approved)
    const approved = users.filter(u => u.approved)

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(6,13,26,0.96)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            display: "flex", flexDirection: "column",
            fontFamily: "Inter, -apple-system, sans-serif", color: "#e0e0e0",
        }}>
            {/* Header */}
            <div style={{
                display: "flex", alignItems: "center", gap: 12,
                padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink: 0,
            }}>
                <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="rgba(255,179,0,0.8)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
                <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.1em", textTransform: "uppercase" }}>
                    Admin Console
                </span>
                <div style={{ flex: 1 }} />
                {pending.length > 0 && (
                    <span style={{ fontSize: 10, background: "rgba(251,191,36,0.2)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.4)", borderRadius: 10, padding: "2px 8px" }}>
                        {pending.length} pending
                    </span>
                )}
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                {["users", "activity"].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        background: "none", border: "none",
                        borderBottom: tab === t ? "2px solid rgba(26,110,181,0.8)" : "2px solid transparent",
                        color: tab === t ? "#fff" : "rgba(255,255,255,0.35)",
                        fontSize: 11, fontWeight: tab === t ? 600 : 400,
                        letterSpacing: "0.08em", textTransform: "uppercase",
                        padding: "10px 16px 8px", cursor: "pointer", marginBottom: -1,
                    }}>
                        {t}
                    </button>
                ))}
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
                {tab === "activity" && (
                    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, marginTop: 40, textAlign: "center" }}>
                        Activity log — coming soon
                    </div>
                )}

                {tab === "users" && (
                    <>
                        {loading && <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12 }}>Loading…</div>}
                        {error && (
                            <div style={{ color: "#f87171", fontSize: 12, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                                {error}
                                <button onClick={fetchUsers} style={{ fontSize: 10, color: "#60a5fa", background: "none", border: "none", cursor: "pointer", padding: 0 }}>Retry</button>
                            </div>
                        )}

                        {pending.length > 0 && (
                            <>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#fbbf24", textTransform: "uppercase", marginBottom: 10, borderLeft: "2px solid #fbbf24", paddingLeft: 8 }}>
                                    Pending Approval ({pending.length})
                                </div>
                                {pending.map(u => (
                                    <UserRow key={u.id} user={u} currentUser={currentUser}
                                        notes={notes[u.id] || ""} onNotesChange={v => setNotes(n => ({ ...n, [u.id]: v }))}
                                        onSaveNotes={() => saveNotes(u.id)} savingNotes={!!saving[u.id]}
                                        onApprove={() => approve(u.id)} onSetRole={r => setRole(u.id, r)}
                                        onDelete={() => deleteUser(u.id)} highlight />
                                ))}
                                <div style={{ height: 20 }} />
                            </>
                        )}

                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 10, borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: 8 }}>
                            Active Users ({approved.length})
                        </div>
                        {approved.map(u => (
                            <UserRow key={u.id} user={u} currentUser={currentUser}
                                notes={notes[u.id] || ""} onNotesChange={v => setNotes(n => ({ ...n, [u.id]: v }))}
                                onSaveNotes={() => saveNotes(u.id)} savingNotes={!!saving[u.id]}
                                onApprove={null} onSetRole={r => setRole(u.id, r)}
                                onDelete={() => deleteUser(u.id)} highlight={false} />
                        ))}
                        {!loading && users.length === 0 && !error && (
                            <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, marginTop: 20 }}>No users found.</div>
                        )}
                    </>
                )}
            </div>
        </div>
    )
}

function UserRow({ user, currentUser, notes, onNotesChange, onSaveNotes, savingNotes, onApprove, onSetRole, onDelete, highlight }) {
    const [notesOpen, setNotesOpen] = useState(false)
    const isSelf       = user.id === currentUser?.id
    const isSuperAdmin = !!user.is_super_admin
    const canModify    = !isSelf && (!isSuperAdmin || !!currentUser?.is_super_admin)

    return (
        <div style={{
            background: highlight ? "rgba(251,191,36,0.05)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${highlight ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.06)"}`,
            borderRadius: 6, marginBottom: 8, padding: "12px 14px",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {isSuperAdmin && <span style={{ fontSize: 12, opacity: 0.7 }} title="Super admin">★</span>}
                <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: isSuperAdmin ? "#FFB300" : "#fff" }}>
                        {user.name || <span style={{ color: "rgba(255,255,255,0.3)", fontStyle: "italic" }}>No name</span>}
                        {isSelf && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>YOU</span>}
                    </div>
                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{user.email}</div>
                    {user.created_at && (
                        <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", marginTop: 1 }}>
                            Joined {new Date(user.created_at).toLocaleDateString()}
                        </div>
                    )}
                </div>
                <RoleBadge role={user.role} />
                {canModify && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {onApprove && <button onClick={onApprove} style={actionBtn("#22c55e")}>Approve</button>}
                        {user.approved && user.role === "observer" && (
                            <button onClick={() => onSetRole("analyst")} style={actionBtn("#2d8fe8")}>→ Analyst</button>
                        )}
                        {user.approved && user.role === "analyst" && (
                            <>
                                <button onClick={() => onSetRole("observer")} style={actionBtn("rgba(255,255,255,0.2)")}>→ Observer</button>
                                <button onClick={() => onSetRole("admin")} style={actionBtn("#FFB300")}>→ Admin</button>
                            </>
                        )}
                        {user.approved && user.role === "admin" && !isSuperAdmin && (
                            <button onClick={() => onSetRole("analyst")} style={actionBtn("rgba(255,255,255,0.2)")}>→ Analyst</button>
                        )}
                        <button onClick={() => setNotesOpen(v => !v)} style={actionBtn("rgba(255,255,255,0.2)")}>Notes</button>
                        <button onClick={onDelete} style={actionBtn("#ef4444")}>Delete</button>
                    </div>
                )}
            </div>

            {notesOpen && (
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <textarea
                        value={notes} onChange={e => onNotesChange(e.target.value)}
                        placeholder="Internal notes…" rows={2}
                        style={{ flex: 1, background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4, padding: "6px 8px", fontSize: 11, color: "#e0e0e0", resize: "vertical", outline: "none", fontFamily: "inherit" }}
                    />
                    <button onClick={onSaveNotes} disabled={savingNotes}
                        style={{ ...actionBtn("#2d8fe8"), alignSelf: "flex-end", padding: "6px 10px" }}>
                        {savingNotes ? "…" : "Save"}
                    </button>
                </div>
            )}
        </div>
    )
}

function actionBtn(color) {
    return {
        background: "none", border: `1px solid ${color}`, borderRadius: 4,
        color, fontSize: 10, padding: "3px 8px", cursor: "pointer", whiteSpace: "nowrap", lineHeight: 1.4,
    }
}

export default function AdminPanel(props) {
    return (
        <AdminErrorBoundary>
            <AdminPanelInner {...props} />
        </AdminErrorBoundary>
    )
}
