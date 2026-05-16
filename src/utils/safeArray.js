const WRAPPER_KEYS = [
  'items','results','data','features','events','alerts','rules','zones',
  'fusions','assessments','vessels','aircraft','cables','ports','airports',
  'articles','signals','ships','detections',
]

export const safeArray = (val) => {
  if (Array.isArray(val)) return val
  if (val === null || val === undefined) return []
  if (typeof val === 'string') {
    try {
      const p = JSON.parse(val)
      return Array.isArray(p) ? p : []
    } catch { return [] }
  }
  if (typeof val === 'object') {
    for (const key of WRAPPER_KEYS) {
      if (Array.isArray(val[key])) return val[key]
    }
  }
  return []
}
