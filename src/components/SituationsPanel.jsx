import { useState, useEffect } from "react"
import { apiFetch } from "../auth.js"

const ACCENT_COLOURS = ["#FF8C00", "#2979FF", "#ef4444", "#22c55e", "#9333ea", "#e5e7eb"]

const FOCUS_REGIONS = [
    // Africa
    "East Africa", "Horn of Africa", "Great Lakes Region", "Sahel",
    "West Africa", "North Africa", "Central Africa", "Southern Africa",
    // Middle East
    "Red Sea / Arabian Peninsula", "Gulf States", "Middle East",
    "Levant", "Iran", "Iraq", "Yemen",
    // Asia
    "Indian Ocean", "Mediterranean", "South Asia", "Southeast Asia",
    "Central Asia", "East Asia",
    // Europe
    "Europe", "Eastern Europe", "Ukraine", "Balkans", "Russia",
    // Americas
    "North America", "Central America", "South America",
    // Oceania
    "Australia",
    // Global
    "Global",
]

function relTime(iso) {
    if (!iso) return "—"
    const diff = Date.now() - new Date(iso)
    const m = Math.floor(diff / 60000)
    if (m < 1)    return "just now"
    if (m < 60)   return `${m}m ago`
    if (m < 1440) return `${Math.floor(m / 60)}h ago`
    return `${Math.floor(m / 1440)}d ago`
}

function initials(name) {
    if (!name) return "?"
    return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
}

function UserSessionRow({ user, onSelect }) {
    const cv = user.current_view || {}
    const regionLabel = cv.lat != null
        ? `${Number(cv.lat).toFixed(2)}, ${Number(cv.lon).toFixed(2)} z${cv.zoom ?? "?"}`
        : "Unknown"
    return (
        <button onClick={() => onSelect(user)} style={{
            width: "100%", padding: "10px 14px", background: "none",
            border: "none", borderBottom: "1px solid rgba(255,255,255,0.05)",
            cursor: "pointer", display: "flex", alignItems: "center", gap: 10, textAlign: "left",
        }}>
            <div style={{
                width: 30, height: 30, borderRadius: "50%",
                background: "rgba(26,110,181,0.25)", border: "1px solid rgba(26,110,181,0.4)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, color: "#60a5fa", flexShrink: 0,
            }}>
                {initials(user.name || user.email)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: "#e0e0e0", marginBottom: 1 }}>
                    {user.name || user.email}
                    <span style={{ fontSize: 9, fontWeight: 400, color: "rgba(255,255,255,0.3)", marginLeft: 6 }}>{user.role}</span>
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
                    {regionLabel} · {relTime(user.last_seen)}
                </div>
            </div>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22c55e", flexShrink: 0 }} />
        </button>
    )
}

function UserDetailPopup({ user, onClose }) {
    if (!user) return null
    const cv = user.current_view || {}
    return (
        <>
            <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 2999, background: "rgba(0,0,0,0.5)" }} />
            <div style={{
                position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                width: 320, background: "rgba(6,14,48,0.97)", backdropFilter: "blur(24px)",
                WebkitBackdropFilter: "blur(24px)", border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 10, padding: "18px 20px", zIndex: 3000,
                boxShadow: "0 8px 40px rgba(0,0,0,0.6)", fontFamily: "Inter, sans-serif", color: "#e0e0e0",
            }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>{user.name || "No name"}</div>
                        <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>{user.email}</div>
                    </div>
                    <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.3)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
                </div>
                {[
                    ["Role",         user.role],
                    ["IP Address",   user.last_ip || "Unknown"],
                    ["Joined",       user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"],
                    ["Last login",   user.last_login ? relTime(user.last_login) : "—"],
                    ["Last seen",    user.last_seen ? relTime(user.last_seen) : "—"],
                    ["Map position", cv.lat != null ? `${Number(cv.lat).toFixed(4)}, ${Number(cv.lon).toFixed(4)}` : "—"],
                    ["Zoom",         cv.zoom != null ? String(cv.zoom) : "—"],
                    ["Active event", cv.event || "None"],
                ].map(([label, val]) => (
                    <div key={label} style={{ display: "flex", gap: 12, fontSize: 11, marginBottom: 7 }}>
                        <span style={{ color: "rgba(255,255,255,0.3)", flexShrink: 0, width: 90 }}>{label}</span>
                        <span style={{ color: "#e0e0e0" }}>{val}</span>
                    </div>
                ))}
                <div style={{ marginTop: 14, fontSize: 9, color: "rgba(255,255,255,0.2)", fontStyle: "italic", lineHeight: 1.5 }}>
                    This information is not visible to the user.
                </div>
            </div>
        </>
    )
}

function SH({ children }) {
    return (
        <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase",
            color: "rgba(26,110,181,0.8)", borderLeft: "2px solid rgba(26,110,181,0.5)",
            paddingLeft: 8, marginTop: 20, marginBottom: 10,
        }}>{children}</div>
    )
}

export default function SituationsPanel({
    situations, setSituations,
    activeSituationId, setActiveSituationId,
    onClose, onDrawTheater,
    profile, onProfileSave,
    currentUser,
    focusRegions: externalFocusRegions,
    onFocusRegionsChange,
}) {
    const [showNew,       setShowNew]       = useState(false)
    const [name,          setName]          = useState("")
    const [mission,       setMission]       = useState("")
    const [color,         setColor]         = useState(ACCENT_COLOURS[0])
    const [trackSessions, setTrackSessions] = useState(false)
    const [activeUsers,   setActiveUsers]   = useState([])
    const [selectedUser,  setSelectedUser]  = useState(null)
    const [missionText,   setMissionText]   = useState(profile?.activeSituations || "")
    const [focusRegions,  setFocusRegions]  = useState(externalFocusRegions ?? profile?.focusRegions ?? [])
    const [threshold,     setThreshold]     = useState(profile?.threshold ?? 1)
    const [savedMission,  setSavedMission]  = useState(false)

    const isAdmin = currentUser?.role === "admin" || currentUser?.is_super_admin

    useEffect(() => {
        if (!trackSessions || !isAdmin) return
        const doFetch = async () => {
            try {
                const res = await apiFetch("/api/admin/active-users")
                if (res.ok) setActiveUsers(await res.json())
            } catch { /* ignore */ }
        }
        doFetch()
        const t = setInterval(doFetch, 15000)
        return () => clearInterval(t)
    }, [trackSessions, isAdmin])

    function createSituation() {
        if (!name.trim()) return
        const s = {
            id: crypto.randomUUID(), name: name.trim(), mission: mission.trim(),
            created: new Date().toISOString(), lastModified: new Date().toISOString(),
            annotations: { points: [], zones: [], links: [] }, notes: "", color,
        }
        setSituations(prev => [s, ...prev])
        setName(""); setMission(""); setColor(ACCENT_COLOURS[0])
        setShowNew(false)
        setActiveSituationId(s.id)
    }

    function saveMission() {
        if (!onProfileSave || !profile) return
        const updated = { ...profile, activeSituations: missionText, focusRegions, threshold }
        onProfileSave(updated)
        setSavedMission(true)
        setTimeout(() => setSavedMission(false), 2000)
    }

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: "Inter, -apple-system, sans-serif", color: "#e0e0e0" }}>
            {/* Header */}
            <div style={{ padding: "14px 16px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff" }}>
                            SITUATIONS
                        </div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>Mission Control</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                        <button onClick={() => setShowNew(v => !v)} style={{
                            fontSize: 10, fontWeight: 700, padding: "4px 10px",
                            border: "1px solid rgba(255,255,255,0.15)", borderRadius: 5,
                            background: showNew ? "rgba(255,255,255,0.08)" : "none",
                            color: "rgba(255,255,255,0.5)", cursor: "pointer",
                        }}>
                            {showNew ? "Cancel" : "+ New"}
                        </button>
                        <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.35)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
                    </div>
                </div>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
                <SH>Active Situation</SH>

                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <textarea
                        value={missionText} onChange={e => setMissionText(e.target.value)}
                        placeholder="Define current mission or situation... Injected into all analysis calls."
                        rows={4}
                        style={{
                            width: "100%", boxSizing: "border-box",
                            background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                            borderRadius: 6, padding: "8px 10px", fontSize: 12, color: "#e0e0e0",
                            outline: "none", resize: "vertical", lineHeight: 1.55, fontFamily: "inherit",
                        }}
                    />
                    <div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>Focus Regions</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                            {FOCUS_REGIONS.map(r => (
                                <button key={r} onClick={() => {
                                    const next = focusRegions.includes(r) ? focusRegions.filter(x => x !== r) : [...focusRegions, r]
                                    setFocusRegions(next)
                                    onFocusRegionsChange?.(next)
                                }} style={{
                                    padding: "3px 8px", fontSize: 9, fontWeight: 600, borderRadius: 4,
                                    border: `1px solid ${focusRegions.includes(r) ? "rgba(26,110,181,0.6)" : "rgba(255,255,255,0.12)"}`,
                                    background: focusRegions.includes(r) ? "rgba(26,110,181,0.2)" : "none",
                                    color: focusRegions.includes(r) ? "#60a5fa" : "rgba(255,255,255,0.4)",
                                    cursor: "pointer",
                                }}>
                                    {r}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,0.3)", marginBottom: 6 }}>
                            Alert Threshold — {["Minimal", "Standard", "High Sensitivity"][threshold]}
                        </div>
                        <input type="range" min={0} max={2} value={threshold}
                            onChange={e => setThreshold(Number(e.target.value))}
                            style={{ width: "100%", cursor: "pointer" }} />
                    </div>
                    <button onClick={saveMission} style={{
                        padding: "8px 0",
                        background: savedMission ? "rgba(34,197,94,0.15)" : "rgba(26,110,181,0.15)",
                        border: `1px solid ${savedMission ? "rgba(34,197,94,0.4)" : "rgba(26,110,181,0.4)"}`,
                        borderRadius: 5, fontSize: 11, fontWeight: 700,
                        color: savedMission ? "#34d399" : "rgba(26,110,181,0.9)", cursor: "pointer",
                    }}>
                        {savedMission ? "✓ Saved" : "Save Mission Context"}
                    </button>
                </div>

                {/* User Locations — admin only */}
                {isAdmin && (
                    <>
                        <SH>User Locations</SH>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>Track active sessions</span>
                            <button onClick={() => setTrackSessions(v => !v)} style={{
                                width: 36, height: 20, borderRadius: 10, border: "none",
                                background: trackSessions ? "rgba(26,110,181,0.6)" : "rgba(255,255,255,0.1)",
                                cursor: "pointer", position: "relative", transition: "background 0.2s",
                            }}>
                                <span style={{
                                    position: "absolute", top: 2,
                                    left: trackSessions ? 18 : 2,
                                    width: 16, height: 16, borderRadius: "50%", background: "#fff",
                                    transition: "left 0.2s", display: "block",
                                }} />
                            </button>
                        </div>
                        {trackSessions && (
                            activeUsers.length === 0
                                ? <div style={{ fontSize: 11, color: "rgba(255,255,255,0.2)", textAlign: "center", padding: "12px 0" }}>No active sessions in the last 10 minutes</div>
                                : activeUsers.map(u => <UserSessionRow key={u.id} user={u} onSelect={setSelectedUser} />)
                        )}
                    </>
                )}

                {/* New situation form */}
                {showNew && (
                    <>
                        <SH>New Situation</SH>
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="Situation name *"
                                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "7px 10px", fontSize: 12, color: "#e0e0e0", outline: "none" }} />
                            <textarea value={mission} onChange={e => setMission(e.target.value)} placeholder="Mission brief (optional)" rows={3}
                                style={{ width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5, padding: "7px 10px", fontSize: 11, color: "#e0e0e0", outline: "none", resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }} />
                            <div>
                                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.08em" }}>Accent</div>
                                <div style={{ display: "flex", gap: 7 }}>
                                    {ACCENT_COLOURS.map(c => <button key={c} onClick={() => setColor(c)} style={{ width: 20, height: 20, borderRadius: "50%", background: c, border: color === c ? "3px solid #fff" : "2px solid transparent", cursor: "pointer", outline: "none" }} />)}
                                </div>
                            </div>
                            <button onClick={createSituation} style={{ padding: "8px 0", background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 5, fontSize: 11, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
                                Create Situation
                            </button>
                        </div>
                    </>
                )}

                {/* Situations list */}
                {situations.length > 0 && <SH>Situations ({situations.length})</SH>}
                {situations.map(s => {
                    const isActive = s.id === activeSituationId
                    const total = (s.annotations?.points?.length || 0) + (s.annotations?.zones?.length || 0) + (s.annotations?.links?.length || 0)
                    return (
                        <div key={s.id} style={{
                            padding: "11px 12px", marginBottom: 6, borderRadius: 6,
                            background: isActive ? `${s.color}10` : "rgba(255,255,255,0.02)",
                            border: `1px solid ${isActive ? s.color + "40" : "rgba(255,255,255,0.07)"}`,
                        }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                                <div style={{ marginTop: 3, width: 7, height: 7, borderRadius: "50%", background: s.color, flexShrink: 0, boxShadow: isActive ? `0 0 6px ${s.color}` : "none" }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                                    {s.mission && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", lineHeight: 1.4, marginBottom: 3, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{s.mission}</div>}
                                    <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{total > 0 ? `${total} annotation${total !== 1 ? "s" : ""} · ` : ""}Modified {relTime(s.lastModified)}</div>
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: 5, marginTop: 8 }}>
                                <button onClick={() => { setActiveSituationId(s.id); onClose() }} style={{ flex: 1, padding: "4px 0", fontSize: 10, fontWeight: 600, border: `1px solid ${s.color}`, borderRadius: 4, background: isActive ? s.color : "none", color: isActive ? "#fff" : s.color, cursor: "pointer" }}>
                                    {isActive ? "Active" : "Open"}
                                </button>
                                {isActive && onDrawTheater && (
                                    <button onClick={onDrawTheater} style={{ padding: "4px 8px", fontSize: 10, border: `1px solid ${s.color}`, borderRadius: 4, background: "none", color: s.color, cursor: "pointer" }}>{s.theater ? "Redraw" : "Theater"}</button>
                                )}
                                {isActive && (
                                    <button onClick={() => setActiveSituationId(null)} style={{ padding: "4px 8px", fontSize: 10, border: "1px solid rgba(255,255,255,0.12)", borderRadius: 4, background: "none", color: "rgba(255,255,255,0.4)", cursor: "pointer" }}>
                                        Deactivate
                                    </button>
                                )}
                                <button onClick={() => { if (!window.confirm("Delete this situation?")) return; setSituations(prev => prev.filter(x => x.id !== s.id)); if (activeSituationId === s.id) setActiveSituationId(null) }}
                                    style={{ padding: "4px 8px", fontSize: 10, border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, background: "none", color: "#ef4444", cursor: "pointer" }}>
                                    Del
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>

            {selectedUser && <UserDetailPopup user={selectedUser} onClose={() => setSelectedUser(null)} />}
        </div>
    )
}
