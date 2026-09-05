import { useState, useEffect } from "react"

// annotationStore.js — the one real shared list of analyst-drawn map
// annotations (markers/routes/areas). Plain pub/sub (matching
// briefingBasket.js's pattern), not React context, so the map header's
// annotation toolbar (the creation surface) and the Layers pane's
// Annotations group (the management surface) both read/write the exact
// same list — never two lists that can drift apart.

let seq = 0
const items = new Map()
const listeners = new Set()

function emit() {
    const snapshot = Array.from(items.values())
    listeners.forEach((fn) => fn(snapshot))
}

/** type: "marker"|"route"|"area". points: [{lat,lon}, ...]. name: a real
 * provisional name filled in immediately (e.g. "Area 4") — never empty. */
export function addAnnotation(type, points, name) {
    const id = `anno_${Date.now()}_${++seq}`
    items.set(id, { id, type, points, name, createdAt: Date.now() })
    emit()
    return id
}

export function renameAnnotation(id, name) {
    const a = items.get(id)
    if (!a) return false
    items.set(id, { ...a, name })
    emit()
    return true
}

export function removeAnnotation(id) {
    const existed = items.delete(id)
    if (existed) emit()
    return existed
}

export function getAnnotations() {
    return Array.from(items.values())
}

export function subscribeAnnotations(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}

/** React hook — the real live list, for both the map header's toolbar (only
 * needs to create) and the Layers pane's Annotations group (rename/fly-to/
 * delete) to render from — one shared list, never two. */
export function useAnnotations() {
    const [list, setList] = useState(() => getAnnotations())
    useEffect(() => subscribeAnnotations(setList), [])
    return list
}
