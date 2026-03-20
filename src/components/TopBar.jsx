import { useState, useEffect } from "react"
import TabBar from "./TabBar.jsx"
import Logo from "./Logo.jsx"

function IconExpand() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="1,6 1,1 6,1"/>
            <polyline points="10,1 15,1 15,6"/>
            <polyline points="15,10 15,15 10,15"/>
            <polyline points="6,15 1,15 1,10"/>
        </svg>
    )
}

function IconCompress() {
    return (
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6,1 6,6 1,6"/>
            <polyline points="10,1 10,6 15,6"/>
            <polyline points="15,10 10,10 10,15"/>
            <polyline points="1,10 6,10 6,15"/>
        </svg>
    )
}

export default function TopBar({
    tabs        = [],
    activeTabId = null,
    onTabSwitch,
    onTabClose,
    onTabNew,
    onTabReorder,
    onTabRename,
}) {
    const [time,       setTime]       = useState(new Date())
    const [fullscreen, setFullscreen] = useState(false)
    const [fsHover,    setFsHover]    = useState(false)

    useEffect(() => {
        const t = setInterval(() => setTime(new Date()), 1000)
        return () => clearInterval(t)
    }, [])

    // Sync fullscreen state with browser events
    useEffect(() => {
        const handler = () => setFullscreen(!!document.fullscreenElement)
        document.addEventListener("fullscreenchange", handler)
        return () => document.removeEventListener("fullscreenchange", handler)
    }, [])

    // F key shortcut
    useEffect(() => {
        const handler = (e) => {
            if (e.key !== "f" && e.key !== "F") return
            // Don't trigger when typing in an input
            const tag = document.activeElement?.tagName
            if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
            toggleFullscreen()
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [fullscreen]) // eslint-disable-line react-hooks/exhaustive-deps

    function toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {})
        } else {
            document.exitFullscreen().catch(() => {})
        }
    }

    const utc   = time.toUTCString()
    const clock = utc.slice(17, 22) + " UTC"

    return (
        <div style={{
            height:       40,
            flexShrink:   0,
            background:   "linear-gradient(180deg, #0d1119 0%, var(--akili-surface) 100%)",
            borderBottom: "1px solid var(--akili-border)",
            display:      "flex",
            alignItems:   "stretch",
            zIndex:       100,
            boxSizing:    "border-box",
            fontFamily:   "system-ui, -apple-system, sans-serif",
        }}>

            {/* Left: Logo + wordmark */}
            <div style={{
                flexShrink:   0,
                display:      "flex",
                alignItems:   "center",
                gap:          9,
                paddingLeft:  12,
                paddingRight: 14,
                userSelect:   "none",
                borderRight:  "1px solid rgba(255,255,255,0.06)",
                minWidth:     172,
            }}>
                <Logo size={48} />
                <div style={{ display: "flex", flexDirection: "column", lineHeight: 1 }}>
                    <span style={{
                        fontFamily:    "system-ui, -apple-system, sans-serif",
                        fontWeight:    800,
                        fontSize:      11,
                        letterSpacing: "0.2em",
                        color:         "var(--akili-text-primary)",
                    }}>
                        HORIZON WATCH
                    </span>
                    <span style={{
                        fontFamily:    "monospace",
                        fontSize:      8,
                        letterSpacing: "0.12em",
                        color:         "rgba(26,110,181,0.65)",
                        marginTop:     2,
                    }}>
                        by Trifecta Technologies
                    </span>
                </div>
            </div>

            {/* Centre: Tab bar — fills remaining space */}
            <TabBar
                tabs={tabs}
                activeTabId={activeTabId}
                height={32}
                iconSize={14}
                onSwitch={onTabSwitch}
                onClose={onTabClose}
                onNew={onTabNew}
                onReorder={onTabReorder}
                onRename={onTabRename}
                canClose={tab => tab.type !== "map"}
            />

            {/* Right: fullscreen button + clock */}
            <div style={{
                display:      "flex",
                alignItems:   "center",
                flexShrink:   0,
                borderLeft:   "1px solid rgba(255,255,255,0.06)",
            }}>
                {/* Fullscreen toggle */}
                <button
                    onClick={toggleFullscreen}
                    onMouseEnter={() => setFsHover(true)}
                    onMouseLeave={() => setFsHover(false)}
                    title={fullscreen ? "Exit fullscreen (F)" : "Enter fullscreen (F)"}
                    style={{
                        width:      36,
                        height:     "100%",
                        display:    "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "none",
                        border:     "none",
                        cursor:     "pointer",
                        color:      fsHover ? "var(--akili-text-secondary)" : "var(--akili-text-muted)",
                        transition: "color 0.12s",
                        flexShrink: 0,
                    }}
                >
                    {fullscreen ? <IconCompress /> : <IconExpand />}
                </button>

                {/* UTC Clock */}
                <div style={{
                    display:      "flex",
                    alignItems:   "center",
                    paddingLeft:  8,
                    paddingRight: 16,
                    borderLeft:   "1px solid rgba(255,255,255,0.06)",
                }}>
                    <span style={{
                        fontSize:           11,
                        color:              "var(--akili-text-muted)",
                        fontVariantNumeric: "tabular-nums",
                        fontFamily:         "monospace",
                        letterSpacing:      "0.04em",
                        whiteSpace:         "nowrap",
                    }}>
                        {clock}
                    </span>
                </div>
            </div>
        </div>
    )
}
