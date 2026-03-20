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
            fontSize:     9,
            fontWeight:   700,
            letterSpacing:"0.1em",
            color:        ROLE_COLORS[role] || "rgba(255,255,255,0.3)",
            border:       `1px solid ${ROLE_COLORS[role] || "rgba(255,255,255,0.15)"}`,
            borderRadius: 3,
            padding:      "2px 5px",
            whiteSpace:   "nowrap",
        }}>
            {ROLE_LABEL[role] || role?.toUpperCase()}
        </span>
    )
}

export default function AdminPanel({ currentUser, onClose }) {
    const [tab,     setTab]     = useState("users")
    const [users,   setUsers]   = useState([])
    const [loading, setLoading] = useState(false)
    const [error,   setError]   = useState("")
    const [notes,   setNotes]   = useState({})   // {id: string}
    const [saving,  setSaving]  = useState({})   // {id: bool}

    const fetchUsers = useCallback(async () => {
        setLoading(true); setError("")
        try {
            const res = await apiFetch("/api/admin/users")
            if (!res.ok) { setError("Failed to load users"); return }
            const data = await res.json()
            setUsers(data)
            const n = {}
            data.forEach(u => { n[u.id] = u.notes || "" })
            setNotes(n)
        } catch {
            setError("Connection error.")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { if (tab === "users") fetchUsers() }, [tab, fetchUsers])

    async function approve(id) {
        await apiFetch(`/api/admin/users/${id}/approve`, { method: "POST" })
        fetchUsers()
    }

    async function setRole(id, role) {
        await apiFetch(`/api/admin/users/${id}`, {
            method: "PUT",
            body: JSON.stringify({ role }),
        })
        fetchUsers()
    }

    async function deleteUser(id) {
        if (!confirm("Delete this user account?")) return
        await apiFetch(`/api/admin/users/${id}`, { method: "DELETE" })
        fetchUsers()
    }

    async function saveNotes(id) {
        setSaving(s => ({ ...s, [id]: true }))
        await apiFetch(`/api/admin/users/${id}`, {
            method: "PUT",
            body: JSON.stringify({ notes: notes[id] || "" }),
        })
        setSaving(s => ({ ...s, [id]: false }))
    }

    const pending = users.filter(u => !u.approved)
    const approved = users.filter(u => u.approved)

    return (
        <div style={{
            position:       "fixed",
            inset:          0,
            zIndex:         2000,
            background:     "rgba(6,13,26,0.96)",
            backdropFilter: "blur(12px)",
            WebkitBackdropFilter: "blur(12px)",
            display:        "flex",
            flexDirection:  "column",
            fontFamily:     "Inter, -apple-system, sans-serif",
            color:          "#e0e0e0",
        }}>
            {/* Header */}
            <div style={{
                display:      "flex",
                alignItems:   "center",
                gap:          12,
                padding:      "14px 20px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                flexShrink:   0,
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
                        {pending.length} pending approval
                    </span>
                )}
                <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 4 }}>✕</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", gap: 0, padding: "0 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
                {["users", "activity"].map(t => (
                    <button key={t} onClick={() => setTab(t)} style={{
                        background:    "none",
                        border:        "none",
                        borderBottom:  tab === t ? "2px solid rgba(26,110,181,0.8)" : "2px solid transparent",
                        color:         tab === t ? "#fff" : "rgba(255,255,255,0.35)",
                        fontSize:      11,
                        fontWeight:    tab === t ? 600 : 400,
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                        padding:       "10px 16px 8px",
                        cursor:        "pointer",
                        marginBottom:  -1,
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
                        {error   && <div style={{ color: "#f87171", fontSize: 12 }}>{error}</div>}

                        {/* Pending approvals */}
                        {pending.length > 0 && (
                            <>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#fbbf24", textTransform: "uppercase", marginBottom: 10, borderLeft: "2px solid #fbbf24", paddingLeft: 8 }}>
                                    Pending Approval
                                </div>
                                {pending.map(u => (
                                    <UserRow
                                        key={u.id}
                                        user={u}
                                        currentUser={currentUser}
                                        notes={notes[u.id] || ""}
                                        onNotesChange={v => setNotes(n => ({ ...n, [u.id]: v }))}
                                        onSaveNotes={() => saveNotes(u.id)}
                                        savingNotes={saving[u.id]}
                                        onApprove={() => approve(u.id)}
                                        onSetRole={role => setRole(u.id, role)}
                                        onDelete={() => deleteUser(u.id)}
                                        highlight
                                    />
                                ))}
                                <div style={{ height: 20 }} />
                            </>
                        )}

                        {/* Approved users */}
                        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 10, borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: 8 }}>
                            Active Users ({approved.length})
                        </div>
                        {approved.map(u => (
                            <UserRow
                                key={u.id}
                                user={u}
                                currentUser={currentUser}
                                notes={notes[u.id] || ""}
                                onNotesChange={v => setNotes(n => ({ ...n, [u.id]: v }))}
                                onSaveNotes={() => saveNotes(u.id)}
                                savingNotes={saving[u.id]}
                                onApprove={null}
                                onSetRole={role => setRole(u.id, role)}
                                onDelete={() => deleteUser(u.id)}
                                highlight={false}
                            />
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}

function UserRow({ user, currentUser, notes, onNotesChange, onSaveNotes, savingNotes, onApprove, onSetRole, onDelete, highlight }) {
    const [notesOpen, setNotesOpen] = useState(false)
    const isSelf      = user.id === currentUser?.id
    const isSuperAdmin = user.is_super_admin
    const canModify   = !isSelf && (!isSuperAdmin || currentUser?.is_super_admin)

    return (
        <div style={{
            background:   highlight ? "rgba(251,191,36,0.05)" : "rgba(255,255,255,0.02)",
            border:       `1px solid ${highlight ? "rgba(251,191,36,0.2)" : "rgba(255,255,255,0.06)"}`,
            borderRadius: 6,
            marginBottom: 8,
            padding:      "12px 14px",
        }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                {/* Crown for super admins */}
                {isSuperAdmin && (
                    <span style={{ fontSize: 12, opacity: 0.7 }} title="Super admin">★</span>
                )}

                {/* Identity */}
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

                {/* Role badge */}
                <RoleBadge role={user.role} />

                {/* Actions */}
                {canModify && (
                    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                        {onApprove && (
                            <button onClick={onApprove} style={actionBtn("#22c55e")}>Approve</button>
                        )}
                        {user.approved && user.role !== "admin" && (
                            <button onClick={() => onSetRole("analyst")} style={actionBtn("#2d8fe8")} disabled={user.role === "analyst"}>
                                {user.role === "analyst" ? "Analyst" : "→ Analyst"}
                            </button>
                        )}
                        {user.approved && user.role !== "admin" && (
                            <button onClick={() => onSetRole("admin")} style={actionBtn("#FFB300")}>→ Admin</button>
                        )}
                        {user.approved && user.role === "analyst" && (
                            <button onClick={() => onSetRole("observer")} style={actionBtn("rgba(255,255,255,0.2)")}>→ Observer</button>
                        )}
                        <button onClick={() => setNotesOpen(v => !v)} style={actionBtn("rgba(255,255,255,0.2)")}>Notes</button>
                        <button onClick={onDelete} style={actionBtn("#ef4444")}>Delete</button>
                    </div>
                )}
            </div>

            {/* Notes expand */}
            {notesOpen && (
                <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                    <textarea
                        value={notes}
                        onChange={e => onNotesChange(e.target.value)}
                        placeholder="Internal notes about this user…"
                        rows={2}
                        style={{
                            flex:       1,
                            background: "rgba(255,255,255,0.05)",
                            border:     "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 4,
                            padding:    "6px 8px",
                            fontSize:   11,
                            color:      "#e0e0e0",
                            resize:     "vertical",
                            outline:    "none",
                            fontFamily: "inherit",
                        }}
                    />
                    <button
                        onClick={onSaveNotes}
                        disabled={savingNotes}
                        style={{ ...actionBtn("#2d8fe8"), alignSelf: "flex-end", padding: "6px 10px" }}
                    >
                        {savingNotes ? "…" : "Save"}
                    </button>
                </div>
            )}
        </div>
    )
}

function actionBtn(color) {
    return {
        background:   "none",
        border:       `1px solid ${color}`,
        borderRadius: 4,
        color:        color,
        fontSize:     10,
        padding:      "3px 8px",
        cursor:       "pointer",
        whiteSpace:   "nowrap",
        lineHeight:   1.4,
    }
}
