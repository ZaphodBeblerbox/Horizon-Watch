import { useEffect, useState } from "react"
import { getSettings, subscribeSettings, updateSetting } from "./settingsStore.js"
/**
 * notificationStore.js — PARALLAX spec §5.
 *
 * Three rules govern this surface.
 *
 * 1. ARRIVAL IS NOT INTERRUPTION. Only a critical, an escalation, something
 *    assigned to you, or an RFI earns a card on screen. Everything else
 *    increments the bell and lands in the tray. A console that shouts at
 *    every event trains people to dismiss without reading, which loses the
 *    one notification that mattered.
 * 2. A NOTIFICATION CARRIES ITS DECISION. Open / acknowledge / to basket,
 *    from the card. Making someone navigate elsewhere to act is what turns
 *    an alert system into a nuisance system.
 * 3. NOTHING IS LOST BY BEING DISMISSED. The tray is the record; dismissing
 *    a card removes the interruption, not the item.
 */

export const KIND = {
    signal:   { icon: "i-bell",    name: "Signal" },
    escalate: { icon: "i-up",      name: "Escalation" },
    assign:   { icon: "i-work",    name: "Assigned to you" },
    rfi:      { icon: "i-rfi",     name: "RFI" },
    // PARALLAX addendum §A2. Each says what the alert IS, not what it is about.
    confirm:  { icon: "i-confirm", name: "Confirmed" },
    surge:    { icon: "i-surge",   name: "Surge" },
    fusion:   { icon: "i-fusion",  name: "Fusion point" },
    detector: { icon: "i-scan",    name: "Detector" },
    // Near something of yours (asset_watch.py): the card names the asset.
    asset:    { icon: "i-register", name: "Your asset" },
    // Announced on Telegram for a time and place (event_watch.py): when it
    // is called, and again shortly before it starts.
    announcement: { icon: "i-clock", name: "Announced" },
    // Happening on the ground now near what you watch: a kettle forming,
    // reinforcements sent, a withdrawal.
    live:     { icon: "i-alert",   name: "On the ground now" },
    feed:     { icon: "i-feed",    name: "Feed health" },
    system:   { icon: "i-gear",    name: "System" },
    // A CONNECTION THE SYSTEM FOUND, not an event that happened. Every
    // other kind here reports something that occurred in the world;
    // this one reports something the graph worked out — a route between
    // two parties that no single record states. It is always inferred,
    // it always carries the chain that produced it, and it is never
    // raised as an interrupt, because a hypothesis is not an alarm.
    discovery: { icon: "i-fusion", name: "Connection found" },
    // A local, located, AI-screened Telegram post (telegram_ingest.py): only
    // kinetic events with a precise place reach here, so each one is worth
    // a card while it is fresh.
    telegram: { icon: "i-feed", name: "Telegram · local report" },
    // Something added to the home screen (home/homeNews.js): new footage,
    // new items under what happened while you were away.
    home:     { icon: "i-home",    name: "New on Home" },
    // A channel we read went live on Telegram (telegram_live.py): the start
    // is the signal; Watch plays it.
    livestream: { icon: "i-feed",  name: "Live on Telegram" },
}

/** Display severity vocabulary — the same four the diamond uses everywhere. */
export const SEV_ORDER = ["critical", "high", "moderate", "low"]

const state = {
    items: [],          // newest first; the tray is the record
    cards: [],          // currently on screen — a strict subset of items
    muted: false,
}
const listeners = new Set()

function notify() {
    for (const fn of listeners) {
        try { fn(snapshot()) } catch { /* one bad listener must not wedge the rest */ }
    }
}

function snapshot() {
    return { items: state.items, cards: state.cards, muted: state.muted }
}

export function subscribeNotifications(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

export function getNotifications() { return snapshot() }

/**
 * The rule, in code. Muting silences CARDS only — the tray keeps filling,
 * because muting is a statement about interruption, not about relevance.
 *
 * PARALLAX addendum §A2 adds `surge` and `fusion`, and pointedly does NOT add
 * `confirm`. That asymmetry is the whole addendum in one line: an arrival is a
 * FACT and belongs in the tray, while a surge and a fusion point are both
 * statements that something CHANGED — a change in attention and a change in
 * the world respectively — and a change is the only thing worth taking
 * someone's attention for.
 *
 * Adding `confirm` here would card every confirmation that lands, which trains
 * people to dismiss without reading and then loses the fusion point in the
 * noise it made itself.
 */
/**
 * How old an event may be and still interrupt you.
 *
 * A notification says "this is happening". Something that happened five
 * hours ago is not happening — it is a record, and it belongs in the tray
 * where records go. Raising a card for it trains the reader that cards are
 * not urgent, which costs them the one that is.
 *
 * Fifteen minutes is the window because that is roughly how long an
 * ingest, geocode and fusion pass can take before a genuinely live event
 * reaches the interface. Beyond it, lateness is no longer the pipeline.
 */
export const MAX_INTERRUPT_AGE_MS = 15 * 60 * 1000

export function interrupts(n, now = Date.now()) {
    if (state.muted) return false

    // WHEN IT HAPPENED, NOT WHEN WE HEARD. `ts` is the event's own time.
    // Only what is actually current may take the screen.
    const ts = Number(n?.ts)
    if (Number.isFinite(ts) && now - ts > MAX_INTERRUPT_AGE_MS) return false
    return n.sev === "critical"
        || n.kind === "escalate" || n.kind === "assign" || n.kind === "rfi" || n.kind === "telegram"
        // A newly arrived relevant signal of high or critical severity.
        || (n.kind === "signal" && n.sev === "high")
        || n.kind === "surge" || n.kind === "fusion"
        // A live development near what you watch, and a reminder that an
        // announced gathering is about to start (both high or above).
        || n.kind === "live" || (n.kind === "announcement" && n.sev === "high")
        // New on Home, unless Home is what you are looking at already.
        || (n.kind === "home" && !n.onHome)
        || n.kind === "livestream"
}

export function setMuted(v) {
    state.muted = !!v
    notify()
}

/**
 * DO NOT DISTURB. This is the store's existing `muted` flag — which
 * nothing ever set — given a persisted, per-user home and a name people
 * use. A second parallel flag would mean interrupts() and the UI could
 * disagree about whether the app is quiet.
 *
 * It suppresses CARDS ONLY. Everything still lands in the tray and the
 * bell still counts, because a quiet mode that also stops recording is
 * "lose alerts silently" wearing a friendlier label.
 */
export function useDnd() {
    const [on, setOn] = useState(() => Boolean(getSettings()?.dnd))
    useEffect(() => {
        setMuted(Boolean(getSettings()?.dnd))
        return subscribeSettings((st) => {
            const v = Boolean(st?.dnd)
            setOn(v); setMuted(v)
        })
    }, [])
    return on
}

export function setDnd(v) {
    setMuted(Boolean(v))
    return updateSetting("dnd", Boolean(v))
}

/**
 * Push a notification. Returns true if it raised a card.
 *
 * `n.silent` records the item in the tray without interrupting. That is
 * for the BACKLOG THAT ALREADY EXISTED when the page opened: replaying a
 * hundred historical criticals as cards on every load is the "shouts at
 * every event" failure, but the previous answer — recording the backlog
 * nowhere at all — meant the tray was empty on arrival and the whole
 * notification surface read as broken. The backlog is a record; only
 * what arrives while you are watching is an interruption.
 */
/* NOW, NOT A BACKLOG (owner's rule, 2026-10-05). A notification is about
   something happening while you are using the console. An event older than
   FRESH_MS — the history loaded at sign-in, or a late-ingested event from
   hours ago — goes into the tray as already read: it is the record, not
   news, and it neither counts on the bell nor takes the screen. Nothing
   pops up while the tab is hidden either; it waits, counted, in the tray,
   instead of a stack of cards greeting you on return. */
export const FRESH_MS = 30 * 60 * 1000

function isFresh(ts, now = Date.now()) {
    return Number.isFinite(ts) && ts >= now - FRESH_MS
}

/* WITH THE WINDOW HIDDEN. Cards cannot be seen, so an item that would
   have taken the screen goes to this handler instead — the desktop app
   sets it to a native macOS notification (desktop/nativeNotify.js). On the
   web the server's push does that job (public/sw-push.js). */
let offScreenHandler = null
export function setOffScreenHandler(fn) { offScreenHandler = typeof fn === "function" ? fn : null }

/* ON SCREEN means seen: the window visible AND in front. A window behind
   other apps is not hidden, so the desktop app used to raise an in-app card
   nobody could see instead of a macOS notification (2026-10-10). */
function onScreen() {
    try {
        if (typeof document === "undefined") return true
        if (document.visibilityState === "hidden") return false
        return typeof document.hasFocus !== "function" || document.hasFocus()
    } catch { return true }
}

/* A CARD THAT TAKES THE SCREEN SOUNDS (owner, 2026-10-10), by severity,
   as Settings › Alerts allows: muted, or per tier. Never for the tray only. */
let lastSoundAt = 0
function soundFor(item) {
    const s = getSettings() || {}
    if (s.soundMuted || state.muted) return
    const tierOn = item.sev === "critical" ? s.soundCritical !== false
        : item.sev === "high" ? s.soundSignificant !== false
        : item.kind === "livestream" || item.kind === "home" ? true : !!s.soundElevated
    if (!tierOn || Date.now() - lastSoundAt < 1500) return      // a burst is one sound
    lastSoundAt = Date.now()
    import("../soundSystem.js").then((m) => { m.resumeAudio(); m.playNotification(item.sev, item.kind) }).catch(() => {})
}

export function pushNotification(n) {
    const ts = Number.isFinite(n.ts) ? n.ts : Date.now()
    const fresh = isFresh(ts)
    const item = {
        id: n.id || `N-${Math.random().toString(36).slice(2, 9)}`,
        ts,
        kind: KIND[n.kind] ? n.kind : "signal",
        sev: SEV_ORDER.includes(n.sev) ? n.sev : "moderate",
        title: n.title || "",
        sub: n.sub || "",
        // What is likely to happen there, and what to do — each names the
        // place (telegram_events.py drops them otherwise).
        expect: n.expect || "",
        advice: n.advice || "",
        ref: n.ref || null,
        // What the reader can do from the card: "investigate" / "scan" for
        // new heat, "image" for an imagery signal.
        actions: Array.isArray(n.actions) ? n.actions : null,
        alertId: n.alertId || null,
        assetId: n.assetId || null,
        onHome: !!n.onHome,
        livestreamId: n.livestreamId || null,
        read: !fresh,
    }
    if (state.items.some((x) => x.id === item.id)) return false   // never double-raise
    state.items = [item, ...state.items].slice(0, 500)

    const raised = !n.silent && fresh && onScreen() && interrupts(item)
    if (raised) state.cards = [...state.cards, item]
    if (raised) soundFor(item)
    if (!n.silent && fresh && !onScreen() && offScreenHandler && interrupts(item)) {
        try { offScreenHandler(item) } catch { /* a notification that fails must not break the tray */ }
    }
    notify()

    // Criticals never self-dismiss: the one notification that must not be
    // missed is exactly the one a timer would remove while nobody was
    // looking. Everything else clears after 14s.
    if (raised && item.sev !== "critical") {
        setTimeout(() => dismissCard(item.id), 14000)
    }
    return raised
}

/** Remove the card. The item stays in the tray — that is the whole point. */
export function dismissCard(id) {
    if (!state.cards.some((c) => c.id === id)) return
    state.cards = state.cards.filter((c) => c.id !== id)
    notify()
}

export function markRead(id) {
    let changed = false
    state.items = state.items.map((i) => {
        if (i.id === id && !i.read) { changed = true; return { ...i, read: true } }
        return i
    })
    if (changed) notify()
}

export function markAllRead() {
    if (!state.items.some((i) => !i.read)) return
    state.items = state.items.map((i) => (i.read ? i : { ...i, read: true }))
    notify()
}

export function unreadCount() {
    return state.items.reduce((n, i) => n + (i.read ? 0 : 1), 0)
}

/** Test seam — not used by the app. */
export function __resetNotifications() {
    state.items = []; state.cards = []; state.muted = false
    notify()
}

// Any part of the app (or a test) can raise a card without importing this
// module: window.dispatchEvent(new CustomEvent("akili:notify", { detail })).
if (typeof window !== "undefined" && !window.__plxNotifyBound) {
    window.__plxNotifyBound = true
    window.addEventListener("akili:notify", (e) => { if (e?.detail) pushNotification(e.detail) })
}
