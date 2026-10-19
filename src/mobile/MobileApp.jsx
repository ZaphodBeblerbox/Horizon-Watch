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
import { useEffect, useRef, useState } from "react"
import "./m2.css"
import PlxIcons from "../plx6/PlxIcons.jsx"
import MHome from "./screens/MHome.jsx"
import MMap from "./screens/MMap.jsx"
import MDesk from "./screens/MDesk.jsx"
import MMessages from "./screens/MMessages.jsx"
import { MAssets, MAlerts, MReports, MProfile, MSettings } from "./screens/MMore.jsx"
import ConflictContext from "../conflicts/ConflictContext.jsx"
import MMood from "./screens/MMood.jsx"
import { Icon, Sheet } from "./screens/common.jsx"
import API_BASE from "../apiBase.js"
import { usePoll, arr } from "./useMine.js"
import useOnlineUsers from "../state/useOnlineUsers.js"
import useConnection, { connectionLine } from "../lib/useConnection.js"
import PlxWordmark from "../plx6/PlxWordmark.jsx"
import GeneralFeed from "../general/GeneralFeed.jsx"
import MAdmin from "./screens/MAdmin.jsx"
import { getCurrentUser, subscribeAuth } from "../state/authStore.js"
import LocationPrompt from "../components/LocationPrompt.jsx"
import LivePlayerHost, { watchLive } from "../telegram/LivePlayer.jsx"
import SourceViewer from "../components/SourceViewer.jsx"
import MNotifCards from "./screens/MNotifCards.jsx"
import { openSignal, pinFor, presentationFor, routeFor, setSignalSurface } from "../notify/openSignal.js"
import { closeOpenedSignal, showSignalPin } from "../lib/signalPin.js"
import RoutePanel from "../routes/RoutePanel.jsx"
import { AirRoutePanel } from "../routes/modes/AirRoute.jsx"
import "../routes/modes/air.js"           // the Flights mode: the route panel's chip
import { SeaRouteSidebar } from "../routes/modes/MaritimeRoute.jsx"
import { fetchVesselThreat } from "../state/vesselThreatStore.js"
import { showFindings } from "../lib/findings.js"
import { findingsForRoute } from "./openFinding.js"
import { dropStaleDemos } from "../globe/freshness.js"

const NAV = [["home", "Home", "g-home"], ["map", "Map", "g-globe"], ["desk", "Desk", "g-feed"], ["messages", "Messages", "g-comment"], ["more", "More", "g-tabs"]]
const MORE = [["assets", "Assets", "g-asset"], ["alerts", "Alerts", "g-bell"], ["conflicts", "Conflicts", "g-flame"], ["mood", "Mood", "g-trend"],
              ["reports", "Reports", "g-report"], ["general", "General", "g-feed"], ["profile", "Profile", "g-user"], ["settings", "Settings", "g-gear"]]
const TITLES = { home: null, map: "Map", desk: "Desk", messages: "Messages", assets: "Assets", alerts: "Alerts", conflicts: "Conflicts", mood: "Mood on Telegram",
                 reports: "Situation reports", general: "General", profile: "Profile", admin: "Admin", settings: "Settings" }

export default function MobileApp() {
    const [tab, setTab] = useState("home")
    const [menu, setMenu] = useState(false)
    const [focus, setFocus] = useState(null)
    const [assetOpen, setAssetOpen] = useState(null)
    const notes = usePoll("/api/notifications?limit=60", 60_000, (d) => dropStaleDemos(arr(d?.items ?? d)))
    const unread = usePoll("/api/chat/unread", 30_000, (d) => d?.unread ?? 0)
    // Check in like the desktop does, so the phone counts as online and
    // keeps "last seen" current. The list itself isn't shown here.
    useOnlineUsers("phone", { listen: false })
    const connLine = connectionLine(useConnection())
    const go =(t, opts) => { setMenu(false); if (opts?.asset) setAssetOpen(opts.asset); setTab(t) }
    useEffect(() => { const h = (e) => go(e.detail); window.addEventListener("m2:go", h); return () => window.removeEventListener("m2:go", h) }, []) // eslint-disable-line react-hooks/exhaustive-deps
    // the route planner opens on THE map (its tray over it), never a second one
    useEffect(() => { const h = () => go("map"); window.addEventListener("plx:route-panel", h); return () => window.removeEventListener("plx:route-panel", h) }, []) // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { const h = (e) => go("assets", { asset: e.detail }); window.addEventListener("m2:go-asset", h); return () => window.removeEventListener("m2:go-asset", h) }, []) // eslint-disable-line react-hooks/exhaustive-deps
    const plainShowOnMap = (s) => { if (!s || !Number.isFinite(+s.lat)) return; setFocus({ ...s, _t: Date.now() }); setTab("map") }
    // a vessel of concern (from Alerts, the General feed, Home …) opens on
    // the vessel, as its notification does; everything else as before
    // "Show on the map": a vessel of concern opens its live view (rings, trail, targets); anything else is centred
    const showOnMap = (s) => (s && !s.vesselThreat && routeFor(s)?.action === "vessel" ? sigMap.current?.(routeFor(s)) : plainShowOnMap(s))

    /* THE MAP AT THE SIGNAL, THE SIGNAL DRAWN (owner, 2026-10-12): a tapped
       notification (push, banner, Alerts) opens the map where it happened with
       the signal itself on it — the live vessel with its rings and targets,
       the finding's boxes over the image they were seen in, or the signal's
       own marker — and a small card over the map (2026-10-17; it was a half
       sheet). How each kind is shown: presentationFor() in notify/openSignal.js. */
    const sigMap = useRef(null)
    const [alertFocus, setAlertFocus] = useState(null)
    useEffect(() => {
        // WHERE A NOTIFICATION LEADS (owner, 2026-10-17: "it doesn't lead me
        // directly to the actual signal"): a signal with a place opens on the
        // map, at it, drawn, with a small card over the map (MPeek); one
        // without a place opens in Alerts, found, scrolled to and opened there.
        const open = async (r) => {
            if (!r) return
            setMenu(false)
            if (r.action === "livestream") { watchLive(r.livestreamId, r.title || ""); return }
            if (r.action === "asset") { go("assets", { asset: r.assetId }); return }
            const p = presentationFor(r, "phone")
            closeOpenedSignal()            // what the last one drew
            if (p?.map) { sigMap.current?.(r); return }
            setAlertFocus({ id: r.alertId || r.id, title: r.title, _t: Date.now() })
            go("alerts")
        }
        // `sheet: false`: the signal's own sheet is already open (MobileApp's),
        // so the map must not open a second one for the same thing
        sigMap.current = async (r, { sheet = true } = {}) => {
            if (!r) return
            const quiet = sheet ? {} : { _noSheet: true }
            if (r.action === "vessel") {
                setTab("map")
                const base = { id: r.alertId || r.id, alert_id: r.alertId || r.id, alert_type: r.alertType, mmsi: r.mmsi, entity_id: r.mmsi,
                               headline: r.title || "Vessel of concern", severity_tier: r.sev || "critical", source: "Vessel of concern" }
                // there at once if the live view is slow to come (a pan still
                // running would swallow the fit to the rings, so not before)
                const early = r.lat != null && r.lon != null ? setTimeout(() => setFocus({ lat: r.lat, lon: r.lon, _t: Date.now() }), 700) : null
                try {
                    const d = await fetchVesselThreat(r.mmsi, { lat: r.lat, lon: r.lon }).finally(() => clearTimeout(early))
                    if (d?.available !== false && d?.vessel) {
                        setFocus({ ...base, ...quiet, lat: d.vessel.lat, lon: d.vessel.lon, vesselThreat: d, _t: Date.now() })
                        return
                    }
                } catch { /* the sheet says why */ }
                if (r.lat != null && r.lon != null) setFocus({ ...base, ...quiet, lat: r.lat, lon: r.lon, _t: Date.now() })
                else if (sheet) { setAlertFocus({ id: r.alertId || r.id, title: r.title, _t: Date.now() }); go("alerts") }
                return
            }
            // an imagery finding: its pass's image, its boxes, the one it is about in
            // focus (mobile/openFinding.js; lib/findings.js, mobile/findingsLeaflet.js).
            // The alert row is fetched when the route came without it, as on the desktop.
            if (r.action === "finding") {
                const { alert, show } = await findingsForRoute(r)
                if (show.findings.length) {
                    setTab("map")
                    showFindings({ ...show, title: r.title || alert.title, fit: true, alertId: r.alertId || r.id })
                    // the card with it, the boxes framing the view
                    if (sheet) setFocus({ ...alert, id: r.alertId || r.id, alert_id: r.alertId || r.id, headline: r.title || alert.title, title: r.title || alert.title,
                                          severity_tier: r.sev || alert.severity, _peekOnly: true, _t: Date.now() })
                    return
                }
            }
            // the signal's own marker, highlighted (lib/signalPin.js → findingsLeaflet.js)
            const pin = pinFor(r.action === "finding" ? { ...r, action: "signal" } : r)
            if (pin) showSignalPin(pin)
            if (r.lat != null && r.lon != null) plainShowOnMap({ lat: r.lat, lon: r.lon, headline: r.title, title: r.title, summary: r.sub, id: r.alertId || r.id, alert_id: r.alertId || r.id,
                                                             severity_tier: r.sev, alert_type: r.alertType, entity_type: r.entityType || undefined, ...quiet })
            else if (sheet) { setAlertFocus({ id: r.alertId || r.id, title: r.title, _t: Date.now() }); go("alerts") }
        }
        const off = setSignalSurface(open)
        // opened cold from a notification (main.jsx): no globe to wait for
        const pending = window.__plxPendingOpen
        if (pending) {
            window.__plxPendingOpen = null
            setTimeout(() => openSignal(pending), 300)
        }
        return off
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    const [me, setMe] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth(setMe), [])
    const more = me?.is_super_admin ? [...MORE, ["admin", "Admin", "g-gear"]] : MORE
    const inMore = more.some(([k]) => k === tab)
    // THE CHROME GETS OUT OF THE WAY: reading down a screen slides the header
    // up and the tab bar down; the first scroll back up, or the top, returns them
    const [chromeHidden, setChromeHidden] = useState(false)
    useEffect(() => {
        const last = new WeakMap()
        const h = (e) => {
            const t = e.target
            if (!(t instanceof Element) || !t.closest(".m2-body") || t.closest(".m2-sheet, .m2-hscroll, .m2-chips")) return
            const y = t.scrollTop, prev = last.has(t) ? last.get(t) : y
            last.set(t, y)
            if (y < 40) setChromeHidden(false)
            else if (y - prev > 6) setChromeHidden(true)
            else if (prev - y > 6) setChromeHidden(false)
        }
        document.addEventListener("scroll", h, true)
        // a screen may ask for the whole screen (a conversation while typing)
        const ask = (e) => setChromeForced(!!e.detail?.hidden)
        window.addEventListener("m2:chrome", ask)
        return () => { document.removeEventListener("scroll", h, true); window.removeEventListener("m2:chrome", ask) }
    }, [])
    const [chromeForced, setChromeForced] = useState(false)
    // A SCREEN ARRIVES FROM THE SIDE ITS TAB IS ON
    const navIndex = (t) => { const i = NAV.findIndex(([k]) => k === t); return i >= 0 ? i : NAV.length - 1 }
    const prevTab = useRef(tab)
    const dir = navIndex(tab) < navIndex(prevTab.current) ? "left" : "right"
    useEffect(() => { prevTab.current = tab; setChromeHidden(false); setChromeForced(false) }, [tab])
    const markAt = menu ? NAV.length - 1 : navIndex(tab)
    return (
        <div className="m2" data-screen-label="Phone" data-chrome={(chromeHidden || chromeForced) && tab !== "map" ? "hidden" : "shown"} data-dir={dir}>
            <PlxIcons />
            <LocationPrompt afterTour={false} live />
            {/* the route planner, full height (a "Leave now" notification, Get me out, an asset's Safest route, a context card) */}
            <RoutePanel variant="phone" />
            <AirRoutePanel variant="phone" />
            <SeaRouteSidebar variant="phone" />
            {/* THE MAP IS THE GROUND OF THE APP (owner, 2026-10-10), as the globe is
                on the desktop: always there, every other screen glass over it. */}
            <div className="m2-bg" data-under={tab !== "map"}>
                <MMap active={tab === "map"} chrome={tab === "map"} focus={focus} onOpen={go} alerts={arr(notes).length} />
            </div>
            <LivePlayerHost />
            {/* WHOSE PROBLEM IT IS (2026-10-18): "offline" only when the
                phone has no network; a slow or restarting server says so. */}
            {connLine && (
                <div role="status" aria-live="polite" style={{
                    position: "fixed", left: "50%", transform: "translateX(-50%)",
                    top: "calc(env(safe-area-inset-top, 0px) + 58px)", zIndex: 40,
                    maxWidth: "calc(100vw - 32px)", padding: "5px 12px", borderRadius: 14,
                    background: "var(--bg-1, #1b1e27)", border: "1px solid var(--line, #2b3040)",
                    color: "var(--txt-2)", font: "400 12px var(--font)", whiteSpace: "nowrap",
                    overflow: "hidden", textOverflow: "ellipsis", pointerEvents: "none",
                }}>{connLine}</div>
            )}
            <MNotifCards onOpen={(n) => openSignal(n)} />
            <SourceViewer />
            {/* The map runs edge to edge (its own round controls carry the bell). */}
            {tab !== "map" && <header className="m2-top">
                {TITLES[tab] ? <span className="m2-title">{TITLES[tab]}</span>
                    : <span className="m2-brand" style={{ flex: 1, display: "flex" }} aria-label="Parallax"><span style={{ width: 124, height: 19, display: "block" }}><PlxWordmark /></span></span>}
                {tab !== "settings" && <button className="m2-iconbtn" aria-label="Settings" onClick={() => go("settings")}><Icon id="g-gear" /></button>}
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
                {tab === "alerts" && <Pane on><MAlerts onShowOnMap={showOnMap} onOpen={go} focus={alertFocus} /></Pane>}
                {/* The wars and the mood, as on the desktop (conflicts/, insight/). */}
                {tab === "conflicts" && <Pane on><div className="m2-scroll"><ConflictContext all label="Current wars" max={30} /></div></Pane>}
                {tab === "mood" && <Pane on><MMood /></Pane>}
                {tab === "reports" && <Pane on><MReports /></Pane>}
                {tab === "general" && <Pane on><div className="m2-scroll"><GeneralFeed compact onMap={(it) => showOnMap(it)} /></div></Pane>}
                {tab === "admin" && me?.is_super_admin && <Pane on><MAdmin /></Pane>}
                {tab === "profile" && <Pane on><MProfile /></Pane>}
                {tab === "settings" && <Pane on><MSettings /></Pane>}
            </main>
            <nav className="m2-nav">
                <span className="m2-nav-mark" aria-hidden style={{ transform: `translateX(${markAt * 100}%)` }} />
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
