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
    feed:     { icon: "i-feed",    name: "Feed health" },
    system:   { icon: "i-gear",    name: "System" },
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
export function interrupts(n) {
    if (state.muted) return false
    return n.sev === "critical"
        || n.kind === "escalate" || n.kind === "assign" || n.kind === "rfi"
        || n.kind === "surge" || n.kind === "fusion"
}

export function setMuted(v) {
    state.muted = !!v
    notify()
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
export function pushNotification(n) {
    const item = {
        id: n.id || `N-${Math.random().toString(36).slice(2, 9)}`,
        ts: n.ts || Date.now(),
        kind: KIND[n.kind] ? n.kind : "signal",
        sev: SEV_ORDER.includes(n.sev) ? n.sev : "moderate",
        title: n.title || "",
        sub: n.sub || "",
        ref: n.ref || null,
        read: false,
    }
    if (state.items.some((x) => x.id === item.id)) return false   // never double-raise
    state.items = [item, ...state.items].slice(0, 500)

    const raised = !n.silent && interrupts(item)
    if (raised) state.cards = [...state.cards, item]
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
