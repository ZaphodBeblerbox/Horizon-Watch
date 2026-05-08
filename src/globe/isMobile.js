// Shared mobile detection so layers can apply aggressive perf limits.
// Captured once at module load (matches GlobeView's behavior).
export const isMobile = (
    /iPhone|iPad|iPod|Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "")
    || (typeof window !== "undefined" && window.innerWidth < 1024)
)

// Per-layer entity caps on mobile. Desktop is unbounded.
export const ADSB_CAP   = isMobile ? 100 : Infinity
export const AIS_CAP    = isMobile ? 150 : Infinity
export const EVENTS_CAP = isMobile ? 100 : Infinity
export const POI_CAP    = isMobile ? 100 : Infinity
