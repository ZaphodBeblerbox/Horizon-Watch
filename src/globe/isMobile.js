// Shared mobile detection so layers can apply aggressive perf limits.
// UA + physical screen size — avoids false positives on non-maximised desktop windows.
export const isMobile = (() => {
    if (typeof navigator === "undefined") return false
    const ua = navigator.userAgent
    if (/iPhone|iPod|Android.*Mobile/i.test(ua)) return true
    if (typeof window !== "undefined" && window.screen.width < 768 && "ontouchstart" in window) return true
    return false
})()

// Per-layer entity caps on mobile. Desktop is unbounded.
export const ADSB_CAP   = isMobile ? 100 : Infinity
export const AIS_CAP    = isMobile ? 150 : Infinity
export const EVENTS_CAP = isMobile ? 100 : Infinity
