// Module-level store so any layer can register entity data
// and GlobePopup can retrieve it on click without prop drilling.
const _store = new Map()
export const setEntity    = (id, type, data) => _store.set(id, { type, data })
export const getEntity    = id => _store.get(id)
export const deleteEntity = id => _store.delete(id)

// Find a currently-registered entity by matching one of its own data fields
// rather than its store key. Needed for deep-linking a report claim back to
// its live map marker: a report claim cites a stable domain id (e.g. a
// SurgeEvent's surge_id, an IntelligenceAssessment's assessment_id) but the
// entityStore key for a Forge-alert-derived marker is the Forge alert's own
// (unrelated) id — see GlobeAlertsLayer.jsx's `alert-forge-${a.id}` keying.
// Returns null (not a guess) if nothing currently registered matches.
export function findEntityByField(type, field, value) {
    for (const [id, entry] of _store.entries()) {
        if (entry.type === type && String(entry.data?.[field] ?? "") === String(value)) {
            return { id, type: entry.type, data: entry.data }
        }
    }
    return null
}
