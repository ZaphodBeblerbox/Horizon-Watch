/**
 * LaunchIntro.jsx — the opening screen.
 *
 * PARALLAX — the word, its X the Parallax X with its stripes — and under it,
 * on one line, "by", the Trifecta knot and TRIFECTA TECHNOLOGIES (the
 * owner, 2026-10-10; the knot from the Trifecta logo kit, public/brand/).
 * It fades in on the console's ground while the system starts and fades
 * out onto the map when it is ready.
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
import { LETTER_PATHS, X_PATHS, ECHO_PATHS, WORD_CLIP, ECHO_STROKE, WORD_VIEWBOX } from "../ui/wordmarkGeometry.js"

const MIN_MS = 1100        // the fade-in finishes before the fade-out starts
const AFTER_AUTH_MS = 8000
const HARD_CAP_MS = 20000

// The word, level (ui/wordmarkGeometry.js), ending in the Parallax X: its
// two strokes and the two stripes beside its front leg.
const WORD = [...LETTER_PATHS, ...X_PATHS]

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
            <div ref={logo} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "min(4.5vh, 40px)", opacity: 0 }}>
                <svg viewBox={WORD_VIEWBOX} role="img" aria-label="Parallax" style={{ width: "min(70vw, 560px)", display: "block", overflow: "visible" }}
                     fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter">
                    <defs><clipPath id="plx-intro-clip"><rect {...WORD_CLIP} /></clipPath></defs>
                    <g clipPath="url(#plx-intro-clip)">
                        {WORD.map((d) => <path key={d} d={d} />)}
                        {ECHO_PATHS.map((d) => <path key={d} d={d} stroke="var(--acchi, #a0b2d2)" strokeWidth={ECHO_STROKE} />)}
                    </g>
                </svg>
                <TrifectaLine />
            </div>
        </div>
    )
}

/** "by [knot] TRIFECTA TECHNOLOGIES", on one line (Trifecta logo kit). The
 *  knot is drawn through a mask so it takes the text colour on any ground. */
export function TrifectaLine({ size = 1 }) {
    return (
        <div data-testid="trifecta-line" style={{ display: "flex", alignItems: "center", gap: `${0.7 * size}em`, fontSize: `${13 * size}px`,
                                                  fontFamily: "'Manrope', var(--font, system-ui), sans-serif", fontWeight: 500, color: "var(--txt2, #c9cfda)" }}>
            <span style={{ fontSize: ".8em", letterSpacing: ".18em", color: "var(--txt3, #9aa3b2)" }}>BY</span>
            <span aria-hidden="true" style={{ width: "1.9em", height: "1.86em", background: "currentColor", display: "inline-block",
                                              WebkitMask: "url(/brand/trifecta-mark.png) center / contain no-repeat",
                                              mask: "url(/brand/trifecta-mark.png) center / contain no-repeat" }} />
            <span style={{ letterSpacing: ".22em", marginRight: "-.22em" }}>TRIFECTA TECHNOLOGIES</span>
        </div>
    )
}
