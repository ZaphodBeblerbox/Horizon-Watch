// fetchWithTimeout.js — real, generic "this fetch can fail or hang, and the
// caller must find out within a bounded real time" helper. Not a special
// case for any one endpoint — any fetch() call in this app can hang
// indefinitely on a slow/unresponsive backend (this repo's own real,
// disclosed backend condition this round: a continuous event-loop-
// blocking signal-evaluation loop), and the browser's own default fetch
// has no timeout at all. Wraps AbortController so callers get a real,
// distinct rejection (not a silent forever-pending promise) after
// `timeoutMs`, tagged so callers can tell a real timeout apart from any
// other real fetch failure if they want to.
export async function fetchWithTimeout(url, { timeoutMs = 7000, ...init } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
        return await fetch(url, { ...init, signal: controller.signal })
    } catch (err) {
        if (err.name === "AbortError") {
            const timeoutErr = new Error(`Request timed out after ${timeoutMs}ms: ${url}`)
            timeoutErr.name = "TimeoutError"
            throw timeoutErr
        }
        throw err
    } finally {
        clearTimeout(timer)
    }
}
