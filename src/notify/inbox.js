/**
 * inbox.js — unread messages and desk posts, on the phone and the desktop
 * alike (owner, 2026-10-19: "I want an indicator if I have any unread
 * messages in the message box or on the desk", and "everything we do on
 * mobile also has to work on the desktop version").
 *
 * THREE SMALL THINGS, SHARED:
 *   - the two counts (GET /api/chat/unread, /api/desk/unread), polled once
 *     for the whole app while it is visible, and refreshed at once after
 *     something is marked read; when a count GROWS the app is told
 *     ("plx:inbox-changed") so it fetches its notifications now rather than
 *     at its next 20-second poll;
 *   - what is on screen (the open conversation, the desk), so a message
 *     you are already looking at does not also pop up as a notification;
 *   - opening a conversation or a desk post from a notification, whichever
 *     surface is showing and whether or not that screen has mounted yet.
 *
 * The server owns what is unread (its last-read marks), so the two devices
 * agree; nothing here is stored in the browser.
 */
import { useEffect, useState } from "react"

/* ── what is on screen ──────────────────────────────────────────────── */

const viewing = { chat: null, desk: false }

export function setViewingChat(id) { viewing.chat = id || null }
export function setViewingDesk(on) { viewing.desk = !!on }

const hidden = () => typeof document !== "undefined" && document.hidden

/** Is this notification about what the reader is looking at right now? */
export function isOnScreen(n) {
    if (!n || hidden()) return false
    if (n.kind === "message") return !!n.conversationId && n.conversationId === viewing.chat
    if (n.kind === "desk") return viewing.desk
    return false
}

/* ── the counts ─────────────────────────────────────────────────────── */

const counts = { messages: 0, desk: 0 }
const listeners = new Set()
let timer = null
let inflight = null

export const POLL_MS = 15_000

/** Did anything new arrive between two readings? Pure. */
export function grew(prev, next) {
    return (next?.messages || 0) > (prev?.messages || 0) || (next?.desk || 0) > (prev?.desk || 0)
}

/** "9", "99+", or "" for nothing. Pure. */
export function badgeText(n) {
    const v = Math.max(0, Math.floor(+n || 0))
    return v === 0 ? "" : v > 99 ? "99+" : String(v)
}

function emit() { for (const fn of listeners) fn({ ...counts }) }

export function getInboxUnread() { return { ...counts } }

export async function refreshInboxUnread() {
    if (inflight) return inflight
    inflight = (async () => {
        const [{ unreadTotal }, { deskUnread }] = await Promise.all([import("../lib/chatApi.js"), import("../lib/deskApi.js")])
        const [m, d] = await Promise.all([unreadTotal().catch(() => null), deskUnread().catch(() => null)])
        const next = { messages: m ? m.unread || 0 : counts.messages, desk: d ? d.unread || 0 : counts.desk }
        const more = grew(counts, next)
        counts.messages = next.messages
        counts.desk = next.desk
        emit()
        if (more && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("plx:inbox-changed", { detail: { ...counts } }))
    })().finally(() => { inflight = null })
    return inflight
}

function start() {
    if (timer || typeof window === "undefined") return
    const tick = () => { if (!hidden()) refreshInboxUnread().catch(() => {}) }
    tick()
    timer = setInterval(tick, POLL_MS)
    document.addEventListener("visibilitychange", tick)
}

/** { messages, desk } — live, for a badge. */
export function useInboxUnread() {
    const [c, setC] = useState(getInboxUnread)
    useEffect(() => {
        listeners.add(setC)
        start()
        return () => { listeners.delete(setC) }
    }, [])
    return c
}

/* ── opening a conversation or a desk post ──────────────────────────── */

/** Ask the chat screen to open this conversation. It may not have mounted
 *  yet (the tab is opened in the same click), so the request waits on
 *  window until it is taken. */
export function requestOpenChat(id) {
    if (typeof window === "undefined" || !id) return
    window.__plxOpenChat = id
    window.dispatchEvent(new CustomEvent("plx:open-chat", { detail: { id } }))
}

export function takeOpenChat() {
    if (typeof window === "undefined") return null
    const id = window.__plxOpenChat || null
    window.__plxOpenChat = null
    return id
}

export function requestOpenDeskPost(id) {
    if (typeof window === "undefined") return
    window.__plxOpenDeskPost = id || "__desk"
    window.dispatchEvent(new CustomEvent("plx:open-desk-post", { detail: { id } }))
}

/** null when nothing was asked for, else {id} (id null: just the desk). */
export function takeOpenDeskPost() {
    if (typeof window === "undefined") return null
    const id = window.__plxOpenDeskPost || null
    window.__plxOpenDeskPost = null
    return id ? { id: id === "__desk" ? null : id } : null
}

/* ── choosing people to add (a group, the company desk) ─────────────── */

/** Everyone who could be added: not already in, matching the search. Pure. */
export function addablePeople(people, memberIds, q = "") {
    const inIt = new Set(memberIds || [])
    const text = String(q || "").trim().toLowerCase()
    return (people || []).filter((p) => p && !inIt.has(p.id) && (!text
        || [p.name, p.email, p.title, p.company].some((x) => String(x || "").toLowerCase().includes(text))))
}
