import { useState } from "react"

const GLASS_DARK = {
    background:          "rgb(10, 14, 20)",
    border:              "var(--elevation-1)",
}

export default function WorkspacesPanel({
    workspaces,
    activeWorkspaceId,
    onSwitch,
    onCreate,
    onDelete,
    onClose,
}) {
    const [newName, setNewName] = useState("")
    const [hovId, setHovId] = useState(null)

    const handleCreate = () => {
        const name = newName.trim()
        if (!name) return
        onCreate(name)
        setNewName("")
    }

    return (
        <div style={{
            position: "fixed",
            top: 44,
            right: 0,
            width: 256,
            bottom: 0,
            ...GLASS_DARK,
            borderLeft: "1px solid rgba(255,255,255,0.065)",
            zIndex: 998,
            display: "flex",
            flexDirection: "column",
            animation: "slideInRight 0.18s cubic-bezier(0.4,0,0.2,1)",
        }}>
            {/* Header */}
            <div style={{
                display: "flex",
                alignItems: "center",
                padding: "14px 14px 10px",
                borderBottom: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
            }}>
                <span style={{
                    flex: 1,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "rgba(255,255,255,0.35)",
                }}>
                    Workspaces
                </span>
                <button
                    onClick={onClose}
                    style={{
                        background: "none",
                        border: "none",
                        color: "rgba(255,255,255,0.25)",
                        cursor: "pointer",
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 0,
                    }}
                >
                    ✕
                </button>
            </div>

            {/* Workspace list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 10px" }}>
                {workspaces.map(ws => {
                    const isActive = ws.id === activeWorkspaceId
                    const isHov = hovId === ws.id
                    return (
                        <div
                            key={ws.id}
                            onClick={() => { onSwitch(ws.id); onClose() }}
                            onMouseEnter={() => setHovId(ws.id)}
                            onMouseLeave={() => setHovId(null)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "9px 11px",
                                borderRadius: 5,
                                marginBottom: 3,
                                background: isActive ? "rgba(255,255,255,0.07)" : isHov ? "rgba(255,255,255,0.03)" : "none",
                                border: `1px solid ${isActive ? "rgba(255,255,255,0.11)" : "transparent"}`,
                                cursor: "pointer",
                                transition: "all 0.12s",
                            }}
                        >
                            {/* Active dot */}
                            <div style={{
                                width: 6, height: 6,
                                borderRadius: "50%",
                                background: isActive ? "#22c55e" : "transparent",
                                border: `1px solid ${isActive ? "#22c55e" : "rgba(255,255,255,0.18)"}`,
                                flexShrink: 0,
                                transition: "all 0.12s",
                            }} />

                            <span style={{
                                flex: 1,
                                fontSize: 12,
                                color: isActive ? "#fff" : "rgba(255,255,255,0.48)",
                                fontWeight: isActive ? 600 : 400,
                                transition: "color 0.12s",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                            }}>
                                {ws.name}
                            </span>

                            {isActive && (
                                <span style={{
                                    fontSize: 8,
                                    color: "rgba(255,255,255,0.25)",
                                    letterSpacing: "0.1em",
                                    flexShrink: 0,
                                }}>
                                    ACTIVE
                                </span>
                            )}

                            {workspaces.length > 1 && !isActive && (
                                <button
                                    onClick={e => { e.stopPropagation(); onDelete(ws.id) }}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        color: "rgba(255,255,255,0.18)",
                                        cursor: "pointer",
                                        fontSize: 12,
                                        padding: "0 2px",
                                        lineHeight: 1,
                                        flexShrink: 0,
                                    }}
                                >
                                    ✕
                                </button>
                            )}
                        </div>
                    )
                })}
            </div>

            {/* Create new workspace */}
            <div style={{
                padding: "10px 10px 14px",
                borderTop: "1px solid rgba(255,255,255,0.06)",
                flexShrink: 0,
            }}>
                <div style={{
                    fontSize: 9,
                    color: "rgba(255,255,255,0.22)",
                    letterSpacing: "0.08em",
                    marginBottom: 6,
                }}>
                    NEW WORKSPACE
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                    <input
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && handleCreate()}
                        placeholder="Name..."
                        style={{
                            flex: 1,
                            background: "rgba(255,255,255,0.05)",
                            border: "1px solid rgba(255,255,255,0.09)",
                            borderRadius: 4,
                            padding: "6px 9px",
                            fontSize: 11,
                            color: "#fff",
                            outline: "none",
                            minWidth: 0,
                        }}
                    />
                    <button
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                        style={{
                            background: newName.trim() ? "rgba(255,255,255,0.09)" : "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,255,255,0.10)",
                            borderRadius: 4,
                            padding: "6px 10px",
                            fontSize: 10,
                            color: newName.trim() ? "#fff" : "rgba(255,255,255,0.25)",
                            cursor: newName.trim() ? "pointer" : "default",
                            fontWeight: 600,
                            letterSpacing: "0.06em",
                            flexShrink: 0,
                            transition: "all 0.12s",
                        }}
                    >
                        CREATE
                    </button>
                </div>
                <div style={{ fontSize: 8, color: "rgba(255,255,255,0.15)", marginTop: 5 }}>
                    Enter to create · each workspace saves its own map position and layer config
                </div>
            </div>

            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(20px); opacity: 0; }
                    to   { transform: translateX(0);    opacity: 1; }
                }
            `}</style>
        </div>
    )
}
