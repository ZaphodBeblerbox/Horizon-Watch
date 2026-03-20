import { useState } from "react"

const ACCENT_COLOURS = ["#FF8C00", "#2979FF", "#ef4444", "#22c55e", "#9333ea", "#e5e7eb"]

const PANEL = {
    position: "fixed",
    top: 48,
    left: 0,
    bottom: 0,
    width: 320,
    background: "rgba(255,255,255,0.97)",
    backdropFilter: "blur(16px)",
    WebkitBackdropFilter: "blur(16px)",
    borderRight: "1px solid rgba(0,0,0,0.09)",
    zIndex: 600,
    display: "flex",
    flexDirection: "column",
    fontFamily: "'Inter','Segoe UI',sans-serif",
}

function relTime(iso) {
    if (!iso) return "—"
    const diff = Date.now() - new Date(iso)
    const m = Math.floor(diff / 60000)
    if (m < 1)   return "just now"
    if (m < 60)  return `${m}m ago`
    if (m < 1440) return `${Math.floor(m / 60)}h ago`
    return `${Math.floor(m / 1440)}d ago`
}

export default function SituationsPanel({ situations, setSituations, activeSituationId, setActiveSituationId, onClose, onDrawTheater }) {
    const [showNew, setShowNew]   = useState(false)
    const [name, setName]         = useState("")
    const [mission, setMission]   = useState("")
    const [color, setColor]       = useState(ACCENT_COLOURS[0])

    const createSituation = () => {
        if (!name.trim()) return
        const s = {
            id:           crypto.randomUUID(),
            name:         name.trim(),
            mission:      mission.trim(),
            created:      new Date().toISOString(),
            lastModified: new Date().toISOString(),
            annotations:  { points: [], zones: [], links: [] },
            notes:        "",
            color,
        }
        setSituations(prev => [s, ...prev])
        setName(""); setMission(""); setColor(ACCENT_COLOURS[0])
        setShowNew(false)
        setActiveSituationId(s.id)
    }

    const openSituation = (id) => {
        setActiveSituationId(id)
        onClose()
    }

    const deleteSituation = (id) => {
        if (!window.confirm("Delete this situation? This cannot be undone.")) return
        setSituations(prev => prev.filter(s => s.id !== id))
        if (activeSituationId === id) setActiveSituationId(null)
    }

    return (
        <div style={PANEL}>
            {/* Header */}
            <div style={{ padding: "14px 18px 10px", borderBottom: "1px solid rgba(0,0,0,0.07)", display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 14 }}>📋</span>
                <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: "0.04em", flex: 1 }}>SITUATIONS</span>
                <button
                    onClick={() => setShowNew(v => !v)}
                    style={{ fontSize: 11, fontWeight: 700, padding: "4px 10px", border: "1px solid #0a0a0a", borderRadius: 6, background: showNew ? "#0a0a0a" : "transparent", color: showNew ? "#fff" : "#0a0a0a", cursor: "pointer" }}
                >
                    {showNew ? "✕ Cancel" : "+ New"}
                </button>
                <button onClick={onClose} style={{ background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>✕</button>
            </div>

            {/* New situation form */}
            {showNew && (
                <div style={{ padding: "14px 18px", borderBottom: "1px solid rgba(0,0,0,0.07)", background: "rgba(0,0,0,0.02)" }}>
                    <input
                        autoFocus
                        value={name}
                        onChange={e => setName(e.target.value)}
                        placeholder="Situation name *"
                        style={{ width: "100%", boxSizing: "border-box", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, padding: "7px 10px", fontSize: 12, outline: "none", marginBottom: 8 }}
                    />
                    <textarea
                        value={mission}
                        onChange={e => setMission(e.target.value)}
                        placeholder="Mission brief — what is the analyst trying to understand or achieve? This context is injected into all analysis calls."
                        rows={4}
                        style={{ width: "100%", boxSizing: "border-box", border: "1px solid rgba(0,0,0,0.15)", borderRadius: 6, padding: "7px 10px", fontSize: 11, outline: "none", resize: "vertical", lineHeight: 1.55, marginBottom: 10 }}
                    />
                    <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 9, color: "#999", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Accent colour</div>
                        <div style={{ display: "flex", gap: 8 }}>
                            {ACCENT_COLOURS.map(c => (
                                <button
                                    key={c}
                                    onClick={() => setColor(c)}
                                    style={{ width: 22, height: 22, borderRadius: "50%", background: c, border: color === c ? "3px solid #0a0a0a" : "2px solid transparent", cursor: "pointer", outline: "none" }}
                                />
                            ))}
                        </div>
                    </div>
                    <button
                        onClick={createSituation}
                        style={{ width: "100%", padding: "8px 0", fontSize: 11, fontWeight: 700, border: "none", borderRadius: 6, background: "#0a0a0a", color: "#fff", cursor: "pointer" }}
                    >
                        Create Situation
                    </button>
                </div>
            )}

            {/* Situations list */}
            <div style={{ flex: 1, overflowY: "auto" }}>
                {situations.length === 0 && !showNew && (
                    <div style={{ padding: "32px 20px", textAlign: "center", color: "#bbb", fontSize: 12, lineHeight: 1.6 }}>
                        No situations yet.<br />Create one to track annotations and mission context.
                    </div>
                )}
                {situations.map(s => {
                    const isActive = s.id === activeSituationId
                    const pts  = s.annotations?.points?.length || 0
                    const zns  = s.annotations?.zones?.length  || 0
                    const lks  = s.annotations?.links?.length  || 0
                    const total = pts + zns + lks
                    return (
                        <div
                            key={s.id}
                            style={{
                                padding: "12px 18px",
                                borderBottom: "1px solid rgba(0,0,0,0.06)",
                                background: isActive ? `${s.color}0d` : "transparent",
                                borderLeft: isActive ? `3px solid ${s.color}` : "3px solid transparent",
                            }}
                        >
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                                {/* Colour dot + active indicator */}
                                <div style={{ marginTop: 3, width: 8, height: 8, borderRadius: "50%", background: s.color, flexShrink: 0, boxShadow: isActive ? `0 0 6px ${s.color}` : "none" }} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 12, fontWeight: 700, color: "#111", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {s.name}
                                    </div>
                                    {total > 0 && (
                                        <div style={{ fontSize: 10, color: "#888", marginBottom: 4 }}>
                                            {zns > 0 && `${zns} zone${zns !== 1 ? "s" : ""}`}
                                            {zns > 0 && pts > 0 && " · "}
                                            {pts > 0 && `${pts} point${pts !== 1 ? "s" : ""}`}
                                            {(zns > 0 || pts > 0) && lks > 0 && " · "}
                                            {lks > 0 && `${lks} link${lks !== 1 ? "s" : ""}`}
                                        </div>
                                    )}
                                    {s.mission && (
                                        <div style={{ fontSize: 10, color: "#999", lineHeight: 1.4, marginBottom: 4, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                                            {s.mission}
                                        </div>
                                    )}
                                    <div style={{ fontSize: 9, color: "#bbb" }}>Modified {relTime(s.lastModified)}</div>
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                                <button
                                    onClick={() => openSituation(s.id)}
                                    style={{ flex: 1, padding: "5px 0", fontSize: 10, fontWeight: 600, border: `1px solid ${s.color}`, borderRadius: 5, background: isActive ? s.color : "transparent", color: isActive ? "#fff" : s.color, cursor: "pointer" }}
                                >
                                    {isActive ? "✓ Active" : "Open"}
                                </button>
                                {isActive && onDrawTheater && (
                                    <button
                                        onClick={onDrawTheater}
                                        title={s.theater ? "Redraw theater polygon" : "Draw theater polygon on map"}
                                        style={{ padding: "5px 8px", fontSize: 10, border: `1px solid ${s.color}`, borderRadius: 5, background: "transparent", color: s.color, cursor: "pointer" }}
                                    >
                                        {s.theater ? "Redraw" : "Theater"}
                                    </button>
                                )}
                                {isActive && (
                                    <button
                                        onClick={() => setActiveSituationId(null)}
                                        style={{ padding: "5px 8px", fontSize: 10, border: "1px solid rgba(0,0,0,0.12)", borderRadius: 5, background: "transparent", color: "#888", cursor: "pointer" }}
                                    >
                                        Deactivate
                                    </button>
                                )}
                                <button
                                    onClick={() => deleteSituation(s.id)}
                                    style={{ padding: "5px 8px", fontSize: 10, border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, background: "transparent", color: "#ef4444", cursor: "pointer" }}
                                >
                                    🗑
                                </button>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
