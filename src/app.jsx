import UpdateBanner from "./desktop/UpdateBanner.jsx"
import Tutorial from "./ui/Tutorial.jsx"
import ScreenCapture, { saveCapture } from "./capture/ScreenCapture.jsx"
import { toast } from "./ui/toast.js"
import { installSignalCardNav } from "./reports/signalCardNav.js"
import { isTextEntry } from "./utils/isTextEntry.js"
import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from "react"
import { REGION_COORDS } from "./data/regionCoords.js"
const GlobeView = lazy(() => import("./components/GlobeView.jsx"))
import IconSprite from "./ui/IconSprite.jsx"
import TopBar from "./components/TopBar.jsx"
import PlxIcons from "./plx6/PlxIcons.jsx"
import PlxTabBar from "./plx6/PlxTabBar.jsx"
import PlxMenuBar from "./plx6/PlxMenuBar.jsx"
import PlxRail from "./plx6/PlxRail.jsx"
import { PlxMenu, PlxToast, PlxAlerts } from "./plx6/PlxOverlays.jsx"
import { useChrome } from "./state/useChrome.js"
import { openOverlay, closeOverlay, subscribeOverlay } from "./state/overlayManager.js"
import NotificationStack from "./components/NotificationStack.jsx"
import NotificationTray from "./components/NotificationTray.jsx"
import { pushNotification, unreadCount as notifUnread, subscribeNotifications } from "./state/notificationStore.js"
import { subscribeLive } from "./state/liveEvents.js"
import SessionControl from "./components/SessionControl.jsx"
import { ensureActiveSession, startSessionAutoPersist } from "./state/sessionStore.js"
import LoginScreen from "./components/LoginScreen.jsx"
import { checkSession, subscribeAuth, isAuthTransientError, canLoginOffline, getCurrentUser } from "./state/authStore.js"
import { reconcileTheme, getThemeMode, setThemeMode } from "./state/themeStore.js"
import { reconcileSettings, getSettings, subscribeSettings, updateSetting } from "./state/settingsStore.js"
import CommandPalette from "./components/CommandPalette.jsx"
import SettingsModal from "./components/SettingsModal.jsx"
// Workstation round, Part 8 — importing this for its module-level
// registerInspectorExtension() side effect (see the file's own comment).
// Not referenced directly here; every real surface that calls
// useInspectorExtensions() picks it up automatically once registered.
import "./components/collab/CollabPanel.jsx"
import ToastHost from "./ui/ToastHost.jsx"
import Home from "./destinations/Home.jsx"
import Situation from "./destinations/Situation.jsx"
import { MODULES } from "./data/modules.js"

// Redesign Round 2 — real module-key <-> legacy tab-type translation. The
// underlying tab `type` strings from the old 5-destination model are left
// unchanged internally (many render blocks/handlers key off them, audited
// only far enough to confirm they still work, not rewritten wholesale) —
// this is the one small seam that lets the new 7-module TopBar reuse them
// where a real 1:1 mapping exists, rather than duplicating working
// destinations under a second type string.
/* The v6 rail (A2.3) names nine modes; this routes each onto the
   destination that actually exists here. Two are approximations and are
   named as such rather than left to look deliberate:
     assets  → Sources, which is where watch areas and detection rules
               already live — the nearest thing we have to a register of
               things being watched. A real asset register is still owed.
     fusion  → AI Council, our existing correlation surface; Crucible's
               own four tabs (pipeline, side channels, tip-and-cue,
               boundaries) are not built yet.
   The older keys below them are kept so existing callers keep working. */
const MODULE_TO_TAB_TYPE = {
    home: "home", map: "situation", graph: "ontology", inbox: "watchlists",
    briefings: "briefings", analytics: "analytics", assets: "sources",
    fusion: "aiCouncil", work: "cases",
    situation: "situation", dossiers: "dossiers", generate: "generate",
    replay: "replay", ontology: "ontology", imagery: "imagery",
    forecast: "forecast", cases: "cases", caseWork: "work", team: "team", editor: "editor",
    chat: "chat", desk: "desk",
}
/* Reverse, so the rail lights the right button for whatever tab is open.
   Forecast resolves to `analytics` because Insight is one surface with
   three tabs (changes · risk · what happens next), not three modes. */
/* ── A1.2 / ▣ Canvas — THE MAP IS THE BACKGROUND OF THE WHOLE APP ─────
   The spec opens with a canvas at `position:absolute; inset:0` holding the
   map, and then puts every mode — Home, Inbox, Insight, Constellation —
   on top of it as a glass sheet at z-index 22. That is the entire reason
   the v6 shell looks the way it does: `backdrop-filter: blur(22px)` has
   something to blur.

   We had the glass but not the canvas. Every mode screen carried the
   correct blur over a flat var(--canvas), which is a no-op — blurring a
   solid colour returns the solid colour. Reported as "home is not
   transluscent", and it was true of every screen, not just Home.

   Hoisting <GlobeView> itself to the root was the obvious fix and the
   wrong one: it takes ~50 props off Situation's layer state, so moving it
   means moving all of that too. Instead the Situation layer simply stops
   hiding. When it is not the active mode it stays mounted and visible at
   z 0 with pointer-events off, showing only its map — see `asCanvas` in
   Situation.jsx, which suppresses that screen's own panes, chrome and
   time strip so they do not punch through the mode on top. */
const modeLayer = (on) => ({
    /* ONE WINDOW, EVERY MODE. The frame used to be spread by whichever
       screen remembered to — four did, thirteen rendered bare onto the
       canvas, so moving between modes flipped between a glass sheet and
       loose content on the background. Applying it here means a mode
       cannot opt out of it by forgetting.

       IT IS SPREAD FIRST, AND `display` IS SET AFTER IT. MODE_FRAME
       carries display:flex; spreading it last overwrote the conditional
       and every mode layer rendered at once, stacked at the same
       coordinates. The symptom was that nothing closed anything — the
       ✕ hid Team and uncovered Inbox, which looked identical to the ✕
       doing nothing at all. */
    ...MODE_FRAME,
    position: "absolute", inset: 0, zIndex: 22,
    minWidth: 0,
    display: on ? "flex" : "none",
})
const canvasLayer = (on, chrome) => ({
    position: "absolute",
    /* Off-mode it breaks OUT of the content area's 84/48 offset and runs
       the full window, so the tab bar, menu bar and rail — all glass — have
       the globe behind them rather than a flat fill. On-mode it stays
       inside the content area, because then it owns panes and a time strip
       that must not slide under the chrome. The chrome sits at z 39-41 and
       this at z 0, so it is painted over either way. */
    top: on ? 0 : (chrome ? -84 : 0),
    left: on ? 0 : (chrome ? -48 : 0),
    right: 0, bottom: 0,
    zIndex: on ? 22 : 0,
    display: "flex", flexDirection: "column",
    minWidth: 0, overflow: "hidden",
    // Off-mode the canvas is scenery, not a target: clicks belong to the
    // glass sheet above it.
    pointerEvents: on ? "auto" : "none",
})

const TAB_TYPE_TO_MODULE = {
    home: "home", situation: "map", ontology: "graph", watchlists: "inbox",
    briefings: "briefings", analytics: "analytics", forecast: "analytics",
    sources: "assets", aiCouncil: "fusion", cases: "work",
    dossiers: "dossiers", generate: "generate", replay: "replay",
    imagery: "imagery", team: "team", editor: "editor",
}
// Mode, not modules (§7.1) — which real module keys a tab type routes to
// belongs to which mode's rail. Opening a tab whose module is work-mode
// (e.g. a case: ref resolved from Watch mode) switches the mode itself,
// exactly like the doc's own HWX.onModule-equivalent correction — guarded
// by MODE_SWITCH_GUARD_MS below so the mode-setter and any other effect
// reacting to the same tab change can't fight each other.
const WORK_MODULE_KEYS = new Set(["cases", "caseWork", "team", "editor", "ontology", "forecast"])
const MODE_STORAGE_KEY = "akili-mode-v1"
import MapControlStack from "./components/MapControlStack.jsx"
import { DESTINATION_KEYS } from "./data/destinations.js"
import { summarizeHealth } from "./utils/systemHealth.js"
import Inbox from "./destinations/Inbox.jsx"
import Dashboard from "./destinations/Dashboard.jsx"
import Sources from "./destinations/Sources.jsx"
import Generate from "./reports/Generate.jsx"
import Briefings from "./reports/Briefings.jsx"
import BriefingStudio from "./reports/BriefingStudio.jsx"
import PrintLayout from "./reports/PrintLayout.jsx"
import Deck from "./reports/Deck.jsx"
import MobileApp from "./mobile/MobileApp.jsx"
import AlertStrip, { isFlagged } from "./components/AlertStrip.jsx"
import WorkspacesPanel from "./components/WorkspacesPanel.jsx"
import ChatPanel from "./components/ChatPanel.jsx"
import TVWidget from "./components/tvwidget.jsx"
import { loadProfile, saveProfileToStorage } from "./components/MissionProfilePanel.jsx"
import SurfaceDetailPanel from "./components/SurfaceDetailPanel.jsx"
import { playAlert, resumeAudio } from "./soundSystem.js"
import HealthPanel from "./components/HealthPanel.jsx"
import Insight from "./destinations/Insight.jsx"
import { exportPdf } from "./print/printSurface.jsx"
import { MODE_FRAME } from "./plx6/modeWindow.js"
import { setActiveTheater } from "./state/filing.js"
import Dossiers from "./destinations/Dossiers.jsx"
import Constellation from "./destinations/Constellation.jsx"
import Profile from "./destinations/Profile.jsx"
import Chat from "./chat/Chat.jsx"
import Desk from "./desk/Desk.jsx"
import ExplanationPanel from "./voice/ExplanationPanel.jsx"
import TheaterEditor from "./components/TheaterEditor.jsx"
import {
    listTheaters, createTheater, updateTheater, deleteTheater,
} from "./lib/theatersApi.js"
import Crucible from "./destinations/Crucible.jsx"
import MyWork from "./destinations/MyWork.jsx"
import Replay from "./destinations/Replay.jsx"
import Imagery from "./destinations/Imagery.jsx"
import Forecast from "./destinations/Forecast.jsx"
import Editor from "./destinations/Editor.jsx"
import Cases from "./destinations/Cases.jsx"
import Team from "./destinations/Team.jsx"
import API_BASE from "./apiBase.js"
import ProfilePanel from "./components/ProfilePanel.jsx"
import NewsReels from "./components/NewsReels.jsx"
import { mergeNotificationItems, mergeNotificationFeed } from "./components/notificationsNormalize.js"
import { buildWatchQueueRows } from "./destinations/dashboardLogic.js"
import OverwatchSidebar, { loadSavedScans, persistSavedScans, loadSavedImages, persistSavedImages } from "./components/OverwatchSidebar.jsx"
import EmergingConflictsPanel from "./components/EmergingConflictsPanel.jsx"
import NewsTicker from "./components/NewsTicker.jsx"
import WorldClocksBar from "./components/WorldClocksBar.jsx"
import { resolveTabAction } from "./lib/tabModel.js"
import SourceViewer from "./components/SourceViewer.jsx"
import useOnlineUsers from "./state/useOnlineUsers.js"
import SearchBar from "./search/SearchBar.jsx"
import { decodeView, shareUrl } from "./state/shareLink.js"
import { getCameraState as getShareCamera } from "./globe/cameraState.js"

const API = API_BASE
const WS_STORAGE_KEY  = "akili-workspaces-v1"
// Redesign Round 2 — bumped from "akili_tabs": the old storage held tab
// `type` values from the 5-destination model ("map" as the permanent home
// tab); this round's real module rail renames that permanent tab to
// "situation" and adds "dossiers"/"replay" as real new types, so old stored
// tabs are simply superseded rather than migrated — a fresh, valid default
// is safer than reverse-engineering old localStorage shapes.
const TAB_STORAGE_KEY = "akili_tabs_v2"
//: Every tab type this build has a renderer for. Anything restored that
//: is not here came from an older version and cannot be shown.
const KNOWN_TAB_TYPES = new Set([
    "situation", "watchlists", "dossiers", "analytics", "generate",
    "briefings", "replay", "ontology", "imagery", "forecast",
    "cases", "team", "editor", "dashboard", "sources",
    // The case WORKSPACE, distinct from "cases" — which is now My work's
    // queue. Two different screens were sharing one tab type, so opening a
    // case from the queue reopened the queue.
    "caseWork",
    // Reached from the rail's Account button; not a landing tab (see
    // NON_LANDING_TABS) because it is somewhere you go and then leave.
    "profile", "home", "aiCouncil",
    // Messages, and the desk feed.
    "chat", "desk",
])

function defaultTabs() {
    return [{ id: "situation", type: "situation", label: "Situation" }]
}

/**
 * Restored tabs are not trusted.
 *
 * This list outlives the code that wrote it. A saved session was found
 * holding eighteen tabs including `mywork` and `mail` — modules that have
 * since been deleted — plus three copies of `dossiers`. Nothing rendered,
 * because the restored active tab was one of those and the app faithfully
 * made every real view display:none to honour it. The app opened on
 * whatever the last session happened to end on, which is how it came up in
 * Workstation instead of on the map.
 *
 * So: drop types this build does not have, de-duplicate, and always keep
 * Situation. Persisted UI state is an input from an older version of the
 * program, and inputs get validated.
 */
/** Modules you visit deliberately and leave — never the view the app
 *  opens on, however recently you were there. */
const NON_LANDING_TABS = new Set(["team", "profile", "editor", "chat"])

function loadTabsFromStorage() {
    try {
        const raw = localStorage.getItem(TAB_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) {
                const seen = new Set()
                const clean = parsed.filter((t) => {
                    if (!t || typeof t.type !== "string") return false
                    if (!KNOWN_TAB_TYPES.has(t.type)) return false
                    if (seen.has(t.type) && !t.recordRef) return false
                    seen.add(t.type)
                    return true
                })
                if (!clean.length) return defaultTabs()
                if (!clean.find((t) => t.type === "situation")) {
                    return [{ id: "situation", type: "situation", label: "Situation" }, ...clean]
                }
                return clean
            }
        }
    } catch { /* ignore */ }
    return defaultTabs()
}


// ── Workspace helpers ─────────────────────────────────────────────────────────

function newWorkspace(name) {
    return { id: crypto.randomUUID(), name, center: [20, 0], zoom: 2, layers: { unifiedEvents: true } }
}

// Ensure unifiedEvents is enabled on all existing workspaces that predate 3D-only mode.
function migrateWorkspaces(workspaces) {
    return workspaces.map(w => {
        if (w.layers?.unifiedEvents !== false) return w
        return { ...w, layers: { ...w.layers, unifiedEvents: true } }
    })
}

function loadWorkspaces() {
    try {
        const raw = localStorage.getItem(WS_STORAGE_KEY)
        if (raw) {
            const parsed = JSON.parse(raw)
            if (Array.isArray(parsed) && parsed.length > 0) return migrateWorkspaces(parsed)
        }
    } catch { /* ignore */ }
    return [newWorkspace("Default")]
}

function saveWorkspacesToStorage(workspaces, activeId) {
    try {
        localStorage.setItem(WS_STORAGE_KEY, JSON.stringify(workspaces))
        localStorage.setItem(WS_STORAGE_KEY + "-active", activeId)
    } catch { /* ignore */ }
}

function loadActiveId(workspaces) {
    try {
        const saved = localStorage.getItem(WS_STORAGE_KEY + "-active")
        if (saved && workspaces.find(w => w.id === saved)) return saved
    } catch { /* ignore */ }
    return workspaces[0].id
}

// ── Right panel width ─────────────────────────────────────────────────────────
const RIGHT_PANEL_W = 300

// ── Panel style (glass) ───────────────────────────────────────────────────────
// Theming regression fix: was a hardcoded rgba(6,14,45,...) literal predating
// the real token system — never responded to [data-theme="light"], and
// didn't even match dark mode's real --bg-0. Reuses the exact real glass
// token the theming round already established (--pane-glass-bg, same one
// .pane-glass uses in designSystem.css) rather than a second glass value.
const PANEL_STYLE = {
    width:       RIGHT_PANEL_W,
    flexShrink:  0,
    height:      "100%",
    background:  "var(--pane-glass-bg)",
    borderLeft:  "1px solid var(--acc-line)",
    overflowY:   "auto",
    boxSizing:   "border-box",
    fontFamily:  "system-ui, -apple-system, sans-serif",
    transition:  "opacity 150ms ease",
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
    // Real authentication round — gates the entire real app shell (see the
    // Render section below) behind a real verified session. checkSession()
    // asks the real backend whether an existing cookie is still valid
    // (real 401 if not — never assumed).
    const [authUser, setAuthUser] = useState(null)
    const [authChecked, setAuthChecked] = useState(false)
    // Real auth/performance round fix — a transient failure (network
    // error, timeout, a cold-starting backend's 5xx) of the mount-time
    // GET /api/auth/me check is no longer treated the same as a genuine
    // 401: checkSession() itself now retries transient failures with
    // backoff and only ever clears a real session on an actual 401. If
    // every retry still fails transiently, authTransientError is set so
    // the Render section below shows a real "reconnecting" state instead
    // of silently forcing a still-valid, still-logged-in user back to the
    // login screen (the confirmed root cause of "closing the tab forces a
    // re-login").
    const [authTransientError, setAuthTransientError] = useState(false)
    // Whether this machine can sign in with no server at all. Resolved
    // once, asynchronously, because it reads IndexedDB.
    const [offlineLoginAvailable, setOfflineLoginAvailable] = useState(false)
    const [captureOpen, setCaptureOpen] = useState(false)
    // A signal card in a document is clickable: it flies the map to the
    // place it describes. Installed once, delegated, so cards rendered
    // from stored HTML work without React touching them.
    useEffect(() => installSignalCardNav(window), [])
    useEffect(() => { canLoginOffline().then(setOfflineLoginAvailable).catch(() => {}) }, [])
    const runAuthCheck = useCallback(() => {
        checkSession().then((u) => {
            setAuthUser(u)
            setAuthTransientError(isAuthTransientError())
            setAuthChecked(true)
            reconcileTheme(u)
            reconcileSettings(u)
        })
    }, [])
    useEffect(() => {
        runAuthCheck()
        return subscribeAuth(setAuthUser)
    }, [runAuthCheck])
    // Real sliding-expiry companion (backend/main.py's GET /api/auth/me
    // now reissues the session cookie with a fresh window on every real
    // success) — this periodic re-check is what actually exercises that
    // for a tab an analyst keeps open for a long real session, not just
    // on remount. Six hours is comfortably inside the real 7-day token
    // window even if one tick is missed (tab backgrounded/throttled).
    useEffect(() => {
        if (!authUser) return
        const iv = setInterval(runAuthCheck, 6 * 3600 * 1000)
        return () => clearInterval(iv)
    }, [authUser, runAuthCheck])

    const [showTV,       setShowTV]       = useState(false)
    const [overwatchActive,     setOverwatchActive]     = useState(false)
    const [overwatchDrawActive, setOverwatchDrawActive] = useState(false)
    // Overwatch panel state (managed here, fed to OverwatchSidebar)
    const [owMode,       setOwMode]       = useState("idle")    // idle|drawing|analyzing|results
    const [owDetections, setOwDetections] = useState([])
    const [owStats,      setOwStats]      = useState(null)
    const [owEnhance,    setOwEnhance]    = useState(false)
    const [owMinConf,    setOwMinConf]    = useState(0.15)
    const [owSavedScans,  setOwSavedScans]  = useState(() => loadSavedScans())
    const [owSavedImages, setOwSavedImages] = useState(() => loadSavedImages())
    const [owAnalysis,   setOwAnalysis]   = useState(null)
    const [owAnalyzing,  setOwAnalyzing]  = useState(false)
    const [owBounds,     setOwBounds]     = useState(null)
    const [owSentinelOverlay,  setOwSentinelOverlay]  = useState(null)  // {image_b64, bounds}
    const [owSentinelLoading,  setOwSentinelLoading]  = useState(false) // kept for legacy compat
    const [overwatchDrawMode,  setOverwatchDrawMode]  = useState("rectangle")
    const [owPolygon,          setOwPolygon]          = useState(null)

    const [isMobile,     setIsMobile]     = useState(() => typeof window !== "undefined" && window.innerWidth < 768)
    // Real phone-mode breakpoint — a genuine structural shell swap (the
    // four-tab mobile companion in place of the desktop console), distinct
    // from the gentler `isMobile` reflow tweak above (768px, minor layout
    // adjustments only). ~600px matches the phone frame this was designed
    // against. Re-evaluated live on resize/orientation change, never decided
    // once at load. Real bug caught live: gating on innerWidth alone would
    // kick a real phone in landscape (e.g. 844x390) OUT of phone mode the
    // moment it rotates, since its width alone exceeds 600 even though it's
    // still genuinely a phone — the smaller of the two dimensions is the
    // real "is this a phone-sized viewport" question, regardless of
    // orientation.
    const phoneModeQuery = () => typeof window !== "undefined" && Math.min(window.innerWidth, window.innerHeight) < 600
    const [phoneMode, setPhoneMode] = useState(phoneModeQuery)
    const [showReels, setShowReels] = useState(false)
    const [showAutoMode, setShowAutoMode] = useState(false)
    // V3 Phase 2, §6.6 Part 3 — deck present mode strips the app's own
    // chrome (topbar/tab strip/status bar). Deck.jsx lives deep inside this
    // component's own render tree (the "briefings" tab slot), so it
    // dispatches a real event rather than needing presenting threaded down
    // as a prop through every intermediate layer — the same destination-
    // neutral CustomEvent pattern already established for akili:navigate
    // etc. Reuses the exact same `!showAutoMode`-style chrome-hiding
    // condition already in place below, rather than inventing a second one.
    const [presenting, setPresenting] = useState(false)
    useEffect(() => {
        const h = (e) => setPresenting(!!e.detail?.active)
        window.addEventListener("akili:present-mode", h)
        return () => window.removeEventListener("akili:present-mode", h)
    }, [])
    // Sessions & Views full round (§3.4) — real app-boot restore of this
    // user's last-active real session (or a seeded honest default if none
    // exist yet), plus the real belt-and-suspenders 60s/beforeunload
    // persistence. Runs once; startSessionAutoPersist()'s own teardown
    // unregisters both real listeners on unmount.
    useEffect(() => {
        ensureActiveSession().catch(() => { /* real network hiccup — SessionControl's own popover open will retry via listSessions() */ })
        return startSessionAutoPersist()
    }, [])
    // Mode, not modules (§7.1) — Watch vs Workstation. Synchronous init from
    // localStorage (read in the useState initializer, not an effect) so the
    // very first render already reflects the right mode — no flash of the
    // wrong rail set on load, per the doc's own explicit warning about
    // async/setTimeout-applied mode classes. Sessions/filters/basket are
    // untouched by a mode switch (they're not part of this state at all).
    const [mode, setModeRaw] = useState(() => {
        try { return localStorage.getItem(MODE_STORAGE_KEY) === "work" ? "work" : "watch" } catch { return "watch" }
    })
    // Guards the mode-setter against a tab-type-driven effect (below) firing
    // right back — real "switching" flag, not a hopeful timing assumption.
    const modeSwitchGuardRef = useRef(false)

    // WHERE YOU WERE IN EACH MODE. Switching Watch -> Workstation and back
    // used to land on whatever tab happened to be active, so a round trip
    // did not return you to your place: you left the Editor mid-sentence,
    // looked at the map, came back and were somewhere else.
    const lastByMode = useRef({ watch: null, work: null })

    const setMode = useCallback((next) => {
        modeSwitchGuardRef.current = true
        setModeRaw(next)
        try { localStorage.setItem(MODE_STORAGE_KEY, next) } catch { /* ignore */ }
        setTimeout(() => { modeSwitchGuardRef.current = false }, 0)
    }, [])

    /** Switch modes and land on the module you last had open there. */
    const switchMode = useCallback((next) => {
        // READ SYNCHRONOUSLY. This used to record the outgoing tab inside a
        // setActiveTabId updater — which React runs during render, after
        // the line below had already read lastByMode back. The memory was
        // therefore always one switch behind, and the first switch had
        // nothing recorded at all. A state setter is not a way to read
        // state.
        const from = next === "work" ? "watch" : "work"
        const cur = tabsRef.current?.find((t) => t.id === activeTabIdRef.current)
        if (cur) lastByMode.current[from] = cur.type

        setMode(next)
        const want = lastByMode.current[next]
        // No remembered module the first time into a mode — the mode's own
        // default applies rather than an arbitrary tab.
        if (want) openTabRef.current?.(want)
        else openTabRef.current?.(next === "work" ? MODULE_TO_TAB_TYPE.cases : MODULE_TO_TAB_TYPE.situation)
    }, [setMode])

    // W / G keybindings (§7.1) — both guarded against firing while typing.
    useEffect(() => {
        const handler = (e) => {
            // Every text-entry surface, not just the three form tags. The
            // previous guard missed contenteditable, which this app uses, so
            // a bare letter shortcut fired while typing in one. isContentEditable
            // covers the element and any contenteditable ancestor; role=textbox
            // covers custom editors that are not contenteditable themselves.
            if (isTextEntry(e.target)) return

            // These require Alt (Option on Mac) rather than being bare keys.
            // A bare letter is one missed guard away from firing mid-sentence,
            // and the guard above can only ever enumerate the text surfaces it
            // knows about. Alt is used instead of Ctrl/Cmd because Ctrl+T and
            // Cmd+T are reserved by the browser for "new tab" and never reach
            // the page reliably.
            if (!e.altKey) return
            if (e.metaKey || e.ctrlKey) return

            if (e.key === "w" || e.key === "W" || e.code === "KeyW") { e.preventDefault(); switchMode(mode === "work" ? "watch" : "work") }
            else if (e.key === "g" || e.key === "G" || e.code === "KeyG") { e.preventDefault(); setMode("work"); openTab(MODULE_TO_TAB_TYPE.cases) }
            // Alt+T cycles auto -> light -> dark -> auto (PARALLAX spec §4.4).
            // Auto is first in the cycle because it is the default state the
            // other two are departures from.
            else if (e.key === "t" || e.key === "T" || e.code === "KeyT") {
                e.preventDefault()
                const cur = getThemeMode()
                setThemeMode(cur === "auto" ? "light" : cur === "light" ? "dark" : "auto")
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode])

    const [heatmapHours, setHeatmapHours] = useState(24)
    const [overwatchDetections, setOverwatchDetections] = useState([])

    useEffect(() => {
        const handler = () => setIsMobile(window.innerWidth < 768)
        window.addEventListener("resize", handler)
        return () => window.removeEventListener("resize", handler)
    }, [])

    useEffect(() => {
        const handler = () => setPhoneMode(phoneModeQuery())
        window.addEventListener("resize", handler)
        window.addEventListener("orientationchange", handler)
        return () => {
            window.removeEventListener("resize", handler)
            window.removeEventListener("orientationchange", handler)
        }
    }, [])

    // ── Mission profile ───────────────────────────────────────────────────────
    // Which section the account screen opens on — the rail's shield opens
    // it on Administration, everything else on the profile itself.
    const [profileSection, setProfileSection] = useState(null)
    // The unread count on the rail. Polled here rather than inside Chat so
    // the badge is right before you have ever opened the screen — which is
    // the only time a badge is doing any work.
    const [unreadMessages, setUnreadMessages] = useState(0)
    // Poll for the unread badge. Every 20 seconds, and never while the tab
    // is hidden: a backgrounded console asking forever is how a laptop
    // ends up warm in somebody's bag.
    useEffect(() => {
        let alive = true
        const tick = async () => {
            if (!alive || document.hidden) return
            try {
                const { unreadTotal } = await import("./lib/chatApi.js")
                const d = await unreadTotal()
                if (alive) setUnreadMessages(d?.unread || 0)
            } catch { /* signed out, or the server is away */ }
        }
        tick()
        const t = setInterval(tick, 20000)
        const vis = () => { if (!document.hidden) tick() }
        document.addEventListener("visibilitychange", vis)
        return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", vis) }
    }, [])

    const [profile, setProfile] = useState(() => loadProfile())
    const [focusRegions, setFocusRegions] = useState(() => loadProfile()?.focusRegions || [])
    const initialProfilePanRef = useRef(false)

    useEffect(() => {
        if (profile) return
        fetch(`${API}/profile/load`)
            .then(r => r.json())
            .then(d => {
                if (d.profile) {
                    saveProfileToStorage(d.profile)
                    setProfile(d.profile)
                    setFocusRegions(d.profile.focusRegions || [])
                }
            })
            .catch(() => {})
    }, [])   // eslint-disable-line react-hooks/exhaustive-deps

    const fetchSurfaceRef = useRef(null)
    const surfaceRetryRef = useRef(null)
    const surfaceRefreshKickRef = useRef(0)

    const handleProfileSave = useCallback((p) => {
        const oldRegions = profile?.focusRegions || []
        saveProfileToStorage(p)
        setProfile(p)
        fetch(`${API}/profile/save`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(p),
        })
        .then(r => r.json())
        .then(d => {
            if (d.items) {
                setSurfaceItems(d.items)
                setSurfaceUpdatedAt(d.updated_at || null)
            }
        })
        .catch(() => { setTimeout(() => fetchSurfaceRef.current?.(), 400) })
        // Pan to first newly-added focus region
        const added = (p.focusRegions || []).find(r => !oldRegions.includes(r) && REGION_COORDS[r])
        if (added && REGION_COORDS[added]) {
            const { lat, lon, zoom } = REGION_COORDS[added]
            setSearchTarget({ lat, lon, zoom, key: Date.now() })
        }
    }, [profile])

    // ── Tab system ────────────────────────────────────────────────────────────
    const [tabs, setTabs] = useState(() => loadTabsFromStorage())

    /* ── PARALLAX v6 chrome ──────────────────────────────────────────────
       A THEATER IS NOT A TAB OF THIS APP. In v6 the tab strip holds
       theaters — regions you watch, each with its own severity, its own
       scan-area count and its own default view — while the rail holds the
       modes that operate inside whichever theater is selected (A2.1/A3).
       Seeded here with the spec's own first-run defaults (A10.1) until the
       theater data model lands; the shape is already the real one, so
       replacing the seed is a data change, not a layout change. */
    /* A THEATER CARRIES ITS OWN VIEW AND ITS OWN LAYERS. Selecting one was
       setting an id and nothing else — the map stayed wherever it was and
       showed whatever was already on, so "Taiwan Strait" and "Red Sea
       watch" were the same picture with a different label on it.

       `view` is where the camera goes. `layers` is what that theater is
       FOR: a strait watch wants chokepoints, ports and hulls; an air
       theater wants aircraft and airfields. Anything not named is turned
       off, so switching theater is a clean change of subject rather than
       an accumulation of everything you have ever switched on. */
    /* The SEED IS NOW A FALLBACK, not the data. Theaters are rows the
       account owns (backend/routers/theaters.py) and are loaded below;
       this is what the strip shows for the half-second before they arrive,
       and what it falls back to if the server cannot be reached. The three
       match the seeded defaults exactly, so nothing flickers into
       something different. */
    const [theaters, setTheaters] = useState(() => ([
        { id: "redsea", name: "Red Sea watch",  sev: "critical", n: 8,
          view: { lat: 13.6, lon: 43.3, height: 2_400_000 },
          layers: { groups: ["maritime", "news"],
                    infra: ["chokepoints", "ports", "cables"],
                    tracks: ["vessels"] } },
        { id: "hormuz", name: "Hormuz transit", sev: "elevated", n: 7,
          view: { lat: 26.6, lon: 56.4, height: 2_000_000 },
          layers: { groups: ["maritime", "news"],
                    infra: ["chokepoints", "ports"],
                    tracks: ["vessels"] } },
        { id: "taiwan", name: "Taiwan Strait",  sev: "steady",   n: 6,
          view: { lat: 24.3, lon: 119.6, height: 2_600_000 },
          layers: { groups: ["maritime", "air", "news"],
                    infra: ["chokepoints", "ports", "airfields"],
                    tracks: ["vessels", "aircraft"] } },
    ]))
    const [theaterId, setTheaterId] = useState("redsea")
    const [editingTheater, setEditingTheater] = useState(null)   // row | "new" | null

    const refreshTheaters = useCallback(async (selectId) => {
        try {
            const rows = await listTheaters()
            if (!rows?.length) return
            setTheaters(rows)
            setTheaterId((cur) => {
                if (selectId) return selectId
                // The id the fallback used ("redsea") is not a real row id,
                // so the first load has to re-point at a real one.
                return rows.some((t) => t.id === cur) ? cur : rows[0].id
            })
        } catch { /* signed out, or offline — the fallback strip stands */ }
    }, [])
    useEffect(() => { refreshTheaters() }, [refreshTheaters])
    /* AND AGAIN WHEN SOMEONE SIGNS IN. The load above runs at mount, which
       on a fresh visit is before sign-in: it fails quietly and the
       placeholder strip ("redsea", "hormuz", "taiwan" — not real rows)
       stayed until the next reload. Anything done to those tabs — editing,
       favouriting, filing — acted on rows that do not exist. */
    useEffect(() => subscribeAuth(() => { if (getCurrentUser()) refreshTheaters() }), [refreshTheaters])
    useEffect(() => {
        const open = () => openOverlay("overlay:settings")
        window.addEventListener("akili:open-settings", open)
        return () => window.removeEventListener("akili:open-settings", open)
    }, [])

    /* OPENING A SHARED LINK. #view=…&theater=… (state/shareLink.js) is read
       once, held until the real theater rows have loaded, then applied: the
       theater is selected and the camera set. The camera is set twice,
       because the globe may still be mounting the first time; set-camera is
       an instant jump, so repeating it is harmless. The hash is then cleared
       so a reload does not snap back to the shared view. */
    const sharedLink = useRef(typeof window !== "undefined" ? decodeView(window.location.hash) : { view: null, theater: null })
    useEffect(() => {
        const link = sharedLink.current
        if (!link || (!link.view && !link.theater)) return
        if (link.theater && !theaters.some((t) => t.id === link.theater)) return
        sharedLink.current = null
        if (link.theater) {
            const t = theaters.find((x) => x.id === link.theater)
            setTheaterId(t.id)
            window.dispatchEvent(new CustomEvent("akili:theater-select", { detail: { id: t.id, name: t.name, view: link.view ? null : t.view, layers: t.layers } }))
        }
        if (link.view) {
            openTabRef.current?.("situation")
            const go = () => window.dispatchEvent(new CustomEvent("akili:set-camera", { detail: link.view }))
            setTimeout(go, 1500); setTimeout(go, 4500)
        }
        try { window.history.replaceState(null, "", window.location.pathname + window.location.search) } catch { /* ignore */ }
    }, [theaters])

    /* A case shared in a chat opens the case workspace. The tab has to be
       opened HERE — Cases only hears the event once it is mounted, and
       until somebody has visited it once, it is not. The event is
       re-dispatched after the tab opens so the listener that just mounted
       actually receives it. */
    useEffect(() => {
        const open = (e) => {
            const id = e?.detail?.caseId
            if (!id || e.detail.__relayed) return
            openTabRef.current?.("caseWork")
            setTimeout(() => window.dispatchEvent(new CustomEvent("akili:open-case", {
                detail: { caseId: id, __relayed: true },
            })), 60)
        }
        window.addEventListener("akili:open-case", open)
        return () => window.removeEventListener("akili:open-case", open)
    }, [])
    /* Filing needs the theater from the first render, not from the first
       tab click — otherwise anything saved before you touch the tab bar
       lands in whatever case was last used. */
    useEffect(() => {
        setActiveTheater((theaters.find((t) => t.id === theaterId) || {}).name || null)
    }, [theaterId, theaters])

    const [plxNarrow, setPlxNarrow] = useState(() => window.innerWidth < 1200)
    const [plxClock, setPlxClock] = useState("")
    const [plxHour, setPlxHour] = useState(() => new Date().getHours() + new Date().getMinutes() / 60)
    const [plxThemeMode, setPlxThemeMode] = useState(() => getThemeMode())
    const [plxMenu, setPlxMenu] = useState(null)
    /* THE TOOL BUTTONS DRIVE THE REAL PANES, not a local mirror of them.
       They were setting a `plxLeft` string that nothing else in the app
       read, so the Layers button lit up and no pane ever appeared. The
       panes read the persisted chrome store, so the rail has to as well —
       then the button and the pane cannot disagree, and the state
       survives a reload like every other chrome setting. */
    const [layersOpen, toggleLayers] = useChrome("leftPanel")
    const [inspectorOpen, toggleInspector] = useChrome("rightPanel")
    const plxLeft = layersOpen ? "layers" : inspectorOpen ? "selection" : null
    /* The rail's Timeline button drives the REAL strip, through the same
       persisted chrome store the Layers and Inspector panes read. It used
       to set a local flag nothing consumed. */
    const [plxDrawer, togglePlxDrawer] = useChrome("timeline")
    /* FAVOURITE THEATERS. The star was a local flag that meant nothing.
       It now marks the selected theater a favourite, and favourites lead
       the tab strip. Kept in this browser (a per-person convenience); a
       store that fails just means no favourites, never a broken strip. */
    const [favTheaters, setFavTheaters] = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem("plx:fav-theaters") || "[]")) } catch { return new Set() }
    })
    const toggleFavTheater = useCallback((id) => {
        setFavTheaters((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            try { localStorage.setItem("plx:fav-theaters", JSON.stringify([...next])) } catch { /* private mode */ }
            return next
        })
    }, [])
    const orderedTheaters = useMemo(() => [
        ...theaters.filter((t) => favTheaters.has(t.id)),
        ...theaters.filter((t) => !favTheaters.has(t.id)),
    ], [theaters, favTheaters])
    const [plxMenuPos, setPlxMenuPos] = useState({ l: 60, t: 74 })
    const [plxToast, setPlxToast] = useState(null)
    const [plxAlertsOpen, setPlxAlertsOpen] = useState(false)
    const plxOpenedAt = useRef(new Date().toISOString().slice(11, 16) + "Z")
    // The menu bar's avatars: colleagues actually signed in now.
    const onlineUsers = useOnlineUsers(getCurrentUser()?.id)

    useEffect(() => {
        // A6.4 — one toast at a time, cleared 2.6 s after the text changes.
        if (!plxToast) return
        const t = setTimeout(() => setPlxToast(null), 2600)
        return () => clearTimeout(t)
    }, [plxToast])

    useEffect(() => {
        // A2.2: the clock refreshes every 20 s, and the auto theme is
        // re-evaluated on the same tick (A9.2) — one timer, not two.
        const tick = () => {
            const d = new Date()
            setPlxClock(d.toISOString().slice(11, 16) + "Z")
            setPlxHour(d.getHours() + d.getMinutes() / 60)
        }
        tick()
        const iv = setInterval(tick, 20000)
        const onRs = () => setPlxNarrow(window.innerWidth < 1200)
        window.addEventListener("resize", onRs)
        return () => { clearInterval(iv); window.removeEventListener("resize", onRs) }
    }, [])
    const [activeTabId, setActiveTabId] = useState(() => {
        const saved = loadTabsFromStorage()
        try {
            const s = localStorage.getItem(TAB_STORAGE_KEY + "-active")
            // The saved id must still name a tab that survived validation.
            // A stale id left every real view hidden, because activeTabType
            // matched none of them.
            const hit = s && saved.find(t => t.id === s)
            /* SOME MODULES ARE NOT A PLACE TO LAND.
               The roster and the account page are things you go to on
               purpose and then leave; the v6 chrome has no close button for
               a module (the tab bar holds theaters, not modules), so
               restoring one as the active view strands you on it with no
               way out. Reported as "I can't close the roster" — it was
               simply the last thing open, restored. */
            if (hit && !NON_LANDING_TABS.has(hit.type)) return s
        } catch { /* ignore */ }
        // THE MAP IS THE FRONT DOOR. Falling back to saved[0] meant opening
        // on whatever happened to be first in a restored list — in practice
        // a Workstation module. Situation is the app's home screen, and it
        // is the one tab loadTabsFromStorage guarantees exists.
        return saved.find(t => t.type === "situation")?.id || saved[0]?.id || "situation"
    })
    const tabHistoryRef = useRef([])

    // Derived — used throughout instead of `page`
    const activeTab     = tabs.find(t => t.id === activeTabId) || tabs[0]
    const activeTabType = activeTab?.type || "situation"

    // Full UI rebuild: which of the 5 fixed destinations (if any) is active —
    // null when on the Globe/Maritime home screen ("map") or a real
    // non-destination tab ("analytics"), since neither is one of the 5.
    const activeDestination = DESTINATION_KEYS.includes(activeTabType) ? activeTabType : null
    const MODE_LABELS = {
        map: "MARITIME OPERATIONAL VIEW",
        dashboard: "DASHBOARD",
        reports: "REPORTS",
        watchlists: "WATCHLISTS",
        sources: "INTEL", // UI correction pass Part 11.1: destination renamed "Intel" in nav; this mode-strip label follows
        aiCouncil: "AI COUNCIL",
        analytics: "ANALYTICS",
    }
    const modeLabel = MODE_LABELS[activeTabType] || activeTabType.toUpperCase()

    // ── Navigation ────────────────────────────────────────────────────────────
    const [searchTarget, setSearchTarget] = useState(null)

    // UI correction pass, Part 6 — Dashboard's fullscreen map + Canonical
    // operational-view switcher. Lifted here (not owned by Dashboard.jsx
    // itself) since the Canonical dropdown lives in the persistent header,
    // a sibling component Dashboard has no direct access to.
    const [dashboardFullscreen, setDashboardFullscreen] = useState(false)
    const [canonicalView, setCanonicalView] = useState("maritime")

    // ── Right panel slot — mutually exclusive ─────────────────────────────────
    // null | "layers" | "detail" | "profile" | "settings" | "health" | "workspaces" | "situations" | "chat" | "alerts"
    const [rightPanel, setRightPanel] = useState(null)

    // Generate/Briefings/print-layout wiring — Generate's completed run (or
    // its "printable briefing" button) opens the Briefings tab pre-loaded
    // with that report; printReportId, when set, swaps the Briefings tab's
    // content for the print layout (#view-doc is a hidden view, reachable
    // only from here or the reader's own print action, never the rail).
    const [briefingsInitialId, setBriefingsInitialId] = useState(null)
    const [printReportId, setPrintReportId] = useState(null)
    // V3 Phase 2, §6.1/§6.6 — the deck is a third rendering of the same
    // real document object, reachable the exact same way print is: never
    // its own rail destination, only from the reader toolbar, the print
    // toolbar, or Generate's footer. deckReportId swaps the Briefings tab's
    // content for the deck, same pattern as printReportId.
    const [deckReportId, setDeckReportId] = useState(null)

    const openRightPanel = useCallback((id) => {
        setRightPanel(prev => prev === id ? null : id)
    }, [])

    // ── Surface pool / notifications ──────────────────────────────────────────
    const [surfaceItems,     setSurfaceItems]     = useState([])
    const [surfaceUpdatedAt, setSurfaceUpdatedAt] = useState(null)
    const [selectedSurface,  setSelectedSurface]  = useState(null)
    const [readIds,          setReadIds]          = useState(() => {
        try { return new Set(JSON.parse(localStorage.getItem("akili-notif-read-v1") || "[]")) }
        catch { return new Set() }
    })
    // Real correlation-engine hits, merged into the same alert log as the
    // surface-pool items above (see NotificationsDrawer's kind:"fusion" row).
    const [fusionEvents, setFusionEvents] = useState([])
    useEffect(() => {
        if (!profile) return
        let cancelled = false
        const load = () => fetch(`${API}/api/fusions?status=active&limit=50`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && Array.isArray(d)) setFusionEvents(d) })
            .catch(() => {})
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [profile])
    // /api/notifications rows, NOT FusionEvents. Running them through the
    // fusion normaliser dropped every id, flattened every severity and
    // threw away `reason` — the sentence that says why the thing fired.
    const notifItems = useMemo(
        () => mergeNotificationFeed(surfaceItems, fusionEvents),
        [surfaceItems, fusionEvents]
    )
    const unreadCount = notifItems.filter(i => !readIds.has(i.id)).length
    // The inbox counts SIGNALS waiting in it, which is a different
    // question from how many alerts are unread in the tray. They were
    // the same number, so the inbox badge reported the wrong surface.
    const inboxCount = useMemo(
        () => buildWatchQueueRows(surfaceItems || []).length, [surfaceItems])

    // ── What actually becomes a notification ─────────────────────────────
    // Source of truth is /api/notifications, NOT the surface pool. The
    // backend already answers the two questions this surface needs — is this
    // worth interrupting someone for, and what does it say in English — and
    // answering them here instead would mean reimplementing geography,
    // sanctions authorities and arrival tracking in the browser, against
    // data the browser does not have.
    //
    // The endpoint returns the filtered set only: ~150/day out of ~860
    // alerts/day, each already carrying a rebuilt title (never an MMSI, never
    // a bare date) and the `reason` its relevance rule fired on. The surface
    // pool stays exactly where it was — it feeds the Inbox, which is the
    // working record and is meant to hold everything.
    const [notifFeed, setNotifFeed] = useState([])
    useEffect(() => {
        if (!profile) return
        let cancelled = false
        const load = () => fetch(`${API}/api/notifications?limit=60&hours=48`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && Array.isArray(d)) setNotifFeed(d) })
            .catch(() => {})
        load()
        // The tray is the surface people judge "is anything happening" by.
        // The timer is now the FLOOR rather than the mechanism: the stream
        // below refetches the moment the pipeline writes something, and this
        // catches whatever the stream missed while the laptop was asleep or
        // a proxy was eating the connection.
        const t = setInterval(load, 20000)
        // Coalesced: a burst of twenty alerts in one second is one refetch,
        // not twenty. Without this a busy minute would be a request storm
        // against the endpoint the tray depends on.
        let pending = null
        const off = subscribeLive(() => {
            if (pending) return
            pending = setTimeout(() => { pending = null; load() }, 400)
        }, ["alert.created", "signal.created", "fusion.created", "surge.created"])
        return () => {
            cancelled = true
            clearInterval(t)
            if (pending) clearTimeout(pending)
            off()
        }
    }, [profile])

    // CONNECTIONS THE GRAPH WORKED OUT, as opposed to events that
    // happened. This is the feed behind "a link has been found between
    // Ukraine and Sudan": link_predict walks the ontology for routes
    // that no single record states, and a new one appearing is worth
    // telling somebody about. Polled slowly — the graph is rebuilt on a
    // timer, not continuously, and nothing here is time-critical.
    const [findings, setFindings] = useState([])
    useEffect(() => {
        if (!profile) return
        let cancelled = false
        const load = () => fetch(`${API}/api/ontology/findings?limit=20`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled && d?.available) setFindings(d.findings || []) })
            .catch(() => {})
        load()
        const t = setInterval(load, 300000)
        return () => { cancelled = true; clearInterval(t) }
    }, [profile])

    const findingSeenRef = useRef(null)
    useEffect(() => {
        if (!findings.length) return
        const firstLoad = findingSeenRef.current === null
        if (firstLoad) findingSeenRef.current = new Set()
        const seen = findingSeenRef.current
        for (const f of findings) {
            const id = `finding:${f.origin}|${(f.via || []).join(">")}|${f.dst}`
            if (seen.has(id)) continue
            seen.add(id)
            pushNotification({
                // Never an interrupt. An inference is a question worth
                // asking, and interrupting someone with a hypothesis is
                // how a system teaches people to ignore it.
                silent: true,
                id,
                sev: "low",
                kind: "discovery",
                title: f.claim || "Connection found",
                // The chain IS the notification. A bare claim with no
                // route is unusable: the reader cannot check it, so
                // they cannot act on it or dismiss it honestly.
                sub: [f.chain, `inferred · confidence ${Math.round((f.conf || 0) * 100)}%`]
                    .filter(Boolean).join(" · "),
                ref: null,
                ts: Date.now(),
            })
        }
    }, [findings])

    // Only signals that appear AFTER the first load raise anything: on mount
    // the existing backlog is recorded silently, because replaying a hundred
    // historical criticals as cards on every page load is precisely the
    // "shouts at every event" failure the rule exists to prevent.
    const notifSeenRef = useRef(null)
    useEffect(() => {
        if (!notifFeed.length) return
        // THE FIRST LOAD FILLS THE TRAY WITHOUT INTERRUPTING. It used to
        // record the backlog in a Set and nowhere else, so the tray was
        // empty until something new happened to arrive — and most of
        // what this system detects carries a STABLE id (a surge, a
        // fusion point, a town that changed hands a fortnight ago), so
        // "something new" could be hours away. The whole surface read as
        // dead because the only thing feeding it was change.
        const firstLoad = notifSeenRef.current === null
        if (firstLoad) notifSeenRef.current = new Set()
        const seen = notifSeenRef.current
        for (const i of notifFeed) {
            if (seen.has(i.id)) continue
            seen.add(i.id)
            pushNotification({
                silent: firstLoad,
                id: i.id,
                sev: i.sev || "moderate",
                kind: i.kind || "signal",
                title: i.title || "Signal",
                // The reason is the whole point of showing it: an analyst who
                // disagrees with a notification can see the rule that raised
                // it rather than guessing at one.
                sub: [i.reason, i.region].filter(Boolean).join(" · "),
                ref: (i.lat != null && i.lon != null) ? { lat: i.lat, lon: i.lon } : null,
                // WHEN IT HAPPENED, in the order the fields mean it.
                // created_at is when the ROW was written, which for a
                // backfilled or late-ingested event is now — and an event
                // from five hours ago would then look current and take the
                // screen. published_at/occurred_at are the event's own
                // time; created_at is the last resort.
                ts: Date.parse(i.occurred_at || i.published_at || i.created_at || "") || Date.now(),
            })
        }
    }, [notifFeed])

    /* LIVE TELEGRAM. The backend reads the joined channels every minute;
       each newly published post (kinetic, precisely located) raises a card
       with its headline while it is fresh. The first load is history and
       goes to the tray silently, like every other feed. */
    const tgSeenRef = useRef(null)
    useEffect(() => {
        if (!profile) return undefined
        let live = true
        const load = () => fetch(`${API}/api/telegram/posts?hours=24`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!live || !d) return
                const first = tgSeenRef.current === null
                if (first) tgSeenRef.current = new Set()
                for (const p of d.posts || []) {
                    if (tgSeenRef.current.has(p.id)) continue
                    tgSeenRef.current.add(p.id)
                    pushNotification({
                        silent: first, id: p.id, kind: "telegram", sev: p.role === "official" ? "high" : "moderate",
                        title: p.headline || "Telegram report",
                        sub: [p.channel_title || p.channel, p.place, p.media !== "none" ? p.media : null].filter(Boolean).join(" · "),
                        ref: { lat: p.lat, lon: p.lon },
                        ts: Date.parse(p.posted_at) || Date.now(),
                    })
                }
            }).catch(() => {})
        load()
        const t = setInterval(load, 60_000)
        return () => { live = false; clearInterval(t) }
    }, [profile])

    const handleMarkRead = useCallback((id) => {
        setReadIds(prev => {
            const next = new Set(prev)
            next.add(id)
            try { localStorage.setItem("akili-notif-read-v1", JSON.stringify([...next])) } catch {}
            return next
        })
    }, [])

    // Watchlists destination's entity chips only expose a real, concrete
    // (entityType, entityId) pair when one is genuinely derivable (see
    // WatchlistsPage.jsx) — reuses the same akili:show-entity deep-link
    // GlobePopup.jsx already listens for (entityStore lookup), same 2-event
    // "open the map, then show the entity" pattern NewsPage.jsx's own
    // onOpenInspector already establishes.
    const handleWatchlistSelectEntity = (entityType, entityId) => {
        openTab("situation")
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent("akili:show-entity", { detail: { entityType, entityId } }))
        }, 50)
    }

    // ── Header/footer real system status pill (full UI rebuild spec 3.1/3.2) ──
    const [healthData, setHealthData] = useState(null)
    useEffect(() => {
        let cancelled = false
        const load = () => fetch(`${API}/api/health/detailed`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (!cancelled) setHealthData(d) })
            .catch(() => { if (!cancelled) setHealthData(null) })
        load()
        const t = setInterval(load, 60000)
        return () => { cancelled = true; clearInterval(t) }
    }, [])
    const systemHealth = useMemo(() => summarizeHealth(healthData), [healthData])

    // The task/queue count and its 60-second poll of /api/reports/tasks
    // went with the status bar. Nothing displayed the number any more, so
    // the request was pure load on a backend whose stability is the point
    // of much of this work.

    // Redesign Round 2 — command palette open state (the global ⌘K/1-7
    // keyboard handler lives further down, after openTab is declared).
    const [paletteOpen, setPaletteOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)

    // One overlay at a time (PARALLAX spec §19), enforced centrally rather
    // than at each opener — an opener only knows about itself, which is how
    // panels come to stack. Both flags are derived from the single registry,
    // so opening either one necessarily closes the other and there is no
    // state in which both are true. Escape is handled inside the manager.
    const [trayOpen, setTrayOpen] = useState(false)
    useEffect(() => subscribeOverlay((cur) => {
        setPaletteOpen(cur === "overlay:palette")
        setSettingsOpen(cur === "overlay:settings")
        setTrayOpen(cur === "overlay:tray")
    }), [])

    // Live unread count comes from the notification store, which is the one
    // record of what actually arrived.
    const [notifUnreadCount, setNotifUnreadCount] = useState(() => notifUnread())
    useEffect(() => subscribeNotifications(() => setNotifUnreadCount(notifUnread())), [])
    const markNotificationRead = useCallback((id) => {
        import("./state/notificationStore.js").then((m) => m.markRead(id))
    }, [])

    useEffect(() => {
        if (!profile) return
        let cancelled = false

        const clearRetry = () => {
            if (surfaceRetryRef.current) {
                clearTimeout(surfaceRetryRef.current)
                surfaceRetryRef.current = null
            }
        }

        const fetchSurface = () => {
            const started = performance.now()
            fetch(`${API}/api/surface`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d || cancelled) return
                    console.info("[surface/fetch]", {
                        ms: Math.round(performance.now() - started),
                        count: (d.items || []).length,
                        diagnostics: d.diagnostics || null,
                    })
                    setSurfaceItems(d.items || [])
                    setSurfaceUpdatedAt(d.updated_at || null)

                    clearRetry()
                    if ((d.items || []).length > 0) return

                    if (Date.now() - surfaceRefreshKickRef.current > 30000) {
                        surfaceRefreshKickRef.current = Date.now()
                        fetch(`${API}/api/surface/refresh`, { method: "POST" }).catch(() => {})
                    }

                    surfaceRetryRef.current = setTimeout(() => {
                        fetchSurfaceRef.current?.()
                    }, 15000)
                })
                .catch(() => {})
        }
        fetchSurfaceRef.current = fetchSurface
        fetchSurface()
        const t = setInterval(fetchSurface, 120000)
        return () => {
            cancelled = true
            clearInterval(t)
            clearRetry()
        }
    }, [profile])   // eslint-disable-line react-hooks/exhaustive-deps

    const [surfaceContext, setSurfaceContext] = useState(null)
    const [surfaceEnrichment, setSurfaceEnrichment] = useState(null)

    const handleSurfaceItemClick = useCallback((item) => {
        setSelectedSurface(item)
        setRightPanel("detail")
        setSurfaceContext(null)
        setSurfaceEnrichment(null)
    }, [])

    // Called by SurfaceDetailPanel when context loads (airports) or location clicked
    const handleContextUpdate = useCallback((ctx) => {
        setSurfaceContext(ctx)
        if (ctx?.panTo) {
            setSearchTarget({
                lat:   ctx.panTo.lat,
                lon:   ctx.panTo.lon,
                zoom:  9,
                label: ctx.panTo.label,
                key:   Date.now(),
            })
        }
    }, [])

    const handleEnrichmentUpdate = useCallback((payload) => {
        setSurfaceEnrichment(payload)
    }, [])

    const contextualLayers = useMemo(() => {
        if (!selectedSurface) return null
        const t = selectedSurface.type || selectedSurface.infrastructure_type || ""
        const layers = {}
        if (t === "aviation")  { layers.airports = true }
        if (t === "maritime")  { layers.ports = true; layers.eez = true; layers.chokepoints = true }
        if (t === "energy")    { layers.powerPlants = true; layers.pipelines = true }
        if (t === "missile")   { layers.airports = true }
        if (t === "armed_clash" || t === "explosion" || selectedSurface.source_type === "conflict_zone") { layers.borders = true; layers.hospitals = true }
        if (Object.keys(layers).length === 0) return null
        return { layers }
    }, [selectedSurface])

    // ── App settings — real Settings round: real per-user, server-persisted
    // store (settingsStore.js), replacing the old localStorage + non-per-
    // user global /api/settings dict. Same flat keys/consumers as before
    // (real alert sound cues, real alert-poll interval below) — only the
    // persistence mechanism underneath changed. ───────────────────────────
    const [appSettings, setAppSettings] = useState(getSettings)
    const settingsRef = useRef(appSettings)
    useEffect(() => { settingsRef.current = appSettings }, [appSettings])

    useEffect(() => subscribeSettings(setAppSettings), [])

    // ── Real-time alert sound cues (UI correction pass: toast popups removed
    // entirely — alerts surface exclusively via the header bell badge and the
    // Watchlists console now; this effect keeps the real audio-cue behavior,
    // which is a distinct "Sound" toggle, not a toast) ────────────────────────
    const alertSinceRef = useRef(new Date().toISOString())
    const seenAlertIdsRef = useRef(new Set())

    // Derived from unified settings (fixes dual-key conflict with old "akili-sound-muted")
    const soundMuted = appSettings.soundMuted

    const onToggleSound = useCallback(() => {
        updateSetting("soundMuted", !settingsRef.current.soundMuted)
    }, [])

    useEffect(() => {
        if (!profile) return
        const poll = () => {
            const s = settingsRef.current
            const since = alertSinceRef.current
            fetch(`${API}/api/alerts/new?since=${encodeURIComponent(since)}`)
                .then(r => r.ok ? r.json() : null)
                .then(d => {
                    if (!d?.alerts?.length) return
                    alertSinceRef.current = new Date().toISOString()
                    const incoming = d.alerts.filter(a => a.priority !== false)
                    if (!incoming.length) return
                    const fresh = incoming.filter(a => !seenAlertIdsRef.current.has(a.id))
                    fresh.forEach(a => seenAlertIdsRef.current.add(a.id))
                    if (fresh.length && !s.soundMuted) {
                        const top = fresh.reduce((a, b) =>
                            (["critical","significant","elevated","low"].indexOf(a.severity_tier) <=
                             ["critical","significant","elevated","low"].indexOf(b.severity_tier)) ? a : b
                        )
                        // Per-tier sound gate
                        const tier = top.severity_tier
                        const shouldPlay =
                            (tier === "critical"    && s.soundCritical)    ||
                            (tier === "significant" && s.soundSignificant) ||
                            (tier === "elevated"    && s.soundElevated)    ||
                            (tier === "low")
                        if (shouldPlay) {
                            resumeAudio()
                            playAlert(tier, top.type)
                        }
                    }
                    // Also surface unread notification count
                    setReadIds(prev => prev)   // trigger recompute
                })
                .catch(() => {})
        }
        const intervalMs = (settingsRef.current.alertInterval || 15) * 1000
        const tid = setInterval(poll, intervalMs)
        return () => clearInterval(tid)
    }, [profile, appSettings.alertInterval])  // eslint-disable-line react-hooks/exhaustive-deps

    // UI correction pass: the raw-DOM "anomaly" toast that used to live here
    // (System 6, /api/alerts/recent polling every 2 minutes) is removed
    // entirely — no exceptions, per the explicit ground rule. That endpoint's
    // real alerts already surface through the header bell badge and the
    // Watchlists console via the existing /api/alerts/new poll above.


    const [mapViewport, setMapViewport] = useState(null)

    // ── Workspace state ───────────────────────────────────────────────────────
    const [workspaces,        setWorkspaces]        = useState(() => loadWorkspaces())
    const [activeWorkspaceId, setActiveWorkspaceId] = useState(() => {
        const ws = loadWorkspaces()
        return loadActiveId(ws)
    })
    const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || workspaces[0]

    useEffect(() => {
        if (!profile || initialProfilePanRef.current) return
        const firstRegion = (profile.focusRegions || []).find(r => REGION_COORDS[r])
        if (!firstRegion) return
        // Pan only if the workspace is at a default starting position, not a
        // user-chosen one. Checks both the current default [20, 0] zoom≤3 and
        // the old Tanzania default [-6.5, 35] that may be in saved workspaces.
        const c = activeWorkspace?.center
        const z = activeWorkspace?.zoom ?? 2
        const isGlobalDefault   = !c || (Math.abs((c[0] ?? 0) - 20) < 0.5 && Math.abs((c[1] ?? 0) - 0) < 0.5 && z <= 3)
        const isTanzaniaDefault = Array.isArray(c) && Math.abs((c[0] ?? 0) - (-6.5)) < 0.5 && Math.abs((c[1] ?? 0) - 35) < 0.5
        const isDefaultWorkspaceView = isGlobalDefault || isTanzaniaDefault
        if (!isDefaultWorkspaceView) {
            initialProfilePanRef.current = true
            return
        }
        const { lat, lon, zoom } = REGION_COORDS[firstRegion]
        setSearchTarget({ lat, lon, zoom, key: Date.now() })
        initialProfilePanRef.current = true
    }, [profile, activeWorkspace])

    const handleWorkspaceSwitch = useCallback((id) => {
        setActiveWorkspaceId(id)
        const ws = workspaces.find(w => w.id === id)
        if (ws?.center) {
            setSearchTarget({ lat: ws.center[0], lon: ws.center[1], zoom: ws.zoom || 6, key: Date.now() })
        }
        saveWorkspacesToStorage(workspaces, id)
        if (rightPanel === "workspaces") setRightPanel(null)
    }, [workspaces, rightPanel])

    const handleCreateWorkspace = useCallback((name) => {
        const ws = newWorkspace(name)
        const next = [...workspaces, ws]
        setWorkspaces(next)
        setActiveWorkspaceId(ws.id)
        saveWorkspacesToStorage(next, ws.id)
    }, [workspaces])

    const handleDeleteWorkspace = useCallback((id) => {
        const next = workspaces.filter(w => w.id !== id)
        if (next.length === 0) return
        const nextActive = activeWorkspaceId === id ? next[0].id : activeWorkspaceId
        setWorkspaces(next)
        setActiveWorkspaceId(nextActive)
        saveWorkspacesToStorage(next, nextActive)
    }, [workspaces, activeWorkspaceId])

    const handleViewportChange = useCallback((center, zoom, bounds) => {
        if (bounds) {
            setMapViewport({ center, zoom, bounds })
        }
        setWorkspaces(prev => {
            const next = prev.map(w =>
                w.id === activeWorkspaceId ? { ...w, center, zoom } : w
            )
            saveWorkspacesToStorage(next, activeWorkspaceId)
            return next
        })
    }, [activeWorkspaceId])

    const handleLayersChange = useCallback((layers) => {
        setWorkspaces(prev => {
            const next = prev.map(w =>
                w.id === activeWorkspaceId ? { ...w, layers } : w
            )
            saveWorkspacesToStorage(next, activeWorkspaceId)
            return next
        })
    }, [activeWorkspaceId])

    // ── Tab management ────────────────────────────────────────────────────────
    const switchTab = useCallback((id) => {
        setActiveTabId(prev => {
            if (prev === id) return prev
            tabHistoryRef.current = [...tabHistoryRef.current, prev]
            return id
        })
    }, [])

    // V3 Phase 1, §3.4 — record-scoped tabs. A plain module switch
    // (`openTab("dossiers")`, no opts) keeps its exact existing behaviour:
    // one base tab per module type, reused, never duplicated. Opening a
    // SPECIFIC record (`openTab("dossiers", {recordRef:"ent:AOI-14",
    // label:"Dossier · Red Sea corridor"})`) creates or reuses a tab keyed
    // on (type, recordRef) instead — a real, separate tab per record,
    // distinct from that module's own base tab. This is the real
    // implementation the pre-existing (audited, unused) retitleTab stub
    // was left for.
    // Redesign Round 2, §3 — real contextual tab retitling (e.g. opening a
    // specific Dossier or generated report retitles its own tab, distinct
    // from the module's own display name). Declared before openTab (which
    // now references it in its own dependency array) rather than after —
    // useCallback's dependency array is evaluated eagerly at this line, so
    // referencing a same-scope `const` declared later would be a real
    // temporal-dead-zone crash, not just a style preference.
    const retitleTab = useCallback((id, label) => {
        setTabs(prev => prev.map(t => (t.id === id ? { ...t, label } : t)))
    }, [])

    const tabsRef = useRef([])
    const openTabRef = useRef(null)
    const activeTabIdRef = useRef(null)

    const openTab = useCallback((type, opts) => {
        // Redesign Round 2 — real tab types for the new 7-module rail
        // (data/modules.js) plus the pre-existing "dashboard"/"sources"/
        // "aiCouncil" types, which are no longer reachable from the new
        // TopBar's module rail (the new module list has no equivalent slot
        // for them — see the redesign prompt's own module mapping) but are
        // left as real, working dead-reachable-only-by-code tab types rather
        // than deleted, since deleting real working destinations wasn't
        // asked for. "situation" replaces "map" as the permanent home tab
        // type; "dossiers"/"replay" are genuinely new placeholder-content
        // types (real modules, no real screen behind them yet — Round 3/4).
        //
        // The actual switch-vs-create decision lives in the pure, unit-
        // tested resolveTabAction() (src/lib/tabModel.js) — kept out of this
        // component so the record-scoped-tab logic (V3 Phase 1, §3.4) can
        // be tested without mounting the whole app shell.
        // Mode-routing correction (§7.1) — opening a ref/tab whose module
        // lives in the other mode's rail switches the mode itself (e.g. a
        // case: ref opened from Watch mode), guarded by modeSwitchGuardRef
        // so this and the W/G keybinding effect can't fight each other.
        const targetModule = TAB_TYPE_TO_MODULE[type]
        if (targetModule) {
            const targetIsWork = WORK_MODULE_KEYS.has(targetModule)
            if (targetIsWork && mode !== "work") setMode("work")
            else if (!targetIsWork && mode === "work") setMode("watch")
        }
        const decision = resolveTabAction(tabs, type, opts, crypto.randomUUID())
        if (decision.action === "switch") { switchTab(decision.id); return }
        if (decision.action === "retitle-and-switch") { retitleTab(decision.id, decision.label); switchTab(decision.id); return }
        setTabs(prev => {
            // Re-check against the latest tabs (not the `tabs` this closure
            // captured) in case of a rapid double-fire — mirrors the
            // dedup guard the pre-existing base-tab path already had.
            const reDecision = resolveTabAction(prev, type, opts, decision.tab.id)
            if (reDecision.action !== "create") return prev
            return [...prev, decision.tab]
        })
        switchTab(decision.tab.id)
    }, [tabs, switchTab, retitleTab, mode, setMode])


    // switchMode is declared above these, so it reaches them through refs
    // rather than the file being reordered around one keybinding.
    useEffect(() => { tabsRef.current = tabs }, [tabs])
    useEffect(() => { openTabRef.current = openTab }, [openTab])
    useEffect(() => { activeTabIdRef.current = activeTabId }, [activeTabId])
    // Redesign Round 2, §6 — global ⌘K/Ctrl+K (palette) and 1-7 (module
    // switch) shortcuts, guarded against active text input so typing is
    // never interrupted. Declared here (after openTab) rather than earlier
    // near paletteOpen's own state, since openTab is a `const` — referencing
    // it in an effect declared before its own initializer is a real
    // temporal-dead-zone crash, not just a style preference.
    useEffect(() => {
        const handler = (e) => {
            // ⌘/Ctrl + Shift + Space toggles Watch <-> Workstation and
            // lands where you last were in the mode you are entering.
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.code === "Space" || e.key === " ")) {
                e.preventDefault()
                switchMode(mode === "work" ? "watch" : "work")
                return
            }
            // ⌘⇧4 — the gesture people already use for a screenshot.
            if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "4") {
                e.preventDefault()
                setCaptureOpen(true)
                return
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
                e.preventDefault()
                setPaletteOpen(v => !v)
                return
            }
            if (e.key === "Escape" && paletteOpen) { closeOverlay("overlay:palette"); return }
            if (isTextEntry(e.target)) return

            /* ESC FALLS BACK TO THE MAP. Every module is a sheet over the
               canvas, and until now leaving one meant finding the right
               rail button — so the way out of a screen depended on knowing
               which screen you were on.

               It is deliberately LAST among the Escape handlers: the
               palette, a dialog, a draw mode and a module's own ✕ all get
               the key first, because the nearest thing you opened is the
               thing you meant to close. Only when nothing is listening
               does Escape mean "take me back to the map". */
            if (e.key === "Escape") {
                const landing = MODULE_TO_TAB_TYPE.situation
                if (activeTabType && activeTabType !== landing) {
                    e.preventDefault()
                    openTab(landing)
                }
                return
            }

            // ⌘/Ctrl + 1..9 jumps to a module. This was a BARE digit, and
            // its guard matched the editable host but nothing inside it —
            // so typing "1" inside a bold span in a document switched the
            // page out from under the writer. A modifier is the fix; the
            // guard alone can only ever enumerate the surfaces it knows.
            if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return
            const n = Number(e.key)
            if (n >= 1 && n <= 9 && MODULES[n - 1]) {
                e.preventDefault()
                openTab(MODULE_TO_TAB_TYPE[MODULES[n - 1].key])
            }
        }
        window.addEventListener("keydown", handler)
        return () => window.removeEventListener("keydown", handler)
    }, [paletteOpen, openTab, mode, switchMode, activeTabType])

    // Real, destination-neutral navigation event (introduced for the strategic
    // zone tooltip's "Manage in Sources" action; that layer is gone, the event
    // is still what every other surface navigates with) —
    // replaces the old akili:open-forge/akili:forge-nav pair now that Forge
    // is no longer a primary-nav destination.
    useEffect(() => {
        const h = (e) => {
            if (!e.detail?.destination) return
            const { destination, recordRef, label } = e.detail
            openTab(destination, recordRef ? { recordRef, label } : undefined)
        }
        window.addEventListener("akili:navigate", h)
        return () => window.removeEventListener("akili:navigate", h)
    }, [openTab])

    // Reverse direction — real deep links from non-map destinations (e.g.
    // NewsPage's "jump to location", Watchlists' entity chips) need the map
    // tab open before the akili:fly-to / akili:show-entity events they fire
    // right after this can find a mounted GlobeView to act on.
    useEffect(() => {
        const h = () => openTab("situation")
        window.addEventListener("akili:open-map", h)
        return () => window.removeEventListener("akili:open-map", h)
    }, [openTab])

    // Spec addendum F2 — the inspector's "what happens next" opens the
    // SHARED board scoped to that signal's situation, never a private
    // forecast. The place travels on the event; Forecast.jsx picks the
    // board rather than the caller, because only it knows which boards
    // exist.
    useEffect(() => {
        const h = () => openTab("forecast")
        window.addEventListener("akili:open-forecast", h)
        return () => window.removeEventListener("akili:open-forecast", h)
    }, [openTab])

    const closeTab = useCallback((id) => {
        const tab = tabs.find(t => t.id === id)
        // Any tab, including "situation", can now be closed — closing the
        // last remaining tab reopens Situation (below) rather than refusing
        // to close a specific hardcoded tab.
        if (!tab) return
        let remaining = tabs.filter(t => t.id !== id)
        // The console is never empty — closing the last tab reopens Situation
        // as a genuinely fresh tab, not a dangling reference to one that no
        // longer exists.
        if (remaining.length === 0) {
            remaining = [{ id: "situation", type: "situation", label: "Situation" }]
        }
        setTabs(remaining)
        if (activeTabId === id) {
            let target = remaining[remaining.length - 1].id
            const hist = tabHistoryRef.current
            for (let i = hist.length - 1; i >= 0; i--) {
                if (remaining.find(t => t.id === hist[i])) {
                    target = hist[i]
                    tabHistoryRef.current = hist.slice(0, i)
                    break
                }
            }
            setActiveTabId(target)
        }
        tabHistoryRef.current = tabHistoryRef.current.filter(x => x !== id)
    }, [tabs, activeTabId])

    // Persist tabs to localStorage
    useEffect(() => {
        try {
            localStorage.setItem(TAB_STORAGE_KEY, JSON.stringify(tabs))
            localStorage.setItem(TAB_STORAGE_KEY + "-active", activeTabId)
        } catch { /* ignore */ }
    }, [tabs, activeTabId])

    // V3 Phase 1, §5.1 — real session restore of open tabs. A session
    // CAPTURES the current tabs by reading the same TAB_STORAGE_KEY this
    // effect already writes (no second store needed); restoring a session
    // dispatches this event with the real saved {tabs, activeTabId}.
    useEffect(() => {
        const h = (e) => {
            const { tabs: restoredTabs, activeTabId: restoredActive } = e.detail || {}
            if (!Array.isArray(restoredTabs) || !restoredTabs.length) return

            // A SESSION IS AN INPUT FROM AN OLDER BUILD. One was found
            // holding eighteen tabs including `mywork` and `mail` —
            // modules since deleted — plus three copies of `dossiers`.
            // Restoring them verbatim left activeTabType naming a view
            // that no longer exists, so every real view was display:none
            // and the window came up with a top bar, a status bar and
            // nothing in between. Same validation the localStorage path
            // uses, for the same reason.
            const seen = new Set()
            const clean = restoredTabs.filter((t) => {
                if (!t || typeof t.type !== "string") return false
                if (!KNOWN_TAB_TYPES.has(t.type)) return false
                if (seen.has(t.type) && !t.recordRef) return false
                seen.add(t.type)
                return true
            })
            const withHome = clean.find((t) => t.type === "situation")
                ? clean
                : [{ id: "situation", type: "situation", label: "Situation" }, ...clean]
            setTabs(withHome)

            // THE MAP IS THE FRONT DOOR, EVERY LAUNCH. This used to fall
            // back to restoredTabs[length - 1] — whatever the previous
            // session opened last, in practice a Workstation module — and
            // then to the saved active tab, which had the same effect.
            //
            // Restoring the tabs is worth doing: the work is still there,
            // one click away. Restoring the VIEW is not. Opening on a
            // half-finished document instead of the picture is the wrong
            // first thing to see, and it is what made the app appear to
            // open in the wrong place. Where you were inside a session is
            // remembered by switchMode for the rest of that session.
            setActiveTabId(
                withHome.find((t) => t.type === "situation")?.id ?? withHome[0].id
            )
        }
        window.addEventListener("akili:restore-tabs", h)
        return () => window.removeEventListener("akili:restore-tabs", h)
    }, [])

    // ── Situations (state kept for ChatPanel context; no panel UI) ──────────
    const [situations,        setSituations]        = useState([])
    const [activeSituationId, setActiveSituationId] = useState(null)
    const activeSituation = situations.find(s => s.id === activeSituationId) || null

    // ── Overwatch draw callbacks ───────────────────────────────────────────────
    const handleOverwatchBounds = useCallback((bounds) => {
        setOwBounds(bounds)
        setOwPolygon(null)
    }, [])

    const handleOverwatchPolygon = useCallback(({ vertices, bounds }) => {
        setOwBounds(bounds)
        setOwPolygon({ vertices, bounds })
    }, [])

    // ── Fire-and-forget scan record save ─────────────────────────────────────
    const _saveScanRecord = useCallback((payload) => {
        const tok = localStorage.getItem("hw-auth-token")
        const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
        fetch(`${API}/api/overwatch/scans`, { method: "POST", headers, body: JSON.stringify(payload) })
            .catch(e => console.warn("[Overwatch] scan record save failed:", e))
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Overwatch scan: called from sidebar ───────────────────────────────────
    const handleOverwatchScan = useCallback(async ({ bounds: scanBounds, confidence, enhance }) => {
        const bounds = scanBounds || owBounds
        if (!bounds) return
        setOwMode("analyzing")
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
            const res = await fetch(`${API}/api/overwatch/detect`, {
                method: "POST", headers,
                body: JSON.stringify({ bounds, zoom: 15, confidence, enhance }),
            })
            if (res.ok) {
                const data = await res.json()
                const dets = data.detections || []
                setOwDetections(dets)
                setOverwatchDetections(dets)
                const catCounts = {}
                for (const d of dets) {
                    const cat = d.category || d.class || "Object"
                    catCounts[cat] = (catCounts[cat] || 0) + 1
                }
                const avgConf = dets.length ? dets.reduce((s, d) => s + (d.confidence || 0), 0) / dets.length : null
                setOwStats({ total: dets.length, byCategory: catCounts })
                setOwMode("results")
                _saveScanRecord({ bounds, total: dets.length, by_category: catCounts, avg_confidence: avgConf, imagery_source: "ESRI" })
            } else {
                setOwMode("idle")
            }
        } catch (e) {
            console.error("[Overwatch]", e)
            setOwMode("idle")
        }
    }, [owBounds, _saveScanRecord]) // eslint-disable-line react-hooks/exhaustive-deps

    // ── Sentinel overlay loaded from sidebar ──────────────────────────────────
    const handleSentinelLoaded = useCallback(({ image_b64, bounds }) => {
        setOwSentinelOverlay({ image_b64, bounds })
    }, [])

    // ── Sentinel ML scan: called from sidebar after overlay loaded ────────────
    const handleSentinelScan = useCallback(async ({ confidence, enhance, sentinelType }) => {
        if (!owSentinelOverlay || !owBounds) return
        setOwMode("analyzing")
        try {
            const tok = localStorage.getItem("hw-auth-token")
            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
            const res = await fetch(`${API}/api/overwatch/detect-image`, {
                method: "POST", headers,
                body: JSON.stringify({ image: owSentinelOverlay.image_b64, bounds: owBounds, confidence, enhance }),
            })
            if (res.ok) {
                const data = await res.json()
                const dets = data.detections || []
                setOwDetections(dets)
                setOverwatchDetections(dets)
                const catCounts = {}
                for (const d of dets) { const cat = d.category || d.class || "Object"; catCounts[cat] = (catCounts[cat] || 0) + 1 }
                const avgConf = dets.length ? dets.reduce((s, d) => s + (d.confidence || 0), 0) / dets.length : null
                setOwStats({ total: dets.length, byCategory: catCounts, zoom: "Sentinel-2" })
                setOwMode("results")
                _saveScanRecord({ bounds: owBounds, total: dets.length, by_category: catCounts, avg_confidence: avgConf, imagery_source: "Sentinel-2", imagery_type: sentinelType })
            } else { setOwMode("idle") }
        } catch (e) { console.error("[Sentinel ML]", e); setOwMode("idle") }
    }, [owSentinelOverlay, owBounds, _saveScanRecord]) // eslint-disable-line react-hooks/exhaustive-deps


    // ── Render ────────────────────────────────────────────────────────────────

    // Real authentication gate — nothing below renders (desktop or mobile
    // shell) until a real session is confirmed. A blank frame while
    // checkSession()'s one real request is in flight is honest (genuinely
    // nothing to show yet); a real login screen once we know there's no
    // valid session.
    // NEVER A BLANK WINDOW. This returned null, which is defensible in a
    // browser tab — the page frame is already on screen — and is not in a
    // packaged app, where the whole window is this and a null render is
    // indistinguishable from the app being broken. The session check can
    // take tens of seconds against an unreachable server before it gives
    // up, and that whole time was blank.
    if (!authChecked) {
        return (
            <div style={{
                position: "fixed", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: 14,
                background: "var(--bg-0, #14161f)",
            }}>
                <svg width="46" height="46" viewBox="0 0 24 24" fill="none"
                     strokeWidth="2.2" strokeLinecap="butt" aria-hidden="true">
                    <path stroke="var(--txt, #f2f3f6)" d="M3 4L14 20M14 4L3 20" />
                    <path stroke="var(--acc-hi, #a0b2d2)" d="M18 4L12.5 12M22 4L19.25 8" />
                </svg>
                <div style={{
                    font: "400 11px var(--font, system-ui)", color: "var(--txt-3, #b5b9c3)",
                    letterSpacing: ".16em", textTransform: "uppercase",
                }}>Parallax</div>
            </div>
        )
    }
    // Real fix for the confirmed root cause of "closing the tab forces a
    // re-login": a transient failure (never a genuine 401) never shows
    // the login screen — it shows this honest, real "couldn't reach the
    // server" state instead, since the real session cookie may still be
    // perfectly valid.
    // THE SERVER IS UNREACHABLE. This used to be a dead end: a message and
    // a Retry button, with no way forward. On a machine that has signed in
    // before, that made every piece of offline machinery below unreachable
    // — the user could never get past this screen to use it, which is the
    // whole "the desktop app does not work offline" report. The capability
    // existed and had no door.
    //
    // So when this machine holds a valid enrolment, offer the login screen
    // instead: it signs in locally against the stored digest. Only a
    // machine that has never reached the server sees the dead end, and for
    // that one it is true — there is genuinely nothing to sign in against.
    if (!authUser && authTransientError && !offlineLoginAvailable) {
        return (
            <div style={{
                position: "fixed", inset: 0, display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center", gap: "var(--space-3)",
                background: "var(--bg-0)", color: "var(--txt-2)", font: "400 13px var(--font)",
                textAlign: "center", padding: 24,
            }}>
                <div>Couldn't reach the server — your session may still be valid.</div>
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)", maxWidth: 380, lineHeight: 1.6 }}>
                    This machine has not signed in before, so there is nothing stored to
                    sign in against offline. Connect once and it will work without a
                    server afterwards.
                </div>
                <button className="btn primary sm" onClick={runAuthCheck}>Retry</button>
            </div>
        )
    }
    if (!authUser) return <LoginScreen onLoggedIn={setAuthUser} offline={authTransientError} />

    // Real structural swap (not a fluid reflow) — below the phone breakpoint,
    // the four-tab mobile shell renders in place of the entire ten-module
    // desktop console. Both share this same component's state underneath
    // (one router/session, per the correction prompt): the one concrete case
    // named there — a specific briefing already open — carries over via
    // briefingsInitialId, a real prop this component already threads into
    // the desktop Briefings destination a few hundred lines below.
    if (phoneMode) {
        return <MobileApp initialBriefingReportId={briefingsInitialId} />
    }

    const panelStyle = isMobile ? {
        position:    "fixed",
        top:         0,
        left:        0,
        right:       0,
        bottom:      56,
        zIndex:      1500,
        background:  "var(--pane-glass-bg)",
        overflowY:   "auto",
        boxSizing:   "border-box",
        fontFamily:  "system-ui, -apple-system, sans-serif",
    } : PANEL_STYLE

    return (
        <div style={{
            /* A1.2 — the root is fixed, inset 0, overflow hidden, on
               var(--canvas). The chrome inside it is absolutely
               positioned at the geometry in A2, so this is no longer a
               flex column; every band measures from the top-left. */
            position:      "fixed",
            inset:         0,
            background:    "var(--canvas)",
            color:         "var(--txt)",
            overflow:      "hidden",
            fontFamily:    "var(--mz-font-body)",
            font:          "13px/1.45 var(--mz-font-body)",
            WebkitFontSmoothing: "antialiased",
        }}>
            {/* Cited posts, read beside the record (sourceEmbed.js). */}
            <SourceViewer />
            {/* RESTORED OVERLAYS. ff2c9e8 deleted this block with the rest of
                an unrelated edit, so search (the palette), Share (the tray),
                settings, screen capture, the first-login tutorial, toasts and
                live notifications all still had openers and nothing on
                screen: the clicks set state that no element read. */}
            <ScreenCapture
                open={captureOpen}
                onClose={() => setCaptureOpen(false)}
                onCaptured={(dataUrl) => {
                    const mod = TAB_TYPE_TO_MODULE[activeTabType] || "screen"
                    const ok = saveCapture(dataUrl, { label: `Capture · ${mod}`, of: mod })
                    toast(ok === false ? "Already saved" : "Saved — it is in the Editor's Saved pane",
                          { icon: "i-check" })
                }}
            />
            <Tutorial />
            <UpdateBanner />
            <ToastHost />
            <NotificationStack
                onOpen={(n) => { if (n.ref?.lat != null && n.ref?.lon != null) {
                    openTab("situation")
                    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: n.ref.lat, lon: n.ref.lon, altitude: 250000 } }))
                } }}
                onAcknowledge={(n) => markNotificationRead(n.id)}
            />
            <NotificationTray
                open={trayOpen}
                onClose={() => closeOverlay("overlay:tray")}
                onOpenItem={(n) => { if (n.ref?.lat != null && n.ref?.lon != null) {
                    openTab("situation")
                    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: n.ref.lat, lon: n.ref.lon, altitude: 250000 } }))
                } }}
            />
            {/* The centred palette is replaced by the tab bar's SearchBar,
                which listens for overlay:palette and focuses itself. */}
            <CommandPalette
                open={false}
                onClose={() => closeOverlay("overlay:palette")}
                signals={notifItems}
                onOpenModule={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                onOpenEntity={(r) => {
                    openTab("situation")
                    if (r.lat != null && r.lon != null) setSearchTarget({ lat: r.lat, lon: r.lon, zoom: 7, key: Date.now() })
                }}
                onOpenSignal={(s) => {
                    openTab("situation")
                    if (s.lat != null && s.lon != null) {
                        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: s.lat, lon: s.lon, altitude: 250000 } }))
                    }
                }}
                onOpenReport={() => openTab("briefings")}
            />
            {settingsOpen && (
                <SettingsModal
                    onClose={() => closeOverlay("overlay:settings")}
                    onOpenSources={() => openTab("sources")}
                />
            )}
        <IconSprite />
            <PlxIcons />

            {/* ── PARALLAX v6 chrome · Part A2 ────────────────────────────
                Three absolutely-positioned bands, in the spec's geometry:
                  tab bar   top 0,  height 40,              z 40
                  menu bar  top 40, left 48, height 34,     z 39
                  rail      left 0, top 40, bottom 0, w 48, z 41
                Everything below them starts at top 84 / left 48. All three
                are glass — var(--bar) over blur(22px) saturate(1.15) —
                which is the single change that makes this read as
                instruments over a map rather than a stack of cards. */}
            {!showAutoMode && !presenting && !isMobile && (
                <>
                    <PlxTabBar
                        narrow={plxNarrow}
                        tabs={orderedTheaters}
                        favourites={favTheaters}
                        activeTab={theaterId}
                        onTab={(id) => {
                            setTheaterId(id)
                            // Filing needs to know where you are standing.
                            setActiveTheater((theaters.find((x) => x.id === id) || {}).name || null)
                            const t = theaters.find((x) => x.id === id)
                            if (!t) return
                            /* The map is the canvas, so it is already
                               mounted and already flying — no need to open
                               the Map tab first, and forcing it would yank
                               someone out of Insight for a tab click whose
                               point is to change the backdrop. */
                            window.dispatchEvent(new CustomEvent("akili:theater-select", {
                                detail: { id, name: t.name, view: t.view, layers: t.layers },
                            }))
                        }}
                        onCloseTab={(id) => {
                            // Never the last one (A2.1); if the closed tab
                            // was active, the first survivor opens.
                            const rest = theaters.filter((t) => t.id !== id)
                            if (!rest.length) return
                            const gone = theaters.find((t) => t.id === id)
                            if (!confirm(`Remove “${gone?.name || "this theater"}” from the strip? Anything you filed while watching it stays where it is.`)) return
                            setTheaters(rest)
                            if (theaterId === id) setTheaterId(rest[0].id)
                            // The strip is a view of rows now, so closing a
                            // tab has to remove the row or it comes back on
                            // the next load.
                            deleteTheater(id).catch((e) => {
                                setPlxToast(e.message || "Could not remove that theater")
                                refreshTheaters()
                            })
                        }}
                        onEditTab={(id) => setEditingTheater(theaters.find((t) => t.id === id) || null)}
                        onAddTab={() => setEditingTheater("new")}
                        onHome={() => openTab("home")}
                        onSearch={() => openOverlay("overlay:palette")}
                        searchSlot={
                            <SearchBar
                                narrow={plxNarrow}
                                theaters={orderedTheaters}
                                signals={notifItems}
                                onPlace={(p) => {
                                    openTab("situation")
                                    window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: p.lat, lon: p.lon, altitude: p.altitude } }))
                                }}
                                onEntity={(r) => {
                                    openTab("situation")
                                    if (r.lat != null && r.lon != null) setSearchTarget({ lat: r.lat, lon: r.lon, zoom: 7, key: Date.now() })
                                }}
                                onSignal={(sg) => {
                                    openTab("situation")
                                    if (sg.lat != null && sg.lon != null) {
                                        window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: sg.lat, lon: sg.lon, altitude: 250000 } }))
                                    }
                                }}
                                onTheater={(id) => {
                                    const t = theaters.find((x) => x.id === id)
                                    if (!t) return
                                    setTheaterId(id)
                                    window.dispatchEvent(new CustomEvent("akili:theater-select", { detail: { id, name: t.name, view: t.view, layers: t.layers } }))
                                }}
                                onModule={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                            />
                        }
                        onFiles={() => openOverlay("overlay:palette")}
                        /* THE CHAT BUTTON OPENS THE CHAT. It opened the
                           notification tray, which is where alerts go — a
                           reasonable place for it to have pointed while
                           there was no chat to open, and the wrong one now
                           that there is. */
                        onChat={() => openTab("chat")}
                        chatOpen={activeTabType === "chat"}
                        chatCount={unreadMessages || ""}
                        themeMode={plxThemeMode}
                        hour={plxHour}
                        onCycleTheme={(next) => { setThemeMode(next); setPlxThemeMode(next) }}
                        alertsOpen={trayOpen}
                        /* THE BELL OPENS THE NOTIFICATIONS AND COUNTS THEM.
                           It opened PlxAlerts with alerts={[]} — always empty —
                           while its badge counted map signals not marked read
                           in a separate local list. The tray (once behind
                           Share) is the real notification log, so the bell
                           opens it and shows its unread count: marking read
                           there now lowers the number here. */
                        onAlerts={() => (trayOpen ? closeOverlay("overlay:tray") : openOverlay("overlay:tray"))}
                        alertCount={notifUnreadCount}
                    />
                    <PlxMenuBar
                        narrow={plxNarrow}
                        menu={plxMenu}
                        onMenu={(v, e) => {
                            const r = e?.currentTarget?.getBoundingClientRect()
                            if (r) setPlxMenuPos({ l: Math.round(r.left), t: Math.round(r.bottom + 2) })
                            setPlxMenu(plxMenu === v ? null : v)
                        }}
                        savedAt={plxClock}
                        starred={favTheaters.has(theaterId)}
                        onStar={() => toggleFavTheater(theaterId)}
                        curTitle={(theaters.find((t) => t.id === theaterId) || {}).name || "Workspace"}
                        // SHARE SHARES. It opened the notification tray. It now
                        // copies a link that opens this theater at this view.
                        onShare={() => {
                            const url = shareUrl(getShareCamera(), theaterId)
                            const name = (theaters.find((t) => t.id === theaterId) || {}).name || "this view"
                            const done = () => toast(`Link copied — opens ${name} at this view`, { icon: "i-check" })
                            if (navigator.clipboard?.writeText) navigator.clipboard.writeText(url).then(done, () => window.prompt("Copy this link", url))
                            else window.prompt("Copy this link", url)
                        }}
                        clock={plxClock}
                        presence={onlineUsers.map((u) => [u.name || u.email, u.initials || "?", u.color || "var(--mz-navy-400)"])}
                        busy={false}
                        onRefresh={() => window.location.reload()}
                    />
                    <PlxRail
                        mode={TAB_TYPE_TO_MODULE[activeTabType] || "home"}
                        onMode={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                        left={plxLeft}
                        onLeft={(k) => {
                            if (k === "layers") { openTab("situation"); toggleLayers() }
                            else if (k === "selection") { openTab("situation"); toggleInspector() }
                            // Overwatch is a destination of its own here, not
                            // a tool window — v6 folds imagery into the tool
                            // window; our imagery surface is a full screen.
                            else if (k === "imagery") openTab("imagery")
                            /* THE FOLDER ICON OPENS THE FOLDERS. It opened
                               the command palette, which is a search box —
                               a reasonable thing to reach for and not what
                               a folder icon promises. Case files are the
                               app's filing system now, so that is what it
                               opens. */
                            else if (k === "files") openTab("caseWork")
                        }}
                        drawer={plxDrawer}
                        onDrawer={togglePlxDrawer}
                        menu={plxMenu}
                        onNewMenu={(e) => {
                            const r = e?.currentTarget?.getBoundingClientRect()
                            if (r) setPlxMenuPos({ l: Math.round(r.right + 6), t: Math.round(r.top) })
                            setPlxMenu(plxMenu === "new" ? null : "new")
                        }}
                        onSnapshot={() => setCaptureOpen(true)}
                        /* Account is the account, not the app's settings
                           dialog. Name, picture, password and the team
                           roster live together on one screen. */
                        onAccount={() => { setProfileSection(null); openTab("profile") }}
                        isSuperAdmin={!!getCurrentUser()?.is_super_admin}
                        onHelp={() => openOverlay("overlay:settings")}
                        feedsOk={systemHealth?.status === "operational"}
                        feedsLabel={systemHealth?.detail || "7 feeds connected"}
                    />
                </>
            )}

            {/* ── Body — flex row, fills remaining height ───────────────────── */}
            {/* ── Floating layer · A6 + A7 ────────────────────────────
                Menus, the bell's panel and the toast. These sit above the
                content area and below nothing, so they are rendered last
                in document order and positioned absolutely. */}
            {!showAutoMode && !presenting && !isMobile && (() => {
                const say = (t) => () => setPlxToast(t)
                const MENUS = {
                    file: [
                        ["New theater…", () => setEditingTheater("new"), "⇧⌘T"],
                        ["New document", () => openTab("editor")],
                        ["Open file…", () => openOverlay("overlay:palette"), "⌘O"],
                        ["Save", say("Saved"), "⌘S"],
                        ["Export view · SVG", () => setCaptureOpen(true)],
                        ["Export document · .doc", say("Export is not wired to the document yet")],
                        ["Import data", () => openTab("sources")],
                        /* exportPdf(), never the browser's own print call.
                           The print surface is an allowlist — it has to be
                           mounted and laid out before the dialog snapshots
                           it, and exportPdf waits the two frames that
                           guarantees. Invoking the dialog straight from a
                           menu prints whatever happened to be on screen,
                           app chrome included. */
                        ["Print", () => exportPdf()],
                    ],
                    edit: [
                        ["Undo", () => document.execCommand("undo"), "⌘Z"],
                        ["Redo", () => document.execCommand("redo"), "⇧⌘Z"],
                        ["Clear annotations", say("Annotations cleared")],
                        ["Clear selection", say("Selection cleared")],
                        ["Alert rules", () => openTab("sources")],
                    ],
                    view: [
                        /* THE ONLY CLICKABLE WAY BACK TO THE OTHER MODE.
                           The old TopBar carried a Watch/Workstation
                           toggle; the v6 chrome replaced that bar and the
                           control went with it, leaving ⌘⇧W as the sole
                           entry point — a feature reachable only by a
                           shortcut nobody is told about. It goes through
                           switchMode, not setMode, because switchMode is
                           what remembers the page you were last on in the
                           mode you are returning to. */
                        [mode === "work" ? "Watch mode" : "Workstation mode",
                         () => switchMode(mode === "work" ? "watch" : "work"), "⇧⌘W"],
                        ["Show / hide timeline", togglePlxDrawer, "T"],
                        ["Map data", () => { openTab("situation"); toggleLayers() }, "L"],
                        ["Messages", () => openTab("chat")],
                        // The label names what you will GET, so it has to
                        // read the theme that is actually applied, not the
                        // mode — in "auto" those differ by time of day.
                        [(document.documentElement.dataset.theme === "dark") ? "Light theme" : "Dark theme",
                         () => {
                             const n = document.documentElement.dataset.theme === "dark" ? "light" : "dark"
                             setThemeMode(n); setPlxThemeMode(n)
                         }],
                        ["Full screen", () => {
                            if (document.fullscreenElement) document.exitFullscreen()
                            else document.documentElement.requestFullscreen?.().catch(() => {})
                        }, "F"],
                        // Settings had no entry of its own: it was reachable as
                        // "Keyboard shortcuts" or "Setup and interests" under
                        // Support, and by the rail's ? icon.
                        ["Settings…", () => openOverlay("overlay:settings")],
                    ],
                    support: [
                        // Superadmins only, and only when the session says
                        // so — see destinations/Admin.jsx.
                        ...(getCurrentUser()?.is_super_admin
                            ? [["Administration", () => { setProfileSection("admin"); openTab("profile") }]]
                            : []),
                        ["Keyboard shortcuts", () => openOverlay("overlay:settings"), "?"],
                        ["Guided tour", say("The guided tour is not built yet")],
                        ["Setup and interests", () => openOverlay("overlay:settings")],
                        ["Data sources", () => openTab("sources")],
                    ],
                    new: [
                        ["Theater", () => setEditingTheater("new")],
                        ["Document", () => openTab("editor")],
                        ["Message", () => openTab("watchlists")],
                        ["Case", () => openTab("caseWork")],
                        ["Area of interest", () => openTab("situation")],
                        ["Import data", () => openTab("sources")],
                    ],
                }
                return (
                    <>
                        <PlxMenu
                            open={!!plxMenu} pos={plxMenuPos}
                            items={MENUS[plxMenu] || []}
                            onClose={() => setPlxMenu(null)}
                        />
                        <PlxAlerts
                            open={plxAlertsOpen}
                            since={plxOpenedAt.current}
                            alerts={[]}
                            onClose={() => setPlxAlertsOpen(false)}
                            onHome={() => { setPlxAlertsOpen(false); openTab("home") }}
                        />
                        <PlxToast text={plxToast} />
                    </>
                )
            })()}

            {/* ── Content area — A2: top 84 (40 + 34 + 10), left 48 ─── */}
            <div style={{
                position: "absolute",
                top: (!showAutoMode && !presenting && !isMobile) ? 84 : 0,
                left: (!showAutoMode && !presenting && !isMobile) ? 48 : 0,
                right: 0, bottom: 0,
                display: "flex", minHeight: 0,
                paddingBottom: (isMobile && !showAutoMode) ? 56 : 0,
            }}>
                {/* The modules now live in PlxRail (Part A2.3), mounted
                    above as one of the three absolutely-positioned chrome
                    bands. The old in-flow SideRail is gone: two rails were
                    briefly on screen at once while the shell moved over. */}

                {/* ── Full-screen panels — all mounted while tab exists, hidden via display:none ── */}

                {/* TV overlay */}
                {showTV && (
                    <TVWidget onClose={() => setShowTV(false)} />
                )}

                {/* Full UI rebuild — the 5 fixed destinations (src/data/destinations.js).
                    "briefing" (BriefingPanel.jsx — a real, older "Claude
                    Briefings" document library, distinct from the ReportTask/
                    Report system below), "news" (NewsPage.jsx) and "forge"
                    (ForgePanel.jsx) are deliberately not replaced 1:1 here —
                    the new spec's 5 destinations don't include an equivalent
                    for any of them (News is a map-layer group only per
                    section 5; Reports below is the ReportTask/Report system,
                    not Claude Briefings; Sources absorbs only Forge's real
                    Watch-Area/Detection-Rule CRUD). Their source files are
                    untouched and still real — just no longer mounted here,
                    since nothing in the new nav model can open a "briefing"/
                    "news"/"forge" tab anymore. Flagged explicitly in this
                    round's PR notes as a deliberate scope decision, not an
                    oversight. */}
                {/* Situation — redesign Round 2's new home screen, replacing
                    Dashboard.jsx as the default view. Dashboard.jsx itself
                    is left in place below (unreached from the new module
                    rail — see MODULE_TO_TAB_TYPE) rather than deleted, since
                    it isn't one of the header/nav/footer/bell components
                    this round's ground rule calls out for deletion, and no
                    later round has explicitly claimed it yet. */}
                {/* Home — the brief. Guarded on its own tab like every
                    other pane, so it mounts only once opened and keeps its
                    fetched state while you are elsewhere. */}
                {tabs.some(t => t.type === "home") && (
                    <div style={modeLayer(activeTabType === "home")}>
                        <Home
                            theaters={orderedTheaters}
                            onOpenSearch={() => openOverlay("overlay:palette")}
                            onOpenModule={(key) => openTab(MODULE_TO_TAB_TYPE[key] || key)}
                            onFocusSignal={(sig) => {
                                if (sig?.lat == null || sig?.lon == null) return
                                openTab("situation")
                                window.dispatchEvent(new CustomEvent("akili:fly-to", {
                                    detail: { lat: sig.lat, lon: sig.lon, altitude: 250000 },
                                }))
                            }}
                        />
                    </div>
                )}
                {/* No `tabs.some(...)` guard: the map is the canvas, so it is
                    mounted whether or not a Map tab exists. Gating it on the
                    tab meant a fresh workspace — which opens on Home with no
                    Map tab yet — had nothing behind the glass. */}
                {!isMobile && (
                    <div style={canvasLayer(activeTabType === "situation", !showAutoMode && !presenting && !isMobile)}>
                        <Situation
                            asCanvas={activeTabType !== "situation"}
                            onOpenDossier={() => openTab("dossiers")}
                        />
                    </div>
                )}

                {tabs.some(t => t.type === "dashboard") && (
                    <div style={modeLayer(activeTabType === "dashboard")}>
                        <Dashboard canonicalView={canonicalView} onFullscreenChange={setDashboardFullscreen} />
                    </div>
                )}

                {tabs.some(t => t.type === "dossiers") && (
                    <div style={modeLayer(activeTabType === "dossiers")}>
                        <Dossiers onOpenGenerate={() => openTab("generate")} />
                    </div>
                )}

                {tabs.some(t => t.type === "replay") && (
                    <div style={modeLayer(activeTabType === "replay")}>
                        <Replay isVisible={activeTabType === "replay"} />
                    </div>
                )}

                {tabs.some(t => t.type === "ontology") && (
                    <div style={modeLayer(activeTabType === "ontology")}>
                        {/* Ontology is called Constellation in v6, and the
                            rulebook behind it is called Semantics — two views
                            of one screen rather than two screens. */}
                        <Constellation
                            theater={(theaters.find((t) => t.id === theaterId) || {}).name || ""}
                            onOpenModule={(m) => openTab(MODULE_TO_TAB_TYPE[m] || m)}
                        />
                    </div>
                )}

                {tabs.some(t => t.type === "imagery") && (
                    <div style={modeLayer(activeTabType === "imagery")}>
                        <Imagery onOpenGenerate={() => openTab("generate")} />
                    </div>
                )}

                {tabs.some(t => t.type === "forecast") && (
                    <div style={modeLayer(activeTabType === "forecast")}>
                        <Forecast />
                    </div>
                )}

                {tabs.some(t => t.type === "generate") && (
                    <div style={modeLayer(activeTabType === "generate")}>
                        <Generate onOpenTab={(reportId, title, kind) => {
                            setBriefingsInitialId(reportId)
                            setPrintReportId(kind === "print" ? reportId : null)
                            setDeckReportId(kind === "deck" ? reportId : null)
                            // V3 Phase 1, §3.4 — a specific generated briefing gets its
                            // own named tab (brf:<id>), distinct from Briefings' base tab.
                            openTab("briefings", { recordRef: `brf:${reportId}`, label: `Briefing · ${title || reportId}` })
                        }} />
                    </div>
                )}

                {tabs.some(t => t.type === "briefings") && (
                    <div style={modeLayer(activeTabType === "briefings")}>
                        {deckReportId ? (
                            <Deck reportId={deckReportId} onBack={() => setDeckReportId(null)} />
                        ) : printReportId ? (
                            <PrintLayout reportId={printReportId} onBack={() => setPrintReportId(null)} onOpenDeck={(id) => { setPrintReportId(null); setDeckReportId(id) }} />
                        ) : (
                            /* v6 ▣ Briefing studio — one Reports surface with
                               Generate / Reader / Deck as tabs, instead of a
                               generator tab, a reader tab and a deck that
                               opened over the reader. PrintLayout and Deck
                               still render their own pages, so the PARALLAX
                               wordmark and the Trifecta Technologies line
                               (print/PageFrame.jsx) are untouched. */
                            <BriefingStudio
                                initialReportId={briefingsInitialId}
                                onPrint={(id) => setPrintReportId(id)}
                                onOpenTab={(rid, title, kind) => { if (kind === "print") setPrintReportId(rid) }}
                                isVisible={activeTabType === "briefings"}
                            />
                        )}
                    </div>
                )}

                {/* §S2 — the Inbox. This slot rendered WatchlistsPage, which is
                    why the spec recorded the module as built:false: "a console
                    whose primary queue is a placeholder is a demo." The tab
                    type stays "watchlists" because handlers across this file
                    key off it; what renders is the real queue. */}
                {tabs.some(t => t.type === "watchlists") && (
                    <div style={modeLayer(activeTabType === "watchlists")}>
                        <Inbox />
                    </div>
                )}

                {tabs.some(t => t.type === "sources") && (
                    <div style={modeLayer(activeTabType === "sources")}>
                        <Sources />
                    </div>
                )}

                {tabs.some(t => t.type === "aiCouncil") && (
                    <div style={modeLayer(activeTabType === "aiCouncil")}>
                        {/* v6 ▣ Crucible. What was here was AICouncil.jsx, a
                            129-line placeholder behind the rail's Crucible
                            entry. */}
                        <Crucible onOpenModule={(m) => openTab(MODULE_TO_TAB_TYPE[m] || m)} />
                    </div>
                )}

                {/* Insight — v6 Part B ▣ Insight. Full-width, no side panes.
                    ONE SURFACE, THREE TABS. "Analytics" and "Forecast" were
                    two rail entries asking the same question — is this
                    getting worse — and because only one icon could win, the
                    Analytics module ended up living behind the forecast
                    glyph, which is what the user saw. The spec has a single
                    destination whose tabs are what changed / risk ranking /
                    what happens next, so that is what this is. */}
                {tabs.some(t => t.type === "analytics") && (
                    <div style={modeLayer(activeTabType === "analytics")}>
                        <Insight
                            theaterKey={theaterId}
                            onOpenModule={(m) => openTab(MODULE_TO_TAB_TYPE[m] || "situation")}
                            onFocusSignal={(sig) => {
                                openTab("situation")
                                if (sig?.lat != null && sig?.lon != null) {
                                    window.dispatchEvent(new CustomEvent("akili:set-camera", {
                                        detail: { lat: sig.lat, lon: sig.lon, height: 900_000 },
                                    }))
                                }
                            }}
                        />
                    </div>
                )}

                {/* Workstation modules (§7.1) — same kept-mounted,
                    display:none-when-inactive pattern as every other tab
                    type above. */}
                {tabs.some(t => t.type === "cases") && (
                    <div style={modeLayer(activeTabType === "cases")}>
                        {/* v6 ▣ Module, instanced as My work. Cases.jsx is
                            still the case workspace itself; this is the
                            queue that says what is waiting on you. */}
                        <MyWork
                            onClose={() => openTab("home")}
                            onOpenCase={() => openTab("caseWork")}
                            onOpenModule={(m) => openTab(MODULE_TO_TAB_TYPE[m] || m)}
                        />
                    </div>
                )}
                {tabs.some(t => t.type === "caseWork") && (
                    <div style={modeLayer(activeTabType === "caseWork")}>
                        <Cases />
                    </div>
                )}

                {tabs.some(t => t.type === "editor") && (
                    <div style={modeLayer(activeTabType === "editor")}>
                        <Editor />
                    </div>
                )}
                {tabs.some(t => t.type === "team") && (
                    <div style={modeLayer(activeTabType === "team")}>
                        <Team onClose={() => openTab("home")} />
                    </div>
                )}
                {tabs.some(t => t.type === "profile") && (
                    <div style={modeLayer(activeTabType === "profile")}>
                        <Profile section={profileSection} onClose={() => openTab("home")} />
                    </div>
                )}

                {/* Messages. Mounted once opened and left mounted, so going
                    back to a chat does not re-fetch the thread you were
                    already reading. */}
                {tabs.some(t => t.type === "chat") && (
                    <div style={modeLayer(activeTabType === "chat")}>
                        <Chat />
                    </div>
                )}

                {/* The answer to "explain the situation in X". Mounted
                    always and empty until something is explained. */}
                <ExplanationPanel />

                {/* The desk feed — observations published to everyone. */}
                {tabs.some(t => t.type === "desk") && (
                    <div style={modeLayer(activeTabType === "desk")}>
                        <Desk />
                    </div>
                )}

                {/* Making or changing a theater. It reads the map's current
                    camera for "use the current view", which is the only way
                    anybody actually knows where to point one. */}
                {editingTheater && (
                    <TheaterEditor
                        theater={editingTheater === "new" ? null : editingTheater}
                        canDelete={theaters.length > 1}
                        readView={() => {
                            const v = window.__akiliCamera
                            return (v && Number.isFinite(v.lat))
                                ? { lat: +v.lat.toFixed(4), lon: +v.lon.toFixed(4), height: Math.round(v.height) }
                                : null
                        }}
                        onSave={async (body) => {
                            if (editingTheater === "new") {
                                const t = await createTheater(body)
                                await refreshTheaters(t.id)
                                window.dispatchEvent(new CustomEvent("akili:theater-select", {
                                    detail: { id: t.id, name: t.name, view: t.view, layers: t.layers },
                                }))
                            } else {
                                await updateTheater(editingTheater.id, body)
                                await refreshTheaters()
                            }
                            setEditingTheater(null)
                        }}
                        onDelete={async (t) => {
                            try {
                                await deleteTheater(t.id)
                                setEditingTheater(null)
                                await refreshTheaters()
                            } catch (e) { setPlxToast(e.message || "Could not delete that theater") }
                        }}
                        onClose={() => setEditingTheater(null)}
                    />
                )}


                {/* ── Right panel slot — 300px, only one at a time ──────────── */}
                {rightPanel === "detail" && selectedSurface && (
                    <SurfaceDetailPanel
                        item={selectedSurface}
                        profile={profile}
                        onClose={() => {
                            setRightPanel(null)
                            setSelectedSurface(null)
                            setSurfaceContext(null)
                            setSurfaceEnrichment(null)
                        }}
                        panelStyle={panelStyle}
                        onContextUpdate={handleContextUpdate}
                        onEnrichmentUpdate={handleEnrichmentUpdate}
                    />
                )}

                {rightPanel === "profile" && profile && (
                    <div style={panelStyle}>
                        <ProfilePanel
                            profile={profile}
                            onSave={handleProfileSave}
                            onClose={() => setRightPanel(null)}
                        />
                    </div>
                )}

                {/* UI correction pass, Part 13: the Settings/Preferences window is
                    removed for now (acknowledged as not worth keeping in its
                    current form — will be rebuilt properly later). The header
                    gear icon stays present but shows a real, clear "coming
                    soon" flyout instead of silently doing nothing — see
                    AppHeader.jsx. */}

                {rightPanel === "health" && (
                    <div style={panelStyle}>
                        <HealthPanel onClose={() => setRightPanel(null)} />
                    </div>
                )}

                {rightPanel === "threats" && (
                    <EmergingConflictsPanel onClose={() => setRightPanel(null)} />
                )}

                {rightPanel === "workspaces" && (
                    <div style={panelStyle}>
                        <WorkspacesPanel
                            workspaces={workspaces}
                            activeWorkspaceId={activeWorkspaceId}
                            onSwitch={handleWorkspaceSwitch}
                            onCreate={handleCreateWorkspace}
                            onDelete={handleDeleteWorkspace}
                            onClose={() => setRightPanel(null)}
                        />
                    </div>
                )}

                {rightPanel === "chat" && (
                    <div style={panelStyle}>
                        <ChatPanel
                            activeSituation={activeSituation}
                            onClose={() => setRightPanel(null)}
                        />
                    </div>
                )}

            </div>

            {/* ── Overwatch panel — professional ML detection sidebar ── */}
            {overwatchActive && (
                <OverwatchSidebar
                    bounds={owBounds}
                    polygon={owPolygon}
                    detections={owDetections}
                    scanning={owMode === "analyzing"}
                    onScan={handleOverwatchScan}
                    onScanSentinel={handleSentinelScan}
                    onSentinelLoaded={handleSentinelLoaded}
                    onAssessArea={async (dets, bounds) => {
                        if (!bounds || !dets?.length) return
                        setOwAnalyzing(true)
                        try {
                            const tok = localStorage.getItem("hw-auth-token")
                            const headers = { "Content-Type": "application/json", ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
                            const res = await fetch(`${API}/api/overwatch/analyze`, {
                                method: "POST", headers,
                                body: JSON.stringify({ detections: dets, bounds }),
                            })
                            if (res.ok) setOwAnalysis((await res.json()).analysis || null)
                        } catch (_) {}
                        setOwAnalyzing(false)
                    }}
                    onClear={() => {
                        setOwDetections([])
                        setOverwatchDetections([])
                        setOwStats(null)
                        setOwAnalysis(null)
                        setOwMode("idle")
                        setOwSentinelOverlay(null)
                        setOwPolygon(null)
                        setOwBounds(null)
                    }}
                    drawMode={overwatchDrawMode}
                    onDrawModeChange={setOverwatchDrawMode}
                    isMobile={isMobile}
                />
            )}

            {/* Autoplay overlays — world clocks + news ticker */}
            <WorldClocksBar visible={showAutoMode} />
            <NewsTicker     visible={showAutoMode} />

            {/* Auto mode exit button — visible on all screen sizes */}
            {showAutoMode && (
                <button
                    onClick={() => setShowAutoMode(false)}
                    style={{
                        position:       "fixed",
                        top:            12,
                        right:          12,
                        zIndex:         2100,
                        background:     "rgb(8, 12, 22)",
                        border:         "1px solid rgba(255,255,255,0.15)",
                        borderRadius:   6,
                        color:          "rgba(232,237,242,0.8)",
                        fontSize:       11,
                        fontWeight:     600,
                        letterSpacing:  "0.06em",
                        padding:        "6px 12px",
                        cursor:         "pointer",
                        display:        "flex",
                        alignItems:     "center",
                        gap:            6,
                    }}
                >
                    <span style={{ fontSize: 14, lineHeight: 1 }}>×</span> Exit Auto
                </button>
            )}

            {showReels && <NewsReels onClose={() => setShowReels(false)} />}

            {/* Full UI rebuild spec section 3.2 — persistent footer, never
                changes size or disappears. "There is no mobile layout in
                this pass" (section 3.3) — BottomNav.jsx/MobileDrawer.jsx are
                retired along with the rest of the old mobile chrome; the
                real isMobile detection elsewhere in this file (unrelated
                layout adaptations) is untouched. */}
            {/* THE STATUS BAR IS GONE. Connection, data volume, latency,
                task count — a row of numbers nobody acted on, permanently
                occupying the bottom of every screen. What mattered in it
                (a feed that has gone stale, a backend that is down) belongs
                in the health panel where it can be read properly, and the
                notification tray already raises the cases that need
                attention.

                --status now resolves to 0 (index.html), so every panel
                pinned to bottom:var(--status) reclaims the space rather
                than floating above a gap where the bar used to be. */}
        </div>
    )
}
