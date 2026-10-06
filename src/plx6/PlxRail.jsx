/**
 * PlxRail.jsx — PARALLAX v6 Part A2.3 / Part B ▣ Rail.
 *
 * GEOMETRY IS NOT NEGOTIABLE HERE. left 0, top 40, bottom 0, width 48,
 * z-index 41. Every button is 36×34 with a 17×17 icon and square corners.
 * Those numbers are the spec's, and the rest of the layout is measured
 * from them: the content area starts at left 48 because the rail ends
 * there, and at top 84 because the tab bar (40) and menu bar (34) plus a
 * 10px gap sit above it.
 *
 * THREE GROUPS, TWO HAIRLINES. Modes, then tools, then files — divided by
 * 22×1 rules, not by whitespace, because at 48px wide a gap reads as a
 * missing button. Then a flexible spacer, the account avatar, help, and
 * the feed dot pinned to the bottom.
 *
 * Active is a background fill (var(--accdim)), not a left bar: the spec
 * states it, and at this width a bar steals pixels from the icon.
 */
import PlxIcon from "./PlxIcon.jsx"
import Avatar from "../ui/Avatar.jsx"

const ON = "var(--accdim)"
const OFF = "transparent"

/* A HUE PER MODULE (owner's call, 2026-10-05), so each place in the app is
   recognisable before its glyph is read. Mid-tone and muted so they read on
   the dark and the light bar alike, and never red or amber: those mean
   critical and elevated everywhere else on this screen. */
export const RAIL_HUE = {
    home: "#5B8DEF", map: "#2BB3A3", graph: "#9B7BE6", inbox: "#3FA7D6",
    desk: "#C08AD8", briefings: "#7F9CC4", analytics: "#4CAF7A", fusion: "#D16BA5",
    work: "#8FA3BF", layers: "#2BB3A3", imagery: "#7C9CE8", selection: "#9AA9BC",
    timeline: "#4CAF7A", files: "#8FA3BF", settings: "#9AA9BC", assets: "#C9A227",
}

/** The effective rail list — Part C marks `railModes` ▶ EFFECTIVE as the
 *  moreVals version: nine modes, Home first. */
export const RAIL_MODES = [
    ["home",      "Home · H",                                  "#g-home"],
    ["map",       "Map · M",                                   "#g-globe"],
    ["graph",     "Constellation · G",                         "#g-onto"],
    ["inbox",     "Inbox · I",                                 "#g-inbox"],
    /* The desk feed: what colleagues have published. Beside Inbox because
       the two answer the same shape of question — what has come in — one
       from the feeds and one from the people. */
    ["desk",      "Desk · what the team has seen",             "#g-feed"],
    ["briefings", "Reports · brief, deck, document · D",       "#g-report"],
    ["analytics", "Insight · changes, risk, forecast",         "#g-orb"],
    /* Asset register removed. It listed sources, not assets — the screen
       behind it was Sources.jsx, which is a feed inventory, so the rail
       entry promised a register of what you protect and opened something
       else entirely. The feed inventory is still reachable; it just is not
       pretending to be an asset register from the rail. */
    /* The asset register, back as what it says: the things this desk
       protects, and what is happening near each (destinations/Assets.jsx). */
    ["assets",    "Assets · what we protect",                  "#g-asset"],
    ["work",      "My work",                                   "#g-work"],
]

function RailButton({ label, icon, active, badge, onClick, hue = null }) {
    const ink = hue || "var(--acchi)"
    return (
        <button
            title={label} aria-label={label} aria-pressed={!!active}
            onClick={onClick}
            style={{
                position: "relative", display: "flex", alignItems: "center",
                justifyContent: "center", width: 36, height: 34, flex: "none",
                border: 0, background: active ? (hue ? `color-mix(in srgb, ${hue} 18%, transparent)` : ON) : OFF,
                // WHERE YOU ARE, AT A GLANCE. Active was a faint grey fill
                // that read as hover. Now: the accent on the icon and a 2px
                // bar on the inner edge — one hue for every module, because
                // red and amber already mean severity in this console and a
                // coloured icon per module would read as an alert.
                // Coloured always; brighter and barred when active.
                color: active ? ink : (hue || "var(--txt3)"),
                opacity: active || !hue ? 1 : 0.78,
                boxShadow: active ? `inset 2px 0 0 ${ink}` : "none",
                cursor: "pointer", borderRadius: 0,
            }}
            onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = "var(--hov)"; e.currentTarget.style.opacity = "1" } }}
            onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = OFF; e.currentTarget.style.opacity = hue ? "0.78" : "1" } }}
        >
            <PlxIcon href={icon} size={17} />
            {badge ? (
                <b style={{
                    position: "absolute", right: 2, bottom: 2,
                    font: "400 9px var(--mz-font-mono)", color: "var(--acchi)",
                }}>{badge}</b>
            ) : null}
        </button>
    )
}

const Rule = () => (
    <span aria-hidden style={{
        width: 22, height: 1, background: "var(--gline2)",
        margin: "6px 0", flex: "none",
    }} />
)

export default function PlxRail({
    mode = "home",
    onMode = () => {},
    left = null,
    onLeft = () => {},
    drawer = false,
    onDrawer = () => {},
    multiCount = 0,
    menu = null,
    onNewMenu = () => {},
    onSnapshot = () => {},
    onAccount = () => {},
    isSuperAdmin = false,
    onSettings = () => {},
    initials = "GU",
}) {
    // Reports stays lit while the document editor is open — they are one
    // surface with three tabs, not two destinations (A3).
    const isActive = (k) => mode === k || (k === "briefings" && mode === "dossier")

    // WHAT IS LIT IS WHAT IS ON SCREEN. Map data and Selection are panes
    // of the map; their open flags persist when you leave it, so on
    // Overwatch the rail lit Selection — a pane that was not showing.
    // Overwatch is a screen, so it is lit by the mode, like a module.
    const toolActive = (k) => k === "imagery" ? mode === "imagery" : (mode === "map" && left === k)

    const tools = [
        ["layers",    "Map data · L", "#g-layers", ""],
        ["imagery",   "Overwatch",    "#g-sat",    ""],
        ["selection", "Selection",    "#g-select", multiCount || ""],
    ]

    return (
        <aside
            data-tour="rail" data-screen-label="Rail" aria-label="Modes"
            style={{
                position: "absolute", left: 0, top: 40, bottom: 0, width: 48,
                boxSizing: "border-box", display: "flex", flexDirection: "column",
                alignItems: "center", gap: 2, padding: "8px 0 10px",
                background: "var(--bar)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                borderRight: "1px solid var(--gline)", zIndex: 41,
            }}
        >
            {RAIL_MODES.map(([k, label, icon]) => (
                <RailButton key={k} label={label} icon={icon} hue={RAIL_HUE[k]}
                            active={isActive(k)} onClick={() => onMode(k)} />
            ))}

            <Rule />

            {tools.map(([k, label, icon, badge]) => (
                <RailButton key={k} label={label} icon={icon} badge={badge} hue={RAIL_HUE[k]}
                            active={toolActive(k)} onClick={() => onLeft(k)} />
            ))}
            <RailButton label="Timeline · T" icon="#g-chart" hue={RAIL_HUE.timeline}
                        active={drawer} onClick={onDrawer} />

            <Rule />

            {/* Lit by the MODE, not by a tool-pane flag: the case files are
                a destination, so "am I looking at them" is the honest test. */}
            <RailButton label="Case files" icon="#g-folder" hue={RAIL_HUE.files}
                        active={mode === "work" || left === "files"}
                        onClick={() => onLeft("files")} />
            <RailButton label="New" icon="#g-plus"
                        active={menu === "new"} onClick={onNewMenu} />
            <RailButton label="Snapshot view · SVG" icon="#g-camera"
                        active={false} onClick={onSnapshot} />

            <div style={{ flex: 1 }} />

            <button
                title={isSuperAdmin ? "Account · superadmin" : "Account"}
                aria-label="Account" onClick={onAccount}
                style={{
                    position: "relative", width: 28, height: 28, flex: "none",
                    margin: "4px 0", padding: 0,
                    border: `1px solid ${mode === "profile" ? "var(--acchi)" : "var(--gline2)"}`,
                    borderRadius: "50%", overflow: "hidden",
                    background: "var(--hov)", cursor: "pointer",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    font: "400 12px var(--mz-font-body)", color: "var(--txt2)",
                }}
            >
                <Avatar size={26} style={{ border: 0, background: "transparent" }} />
                {/* The mark says which account you are signed in as, which
                    for a superadmin is the thing most worth knowing before
                    you click anything. The console itself is on the account
                    page, where the rest of what this account IS lives. */}
                {isSuperAdmin && (
                    <span aria-hidden="true" style={{
                        position: "absolute", right: -1, bottom: -1,
                        width: 10, height: 10, borderRadius: "50%",
                        background: "var(--acchi)", border: "1.5px solid var(--bg0, #14161f)",
                    }} />
                )}
            </button>

            {/* SETTINGS, where the "?" was: it opened the same dialog under
                a help icon nobody read as settings. Lit while the page is
                open. The feed-health square that sat under it is gone — the
                same thing, in full, is Settings → Feeds and health. */}
            <RailButton label="Settings" icon="#g-gear" hue={RAIL_HUE.settings}
                        active={mode === "settings"} onClick={onSettings} />
        </aside>
    )
}
