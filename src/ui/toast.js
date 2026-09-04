// toast.js — redesign Round 2, §7: the one real toast queue for the whole
// app. No shared toast system existed before this (confirmed by investigation:
// every prior "toast" was ad-hoc per-component local state in ForgePanel.jsx,
// and the app's one real toast popup — the "anomaly" toast — was already
// deliberately removed in an earlier round with an explicit "no exceptions"
// ground rule). This module is a plain pub/sub, not a React context, so any
// component/module (including non-React code like a Cesium click handler)
// can call `toast(...)` without needing to be inside a provider tree.
//
// Confirm-only, per the standing decision this round reinforces: a toast
// tells the user an action they took just happened ("3 signals added to
// briefing basket"); it never carries information they must read to learn
// something happened on its own (that belongs in a real panel/badge).

let seq = 0
const listeners = new Set()

/**
 * @param {string} message
 * @param {{ icon?: string, durationMs?: number }} [opts] - icon: an
 *   IconSprite symbol name (e.g. "icon-check"); durationMs default 3200ms
 *   per the component spec.
 */
export function toast(message, opts = {}) {
    const id = ++seq
    const entry = { id, message, icon: opts.icon || "icon-check", durationMs: opts.durationMs ?? 3200 }
    listeners.forEach((fn) => fn(entry))
    return id
}

/** Internal — ToastHost.jsx subscribes here. Not for general use. */
export function subscribeToasts(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
}
