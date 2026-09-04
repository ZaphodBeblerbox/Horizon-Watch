// Probe requestAnimationFrame once at module load, then route every chart
// transition in Analytics.jsx through applyTransition() so a throttled or
// backgrounded tab (where rAF can silently never fire) still lands every
// chart on its correct final values instead of freezing mid-transition.
let rafOK = null
;(function probeRaf() {
    let fired = false
    if (typeof requestAnimationFrame !== "function") { rafOK = false; return }
    requestAnimationFrame(() => { fired = true; rafOK = true })
    setTimeout(() => { if (!fired) rafOK = false }, 260)
})()

// onProgress(t) is called with t in [0,1]. If rAF is unavailable/throttled,
// it is called once, synchronously, with t=1 — the chart still renders its
// correct current values, just without the intermediate animation frames.
// A wall-clock fallback timer also guarantees t=1 fires even if rAF stops
// firing partway through (e.g. the tab is backgrounded mid-transition).
export function applyTransition(durationMs, onProgress) {
    if (!durationMs || rafOK === false) { onProgress(1); return }
    const start = performance.now()
    let done = false
    function frame(now) {
        if (done) return
        const t = Math.min(1, (now - start) / durationMs)
        onProgress(t)
        if (t < 1) requestAnimationFrame(frame)
        else done = true
    }
    requestAnimationFrame(frame)
    setTimeout(() => { if (!done) { done = true; onProgress(1) } }, durationMs + 300)
}
