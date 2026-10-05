import { Wordmark, Glyph } from "../ui/Wordmark.jsx"
import Freshness from "./Freshness.jsx"
import { useState, useEffect } from "react"
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
    sessionControl = null,
    unreadCount = 0,
    inboxCount = 0,
    dataUpdatedAt = null,
    systemHealth = { status: "operational", detail: "ALL FEEDS LIVE" },
    onOpenPalette,
    mode = "watch",
    onToggleMode = null,
    onOpenSettings = null,
    onOpenTray = null,
    onScreenshot = null,
}) {
    // Mode, not modules (§7.1) — the rendered rail set is filtered off one
    // real registry field (data/modules.js's `set`), re-derived fresh every
    // render from current `mode` — never patched/re-applied after the fact.
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
                <div className="brand">
                    <Glyph />
                    <Wordmark />
                </div>
                <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)",
                               whiteSpace: "nowrap" }}>
                    ops console {typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : ""}
                </span>
            </div>

            {/* THE MODULE RAIL LEFT THIS BAR. It is now a 48px column down
                the left edge (components/SideRail.jsx) — eight 62px buttons
                across the top cost a full band of vertical height on every
                screen, and height is the scarce axis for a list, a map or a
                document alike. What stays here is what belongs to the whole
                session rather than to one module. */}

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
                {/* How old is what you are looking at. The status bar is
                    gone and this is the one fact it carried that a reader
                    needs (v4.3 §2). */}
                <Freshness updatedAt={dataUpdatedAt} />

                {/* The bell is the notification TRAY trigger (spec §1.1), not
                    a second route into the Inbox — the rail already goes
                    there, and two controls for one destination is how a bell
                    ends up meaning nothing. The tray is the record of what
                    arrived; the Inbox is the working surface. */}
                <button
                    onClick={() => (onOpenTray ? onOpenTray() : onSelectModule("inbox"))}
                    title="Notifications"
                    aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
                    style={{
                        position: "relative",
                        width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                        background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                    }}
                >
                    <svg className="icon sm"><use href="#i-bell" /></svg>
                    {unreadCount > 0 && (
                        <span className="nbadge" style={{
                            position: "absolute", top: 1, right: 0, minWidth: 13, height: 13,
                            padding: "0 3px", background: "var(--red)", color: "#fff",
                            font: "9px var(--mono)", display: "grid", placeItems: "center",
                            borderRadius: 7,
                        }}>{unreadCount > 99 ? "99+" : unreadCount}</span>
                    )}
                </button>
                {/* THE TOOLS THAT ACT ON WHAT YOU ARE LOOKING AT, in one
                    cluster with the map's own controls rather than scattered
                    along the bar. Screenshot was keyboard-only (⌘⇧4), which
                    means it existed only for people who already knew it did.

                    Fullscreen is gone entirely. On the desktop build the app
                    is already its own window, and in a WKWebView the browser
                    fullscreen API hides the traffic lights with no reliable
                    way back; on the web the OS and the browser both already
                    offer it. A third control for it earned nothing. */}
                {onScreenshot && (
                    <button
                        onClick={onScreenshot}
                        title="Screenshot (⌘⇧4) — crop it and save to a case or document"
                        style={{
                            width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                            background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                        }}
                    >
                        <svg className="icon sm"><use href="#i-crop" /></svg>
                    </button>
                )}
                {/* WHERE THE MAP'S OWN TOOLS GO. Situation portals its
                    layer toggles, export and camera presets in here, so
                    they sit in the chrome instead of floating over the
                    geography they are for. A slot rather than props:
                    the controls need Situation's state, and threading that
                    up through app.jsx to come back down again would make
                    two components own one toolbar. */}
                <div id="topbar-map-tools" style={{ display: "flex", alignItems: "center", gap: 2 }} />

                {/* Moved off the tab strip when that row was removed —
                    session mode is a top-level control, not a tab. */}
                {sessionControl}
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
                    title="Search (⌘K)"
                    style={{
                        display: "flex", alignItems: "center", gap: 8, width: 260, height: 26,
                        padding: "0 8px", background: "var(--bg-0)", border: "1px solid var(--line)",
                        borderRadius: "var(--r)", color: "var(--txt-4)", cursor: "pointer", font: "400 12px var(--font)",
                    }}
                >
                    <svg className="icon sm"><use href="#i-search" /></svg>
                    <span style={{ flex: 1, textAlign: "left" }}>Search</span>
                    <span style={{
                        font: "400 10px var(--mono)", color: "var(--txt-3)", border: "1px solid var(--line-strong)",
                        borderRadius: "var(--r)", padding: "0 4px",
                    }}>⌘K</span>
                </button>

                {/* THE HEALTH WORD IS GONE. It read DEGRADED whenever any
                    one feed of fifteen was stale, which is most of the
                    time and almost never something to act on — so it
                    trained people to ignore a status light, which is the
                    one thing a status light must not do. Feed state lives
                    in the health panel, where which feed and how stale can
                    actually be read. */}

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
