/**
 * frames.js — screenshots of a video, for locating it.
 *
 * Locating needs the one frame where the place shows best — a sign, a
 * skyline, a shadow — so the frame is chosen, not taken. captureFrame()
 * is the screenshot of whatever the player shows; sampleFrames() lays the
 * whole video out as a strip so that frame can be found without scrubbing
 * blind. Both need the video loaded with crossOrigin="use-credentials"
 * (the API is another origin); a tainted canvas returns null.
 */

export function captureFrame(video, quality = 0.92) {
    if (!video || !video.videoWidth) return null
    try {
        const c = document.createElement("canvas")
        c.width = video.videoWidth
        c.height = video.videoHeight
        c.getContext("2d").drawImage(video, 0, 0)
        return c.toDataURL("image/jpeg", quality)
    } catch {
        return null
    }
}

/** n small frames spread over the video: [{t, url}] (seconds, data URL). */
export async function sampleFrames(src, n = 10, width = 200) {
    const v = document.createElement("video")
    v.crossOrigin = "use-credentials"
    v.muted = true
    v.preload = "auto"
    v.src = src
    await new Promise((ok, fail) => { v.onloadedmetadata = ok; v.onerror = fail })
    const d = v.duration
    if (!Number.isFinite(d) || d <= 0) return []
    const out = []
    const c = document.createElement("canvas")
    for (let i = 0; i < n; i++) {
        const t = Math.min(d - 0.05, (d * (i + 0.5)) / n)
        await new Promise((ok) => { v.onseeked = ok; v.currentTime = t })
        const h = Math.round((width * v.videoHeight) / Math.max(1, v.videoWidth))
        c.width = width; c.height = h
        try {
            c.getContext("2d").drawImage(v, 0, 0, width, h)
            out.push({ t, url: c.toDataURL("image/jpeg", 0.7) })
        } catch {
            return out
        }
    }
    v.removeAttribute("src"); v.load()
    return out
}

export const fmtT = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, "0")}`
