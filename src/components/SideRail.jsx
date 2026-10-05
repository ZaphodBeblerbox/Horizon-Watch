import { WATCH_MODULES, WORK_MODULES } from "../data/modules.js"
import { useChrome } from "../state/useChrome.js"

/**
 * SideRail.jsx — the modules, down the left edge.
 *
 * WHY THE RAIL MOVED OFF THE TOP BAR. The modules used to be eight 62px
 * buttons laid across the top, which cost a full 40px band of vertical
 * space on every screen — and vertical space is the scarce one here, since
 * every destination in this app is a list, a map or a document, and all
 * three are taller than they are wide. Down the side the same eight fit in
 * 48px of horizontal room that the map was already wasting on its own
 * margins, and the top bar is freed for the things that genuinely belong
 * to the whole session rather than to one module: the clock, search, and
 * the theater you are looking at.
 *
 * ICONS CARRY THE LABEL, NOT A WORD UNDER IT. At 62px wide the old
 * buttons could afford "Analytics" underneath; at 48px they cannot, and a
 * truncated word is worse than none. The label is the `title`, so it is
 * one hover away and screen readers always have it.
 *
 * THE ORDER IS THE REGISTRY'S ORDER. Nothing here re-sorts or re-groups
 * modules: the rail renders `set`-filtered MODULES exactly as data/modules.js
 * declares them, so adding a module is a one-line change there and never a
 * change here.
 */
export default function SideRail({
    activeModule,
    onSelectModule,
    mode = "watch",
    inboxCount = 0,
    onOpenSettings = null,
    onOpenAccount = null,
    feedsOk = true,
    feedsLabel = "",
}) {
    const modules = mode === "work" ? WORK_MODULES : WATCH_MODULES
    const [layersOpen, toggleLayers] = useChrome("leftPanel")
    const [inspectorOpen, toggleInspector] = useChrome("rightPanel")
    const showTools = activeModule === "situation"

    return (
        <nav
            aria-label="Modules"
            style={{
                width: 48, flexShrink: 0, display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, padding: "6px 0 8px",
                background: "var(--bg-2)", borderRight: "1px solid var(--line)",
                fontFamily: "var(--font)",
            }}
        >
            {modules.map((m) => {
                const active = activeModule === m.key
                return (
                    <button
                        key={m.key}
                        role="tab"
                        aria-selected={active}
                        aria-label={m.label}
                        title={m.label}
                        onClick={() => onSelectModule(m.key)}
                        style={{
                            position: "relative", width: 38, height: 34, flexShrink: 0,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            border: "none", borderRadius: "var(--r)",
                            // The active mark is a left bar, not a fill: in a
                            // narrow column a filled block reads as a button
                            // that is stuck down, while a bar reads as "you
                            // are here" and leaves the icon itself legible.
                            background: active ? "var(--bg-4)" : "transparent",
                            color: active ? "var(--txt)" : "var(--txt-3)",
                            cursor: "pointer",
                            transition: "background 100ms linear, color 100ms linear",
                        }}
                        onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--txt)" } }}
                        onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--txt-3)" } }}
                    >
                        {active && (
                            <span aria-hidden style={{
                                position: "absolute", left: -5, top: 6, bottom: 6,
                                width: 2, background: "var(--acc-hi)", borderRadius: 1,
                            }} />
                        )}
                        <svg className="icon" style={{ width: 17, height: 17 }}><use href={`#${m.icon}`} /></svg>
                        {/* The Inbox's own unread count, not the notification
                            tray's — they are different questions and were
                            once the same number. */}
                        {m.key === "inbox" && inboxCount > 0 && (
                            <span style={{
                                position: "absolute", top: 2, right: 2, minWidth: 12, height: 12,
                                borderRadius: "50%", background: "var(--red)", color: "var(--btn-primary-text)",
                                font: "400 8.5px var(--mono)", display: "flex", alignItems: "center",
                                justifyContent: "center", lineHeight: 1, padding: "0 2px",
                            }}>
                                {inboxCount > 99 ? "99+" : inboxCount}
                            </span>
                        )}
                    </button>
                )
            })}

            {/* ── Tools ─────────────────────────────────────────────────
                Where the map's own panes are opened from. They used to be
                reachable only by clicking a word turned on its side against
                the window edge once you had already minimised it — a
                control that could only be found by someone who did not
                need it. State is the same persisted per-user chrome
                setting the panes themselves read, so the button and the
                pane can never disagree. Only shown for the map, because
                these panes belong to it. */}
            {showTools && (
                <>
                    <span aria-hidden style={{
                        width: 22, height: 1, background: "var(--line-strong)",
                        margin: "6px 0", flexShrink: 0,
                    }} />
                    {[["Layers", "i-layers", layersOpen, toggleLayers],
                      ["Inspector", "i-inspector", inspectorOpen, toggleInspector]].map(([label, icon, on, toggle]) => (
                        <button
                            key={label} aria-label={label} title={label} aria-pressed={on}
                            onClick={toggle}
                            style={{
                                width: 38, height: 34, flexShrink: 0, display: "flex",
                                alignItems: "center", justifyContent: "center", border: "none",
                                borderRadius: "var(--r)", cursor: "pointer",
                                background: on ? "var(--bg-4)" : "transparent",
                                color: on ? "var(--txt)" : "var(--txt-3)",
                            }}
                            onMouseEnter={(e) => { if (!on) { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--txt)" } }}
                            onMouseLeave={(e) => { if (!on) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--txt-3)" } }}
                        >
                            <svg className="icon" style={{ width: 17, height: 17 }}><use href={`#${icon}`} /></svg>
                        </button>
                    ))}
                </>
            )}

            <div style={{ flex: 1 }} />

            {onOpenSettings && (
                <button
                    aria-label="Settings" title="Settings"
                    onClick={onOpenSettings}
                    style={{
                        width: 38, height: 34, flexShrink: 0, display: "flex",
                        alignItems: "center", justifyContent: "center", border: "none",
                        background: "transparent", color: "var(--txt-3)", cursor: "pointer",
                        borderRadius: "var(--r)",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-3)"; e.currentTarget.style.color = "var(--txt)" }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--txt-3)" }}
                >
                    <svg className="icon" style={{ width: 16, height: 16 }}><use href="#i-settings" /></svg>
                </button>
            )}

            {/* Feed health, as one dot. The full status lives in Settings →
                Health; this is only ever "is anything coming in", which is
                the question you ask at a glance and the reason it is a dot
                and not a sentence. */}
            <span
                title={feedsLabel || (feedsOk ? "Feeds live" : "Feeds degraded")}
                aria-label={feedsLabel || (feedsOk ? "Feeds live" : "Feeds degraded")}
                style={{
                    width: 7, height: 7, borderRadius: "50%", marginTop: 6, flexShrink: 0,
                    background: feedsOk ? "var(--green)" : "var(--amber)",
                }}
            />
        </nav>
    )
}
