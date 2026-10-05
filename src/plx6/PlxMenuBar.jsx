/**
 * PlxMenuBar.jsx — PARALLAX v6 Part A2.2 / Part B ▣ Menu bar.
 *
 * left 48, top 40, right 0, height 34, z-index 39. It starts at 48 because
 * the rail occupies that column from top 40 down; the two never overlap.
 *
 * WHY A MENU BAR AT ALL, in 2026. Because the alternative this app had was
 * a scattering of icon buttons whose meaning you learned by clicking them.
 * File/Edit/View/Support is the one navigation idiom every user already
 * knows, it costs 34px, and it gives every command a findable home with its
 * keyboard shortcut printed next to it.
 *
 * The centre block names the current file and makes it clickable — the
 * title is the file switcher, which is where people look for it.
 */
import PlxIcon from "./PlxIcon.jsx"

const ON = "var(--accdim)"
const OFF = "transparent"

const MENUS = [["File", "file"], ["Edit", "edit"], ["View", "view"], ["Support", "support"]]

export default function PlxMenuBar({
    narrow = false,
    menu = null,
    onMenu = () => {},
    savedAt = "",
    starred = false,
    onStar = () => {},
    curIcon = "#g-globe",
    curTitle = "Red Sea watch",
    onTitle = () => {},
    // Who else is signed in right now (useOnlineUsers). This defaulted to
    // three invented colleagues; empty means nobody else is on.
    presence = [],
    onShare = () => {},
    classification = "INTERNAL // RISK",
    clock = "",
    busy = false,
    onRefresh = () => {},
}) {
    const wide = narrow ? "none" : "inline"
    const wideFlex = narrow ? "none" : "flex"

    return (
        <div
            data-tour="menu" data-screen-label="Menu bar"
            style={{
                position: "absolute", left: 48, right: 0, top: 40, height: 34,
                display: "flex", alignItems: "center", gap: 2, padding: "0 8px 0 6px",
                background: "var(--bar)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                borderBottom: "1px solid var(--gline)", zIndex: 39, whiteSpace: "nowrap",
            }}
        >
            {MENUS.map(([k, v]) => (
                <button
                    key={v} onClick={(e) => onMenu(v, e)}
                    style={{
                        height: 26, padding: "0 9px", border: 0,
                        background: menu === v ? ON : OFF, color: "var(--txt)",
                        font: "inherit", cursor: "pointer", borderRadius: 0,
                    }}
                    onMouseEnter={(e) => { if (menu !== v) e.currentTarget.style.background = "var(--hov)" }}
                    onMouseLeave={(e) => { if (menu !== v) e.currentTarget.style.background = OFF }}
                >{k}</button>
            ))}

            <span style={{ width: 1, height: 16, background: "var(--gline2)", margin: "0 8px" }} />

            <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--txt3)" }}>
                <span style={{ color: "var(--acchi)" }}>✓</span>
                {`Saved ${savedAt || clock}`}
            </span>

            <div style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <button
                        onClick={onStar} title="Favourite"
                        style={{
                            border: 0, background: OFF, padding: "0 2px", fontSize: 14,
                            cursor: "pointer",
                            color: starred ? "var(--acchi)" : "var(--txt3)",
                        }}
                    >{starred ? "★" : "☆"}</button>
                    <PlxIcon href={curIcon} size={14} style={{ flex: "none", color: "var(--txt3)" }} />
                    <button
                        onClick={onTitle}
                        style={{
                            display: "flex", alignItems: "center", gap: 6, minWidth: 0,
                            overflow: "hidden", border: 0, background: OFF,
                            color: "var(--txt)", font: "inherit", fontWeight: 600,
                            textOverflow: "ellipsis", cursor: "pointer",
                        }}
                    >
                        {curTitle}
                        <span style={{ color: "var(--txt4)", fontWeight: 400 }}>▾</span>
                    </button>
                </div>
            </div>

            <div style={{ display: wideFlex, alignItems: "center", paddingLeft: 6, marginRight: 6 }}>
                {presence.slice(0, 4).map(([name, i, bg]) => (
                    <span key={name} title={`${name} · online now`} style={{
                        width: 22, height: 22, marginLeft: -5, display: "flex",
                        alignItems: "center", justifyContent: "center", borderRadius: 0,
                        background: bg, color: "var(--mz-cream)",
                        border: "1.5px solid var(--canvas)",
                        fontSize: 9, fontWeight: 600,
                    }}>{i}</span>
                ))}
                {presence.length > 4 && (
                    <span title={presence.slice(4).map(([n]) => n).join(", ")}
                          style={{ marginLeft: 4, font: "500 10px var(--mz-font-mono)", color: "var(--txt3)" }}>
                        +{presence.length - 4}
                    </span>
                )}
            </div>

            <button
                onClick={onShare}
                style={{
                    height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
                    background: OFF, color: "var(--txt)", font: "inherit",
                    cursor: "pointer", borderRadius: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hov)" }}
                onMouseLeave={(e) => { e.currentTarget.style.background = OFF }}
            >Share</button>

            <span style={{
                display: wide, fontFamily: "var(--mz-font-mono)", fontSize: 10,
                letterSpacing: ".08em", color: "var(--txt2)",
                border: "1px solid var(--gline2)", borderRadius: 0,
                padding: "4px 7px", marginLeft: 6,
            }}>{classification}</span>

            <span
                title={busy ? "Loading…" : "Connected · all feeds live"}
                style={{
                    display: "flex", alignItems: "center", gap: 6, marginLeft: 8,
                    fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt2)",
                }}
            >
                {busy
                    ? <span style={{ display: "flex", width: 14, height: 14, color: "var(--acchi)" }}>
                          <svg viewBox="0 0 24 24" width="100%" height="100%" style={{ overflow: "visible", display: "block" }}>
                              <path d="M4 4 L15 20 M15 4 L4 20" stroke="currentColor" fill="none" strokeWidth="2.2" strokeLinecap="butt" />
                              <path d="M19 4 L13.5 12" stroke="var(--acchi)" fill="none" strokeWidth="2.2"
                                    style={{ animation: "plx-e1 1.6s cubic-bezier(.22,.61,.36,1) infinite" }} />
                              <path d="M23 4 L20.25 8" stroke="var(--acchi)" fill="none" strokeWidth="2.2"
                                    style={{ animation: "plx-e2 1.6s cubic-bezier(.22,.61,.36,1) infinite" }} />
                          </svg>
                      </span>
                    : <i style={{ width: 6, height: 6, flex: "none", borderRadius: "50%", background: "var(--green)" }} />}
                {clock}
            </span>

            <button
                onClick={onRefresh} title="Refresh feeds"
                style={{
                    width: 28, height: 26, border: 0, background: OFF,
                    color: "var(--txt3)", fontSize: 14, cursor: "pointer", borderRadius: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hov)"; e.currentTarget.style.color = "var(--txt)" }}
                onMouseLeave={(e) => { e.currentTarget.style.background = OFF; e.currentTarget.style.color = "var(--txt3)" }}
            >↻</button>
        </div>
    )
}
