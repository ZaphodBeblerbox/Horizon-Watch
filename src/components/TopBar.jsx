import { useState, useEffect } from "react"
import { WATCH_MODULES, WORK_MODULES } from "../data/modules.js"
import { STATUS_COLOR_TOKEN, STATUS_WORD } from "../utils/systemHealth.js"
import ThemeControl from "./ThemeControl.jsx"

/**
 * TopBar.jsx — redesign Round 2, §2. Replaces AppHeader.jsx entirely: a
 * real 40px top bar (--top token) with the brand block, the 7-module rail,
 * and the tools cluster. AppHeader.jsx's 5-destination model, Canonical-view
 * dropdown, and Tools flyout are NOT ported here — this round's module rail
 * supersedes the destination model, and the old per-feature toggles
 * (Overwatch/Director/Threats/Health/TV/Sound) live on with their existing
 * call sites in app.jsx until whichever later round actually rebuilds each
 * of those features' own screens; wiring them back into this new shell
 * without a real place to put them would just recreate the old flyout this
 * round is replacing.
 */
export default function TopBar({
    activeModule,
    onSelectModule,
    unreadCount = 0,
    systemHealth = { status: "operational", detail: "ALL FEEDS LIVE" },
    onOpenPalette,
    mode = "watch",
    onToggleMode = null,
    onOpenSettings = null,
}) {
    // Mode, not modules (§7.1) — the rendered rail set is filtered off one
    // real registry field (data/modules.js's `set`), re-derived fresh every
    // render from current `mode` — never patched/re-applied after the fact.
    const railModules = mode === "work" ? WORK_MODULES : WATCH_MODULES
    // Tools cluster, per §2, is deliberately narrower than the spec's literal
    // "new-tab, create-AOI, export, alerts" list — investigation found no
    // real generic "export the current view" or "create AOI" flow this
    // shell can wire to honestly yet (AOI creation exists only inside the
    // Intel destination's own Watch Areas flow, not as a global action).
    // Real actions only: new-tab opens the palette (same real action the
    // tab strip's own + control performs), alerts jumps to the real Inbox
    // module tab. The other two are omitted rather than faked.
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 1000)
        return () => clearInterval(t)
    }, [])
    const zulu = now.toUTCString().slice(17, 22) + "Z"
    const dateStr = now.toISOString().slice(0, 10)

    // Real Fullscreen API — state tracked via a real fullscreenchange
    // listener (not just toggled on click) so the icon stays correct if the
    // analyst exits fullscreen with Esc directly rather than the button.
    const [isFullscreen, setIsFullscreen] = useState(!!document.fullscreenElement)
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement)
        document.addEventListener("fullscreenchange", onChange)
        return () => document.removeEventListener("fullscreenchange", onChange)
    }, [])
    const toggleFullscreen = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {})
        } else {
            document.documentElement.requestFullscreen().catch(() => {})
        }
    }

    return (
        <div style={{
            height: "var(--top)", flexShrink: 0, background: "var(--bg-2)",
            display: "flex", alignItems: "stretch", fontFamily: "var(--font)",
        }}>
            {/* Brand block */}
            <div style={{
                width: 196, flexShrink: 0, display: "flex", alignItems: "center", gap: 8,
                padding: "0 12px", borderRight: "1px solid var(--line)",
            }}>
                <svg className="icon" style={{ width: 17, height: 17, color: "var(--txt-2)", flexShrink: 0 }}>
                    <use href="#i-globe" />
                </svg>
                <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <span style={{ font: "600 12.5px var(--font)", color: "var(--txt)", whiteSpace: "nowrap" }}>
                        Parallax
                    </span>
                    <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)", whiteSpace: "nowrap" }}>
                        v{typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : "—"}
                    </span>
                </div>
            </div>

            {/* Module rail — real set filtered by mode, with `hidden` modules
                excluded (PARALLAX spec §1.3). 8 in Watch, 4 in Workstation
                today; the spec's fifth work module, Register (asset
                register), has no destination in this codebase yet, so it is
                deliberately absent rather than a rail button pointing at
                nothing. */}
            <div style={{ display: "flex", alignItems: "stretch" }}>
                {railModules.map((m) => {
                    const active = activeModule === m.key
                    return (
                        <button
                            key={m.key}
                            role="tab"
                            aria-selected={active}
                            onClick={() => onSelectModule(m.key)}
                            title={m.label}
                            style={{
                                position: "relative", width: 62, display: "flex", flexDirection: "column",
                                alignItems: "center", justifyContent: "center", gap: 3,
                                background: active ? "var(--bg-0)" : "transparent", border: "none",
                                borderBottom: active ? "2px solid var(--acc-hi)" : "2px solid transparent",
                                color: active ? "var(--txt)" : "var(--txt-3)", cursor: "pointer",
                                transition: "background 100ms linear, color 100ms linear",
                            }}
                            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--txt)" } }}
                            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--txt-3)" } }}
                        >
                            <span style={{ position: "relative" }}>
                                <svg className="icon" style={{ width: 15, height: 15 }}><use href={`#${m.icon}`} /></svg>
                                {m.key === "inbox" && unreadCount > 0 && (
                                    <span style={{
                                        position: "absolute", top: -4, right: -8, minWidth: 12, height: 12,
                                        borderRadius: "50%", background: "var(--red)", color: "#fff",
                                        font: "400 8.5px var(--mono)", display: "flex", alignItems: "center",
                                        justifyContent: "center", lineHeight: 1, padding: "0 2px",
                                    }}>
                                        {unreadCount > 99 ? "99+" : unreadCount}
                                    </span>
                                )}
                            </span>
                            <span style={{ font: "400 10px var(--font)" }}>{m.label}</span>
                        </button>
                    )
                })}
            </div>

            {/* Tools cluster */}
            <div style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10,
                padding: "0 12px", borderLeft: "1px solid var(--line)",
            }}>
                {/* The standalone WATCH/WORK button that sat here is gone
                    (PARALLAX spec §1.2, and §21's checklist: "the top-right
                    button is gone"). A button among the tools implied
                    Workstation was a destination alongside them; it is not —
                    it replaces the entire rail. The control now lives in the
                    session popover at the left end of the tab strip, beside
                    the tabs, which are also workspace-scoped. The `W`
                    keyboard shortcut still toggles it. */}
                <button
                    onClick={onOpenPalette}
                    title="New tab"
                    style={{
                        width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                    }}
                >
                    <svg className="icon sm"><use href="#i-plus" /></svg>
                </button>
                <button
                    onClick={() => onSelectModule("inbox")}
                    title="Alerts"
                    style={{
                        width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                    }}
                >
                    <svg className="icon sm"><use href="#i-bell" /></svg>
                </button>
                <button
                    onClick={toggleFullscreen}
                    title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
                    style={{
                        width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                    }}
                >
                    <svg className="icon sm"><use href={isFullscreen ? "#i-fullscreen-exit" : "#i-fullscreen-enter"} /></svg>
                </button>
                <ThemeControl />
                {onOpenSettings && (
                    <button
                        onClick={onOpenSettings}
                        title="Settings"
                        style={{
                            width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                            background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                        }}
                    >
                        <svg className="icon sm"><use href="#i-settings" /></svg>
                    </button>
                )}

                <button
                    onClick={onOpenPalette}
                    title="Search signals, entities, reports (⌘K)"
                    style={{
                        display: "flex", alignItems: "center", gap: 8, width: 260, height: 26,
                        padding: "0 8px", background: "var(--bg-0)", border: "1px solid var(--line)",
                        borderRadius: "var(--r)", color: "var(--txt-4)", cursor: "pointer", font: "400 12px var(--font)",
                    }}
                >
                    <svg className="icon sm"><use href="#i-search" /></svg>
                    <span style={{ flex: 1, textAlign: "left" }}>Search signals, entities, reports</span>
                    <span style={{
                        font: "400 10px var(--mono)", color: "var(--txt-3)", border: "1px solid var(--line-strong)",
                        borderRadius: "var(--r)", padding: "0 4px",
                    }}>⌘K</span>
                </button>

                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{
                        width: 6, height: 6, borderRadius: "50%",
                        background: STATUS_COLOR_TOKEN[systemHealth.status] || STATUS_COLOR_TOKEN.operational,
                        flexShrink: 0,
                    }} />
                    <span style={{ font: "400 11px var(--font)", color: "var(--txt-2)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                        {STATUS_WORD[systemHealth.status] || STATUS_WORD.operational}
                    </span>
                </div>

                <span style={{ font: "400 11.5px var(--mono)", color: "var(--txt-2)" }}>
                    {zulu} <span style={{ color: "var(--txt-4)" }}>· {dateStr}</span>
                </span>

                <div style={{
                    width: 24, height: 24, borderRadius: "var(--r)", background: "var(--bg-3)",
                    border: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "center",
                    font: "600 10px var(--font)", color: "var(--txt-2)", flexShrink: 0,
                }}>
                    M
                </div>
            </div>
        </div>
    )
}
