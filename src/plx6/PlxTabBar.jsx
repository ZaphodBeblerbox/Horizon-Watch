/**
 * PlxTabBar.jsx — PARALLAX v6 Part A2.1 / Part B ▣ Tab bar.
 *
 * top 0, left 0, right 0, height 40, z-index 40. Glass, with a 1px
 * var(--gline) bottom border.
 *
 * WHAT A TAB IS HERE. Not a document and not a mode — a THEATER. Each tab
 * is a region you watch, carrying its own severity dot, its own count of
 * active scan areas, and its own default view. The modes (map, inbox,
 * reports…) live on the rail and operate *inside* whichever theater is
 * selected. Conflating the two is what made the old tab strip grow a tab
 * every time someone opened a panel.
 *
 * THE DAY/NIGHT DIAL IS NOT DECORATION. It shows, at a glance, whether
 * the theme is following the clock and where in the day the setup's
 * timezone currently is: the inner group rotates `dnRot` degrees so the
 * sun is up by day and the moon by night. Clicking cycles
 * auto → light → dark.
 */
import PlxIcon from "./PlxIcon.jsx"
import PlxWordmark from "./PlxWordmark.jsx"

const ON = "var(--accdim)"
const OFF = "transparent"
const SEV = { critical: "var(--red)", elevated: "var(--amber)", steady: "var(--steel)" }

export default function PlxTabBar({
    narrow = false,
    tabs = [],
    favourites = null,
    activeTab = null,
    onTab = () => {},
    onCloseTab = () => {},
    onAddTab = () => {},
    onEditTab = null,
    onHome = () => {},
    onSearch = () => {},
    searchSlot = null,
    onFiles = () => {},
    chatOpen = false,
    onChat = () => {},
    // NOT 4. This defaulted to a literal 4, so every screenshot and every
    // fresh account showed four unread messages that did not exist. An
    // unknown count shows nothing.
    chatCount = "",
    themeMode = "auto",
    hour = 12,
    onCycleTheme = () => {},
    alertsOpen = false,
    onAlerts = () => {},
    alertCount = 0,
}) {
    const wide = narrow ? "none" : "inline"
    const isDay = hour >= 7 && hour < 19
    const rot = themeMode === "light" ? 0
        : themeMode === "dark" ? 180
        : Math.round((hour - 12) * 15 * 10) / 10
    const dnMode = { auto: "AUTO", light: "DAY", dark: "NIGHT" }[themeMode] || "AUTO"
    const next = { auto: "light", light: "dark", dark: "auto" }[themeMode] || "light"
    const hh = String(Math.floor(hour)).padStart(2, "0") + ":" + String(Math.floor((hour % 1) * 60)).padStart(2, "0")
    const dnTitle = (themeMode === "auto"
        ? `Automatic · ${isDay ? "day" : "night"} at ${hh} · switches 07:00 and 19:00`
        : `${themeMode === "light" ? "Light" : "Dark"} theme`)
        + `. Click for ${{ auto: "automatic", light: "light", dark: "dark" }[next]}.`

    const hoverable = (el, on = "var(--hov)") => ({
        onMouseEnter: (e) => { e.currentTarget.style.background = on },
        onMouseLeave: (e) => { e.currentTarget.style.background = el },
    })

    return (
        <header
            data-tour="tabs" data-screen-label="Tab bar"
            style={{
                position: "absolute", left: 0, right: 0, top: 0, height: 40,
                display: "flex", alignItems: "center", gap: 8, paddingRight: 8,
                background: "var(--bar)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                borderBottom: "1px solid var(--gline)", zIndex: 40,
            }}
        >
            <button
                onClick={onHome} title="Parallax · Home"
                style={{
                    display: "flex", alignItems: "center", gap: 10, height: 40,
                    padding: "0 14px 0 13px", flex: "none", border: 0,
                    borderRight: "1px solid var(--gline)", background: OFF,
                    color: "var(--txt)", cursor: "pointer",
                }}
                {...hoverable(OFF)}
            >
                <span style={{ display: "flex", width: 94, height: 13 }}><PlxWordmark /></span>
            </button>

            {/* The search box itself, not a button that opens one. */}
            {searchSlot}

            {/* The "All files" button that sat here is gone: it wore a
                layers-like glyph and opened the command palette — the same
                thing as the search box beside it. Case files are on the
                rail's folder icon. */}

            <nav style={{
                display: "flex", alignItems: "stretch", height: 40,
                minWidth: 0, flex: 1, overflow: "hidden",
                borderLeft: "1px solid var(--gline)",
            }}>
                {/* GLOBAL: always first, never stored — the whole world, with
                    whatever layers are on (the owner, 2026-10-07: a theater
                    mode that is not stuck to one region). */}
                <div onClick={() => onTab("global")} title="Global — the whole world" data-tour="global-theater"
                    style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "0 12px", flex: "none",
                        boxSizing: "border-box", margin: "5px 2px", borderRadius: 0,
                        background: activeTab === "global" ? ON : OFF,
                        color: activeTab === "global" ? "var(--txt)" : "var(--txt3)", cursor: "pointer",
                    }}
                    {...hoverable(activeTab === "global" ? ON : OFF)}>
                    <PlxIcon href="#g-globe" size={13} />
                    <span style={{ whiteSpace: "nowrap", fontSize: 13 }}>Global</span>
                </div>
                {tabs.map((t) => {
                    const on = t.id === activeTab
                    return (
                        <div
                            key={t.id} onClick={() => onTab(t.id)}
                            /* DOUBLE-CLICK EDITS IT, which is where anybody
                               who has used a browser or a spreadsheet will
                               try first. The ✕ removes it; there is no
                               third control competing for the 18px left. */
                            onDoubleClick={(e) => { if (onEditTab) { e.stopPropagation(); onEditTab(t.id) } }}
                            title={onEditTab ? `${t.name} — double-click to edit` : t.name}
                            style={{
                                display: "flex", alignItems: "center", gap: 8,
                                padding: "0 6px 0 12px", flex: "0 1 220px", minWidth: 110,
                                boxSizing: "border-box", margin: "5px 2px", borderRadius: 0,
                                background: on ? ON : OFF,
                                color: on ? "var(--txt)" : "var(--txt3)", cursor: "pointer",
                            }}
                            {...hoverable(on ? ON : OFF)}
                        >
                            <i style={{
                                width: 7, height: 7, flex: "none",
                                background: SEV[t.sev] || "var(--txt3)",
                            }} />
                            <span style={{
                                flex: 1, minWidth: 0, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap",
                                fontWeight: on ? 600 : 400,
                            }}>{t.name}</span>
                            {favourites?.has?.(t.id) && (
                                <span title="Favourite — pinned first" style={{ color: "var(--acchi)", fontSize: 11 }}>★</span>
                            )}
                            <span style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                color: "var(--txt4)",
                            }}>{t.n}</span>
                            <button
                                title="Remove this theater"
                                onClick={(e) => { e.stopPropagation(); onCloseTab(t.id) }}
                                style={{
                                    width: 18, height: 18, flex: "none", padding: 0, border: 0,
                                    background: OFF, color: "var(--txt4)", fontSize: 10,
                                    cursor: "pointer", borderRadius: 0,
                                }}
                            >✕</button>
                        </div>
                    )
                })}
                {/* A new account starts with no theaters: it chooses its own. */}
                {tabs.length === 0 && (
                    <button onClick={onAddTab} data-tour="first-theater" style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "0 14px", border: 0,
                        background: "var(--accdim)", color: "var(--txt)", font: "inherit", fontSize: 13,
                        cursor: "pointer", whiteSpace: "nowrap", borderRadius: 0,
                    }}><PlxIcon href="#g-plus" size={13} />Create your first theater — the region you watch</button>
                )}
                <button
                    onClick={onAddTab} title="New theater"
                    style={{
                        display: tabs.length === 0 ? "none" : "flex",
                        width: 34, flex: "none", alignItems: "center",
                        justifyContent: "center", border: 0, background: OFF,
                        color: "var(--txt3)", cursor: "pointer",
                    }}
                >
                    <PlxIcon href="#g-plus" size={14} />
                </button>
            </nav>

            <button
                onClick={onChat} title="Messages"
                style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 1, width: 36, height: 36, border: 0,
                    background: chatOpen ? ON : OFF, color: "var(--txt2)",
                    cursor: "pointer", borderRadius: 0,
                }}
            >
                <PlxIcon href="#g-comment" size={15} />
                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 9, lineHeight: 1 }}>{chatCount}</span>
            </button>

            <button
                onClick={() => onCycleTheme(next)} title={dnTitle}
                style={{
                    position: "relative", display: "flex", flexDirection: "column",
                    alignItems: "center", justifyContent: "center", gap: 1,
                    width: 40, height: 36, flex: "none", border: 0, background: OFF,
                    color: "var(--txt2)", cursor: "pointer", borderRadius: 0,
                }}
                {...hoverable(OFF)}
            >
                <svg width="26" height="16" viewBox="2 5 20 11" fill="none" style={{ overflow: "hidden" }}>
                    <defs><clipPath id="plx-dn-ap"><path d="M3 15a9 9 0 0118 0z" /></clipPath></defs>
                    <g clipPath="url(#plx-dn-ap)">
                        <g style={{
                            transform: `rotate(${rot}deg)`, transformOrigin: "12px 15px",
                            transition: "transform 900ms var(--mz-ease)",
                        }}>
                            <path d="M3 15a9 9 0 0118 0z" fill="var(--mz-sky)" />
                            <path d="M3 15a9 9 0 0018 0z" fill="var(--mz-navy)" />
                            <circle cx="12" cy="9.2" r="2.1" fill="var(--mz-orange)" />
                            <path d="M13.2 18.6a2.3 2.3 0 11-1.6 3.9a2.9 2.9 0 001.6-3.9z" fill="var(--mz-cream)" />
                            <circle cx="8.6" cy="21.4" r=".45" fill="var(--mz-cream)" />
                            <circle cx="15.8" cy="22.1" r=".35" fill="var(--mz-cream)" />
                        </g>
                    </g>
                    <path d="M3 15a9 9 0 0118 0" stroke="currentColor" strokeWidth="1" />
                    <path d="M2.5 15h19" stroke="currentColor" strokeWidth="1" />
                </svg>
                <span style={{
                    fontFamily: "var(--mz-font-mono)", fontSize: 7, letterSpacing: ".08em",
                    lineHeight: 1, color: "var(--txt3)",
                }}>{dnMode}</span>
            </button>

            <button
                data-tour="alerts" onClick={onAlerts} title="Alerts"
                style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    justifyContent: "center", gap: 1, width: 36, height: 36, border: 0,
                    background: alertsOpen ? ON : OFF, color: "var(--txt2)",
                    cursor: "pointer", borderRadius: 0,
                }}
            >
                <PlxIcon href="#g-bell" size={15} />
                <span style={{
                    fontFamily: "var(--mz-font-mono)", fontSize: 9, lineHeight: 1,
                    color: "var(--red)",
                }}>{alertCount || ""}</span>
            </button>
        </header>
    )
}
