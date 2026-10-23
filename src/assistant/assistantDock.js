/**
 * assistantDock.js — which face the map's right column shows: the Inspector
 * or the Assistant (owner, 2026-10-23: "by pressing on the X, the inspector
 * window disappears and a chat window appears").
 *
 * The column itself (open or closed) is the persisted chrome setting
 * chrome.rightPanel; this only says which tab is in front. Opening an item
 * brings the Inspector forward; closing the Inspector (its X) brings the
 * Assistant forward instead of leaving an empty map edge. Remembered in this
 * browser (a per-viewer convenience).
 */
import { useSyncExternalStore } from "react"

const KEY = "plx-right-tab"
const read = () => { try { return localStorage.getItem(KEY) === "assistant" ? "assistant" : "inspector" } catch { return "inspector" } }
let tab = read()
const subs = new Set()

export const getRightTab = () => tab
export function setRightTab(next) {
    const t = next === "assistant" ? "assistant" : "inspector"
    if (t === tab) return
    tab = t
    try { localStorage.setItem(KEY, t) } catch { /* private mode */ }
    subs.forEach((f) => f())
}
export function subscribeRightTab(fn) { subs.add(fn); return () => subs.delete(fn) }
export function useRightTab() { return useSyncExternalStore(subscribeRightTab, getRightTab, getRightTab) }

/**
 * What the top bar's sparkle does on the map, given the column's state. Pure (tested).
 * @returns {"close"|"show"} close the column, or open it with the Assistant in front
 */
export function sparkleAction(columnOpen, currentTab) {
    return columnOpen && currentTab === "assistant" ? "close" : "show"
}

/** True when a key press is the '/' that focuses the chat (not typed into a field). Pure (tested). */
export function isChatShortcut(e) {
    if (!e || e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return false
    const t = e.target
    const tag = (t?.tagName || "").toLowerCase()
    return !(tag === "input" || tag === "textarea" || tag === "select" || t?.isContentEditable)
}
