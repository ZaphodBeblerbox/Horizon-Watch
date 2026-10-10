/**
 * homeNews.js — "New on Home": a notification when something is added to
 * the home screen (owner, 2026-10-10).
 *
 * Home's sections change by themselves — new footage from the ground, new
 * items under what happened while you were away. Each section's items are
 * compared with what this browser has already been told about; anything
 * not seen before is announced once, as one notification per change (one
 * item named, several counted). The first look at a section only records
 * it: what was already there when you opened the app is not news. What was
 * announced is remembered across reloads (localStorage), so a reload does
 * not announce it again.
 *
 * It always lands in the tray. It takes the screen — a card, or with the
 * window hidden a native notification on the desktop app — only when Home
 * is not what you are looking at (notificationStore.interrupts, `onHome`).
 */
import { pushNotification } from "../state/notificationStore.js"

const KEY = "plx.home.seen.v1"
const KEEP = 200

function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || "{}") || {} } catch { return {} }
}
function save(all) {
    try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* private mode: announce per session */ }
}

/**
 * The items in `items` this section has not had before. The first call for
 * a section records and returns nothing. Pure apart from `store`.
 */
export function newOnHome(section, items, idOf, store) {
    const ids = items.map(idOf).filter((x) => x != null).map(String)
    const known = store[section]
    if (!known) {
        store[section] = ids.slice(0, KEEP)
        return []
    }
    const seen = new Set(known)
    const fresh = items.filter((it) => { const id = idOf(it); return id != null && !seen.has(String(id)) })
    if (fresh.length) store[section] = [...ids, ...known.filter((k) => !ids.includes(k))].slice(0, KEEP)
    return fresh
}

/** Is Home on screen right now? */
export function homeVisible() {
    try {
        const el = document.querySelector('[data-screen-label="Home"]')
        return !!el && el.offsetParent !== null && document.visibilityState !== "hidden"
    } catch { return false }
}

const SECTION = {
    ground: "From the ground",
    happened: "What happened while you were away",
}

/** Announce what is new in one of Home's sections. Returns the new items. */
export function announceNew(section, items, { idOf = (x) => x.id, titleOf = (x) => x.headline || x.title, whereOf = () => null } = {}) {
    if (!Array.isArray(items) || !items.length) return []
    const store = load()
    const fresh = newOnHome(section, items, idOf, store)
    save(store)
    if (!fresh.length) return fresh
    const first = fresh[0]
    const name = String(titleOf(first) || "").trim()
    const where = whereOf(first)
    pushNotification({
        id: `home:${section}:${fresh.map(idOf).join(",")}`.slice(0, 200),
        kind: "home",
        sev: "moderate",
        title: fresh.length === 1 ? `New on Home: ${name}` : `${fresh.length} new on Home · ${SECTION[section] || section}`,
        sub: fresh.length === 1
            ? [SECTION[section], where].filter(Boolean).join(" · ")
            : fresh.slice(0, 3).map((x) => titleOf(x)).filter(Boolean).join(" · "),
        actions: ["home"],
        onHome: homeVisible(),
        ts: Date.now(),
    })
    return fresh
}
