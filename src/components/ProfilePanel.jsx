import { useState, useRef } from "react"
import { saveProfileToStorage } from "./MissionProfilePanel.jsx"
import { apiFetch } from "../auth.js"

const getClearances = (user) => {
    if (!user) return []
    const role = user.role
    return [
        { name: "Map Intelligence",  status: "GRANTED" },
        { name: "Briefings Access",  status: "GRANTED" },
        { name: "POI Profiles",      status: (role === "analyst" || role === "admin") ? "GRANTED" : "OBSERVER" },
        { name: "Claude Analysis",   status: (role === "analyst" || role === "admin") ? "GRANTED" : "DENIED" },
        { name: "Admin Panel",       status: role === "admin" ? "GRANTED" : "DENIED" },
        { name: "Export Reports",    status: role === "admin" ? "GRANTED" : "PENDING" },
    ]
}

const BADGE_COLOR = {
    ADMIN:        { bg: "rgba(220,38,38,0.15)",   border: "rgba(220,38,38,0.4)",   text: "#ef4444" },
    ANALYST:      { bg: "rgba(59,130,246,0.15)",  border: "rgba(59,130,246,0.4)",  text: "#60a5fa" },
    ADMINISTRATOR:{ bg: "rgba(220,38,38,0.15)",   border: "rgba(220,38,38,0.4)",   text: "#ef4444" },
    OPERATOR:     { bg: "rgba(139,92,246,0.15)",  border: "rgba(139,92,246,0.4)",  text: "#a78bfa" },
    OBSERVER:     { bg: "rgba(107,114,128,0.15)", border: "rgba(107,114,128,0.4)", text: "#9ca3af" },
}

const STATUS_COLOR = {
    GRANTED:  { bg: "rgba(22,163,74,0.12)",  border: "rgba(22,163,74,0.35)",  text: "#16a34a" },
    PENDING:  { bg: "rgba(217,119,6,0.12)",  border: "rgba(217,119,6,0.35)",  text: "#d97706" },
    DENIED:   { bg: "rgba(220,38,38,0.12)",  border: "rgba(220,38,38,0.35)",  text: "#dc2626" },
    OBSERVER: { bg: "rgba(74,85,104,0.12)",  border: "rgba(74,85,104,0.35)",  text: "#4a5568" },
}

function StatusBadge({ status }) {
    const c = STATUS_COLOR[status] || STATUS_COLOR.DENIED
    return (
        <span style={{
            fontSize:     9,
            fontWeight:   700,
            letterSpacing:"0.1em",
            padding:      "2px 7px",
            borderRadius: 3,
            background:   c.bg,
            border:       `1px solid ${c.border}`,
            color:        c.text,
        }}>
            {status}
        </span>
    )
}

function SectionHeader({ children }) {
    return (
        <div style={{
            fontSize:      10,
            fontWeight:    700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color:         "var(--akili-accent)",
            borderLeft:    "2px solid var(--akili-accent)",
            paddingLeft:   8,
            marginTop:     20,
            marginBottom:  10,
        }}>
            {children}
        </div>
    )
}

const INPUT_STYLE = {
    width:        "100%",
    background:   "var(--akili-input-bg)",
    border:       "1px solid var(--akili-input-border)",
    borderRadius: 4,
    padding:      "7px 10px",
    fontSize:     12,
    color:        "var(--akili-text-primary)",
    outline:      "none",
    boxSizing:    "border-box",
}

function relTimeAgo(iso) {
    if (!iso) return "—"
    const diff = Date.now() - new Date(iso)
    const m = Math.floor(diff / 60000)
    if (m < 1)    return "just now"
    if (m < 60)   return `${m} minutes ago`
    if (m < 1440) return `${Math.floor(m / 60)} hours ago`
    if (m < 43200) return `${Math.floor(m / 1440)} days ago`
    return new Date(iso).toLocaleDateString()
}

export default function ProfilePanel({ profile, onSave, onClose, user: userProp, currentUser: currentUserProp }) {
    const currentUser = userProp ?? currentUserProp
    const [displayName, setDisplayName] = useState(currentUser?.name || profile?.displayName || "")
    const [email,       setEmail]       = useState(currentUser?.email || profile?._email || "")
    const [pwExpanded,  setPwExpanded]  = useState(false)
    const [curPw,       setCurPw]       = useState("")
    const [newPw,       setNewPw]       = useState("")
    const [confirmPw,   setConfirmPw]   = useState("")
    const [pwLoading,   setPwLoading]   = useState(false)
    const [pwError,     setPwError]     = useState("")
    const [pwSuccess,   setPwSuccess]   = useState(false)
    const [saved,       setSaved]       = useState(false)
    const [requestOpen, setRequestOpen] = useState(false)
    const [requestText, setRequestText] = useState("")
    const [requestDone, setRequestDone] = useState(false)
    const avatarRef = useRef()

    const roleKey = (currentUser?.role || profile?.role || "").toUpperCase().replace(/\s/g, "")
    const badgeColors = BADGE_COLOR[roleKey] || BADGE_COLOR.OBSERVER

    function memberSince(iso) {
        if (!iso) return null
        return "Member since " + new Date(iso).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    }

    function handleSave() {
        if (!profile) return
        const updated = { ...profile, displayName, _email: email }
        saveProfileToStorage(updated)
        onSave?.(updated)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
    }

    async function handleChangePassword() {
        setPwError("")
        if (!curPw || !newPw || !confirmPw) { setPwError("All fields required"); return }
        if (newPw !== confirmPw) { setPwError("Passwords do not match"); return }
        if (newPw.length < 8)   { setPwError("Password must be at least 8 characters"); return }
        setPwLoading(true)
        try {
            const res = await apiFetch("/api/auth/change-password", {
                method: "POST",
                body: JSON.stringify({ current_password: curPw, new_password: newPw }),
            })
            const data = await res.json()
            if (!res.ok) { setPwError(data.detail || "Failed to change password"); return }
            setPwSuccess(true)
            setCurPw(""); setNewPw(""); setConfirmPw("")
            setTimeout(() => { setPwExpanded(false); setPwSuccess(false) }, 2000)
        } catch {
            setPwError("Connection error.")
        } finally {
            setPwLoading(false)
        }
    }

    function handleRequest() {
        setRequestDone(true)
        setTimeout(() => { setRequestOpen(false); setRequestDone(false); setRequestText("") }, 2000)
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
            {/* Header */}
            <div style={{
                display:        "flex",
                alignItems:     "center",
                justifyContent: "space-between",
                padding:        "14px 16px 12px",
                borderBottom:   "1px solid var(--akili-border)",
                flexShrink:     0,
            }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--akili-text-primary)", letterSpacing: "0.04em" }}>
                    PROFILE
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {/* Save button */}
                    <button onClick={handleSave} style={{
                        padding:      "5px 14px",
                        background:   saved ? "rgba(16,185,129,0.15)" : "rgba(26,110,181,0.15)",
                        border:       `1px solid ${saved ? "rgba(16,185,129,0.4)" : "rgba(26,110,181,0.4)"}`,
                        borderRadius: 4,
                        color:        saved ? "#34d399" : "var(--akili-accent)",
                        fontSize:     11,
                        fontWeight:   600,
                        cursor:       "pointer",
                        transition:   "all 0.2s",
                        letterSpacing:"0.05em",
                        display:      "flex",
                        alignItems:   "center",
                        gap:          5,
                    }}>
                        {saved ? (
                            <>
                                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="1,6 4,10 11,2"/>
                                </svg>
                                Saved
                            </>
                        ) : "Save"}
                    </button>
                    <button onClick={onClose} style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: "var(--akili-text-secondary)", fontSize: 16, lineHeight: 1, padding: 4,
                    }}>×</button>
                </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 20px" }}>

                {/* Avatar + identity */}
                <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "20px 0 16px", borderBottom: "1px solid var(--akili-border)" }}>
                    {/* Avatar */}
                    <input ref={avatarRef} type="file" accept="image/*" style={{ display: "none" }} />
                    <button
                        onClick={() => avatarRef.current?.click()}
                        title="Upload profile picture"
                        style={{
                            width:          80,
                            height:         80,
                            borderRadius:   "50%",
                            border:         "1.5px dashed rgba(255,255,255,0.15)",
                            background:     "rgba(255,255,255,0.03)",
                            cursor:         "pointer",
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "center",
                            flexShrink:     0,
                            color:          "rgba(255,255,255,0.2)",
                            transition:     "border-color 0.15s, color 0.15s",
                        }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(26,110,181,0.5)"; e.currentTarget.style.color = "rgba(26,110,181,0.6)" }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.color = "rgba(255,255,255,0.2)" }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                            <circle cx="12" cy="13" r="4"/>
                        </svg>
                    </button>
                    {/* Name + role */}
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: "var(--akili-text-primary)", marginBottom: 4 }}>
                            {currentUser?.name || profile?.displayName || "No name set"}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--akili-text-muted)", marginBottom: 8 }}>
                            {currentUser?.email || profile?._email || "No email set"}
                        </div>
                        {(currentUser?.role || profile?.role) && (
                            <span style={{
                                fontSize:      9,
                                fontWeight:    700,
                                letterSpacing: "0.12em",
                                padding:       "3px 8px",
                                borderRadius:  3,
                                background:    badgeColors.bg,
                                border:        `1px solid ${badgeColors.border}`,
                                color:         badgeColors.text,
                            }}>
                                {(currentUser?.role || profile?.role).toUpperCase()}
                            </span>
                        )}
                        {currentUser?.created_at && (
                            <div style={{ fontSize: 10, color: "var(--akili-text-muted)", marginTop: 6 }}>
                                {memberSince(currentUser.created_at)}
                            </div>
                        )}
                        {currentUser?.last_login && (
                            <div style={{ fontSize: 10, color: "var(--akili-text-muted)", marginTop: 2 }}>
                                Last login: {relTimeAgo(currentUser.last_login)}
                            </div>
                        )}
                    </div>
                </div>

                {/* Edit fields */}
                <SectionHeader>Account Details</SectionHeader>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                        <label style={{ fontSize: 10, color: "var(--akili-text-muted)", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>
                            DISPLAY NAME
                        </label>
                        <input
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            placeholder="Your display name"
                            style={INPUT_STYLE}
                        />
                    </div>

                    <div>
                        <label style={{ fontSize: 10, color: "var(--akili-text-muted)", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>
                            EMAIL
                        </label>
                        <input
                            type="email"
                            value={currentUser?.email || email}
                            readOnly
                            style={{ ...INPUT_STYLE, opacity: 0.6, cursor: "default" }}
                        />
                    </div>

                    {/* Password section */}
                    <div>
                        <label style={{ fontSize: 10, color: "var(--akili-text-muted)", letterSpacing: "0.06em", display: "block", marginBottom: 4 }}>
                            PASSWORD
                        </label>
                        {!pwExpanded ? (
                            <button onClick={() => setPwExpanded(true)} style={{
                                background:   "var(--akili-hover)",
                                border:       "1px solid var(--akili-border)",
                                borderRadius: 4,
                                padding:      "7px 12px",
                                fontSize:     11,
                                color:        "var(--akili-text-secondary)",
                                cursor:       "pointer",
                            }}>
                                Change Password
                            </button>
                        ) : (
                            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                                <input type="password" value={curPw} onChange={e => setCurPw(e.target.value)}
                                    placeholder="Current password" style={INPUT_STYLE} />
                                <input type="password" value={newPw} onChange={e => setNewPw(e.target.value)}
                                    placeholder="New password" style={INPUT_STYLE} />
                                <input type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                                    placeholder="Confirm new password" style={INPUT_STYLE} />
                                {pwError   && <div style={{ fontSize: 10, color: "#f87171" }}>{pwError}</div>}
                                {pwSuccess  && <div style={{ fontSize: 10, color: "#34d399" }}>Password updated</div>}
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={() => { setPwExpanded(false); setPwError("") }} style={{
                                        flex: 1, padding: "6px", background: "none",
                                        border: "1px solid var(--akili-border)", borderRadius: 4,
                                        fontSize: 11, color: "var(--akili-text-muted)", cursor: "pointer",
                                    }}>Cancel</button>
                                    <button onClick={handleChangePassword} disabled={pwLoading} style={{
                                        flex: 2, padding: "6px", background: "rgba(26,110,181,0.12)",
                                        border: "1px solid rgba(26,110,181,0.35)", borderRadius: 4,
                                        fontSize: 11, color: "var(--akili-accent)", cursor: pwLoading ? "default" : "pointer",
                                    }}>{pwLoading ? "Updating…" : "Update Password"}</button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* Clearances */}
                <SectionHeader>Access Clearances</SectionHeader>

                <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                    {getClearances(currentUser || profile).map(c => (
                        <div key={c.name} style={{
                            display:        "flex",
                            alignItems:     "center",
                            justifyContent: "space-between",
                            padding:        "9px 0",
                            borderBottom:   "1px solid var(--akili-border-subtle)",
                        }}>
                            <span style={{ fontSize: 12, color: "var(--akili-text-primary)" }}>
                                {c.name}
                            </span>
                            <StatusBadge status={c.status} />
                        </div>
                    ))}
                </div>

                {/* Request access */}
                {!requestOpen ? (
                    <button onClick={() => setRequestOpen(true)} style={{
                        marginTop:    14,
                        width:        "100%",
                        padding:      "8px",
                        background:   "rgba(26,110,181,0.06)",
                        border:       "1px dashed rgba(26,110,181,0.3)",
                        borderRadius: 4,
                        fontSize:     11,
                        color:        "rgba(26,110,181,0.7)",
                        cursor:       "pointer",
                        letterSpacing:"0.04em",
                    }}>
                        Request Additional Access
                    </button>
                ) : (
                    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
                        {requestDone ? (
                            <div style={{ fontSize: 11, color: "#34d399", textAlign: "center", padding: "10px 0" }}>
                                Request submitted
                            </div>
                        ) : (
                            <>
                                <textarea
                                    value={requestText}
                                    onChange={e => setRequestText(e.target.value)}
                                    placeholder="Describe the access you need..."
                                    rows={3}
                                    style={{ ...INPUT_STYLE, resize: "vertical", fontFamily: "inherit" }}
                                />
                                <div style={{ display: "flex", gap: 6 }}>
                                    <button onClick={() => setRequestOpen(false)} style={{
                                        flex: 1, padding: "6px", background: "none",
                                        border: "1px solid var(--akili-border)", borderRadius: 4,
                                        fontSize: 11, color: "var(--akili-text-muted)", cursor: "pointer",
                                    }}>Cancel</button>
                                    <button onClick={handleRequest} style={{
                                        flex: 2, padding: "6px", background: "rgba(26,110,181,0.12)",
                                        border: "1px solid rgba(26,110,181,0.35)", borderRadius: 4,
                                        fontSize: 11, color: "var(--akili-accent)", cursor: "pointer",
                                    }}>Submit</button>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}
