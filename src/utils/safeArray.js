export const safeArray = (val) => {
  if (Array.isArray(val)) return val
  if (typeof val === 'string' && val.length > 0) {
    try { return JSON.parse(val) } catch { return [] }
  }
  return []
}
