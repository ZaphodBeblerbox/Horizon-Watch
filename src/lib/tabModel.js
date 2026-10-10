// tabModel.js — pure, testable tab-matching logic for V3 Phase 1, §3.4
// (record-scoped tabs). Extracted out of app.jsx's openTab() so the real
// decision logic (switch vs. create, base tab vs. record tab) can be unit
// tested without mounting the whole app shell.

export const TAB_LABELS = {
    situation: "Situation", inbox: "Inbox", dossiers: "Dossiers",
    analytics: "Insight", stats: "Analytics", generate: "Generate", briefings: "Briefings", replay: "Replay",
    ontology: "Ontology", imagery: "Imagery",
    map: "Map", dashboard: "Dashboard", reports: "Reports", watchlists: "Watchlists",
    sources: "Intel", aiCouncil: "AI Council", settings: "Settings", assets: "Assets",
}

/**
 * Pure decision function for openTab(type, opts). Given the current tabs
 * array, the target module type, and optional {recordRef, label}, returns
 * exactly one of:
 *   { action: "switch",  id }                  — reuse an existing tab
 *   { action: "retitle-and-switch", id, label } — reuse, but its label changed
 *   { action: "create",  tab }                 — a brand new tab is needed
 *
 * A plain module switch (no recordRef) matches/creates the module's one
 * base tab (`!t.recordRef`). A record open (`recordRef` present) matches/
 * creates a tab keyed on (type, recordRef) — a genuinely separate tab per
 * record, never colliding with that module's own base tab.
 */
export function resolveTabAction(tabs, type, opts, newId) {
    const recordRef = opts?.recordRef || null
    const label = opts?.label

    if (recordRef) {
        const existing = tabs.find(t => t.type === type && t.recordRef === recordRef)
        if (existing) {
            if (label && label !== existing.label) return { action: "retitle-and-switch", id: existing.id, label }
            return { action: "switch", id: existing.id }
        }
        return {
            action: "create",
            tab: { id: newId, type, recordRef, kind: "record", label: label || TAB_LABELS[type] || type },
        }
    }

    const existing = tabs.find(t => t.type === type && !t.recordRef)
    if (existing) return { action: "switch", id: existing.id }
    return { action: "create", tab: { id: newId, type, label: TAB_LABELS[type] || type } }
}
