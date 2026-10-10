// Web Audio API alert sound system for Akili
// All tones synthesized — no audio files required.

let _ctx = null

function ctx() {
    if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
    return _ctx
}

function tone(freq, type, duration, gain, startTime) {
    const c   = ctx()
    const osc = c.createOscillator()
    const g   = c.createGain()
    osc.connect(g)
    g.connect(c.destination)
    osc.type      = type
    osc.frequency.setValueAtTime(freq, startTime)
    g.gain.setValueAtTime(gain, startTime)
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration)
    osc.start(startTime)
    osc.stop(startTime + duration + 0.01)
}

function seq(notes, startOffset = 0) {
    const c   = ctx()
    const now = c.currentTime + startOffset
    let t = now
    for (const [freq, type, dur, gain] of notes) {
        tone(freq, type, dur, gain, t)
        t += dur
    }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function playAlert(severityTier, alertType) {
    try {
        if (alertType === "missile_warning") {
            // Urgent ascending square tones
            seq([
                [440, "square", 0.06, 0.35],
                [660, "square", 0.06, 0.35],
                [880, "square", 0.06, 0.35],
            ])
            return
        }
        if (alertType === "earthquake") {
            // Low rumble — sawtooth
            seq([[110, "sawtooth", 0.4, 0.25]])
            return
        }
        // Severity-based tones
        switch (severityTier) {
            case "critical":
                // 880→660 descending triangle, two pulses
                seq([
                    [880, "triangle", 0.08, 0.4],
                    [660, "triangle", 0.08, 0.4],
                    [880, "triangle", 0.08, 0.3],
                    [660, "triangle", 0.08, 0.3],
                ])
                break
            case "significant":
                // Single mid tone
                seq([[660, "sine", 0.12, 0.3]])
                break
            case "elevated":
                // Soft single
                seq([[528, "sine", 0.15, 0.2]])
                break
            default:
                // Low subtle ping
                seq([[440, "sine", 0.08, 0.15]])
        }
    } catch (_) {
        // AudioContext blocked or unsupported — silent fail
    }
}

export function playBriefingGenerated() {
    try {
        seq([
            [528, "sine", 0.2, 0.2],
            [660, "sine", 0.2, 0.2],
        ])
    } catch (_) {}
}

export function playDocumentSaved() {
    try {
        seq([[880, "sine", 0.04, 0.15]])
    } catch (_) {}
}

// Resume AudioContext if suspended (required after user gesture)
export function resumeAudio() {
    if (_ctx && _ctx.state === "suspended") _ctx.resume()
}

/* BROWSERS ONLY PLAY AFTER A GESTURE. An AudioContext created by a timer
   (the first alert) starts suspended and resume() from a timer is refused,
   so every sound was silent. The first click, tap or key anywhere creates
   and resumes it; after that a notification can play at any time. */
export function installAudioUnlock() {
    if (typeof window === "undefined" || window.__plxAudioUnlock) return
    window.__plxAudioUnlock = true
    const unlock = () => {
        try {
            const c = ctx()
            if (c.state === "suspended") c.resume()
            // a silent blip: Safari and the desktop webview unlock on a played node
            const g = c.createGain(); g.gain.value = 0; g.connect(c.destination)
            const o = c.createOscillator(); o.connect(g); o.start(); o.stop(c.currentTime + 0.01)
        } catch { /* no audio here */ }
        if (_ctx && _ctx.state === "running") {
            for (const ev of ["pointerdown", "keydown", "touchstart"]) window.removeEventListener(ev, unlock, true)
        }
    }
    for (const ev of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(ev, unlock, true)
}

/** The sound for a notification that takes the screen, by its severity. */
export function playNotification(sev, kind) {
    if (kind === "livestream") { try { seq([[660, "sine", 0.1, 0.25], [880, "sine", 0.14, 0.25]]) } catch { /* silent */ } return }
    playAlert(sev === "critical" ? "critical" : sev === "high" ? "significant" : "elevated")
}
