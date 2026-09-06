import { useState, useEffect } from "react"

// extensionRegistry.js — V3 Phase 1, §2.2: the real hook-based extension
// point for the Inspector/detail-panel surfaces, replacing the reference
// document's wrapper-patching anti-pattern (reassigning an exported render
// function, e.g. `SH.renderInspector = newVersion`, never rebinds the
// internal call sites that already captured the original reference — an
// extension silently stops firing the moment anything re-selects a
// record). The general fix: the component that owns a shared surface
// publishes an extension-point hook array and calls every registered hook
// itself, from inside its own render path. Nothing external ever
// reassigns or wraps the owner's function.
//
// This follows the exact same plain-pub-sub shape already established in
// this codebase by annotationStore.js/briefingBasket.js (not React
// context, not a `window.someArray.push(fn)` global) — confirmed via
// audit to be the real, existing idiom for cross-cutting shared state
// here, so this is consistent with the codebase rather than a new,
// competing pattern.
//
// An extension is a React component receiving `{ recordRef, record }` —
// recordRef is the real reference-grammar string (src/lib/ref.js, e.g.
// "sig:ALT-1a2b3c4d"), record is whatever resolve(recordRef) returned
// (may be null while still loading, or for a bare selection with nothing
// resolved yet). The owning surface (InspectorPanel.jsx, Situation.jsx's
// Inspector pane, etc.) calls useInspectorExtensions() and .map()s over
// the result INSIDE its own render — it is never called from outside.
//
// Phase 1 registers zero real extensions — Phase 4's assignment/presence/
// comments/urgent-interrupt work (§7.7 in the reference doc) is what
// actually pushes real ones here. The mechanism exists now so those land
// without this codebase's inspector-rendering components changing again.

const extensions = new Set()
const listeners = new Set()

function emit() {
    const snapshot = Array.from(extensions)
    listeners.forEach((fn) => fn(snapshot))
}

/**
 * Register a real inspector extension. Returns an unregister function —
 * call it on unmount if the registration is itself tied to a mounted
 * component's lifetime (most real extensions, e.g. a Phase 4 feature
 * module, register once at module load and never unregister).
 * @param {(props: {recordRef: string, record: any}) => import("react").ReactNode} Component
 */
export function registerInspectorExtension(Component) {
    extensions.add(Component)
    emit()
    return () => {
        if (extensions.delete(Component)) emit()
    }
}

export function getInspectorExtensions() {
    return Array.from(extensions)
}

/** React hook — the real live list of registered extensions, for an
 * Inspector-rendering surface to map over inside its own render. */
export function useInspectorExtensions() {
    const [list, setList] = useState(() => getInspectorExtensions())
    useEffect(() => {
        listeners.add(setList)
        return () => listeners.delete(setList)
    }, [])
    return list
}
