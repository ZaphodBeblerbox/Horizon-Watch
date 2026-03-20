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
