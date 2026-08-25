import { useState } from "react"

// ── Inline icons ───────────────────────────────────────────────────────────────

function MapIcon({ size }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="1,2 7,4 7,16 1,14" />
            <polygon points="7,4 13,2 13,14 7,16" />
            <polygon points="13,2 17,4 17,16 13,14" />
        </svg>
    )
}

function BriefingIcon({ size }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="1.5" width="12" height="15" rx="2" />
            <line x1="6" y1="6"  x2="12" y2="6"  />
            <line x1="6" y1="9"  x2="12" y2="9"  />
            <line x1="6" y1="12" x2="9.5" y2="12" />
        </svg>
    )
}

function NewsIcon({ size }) {
    return (
        <svg width={size} height={size} viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="14" height="12" rx="1.5" />
            <line x1="5" y1="7"  x2="13" y2="7"  />
            <line x1="5" y1="10" x2="10" y2="10" />
        </svg>
    )
}

function ForgeIcon({ size }) {
    return (
        <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 14L7.5 8.5"/>
            <rect x="6.5" y="1.5" width="5" height="5" rx="1" transform="rotate(-45 8 4)"/>
        </svg>
    )
}

const TYPE_ICON = { map: MapIcon, briefing: BriefingIcon, news: NewsIcon, forge: ForgeIcon }

// ── TabBar ─────────────────────────────────────────────────────────────────────
//
// tab objects: { id, type?, label }
// canClose:    (tab) => bool — if omitted, all tabs with type !== "map" are closeable
//
export default function TabBar({
    tabs        = [],
    activeTabId = null,
    height      = 32,
    iconSize    = 14,
    onSwitch,           // (id) => void
    onClose,            // (id) => void   | null → no X button
    onNew,              // ()   => void   | null → no + button
    onReorder,          // (fromIdx, toIdx) => void | null
    onRename,           // (id, label)   => void | null → no double-click rename
    canClose,           // (tab) => bool  | null → default: type !== "map"
}) {
    const [hoveredId,   setHoveredId]   = useState(null)
    const [editingId,   setEditingId]   = useState(null)
    const [editVal,     setEditVal]     = useState("")
    const [dragSrcIdx,  setDragSrcIdx]  = useState(null)
    const [dragOverIdx, setDragOverIdx] = useState(null)

    const isCloseable = (tab) =>
        canClose ? canClose(tab) : tab.type !== "map"

    const commitEdit = () => {
        if (editingId && editVal.trim() && onRename) onRename(editingId, editVal.trim())
        setEditingId(null)
        setEditVal("")
    }

    const handleDragStart = (e, idx) => {
        setDragSrcIdx(idx)
        e.dataTransfer.effectAllowed = "move"
        e.currentTarget.style.opacity = "0.5"
    }

    const handleDragEnd = (e) => {
        e.currentTarget.style.opacity = ""
        if (dragSrcIdx !== null && dragOverIdx !== null && dragSrcIdx !== dragOverIdx && onReorder) {
            onReorder(dragSrcIdx, dragOverIdx)
        }
        setDragSrcIdx(null)
        setDragOverIdx(null)
    }

    const handleDragOver = (e, idx) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = "move"
        setDragOverIdx(idx)
    }

    const minW = height >= 32 ? 120 : 80
    const maxW = height >= 32 ? 220 : 160
    const px   = height >= 32 ? "0 10px" : "0 8px"

    return (
        <div style={{
            display:    "flex",
            alignItems: "flex-end",
            height:     "100%",
            flex:       1,
            minWidth:   0,
            overflow:   "hidden",
        }}>
            {tabs.map((tab, idx) => {
                const isActive  = tab.id === activeTabId
                const isHovered = hoveredId === tab.id
                const closeable = isCloseable(tab)
                const Icon      = TYPE_ICON[tab.type]
                const showX     = closeable && onClose && (isActive || isHovered) && editingId !== tab.id

                return (
                    <div
                        key={tab.id}
                        draggable={!!onReorder}
                        onDragStart={e => handleDragStart(e, idx)}
                        onDragEnd={handleDragEnd}
                        onDragOver={e => handleDragOver(e, idx)}
                        onDrop={e => e.preventDefault()}
                        onMouseEnter={() => setHoveredId(tab.id)}
                        onMouseLeave={() => setHoveredId(null)}
                        onClick={() => onSwitch(tab.id)}
                        onMouseDown={e => {
                            if (e.button === 1) {
                                e.preventDefault()
                                if (closeable && onClose) onClose(tab.id)
                            }
                        }}
                        onDoubleClick={() => {
                            if (!onRename || !closeable) return
                            setEditingId(tab.id)
                            setEditVal(tab.label)
                        }}
                        style={{
                            display:      "flex",
                            alignItems:   "center",
                            gap:          5,
                            height:       height,
                            minWidth:     minW,
                            maxWidth:     maxW,
                            padding:      px,
                            cursor:       "pointer",
                            userSelect:   "none",
                            background:   isActive ? "rgba(255,255,255,0.08)" : "transparent",
                            borderBottom: isActive ? "2px solid var(--akili-accent)" : "2px solid transparent",
                            borderRight:  !isActive ? "1px solid rgba(255,255,255,0.04)" : "none",
                            color:        isActive ? "#e8edf2" : isHovered ? "#8899aa" : "#4a5568",
                            transition:   "color 0.1s, background 0.1s",
                            flexShrink:   0,
                            boxSizing:    "border-box",
                        }}
                    >
                        {Icon && <Icon size={iconSize} />}

                        {editingId === tab.id
                            ? (
                                <input
                                    autoFocus
                                    value={editVal}
                                    onChange={e => setEditVal(e.target.value)}
                                    onBlur={commitEdit}
                                    onKeyDown={e => {
                                        if (e.key === "Enter")  commitEdit()
                                        if (e.key === "Escape") { setEditingId(null); setEditVal("") }
                                        e.stopPropagation()
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    style={{
                                        background: "transparent", border: "none", outline: "none",
                                        color: "#e8edf2", fontSize: 11, fontFamily: "inherit",
                                        flex: 1, width: 0, padding: 0,
                                    }}
                                />
                            )
                            : (
                                <span style={{
                                    fontSize:     11,
                                    fontWeight:   isActive ? 500 : 400,
                                    overflow:     "hidden",
                                    textOverflow: "ellipsis",
                                    whiteSpace:   "nowrap",
                                    flex:         1,
                                }}>
                                    {tab.label}
                                </span>
                            )
                        }

                        {showX && (
                            <button
                                onClick={e => { e.stopPropagation(); onClose(tab.id) }}
                                style={{
                                    background: "none", border: "none", color: "inherit",
                                    cursor: "pointer", fontSize: 14, lineHeight: 1,
                                    padding: "0 0 0 2px", opacity: 0.55, flexShrink: 0,
                                    display: "flex", alignItems: "center",
                                }}
                            >
                                ×
                            </button>
                        )}
                    </div>
                )
            })}

            {/* New tab (+) button */}
            {onNew && (
                <button
                    onClick={onNew}
                    onMouseEnter={e => e.currentTarget.style.color = "#8899aa"}
                    onMouseLeave={e => e.currentTarget.style.color = "#4a5568"}
                    style={{
                        width: height >= 32 ? 32 : 28,
                        height,
                        display:        "flex",
                        alignItems:     "center",
                        justifyContent: "center",
                        background:     "none",
                        border:         "none",
                        color:          "#4a5568",
                        cursor:         "pointer",
                        fontSize:       16,
                        flexShrink:     0,
                        transition:     "color 0.1s",
                    }}
                >
                    +
                </button>
            )}
        </div>
    )
}
