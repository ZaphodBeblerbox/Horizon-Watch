/**
 * alarm.js — the WARNING alarm: its own sound and its own vibration.
 *
 * THE SOUND is public/sounds/warning-alarm.wav: a loud two-tone (1050 Hz /
 * 700 Hz, a bright square) four times over, then a breath — nothing like
 * the app's notification chimes (soundSystem.js), so it is known for what
 * it is. It loops until stop(). Where the file cannot play, the same
 * pattern is synthesised (Web Audio).
 *
 * BROWSERS ONLY SOUND AFTER A TAP. A page may not start audio on its own
 * until the person has touched it once; prime() (on the first tap or key
 * anywhere in the app) plays the alarm element silently once, which lets it
 * play later with no tap — the iPhone included. Until then the takeover
 * says "Tap to sound the alarm" and a tap on it starts it (unlock()).
 *
 * VIBRATION: navigator.vibrate, long and strong, again every few seconds —
 * Android. iOS web pages cannot vibrate at all (the takeover says so).
 */

export const ALARM_URL = "/sounds/warning-alarm.wav"
export const VIBRATE_PATTERN = [1000, 250, 1000, 250, 1000]
export const REPEAT_MS = 4000

let shared = null
function defaultAudio() {
    if (typeof Audio === "undefined") return null
    if (!shared) {
        shared = new Audio(ALARM_URL)
        shared.loop = true
        shared.preload = "auto"
    }
    return shared
}

/** On the first tap anywhere: play the alarm element silently once, so it may sound later on its own. */
export function primeAlarm(audio = defaultAudio()) {
    if (!audio || audio.__primed) return
    try {
        audio.muted = true
        const p = audio.play()
        const done = () => { try { audio.pause(); audio.currentTime = 0 } catch { /* fine */ } audio.muted = false; audio.__primed = true }
        if (p && typeof p.then === "function") p.then(done, () => { audio.muted = false })
        else done()
    } catch { audio.muted = false }
}

export function installAlarmPrime(win = typeof window !== "undefined" ? window : undefined) {
    if (!win || win.__plxAlarmPrime) return
    win.__plxAlarmPrime = true
    const once = () => { primeAlarm(); for (const e of ["pointerdown", "keydown", "touchend"]) win.removeEventListener(e, once, true) }
    for (const e of ["pointerdown", "keydown", "touchend"]) win.addEventListener(e, once, true)
}

/** The same two-tone, synthesised: for a device where the file will not play. */
function synth() {
    let ctx = null, timer = null
    const beat = () => {
        const t0 = ctx.currentTime
        for (let i = 0; i < 8; i++) {
            const o = ctx.createOscillator(), g = ctx.createGain()
            o.type = "square"
            o.frequency.value = i % 2 ? 700 : 1050
            g.gain.setValueAtTime(0.0001, t0 + i * 0.22)
            g.gain.exponentialRampToValueAtTime(0.5, t0 + i * 0.22 + 0.01)
            g.gain.setValueAtTime(0.5, t0 + i * 0.22 + 0.2)
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.22 + 0.22)
            o.connect(g); g.connect(ctx.destination)
            o.start(t0 + i * 0.22); o.stop(t0 + i * 0.22 + 0.23)
        }
    }
    return {
        async start() {
            const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)
            if (!AC) return false
            ctx = ctx || new AC()
            try { await ctx.resume() } catch { /* still suspended */ }
            if (ctx.state !== "running") return false
            beat()
            timer = setInterval(beat, 2000)
            return true
        },
        stop() { if (timer) clearInterval(timer); timer = null },
    }
}

/**
 * The alarm. start() sounds and vibrates, repeating, until stop().
 * state(): {running, audible, blocked, canVibrate}.
 */
export function createAlarm({
    audio = defaultAudio,
    nav = typeof navigator !== "undefined" ? navigator : undefined,
    timers = { setInterval: (...a) => setInterval(...a), clearInterval: (id) => clearInterval(id) },
    makeSynth = synth,
    onChange = () => {},
} = {}) {
    let running = false, audible = false, blocked = false, timer = null, fallback = null
    const canVibrate = typeof nav?.vibrate === "function"
    const changed = () => { try { onChange({ running, audible, blocked, canVibrate }) } catch { /* listener */ } }
    const vibrate = () => { if (canVibrate) { try { nav.vibrate(VIBRATE_PATTERN) } catch { /* not allowed */ } } }

    async function sound() {
        if (!running || audible) return
        const a = audio()
        if (a) {
            try {
                a.loop = true; a.muted = false; a.volume = 1
                await a.play()
                if (!running) { a.pause(); return }
                audible = true; blocked = false; changed(); return
            } catch { /* not allowed yet, or no file: the synthesiser */ }
        }
        try {
            fallback = fallback || makeSynth()
            if (await fallback.start()) { if (running) { audible = true; blocked = false } else fallback.stop(); changed(); return }
        } catch { /* nothing can sound */ }
        blocked = true
        changed()
    }

    return {
        start() {
            if (running) return
            running = true
            changed()
            vibrate()
            sound()
            timer = timers.setInterval(() => { vibrate(); if (!audible) sound() }, REPEAT_MS)
        },
        stop() {
            if (!running) return
            running = false
            if (timer != null) timers.clearInterval(timer)
            timer = null
            const a = audio()
            if (a) { try { a.pause(); a.currentTime = 0 } catch { /* fine */ } }
            fallback?.stop()
            if (canVibrate) { try { nav.vibrate(0) } catch { /* fine */ } }
            audible = false; blocked = false
            changed()
        },
        /** A tap on the takeover: allowed to sound now. */
        unlock() { if (running && !audible) sound() },
        state() { return { running, audible, blocked, canVibrate } },
    }
}
