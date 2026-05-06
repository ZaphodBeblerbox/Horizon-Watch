// Module-level store so any layer can register entity data
// and GlobePopup can retrieve it on click without prop drilling.
const _store = new Map()
export const setEntity    = (id, type, data) => _store.set(id, { type, data })
export const getEntity    = id => _store.get(id)
export const deleteEntity = id => _store.delete(id)
