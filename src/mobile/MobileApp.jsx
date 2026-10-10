/**
 * MobileApp.jsx — Parallax on the phone (v1.1, the owner, 2026-10-07).
 *
 * Five places at the bottom: Home (built on the user's theaters and assets,
 * turning three times a day), the Map (a light 2-D map with its own
 * theaters, filters and layers), the Desk (the team's feed, posting from the
 * field), Messages, and More — the quick menu for Assets, Alerts, Reports,
 * Footage and the Profile. The bell at the top counts what is for the user.
 *
 * Rendered by app.jsx in place of the desktop console below the phone
 * breakpoint; same session, same data, same rules for "yours".
 */
import { useEffect, useState } from "react"
import "./m2.css"
import PlxIcons from "../plx6/PlxIcons.jsx"
import MHome from "./screens/MHome.jsx"
import MMap from "./screens/MMap.jsx"
import MDesk from "./screens/MDesk.jsx"
import MMessages from "./screens/MMessages.jsx"
import { MAssets, MAlerts, MReports, MProfile } from "./screens/MMore.jsx"
import ConflictContext from "../conflicts/ConflictContext.jsx"
import TelegramMood from "../insight/TelegramMood.jsx"
import { Icon, Sheet } from "./screens/common.jsx"
import { usePoll, arr } from "./useMine.js"
import useOnlineUsers from "../state/useOnlineUsers.js"
import PlxWordmark from "../plx6/PlxWordmark.jsx"
import GeneralFeed from "../general/GeneralFeed.jsx"
import MAdmin from "./screens/MAdmin.jsx"
import { getCurrentUser, subscribeAuth } from "../state/authStore.js"
import LocationPrompt from "../components/LocationPrompt.jsx"
import LivePlayerHost from "../telegram/LivePlayer.jsx"
import SourceViewer from "../components/SourceViewer.jsx"

const NAV = [["home", "Home", "g-home"], ["map", "Map", "g-globe"], ["desk", "Desk", "g-feed"], ["messages", "Messages", "g-comment"], ["more", "More", "g-tabs"]]
const MORE = [["assets", "Assets", "g-asset"], ["alerts", "Alerts", "g-bell"], ["conflicts", "Conflicts", "g-flame"], ["mood", "Mood", "g-trend"],
              ["reports", "Reports", "g-report"], ["general", "General", "g-feed"], ["profile", "Profile", "g-user"]]
const TITLES = { home: null, map: "Map", desk: "Desk", messages: "Messages", assets: "Assets", alerts: "Alerts", conflicts: "Conflicts", mood: "Mood on Telegram",
                 reports: "Situation reports", general: "General", profile: "Profile", admin: "Admin" }

export default function MobileApp() {
    const [tab, setTab] = useState("home")
    const [menu, setMenu] = useState(false)
    const [focus, setFocus] = useState(null)
    const [assetOpen, setAssetOpen] = useState(null)
    const notes = usePoll("/api/notifications?limit=60", 60_000, (d) => arr(d?.items ?? d))
    const unread = usePoll("/api/chat/unread", 30_000, (d) => d?.unread ?? 0)
    // Check in like the desktop does, so the phone counts as online and
    // keeps "last seen" current. The list itself isn't shown here.
    useOnlineUsers("phone")
    const go = (t, opts) => { setMenu(false); if (opts?.asset) setAssetOpen(opts.asset); setTab(t) }
    const showOnMap = (s) => { if (!s || !Number.isFinite(+s.lat)) return; setFocus({ ...s, _t: Date.now() }); setTab("map") }
    const [me, setMe] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth(setMe), [])
    const more = me?.is_super_admin ? [...MORE, ["admin", "Admin", "g-gear"]] : MORE
    const inMore = more.some(([k]) => k === tab)
    return (
        <div className="m2" data-screen-label="Phone">
            <PlxIcons />
            <LocationPrompt afterTour={false} live />
            {/* THE MAP IS THE GROUND OF THE APP (owner, 2026-10-10), as the globe is
                on the desktop: always there, every other screen glass over it. */}
            <div className="m2-bg" data-under={tab !== "map"}>
                <MMap active={tab === "map"} chrome={tab === "map"} focus={focus} onOpen={go} alerts={arr(notes).length} />
            </div>
            <LivePlayerHost />
            <SourceViewer />
            {/* The map runs edge to edge (its own round controls carry the bell). */}
            {tab !== "map" && <header className="m2-top">
                {TITLES[tab] ? <span className="m2-title">{TITLES[tab]}</span>
                    : <span className="m2-brand" style={{ flex: 1, display: "flex" }} aria-label="Parallax"><span style={{ width: 124, height: 19, display: "block" }}><PlxWordmark /></span></span>}
                <button className="m2-iconbtn" aria-label="Alerts" onClick={() => go("alerts")}>
                    <Icon id="g-bell" />{arr(notes).length > 0 && <span className="m2-badge">{Math.min(99, arr(notes).length)}</span>}
                </button>
            </header>}
            <main className="m2-body" style={{ pointerEvents: tab === "map" ? "none" : "auto" }}>
                {/* Every screen stays mounted (the map keeps its place; a thread keeps its scroll); only one shows. */}
                <Pane on={tab === "home"}><MHome onShowOnMap={showOnMap} onOpen={go} /></Pane>

                <Pane on={tab === "desk"}><MDesk active={tab === "desk"} onShowOnMap={showOnMap} /></Pane>
                <Pane on={tab === "messages"}><MMessages active={tab === "messages"} /></Pane>
                {tab === "assets" && <Pane on><MAssets onShowOnMap={showOnMap} initial={assetOpen} /></Pane>}
                {tab === "alerts" && <Pane on><MAlerts onShowOnMap={showOnMap} onOpen={go} /></Pane>}
                {/* The wars and the mood, as on the desktop (conflicts/, insight/). */}
                {tab === "conflicts" && <Pane on><div className="m2-scroll"><ConflictContext all label="Current wars" max={30} /></div></Pane>}
                {tab === "mood" && <Pane on><div className="m2-scroll"><TelegramMood /></div></Pane>}
                {tab === "reports" && <Pane on><MReports /></Pane>}
                {tab === "general" && <Pane on><div className="m2-scroll"><GeneralFeed compact onMap={(it) => showOnMap(it)} /></div></Pane>}
                {tab === "admin" && me?.is_super_admin && <Pane on><MAdmin /></Pane>}
                {tab === "profile" && <Pane on><MProfile /></Pane>}
            </main>
            <nav className="m2-nav">
                {NAV.map(([k, label, icon]) => (
                    <button key={k} aria-current={k === "more" ? (menu || inMore) : tab === k} onClick={() => (k === "more" ? setMenu(true) : go(k))}>
                        <Icon id={icon} size={22} />
                        <span>{label}</span>
                        {k === "messages" && unread > 0 && <span className="m2-badge" style={{ top: 4, right: "calc(50% - 22px)" }}>{unread}</span>}
                    </button>
                ))}
            </nav>
            {menu && (
                <Sheet onClose={() => setMenu(false)}>
                    <div className="m2-menu">
                        {more.map(([k, label, icon]) => (
                            <button key={k} onClick={() => go(k)}><Icon id={icon} size={22} /><span>{label}</span></button>
                        ))}
                    </div>
                </Sheet>
            )}
        </div>
    )
}

/** A screen over the map: glass, fading up as it opens. */
function Pane({ on, children }) {
    if (!on) return <div style={{ display: "none" }}>{children}</div>
    return <div className="m2-pane">{children}</div>
}
