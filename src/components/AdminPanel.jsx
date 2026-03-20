import React, { useEffect, useMemo } from "react"
import API_BASE from "../apiBase.js"

const PANEL_STYLE = {
    position: "fixed",
    inset: 0,
    zIndex: 2000,
    background: "rgba(6,13,26,0.92)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.08)",
    color: "#e8edf2",
    display: "flex",
    flexDirection: "column",
}

const SECTION_STYLE = {
    background: "rgba(6,13,26,0.92)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 10,
}

function adminHeaders() {
    const token = localStorage.getItem("hw_token")
    return {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }
}

function relTime(iso) {
    if (!iso) return "Never"
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return "just now"
    if (minutes < 60) return `${minutes}m ago`
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`
    return new Date(iso).toLocaleString()
}

export default function AdminPanel({ currentUser, onClose }) {
    const [tab, setTab] = React.useState("users")
    const [users, setUsers] = React.useState([])
    const [activeUsers, setActiveUsers] = React.useState([])
    const [loadingUsers, setLoadingUsers] = React.useState(false)
    const [loadingActiveUsers, setLoadingActiveUsers] = React.useState(false)
    const [savingId, setSavingId] = React.useState(null)
    const [showLocationsOnMap, setShowLocationsOnMap] = React.useState(false)
    const [error, setError] = React.useState(null)

    const pendingUsers = useMemo(
        () => users.filter((user) => !user.approved),
        [users],
    )

    const onlineUsers = useMemo(
        () => activeUsers.filter((user) => user.last_seen),
        [activeUsers],
    )

    const dispatchUserLocations = (items) => {
        window.dispatchEvent(new CustomEvent("akili:show-user-locations", {
            detail: Array.isArray(items) ? items : [],
        }))
    }

    const fetchUsers = React.useCallback(async () => {
        setLoadingUsers(true)
        try {
            const res = await fetch(`${API_BASE}/api/admin/users`, {
                headers: adminHeaders(),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
            const list = Array.isArray(data) ? data : (Array.isArray(data?.users) ? data.users : [])
            setUsers(list)
        } catch (err) {
            setError(err)
        } finally {
            setLoadingUsers(false)
        }
    }, [])

    const fetchActiveUsers = React.useCallback(async () => {
        setLoadingActiveUsers(true)
        try {
            const res = await fetch(`${API_BASE}/api/admin/active-users`, {
                headers: adminHeaders(),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
            const list = Array.isArray(data) ? data : []
            setActiveUsers(list)
            if (showLocationsOnMap) {
                dispatchUserLocations(list)
            }
        } catch (err) {
            setError(err)
        } finally {
            setLoadingActiveUsers(false)
        }
    }, [showLocationsOnMap])

    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                if (tab === "users" && mounted) {
                    await fetchUsers()
                }
            } catch (err) {
                if (mounted) setError(err)
            }
        })()
        return () => { mounted = false }
    }, [tab, fetchUsers])

    useEffect(() => {
        let mounted = true
        ;(async () => {
            try {
                if (tab === "active-users" && mounted) {
                    await fetchActiveUsers()
                }
            } catch (err) {
                if (mounted) setError(err)
            }
        })()
        return () => { mounted = false }
    }, [tab, fetchActiveUsers])

    useEffect(() => {
        if (!showLocationsOnMap) {
            dispatchUserLocations([])
            return
        }
        dispatchUserLocations(activeUsers)
    }, [showLocationsOnMap, activeUsers])

    async function runUserAction(url, options = {}, { refresh = true } = {}) {
        setSavingId(url)
        try {
            const res = await fetch(`${API_BASE}${url}`, {
                ...options,
                headers: adminHeaders(),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data?.detail || `HTTP ${res.status}`)
            if (refresh) await fetchUsers()
            if (tab === "active-users") await fetchActiveUsers()
            return data
        } catch (err) {
            setError(err)
            return null
        } finally {
            setSavingId(null)
        }
    }

    if (error) return (
        <div style={{ padding: 24, color: "#dc2626" }}>
            Admin panel error: {error.message}
            <button onClick={() => setError(null)} style={{ marginLeft: 8 }}>
                Retry
            </button>
        </div>
    )

    try {
        return (
            <div style={PANEL_STYLE}>
                <div style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "16px 20px",
                    borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        <div>
                            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.12em" }}>ADMIN PANEL</div>
                            <div style={{ fontSize: 10, color: "#8899aa", marginTop: 2 }}>
                                {currentUser?.email || "Administrator"}
                            </div>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", cursor: "pointer", fontSize: 18 }}
                    >
                        ×
                    </button>
                </div>

                <div style={{
                    display: "flex",
                    gap: 8,
                    padding: "12px 20px 0",
                }}>
                    {[
                        ["users", "USERS"],
                        ["active-users", "ACTIVE USERS"],
                    ].map(([id, label]) => (
                        <button
                            key={id}
                            onClick={() => setTab(id)}
                            style={{
                                padding: "8px 12px",
                                borderRadius: 999,
                                border: `1px solid ${tab === id ? "rgba(26,110,181,0.45)" : "rgba(255,255,255,0.08)"}`,
                                background: tab === id ? "rgba(26,110,181,0.16)" : "rgba(255,255,255,0.03)",
                                color: tab === id ? "#dbeafe" : "#94a3b8",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 700,
                                letterSpacing: "0.08em",
                            }}
                        >
                            {label}
                        </button>
                    ))}
                </div>

                <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
                    {tab === "users" && (
                        <>
                            <div style={{ ...SECTION_STYLE, padding: 16, marginBottom: 16 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: "#fbbf24", letterSpacing: "0.1em", marginBottom: 12 }}>
                                    PENDING APPROVALS
                                </div>
                                {pendingUsers.length === 0 && (
                                    <div style={{ fontSize: 12, color: "#8899aa" }}>
                                        No pending approvals.
                                    </div>
                                )}
                                {pendingUsers.map((user) => (
                                    <div
                                        key={user.id}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            gap: 12,
                                            padding: "12px 14px",
                                            background: "rgba(251,191,36,0.08)",
                                            border: "1px solid rgba(251,191,36,0.28)",
                                            borderRadius: 8,
                                            marginBottom: 10,
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 700 }}>{user.name || "No name"}</div>
                                            <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>{user.email}</div>
                                        </div>
                                        <div style={{ display: "flex", gap: 8 }}>
                                            <button
                                                onClick={() => runUserAction(`/api/admin/users/${user.id}/approve`, { method: "POST" })}
                                                disabled={savingId === `/api/admin/users/${user.id}/approve`}
                                                style={{
                                                    padding: "6px 10px",
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(34,197,94,0.4)",
                                                    background: "rgba(34,197,94,0.16)",
                                                    color: "#4ade80",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                Approve
                                            </button>
                                            <button
                                                onClick={() => runUserAction(`/api/admin/users/${user.id}`, { method: "DELETE" })}
                                                disabled={savingId === `/api/admin/users/${user.id}`}
                                                style={{
                                                    padding: "6px 10px",
                                                    borderRadius: 6,
                                                    border: "1px solid rgba(239,68,68,0.4)",
                                                    background: "rgba(239,68,68,0.12)",
                                                    color: "#f87171",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                Reject
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div style={{ ...SECTION_STYLE, overflow: "hidden" }}>
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                                        <thead>
                                            <tr style={{ background: "rgba(255,255,255,0.03)" }}>
                                                {["Name", "Email", "Role", "Approved", "Last Login", "Actions"].map((label) => (
                                                    <th
                                                        key={label}
                                                        style={{
                                                            textAlign: "left",
                                                            padding: "12px 14px",
                                                            color: "#94a3b8",
                                                            fontSize: 10,
                                                            fontWeight: 700,
                                                            letterSpacing: "0.08em",
                                                            borderBottom: "1px solid rgba(255,255,255,0.08)",
                                                        }}
                                                    >
                                                        {label}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {loadingUsers && (
                                                <tr>
                                                    <td colSpan={6} style={{ padding: 16, color: "#8899aa" }}>
                                                        Loading users...
                                                    </td>
                                                </tr>
                                            )}
                                            {!loadingUsers && users.map((user) => (
                                                <tr key={user.id} style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                                                    <td style={{ padding: "12px 14px", fontWeight: 600 }}>{user.name || "No name"}</td>
                                                    <td style={{ padding: "12px 14px", color: "#cbd5e1" }}>{user.email}</td>
                                                    <td style={{ padding: "12px 14px" }}>
                                                        <select
                                                            value={user.role || "observer"}
                                                            onChange={(e) => runUserAction(`/api/admin/users/${user.id}`, {
                                                                method: "PUT",
                                                                body: JSON.stringify({ role: e.target.value }),
                                                            })}
                                                            style={{
                                                                background: "rgba(255,255,255,0.04)",
                                                                color: "#e8edf2",
                                                                border: "1px solid rgba(255,255,255,0.12)",
                                                                borderRadius: 6,
                                                                padding: "6px 8px",
                                                            }}
                                                        >
                                                            <option value="observer">observer</option>
                                                            <option value="analyst">analyst</option>
                                                            <option value="admin">admin</option>
                                                        </select>
                                                    </td>
                                                    <td style={{ padding: "12px 14px" }}>
                                                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                                            <input
                                                                type="checkbox"
                                                                checked={!!user.approved}
                                                                onChange={(e) => runUserAction(`/api/admin/users/${user.id}`, {
                                                                    method: "PUT",
                                                                    body: JSON.stringify({ approved: e.target.checked }),
                                                                })}
                                                            />
                                                            <span style={{ color: user.approved ? "#4ade80" : "#fbbf24" }}>
                                                                {user.approved ? "Yes" : "No"}
                                                            </span>
                                                        </label>
                                                    </td>
                                                    <td style={{ padding: "12px 14px", color: "#94a3b8" }}>
                                                        {relTime(user.last_login)}
                                                    </td>
                                                    <td style={{ padding: "12px 14px" }}>
                                                        <button
                                                            onClick={() => runUserAction(`/api/admin/users/${user.id}`, { method: "DELETE" })}
                                                            style={{
                                                                padding: "6px 10px",
                                                                borderRadius: 6,
                                                                border: "1px solid rgba(239,68,68,0.35)",
                                                                background: "rgba(239,68,68,0.12)",
                                                                color: "#f87171",
                                                                cursor: "pointer",
                                                            }}
                                                        >
                                                            Delete
                                                        </button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </>
                    )}

                    {tab === "active-users" && (
                        <>
                            <div style={{ ...SECTION_STYLE, padding: 16, marginBottom: 16 }}>
                                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                                    <div>
                                        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em" }}>ACTIVE USERS</div>
                                        <div style={{ fontSize: 11, color: "#8899aa", marginTop: 4 }}>
                                            Users seen within the last 10 minutes
                                        </div>
                                    </div>
                                    {currentUser?.role === "admin" && (
                                        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                                            <input
                                                type="checkbox"
                                                checked={showLocationsOnMap}
                                                onChange={(e) => setShowLocationsOnMap(e.target.checked)}
                                            />
                                            Show User Locations on Map
                                        </label>
                                    )}
                                </div>
                            </div>

                            <div style={{ ...SECTION_STYLE, padding: 16 }}>
                                {loadingActiveUsers && (
                                    <div style={{ color: "#8899aa", fontSize: 12 }}>Loading active users...</div>
                                )}
                                {!loadingActiveUsers && onlineUsers.length === 0 && (
                                    <div style={{ color: "#8899aa", fontSize: 12 }}>No active users found.</div>
                                )}
                                {!loadingActiveUsers && onlineUsers.map((user) => (
                                    <div
                                        key={user.id}
                                        style={{
                                            display: "grid",
                                            gridTemplateColumns: "1.4fr 1fr 1fr",
                                            gap: 12,
                                            padding: "12px 0",
                                            borderBottom: "1px solid rgba(255,255,255,0.06)",
                                        }}
                                    >
                                        <div>
                                            <div style={{ fontSize: 12, fontWeight: 700 }}>{user.name || "No name"}</div>
                                            <div style={{ fontSize: 11, color: "#cbd5e1", marginTop: 2 }}>{user.email}</div>
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8" }}>
                                            {user.location_city || user.current_view?.event || "Location unknown"}
                                        </div>
                                        <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "right" }}>
                                            {relTime(user.last_seen)}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        )
    } catch (err) {
        return (
            <div style={{ padding: 24, color: "#dc2626" }}>
                Admin panel error: {err.message}
                <button onClick={() => setError(null)} style={{ marginLeft: 8 }}>
                    Retry
                </button>
            </div>
        )
    }
}
