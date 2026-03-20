import React, { useState, useEffect, useCallback } from "react"
import API_BASE from "../apiBase.js"

const TOKEN_KEY = "hw-auth-token"
const authHdr = () => ({
    "Content-Type": "application/json",
    Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY),
})

// ── Error boundary ────────────────────────────────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(iso) {
    if (!iso) return "Never"
    try { return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) }
    catch { return "—" }
}

const TH = ({ children, style }) => (
    <th style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", borderBottom: "1px solid rgba(255,255,255,0.08)", whiteSpace: "nowrap", ...style }}>
        {children}
    </th>
)

const TD = ({ children, style }) => (
    <td style={{ padding: "10px 12px", fontSize: 12, color: "#e0e0e0", borderBottom: "1px solid rgba(255,255,255,0.04)", verticalAlign: "middle", ...style }}>
        {children}
    </td>
)

// ── Main inner component ──────────────────────────────────────────────────────
function AdminPanelInner({ user, onClose }) {
    const [tab,       setTab]      = useState("users")
    const [users,     setUsers]    = useState([])
    const [loading,   setLoading]  = useState(false)
    const [loadError, setLoadError] = useState(null)
    const [panelError, setPanelError] = useState(null)

    const fetchUsers = useCallback(async () => {
        setLoading(true)
        setLoadError(null)
        try {
            const res = await fetch(`${API_BASE}/api/admin/users`, {
                headers: { Authorization: "Bearer " + localStorage.getItem(TOKEN_KEY) }
            })
            if (!res.ok) throw new Error(`Server returned ${res.status}`)
            const data = await res.json()
            setUsers(Array.isArray(data) ? data : [])
        } catch (err) {
            setLoadError(err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { if (tab === "users") fetchUsers() }, [tab, fetchUsers])

    async function handleApprove(id) {
        try {
            const res = await fetch(`${API_BASE}/api/admin/users/${id}/approve`, {
                method: "POST",
                headers: authHdr(),
            })
            if (!res.ok) throw new Error(`Server returned ${res.status}`)
            setUsers(prev => prev.map(u => u.id === id ? { ...u, approved: true } : u))
        } catch (err) {
            setPanelError(err.message)
        }
    }

    async function handleReject(id) {
        if (!window.confirm("Reject and delete this user?")) return
        try {
            const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
                method: "DELETE",
                headers: authHdr(),
            })
            if (!res.ok) throw new Error(`Server returned ${res.status}`)
            setUsers(prev => prev.filter(u => u.id !== id))
        } catch (err) {
            setPanelError(err.message)
        }
    }

    async function handleRoleChange(id, role) {
        try {
            const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
                method: "PUT",
                headers: authHdr(),
                body: JSON.stringify({ role }),
            })
            if (!res.ok) throw new Error(`Server returned ${res.status}`)
            setUsers(prev => prev.map(u => u.id === id ? { ...u, role } : u))
        } catch (err) {
            setPanelError(err.message)
        }
    }

    async function handleDelete(id) {
        if (!window.confirm("Delete this user account? This cannot be undone.")) return
        try {
            const res = await fetch(`${API_BASE}/api/admin/users/${id}`, {
                method: "DELETE",
                headers: authHdr(),
            })
            if (!res.ok) throw new Error(`Server returned ${res.status}`)
            setUsers(prev => prev.filter(u => u.id !== id))
        } catch (err) {
            setPanelError(err.message)
        }
    }

    const pending  = users.filter(u => !u.approved)
    const allUsers = users.filter(u => u.approved)

    // ── Guards ────────────────────────────────────────────────────────────────
    const isAdmin = user?.role === "admin" || user?.is_super_admin === true
    if (!isAdmin) return (
        <div style={{ padding: 32, color: "#8899aa", fontFamily: "Inter, sans-serif", textAlign: "center" }}>
            <div style={{ fontSize: 14 }}>Admin access required</div>
            <div style={{ fontSize: 12, marginTop: 8, color: "#4a5568" }}>Current role: {user?.role || "unknown"}</div>
        </div>
    )

    if (loadError) return (
        <div style={{ padding: 24, color: "#dc2626", fontFamily: "Inter, sans-serif" }}>
            Error: {loadError}
            <button onClick={() => { setLoadError(null); fetchUsers() }} style={{ marginLeft: 12, padding: "4px 12px", background: "#1a3a6b", color: "white", border: "none", cursor: "pointer", borderRadius: 3 }}>Retry</button>
        </div>
    )

    return (
        <div style={{
            position: "fixed", inset: 0, zIndex: 2000,
            background: "rgba(6,13,26,0.96)",
            backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
            display: "flex", flexDirection: "column",
            fontFamily: "Inter, -apple-system, sans-serif", color: "#e0e0e0",
        }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
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
                {panelError && (
                    <span style={{ fontSize: 10, color: "#f87171", maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {panelError}
                        <button onClick={() => setPanelError(null)} style={{ marginLeft: 6, background: "none", border: "none", color: "#60a5fa", cursor: "pointer", fontSize: 10 }}>✕</button>
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
            <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
                {tab === "activity" && (
                    <div style={{ color: "rgba(255,255,255,0.25)", fontSize: 12, marginTop: 40, textAlign: "center" }}>
                        Activity log — coming soon
                    </div>
                )}

                {tab === "users" && (
                    <>
                        {loading && (
                            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: 12, marginBottom: 16 }}>Loading…</div>
                        )}

                        {/* ── Section 1: Pending Approvals ───────────────────────── */}
                        {pending.length > 0 && (
                            <div style={{ marginBottom: 28 }}>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#fbbf24", textTransform: "uppercase", marginBottom: 10, borderLeft: "2px solid #fbbf24", paddingLeft: 8 }}>
                                    Pending Approvals ({pending.length})
                                </div>
                                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                    {pending.map(u => (
                                        <div key={u.id} style={{
                                            background: "rgba(217,119,6,0.1)",
                                            border: "1px solid rgba(217,119,6,0.3)",
                                            borderRadius: 6,
                                            padding: "12px 16px",
                                            display: "flex",
                                            alignItems: "center",
                                            gap: 16,
                                            flexWrap: "wrap",
                                        }}>
                                            <div style={{ flex: 1, minWidth: 200 }}>
                                                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                                                    {u.name || <span style={{ fontStyle: "italic", color: "rgba(255,255,255,0.35)" }}>No name</span>}
                                                </div>
                                                <div style={{ fontSize: 11, color: "rgba(255,255,255,0.45)", marginTop: 2 }}>{u.email}</div>
                                                {u.created_at && (
                                                    <div style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 2 }}>
                                                        Registered {fmtDate(u.created_at)}
                                                    </div>
                                                )}
                                            </div>
                                            <div style={{ display: "flex", gap: 8 }}>
                                                <button onClick={() => handleApprove(u.id)} style={{
                                                    padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                                    background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.5)",
                                                    borderRadius: 4, color: "#22c55e",
                                                }}>
                                                    Approve
                                                </button>
                                                <button onClick={() => handleReject(u.id)} style={{
                                                    padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                                                    background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.4)",
                                                    borderRadius: 4, color: "#ef4444",
                                                }}>
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* ── Section 2: All Users table ─────────────────────────── */}
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", marginBottom: 10, borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: 8 }}>
                                All Users ({allUsers.length})
                            </div>
                            {allUsers.length === 0 && !loading ? (
                                <div style={{ color: "rgba(255,255,255,0.2)", fontSize: 12, marginTop: 12 }}>No approved users found.</div>
                            ) : (
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                                        <thead>
                                            <tr>
                                                <TH>Name</TH>
                                                <TH>Email</TH>
                                                <TH>Role</TH>
                                                <TH style={{ textAlign: "center" }}>Approved</TH>
                                                <TH>Last Login</TH>
                                                <TH>Actions</TH>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {allUsers.map(u => (
                                                <tr key={u.id} style={{ background: u.id === user?.id ? "rgba(26,110,181,0.06)" : "transparent" }}>
                                                    <TD>
                                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                            {u.is_super_admin && (
                                                                <span style={{ color: "#FFB300", fontSize: 13 }} title="Super admin">★</span>
                                                            )}
                                                            <span style={{ fontWeight: u.is_super_admin ? 600 : 400, color: u.is_super_admin ? "#FFB300" : "#e0e0e0" }}>
                                                                {u.name || <span style={{ fontStyle: "italic", color: "rgba(255,255,255,0.3)" }}>No name</span>}
                                                            </span>
                                                            {u.id === user?.id && (
                                                                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>YOU</span>
                                                            )}
                                                        </div>
                                                    </TD>
                                                    <TD style={{ color: "rgba(255,255,255,0.5)", fontSize: 11 }}>{u.email}</TD>
                                                    <TD>
                                                        <select
                                                            value={u.role}
                                                            disabled={!!u.is_super_admin}
                                                            onChange={e => handleRoleChange(u.id, e.target.value)}
                                                            style={{
                                                                background: "rgba(255,255,255,0.06)",
                                                                border: "1px solid rgba(255,255,255,0.12)",
                                                                borderRadius: 4,
                                                                color: u.role === "admin" ? "#FFB300" : u.role === "analyst" ? "#2d8fe8" : "rgba(255,255,255,0.5)",
                                                                fontSize: 11,
                                                                padding: "3px 6px",
                                                                cursor: u.is_super_admin ? "default" : "pointer",
                                                                opacity: u.is_super_admin ? 0.5 : 1,
                                                            }}
                                                        >
                                                            <option value="observer">Observer</option>
                                                            <option value="analyst">Analyst</option>
                                                            <option value="admin">Admin</option>
                                                        </select>
                                                    </TD>
                                                    <TD style={{ textAlign: "center" }}>
                                                        {u.approved
                                                            ? <span style={{ color: "#22c55e", fontSize: 14 }}>✓</span>
                                                            : <span style={{ color: "#ef4444", fontSize: 14 }}>✗</span>
                                                        }
                                                    </TD>
                                                    <TD style={{ color: "rgba(255,255,255,0.4)", fontSize: 11 }}>
                                                        {fmtDate(u.last_login)}
                                                    </TD>
                                                    <TD>
                                                        {!u.is_super_admin && (
                                                            <button onClick={() => handleDelete(u.id)} style={{
                                                                padding: "3px 10px", fontSize: 10, cursor: "pointer",
                                                                background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)",
                                                                borderRadius: 4, color: "#ef4444",
                                                            }}>
                                                                Delete
                                                            </button>
                                                        )}
                                                    </TD>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default function AdminPanel(props) {
    return (
        <AdminErrorBoundary>
            <AdminPanelInner {...props} />
        </AdminErrorBoundary>
    )
}
