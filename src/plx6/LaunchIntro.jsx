/**
 * LaunchIntro.jsx — the opening screen.
 *
 * The PARALLAX logo — the X mark above the word — fades in on the console's
 * ground while the system starts, and fades out onto the map when it is
 * ready (the owner, 2026-10-10: a fade, not the flying X).
 *
 * WHEN IT IS READY. Mounted beside <App/> (main.jsx), so it covers the
 * session check, the login and the globe's first load alike. It leaves on:
 *   - "plx:booted"     the app has nothing to wait for (login screen, phone);
 *   - "plx:map-ready"  the globe drew a frame with its tiles loaded
 *                      (components/GlobeView.jsx), after "plx:authed";
 *   - 8 s after "plx:authed", in case the map is not the first screen;
 *   - 20 s in any case, so a slow server never traps anyone behind a logo.
 * It stays at least MIN_MS, or the mark flickers past before it registers.
 *
 * Reduced motion: shorter fades.
 */
import { useEffect, useRef, useState } from "react"
import { LETTER_PATHS, X_PATHS } from "../ui/wordmarkGeometry.js"

const MIN_MS = 1100        // the fade-in finishes before the fade-out starts
const AFTER_AUTH_MS = 8000
const HARD_CAP_MS = 20000

// The word, level (ui/wordmarkGeometry.js), without the echoes: the mark
// above it carries them.
const WORD = [...LETTER_PATHS, ...X_PATHS]
// The mark above it (the #g-logo X): its back stroke, and the three
// parallel stripes — its own leg and the two accents.
const X_BACK = "M4 4 L15 20"
const STRIPES = [
    ["M15 4 L4 20", "currentColor"],
    ["M19 4 L13.5 12", "var(--acchi, #a0b2d2)"],
    ["M23 4 L20.25 8", "var(--acchi, #a0b2d2)"],
]

const reduced = () => typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

export default function LaunchIntro() {
    const [phase, setPhase] = useState("hold")      // hold | exit | gone
    const root = useRef(null)
    const shownAt = useRef(Date.now())

    // Decide when to leave.
    useEffect(() => {
        let authed = false, left = false
        const timers = []
        const leave = () => {
            if (left) return
            left = true
            const wait = Math.max(0, MIN_MS - (Date.now() - shownAt.current))
            timers.push(setTimeout(() => setPhase("exit"), wait))
        }
        const onAuthed = () => { authed = true; if (window.__plxMapReady) leave(); else timers.push(setTimeout(leave, AFTER_AUTH_MS)) }
        const onMap = () => { if (authed) leave() }
        window.addEventListener("plx:booted", leave)
        window.addEventListener("plx:authed", onAuthed)
        window.addEventListener("plx:map-ready", onMap)
        timers.push(setTimeout(leave, HARD_CAP_MS))
        return () => {
            window.removeEventListener("plx:booted", leave)
            window.removeEventListener("plx:authed", onAuthed)
            window.removeEventListener("plx:map-ready", onMap)
            timers.forEach(clearTimeout)
        }
    }, [])

    // In: the logo fades up while the system starts.
    const logo = useRef(null)
    useEffect(() => {
        if (reduced() || !logo.current?.animate) return
        logo.current.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 700, easing: "ease-out", fill: "both" })
    }, [])

    // Out: the logo fades, and the ground with it, onto the map.
    useEffect(() => {
        if (phase !== "exit") return
        const done = () => setPhase("gone")
        if (!root.current?.animate) { done(); return }
        const quick = reduced()
        logo.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: quick ? 150 : 450, easing: "ease-in", fill: "forwards" })
        const g = root.current.animate([{ opacity: 1 }, { opacity: 1, offset: quick ? 0 : 0.35 }, { opacity: 0 }],
                                       { duration: quick ? 250 : 800, easing: "ease-out", fill: "forwards" })
        g.onfinish = done
    }, [phase])

    if (phase === "gone") return null
    const exiting = phase === "exit"
    const svgEl = (style) => ({ transformBox: "view-box", ...style })
    return (
        <div ref={root} aria-hidden="true" data-testid="launch-intro" style={{
            position: "fixed", inset: 0, zIndex: 20000, display: "grid", placeItems: "center",
            background: "var(--bg-0, #14161f)", color: "var(--txt, #f2f3f6)",
            pointerEvents: exiting ? "none" : "auto", overflow: "hidden",
        }}>
            <div ref={logo} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "min(5vh, 44px)", opacity: 0 }}>
                <svg viewBox="0 0 24 24" style={{ width: "min(26vmin, 210px)", overflow: "visible", display: "block" }}
                     fill="none" strokeWidth="2.2" strokeLinecap="butt">
                    <path d={X_BACK} stroke="currentColor" />
                    {STRIPES.map(([d, stroke]) => <path key={d} d={d} stroke={stroke} />)}
                </svg>
                <svg viewBox="0 0 136.1 21.3" style={{ width: "min(46vw, 440px)", display: "block", overflow: "visible" }}
                     fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter">
                    {WORD.map((d) => <path key={d} d={d} />)}
                </svg>
            </div>
        </div>
    )
}
