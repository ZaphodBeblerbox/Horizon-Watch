/**
 * LaunchIntro.jsx — the opening screen.
 *
 * The PARALLAX wordmark, large, on the console's ground while the system
 * starts. When it is ready the X leaves the word and flies at the viewer;
 * on the way it comes apart — its back stroke one way, the three parallel
 * stripes (the X's own leg and the two accent strokes) the other — and the
 * ground dissolves into the map behind it. The X app's opening is the
 * reference: a mark that opens onto the product rather than fading off it.
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
 * Reduced motion: no flight, the ground fades.
 */
import { useEffect, useRef, useState } from "react"

const MIN_MS = 900
const AFTER_AUTH_MS = 8000
const HARD_CAP_MS = 20000

// The wordmark's geometry (PlxWordmark.jsx), split so the X can move alone.
const LETTERS = [
    "M1.3 21.3 V1.3 H8 C11.6 1.3 12.7 3.5 12.7 6.2 C12.7 8.9 11.6 11 8 11 H1.3",
    "M37.3 21.3 V1.3 H44 C47.6 1.3 48.7 3.5 48.7 6.2 C48.7 8.9 47.6 11 44 11 H37.3 M43.5 11 L49.8 21.3 M73.3 -1.3 V18.7 H83 M88.8 -1.3 V18.7 H98.5",
    "M17.74 21.3 L23.3 1.3 H25.7 L31.26 21.3",
    "M53.74 21.3 L59.3 1.3 H61.7 L67.26 21.3 M103.24 21.3 L108.8 1.3 H111.2 L116.76 21.3",
]
const X_BACK = "M121.2 -1.3 L134.8 21.3"            // "\"
const STRIPES = [                                   // the three parallel "/"
    ["M134.8 -1.3 L121.2 21.3", "currentColor"],
    ["M138.98 -1.3 L131.6 11", "var(--acchi, #a0b2d2)"],
    ["M143.18 -1.3 L139.4 5", "var(--acchi, #a0b2d2)"],
]
const X_CENTRE = "128px 10px"                       // in the viewBox's units
const WORD_CENTRE_DX = 72.5 - 128

const reduced = () => typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

export default function LaunchIntro() {
    const [phase, setPhase] = useState("hold")      // hold | exit | gone
    const root = useRef(null)
    const letters = useRef(null)
    const xGroup = useRef(null)
    const back = useRef(null)
    const stripes = useRef([])
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

    // The flight.
    useEffect(() => {
        if (phase !== "exit") return
        const done = () => setPhase("gone")
        if (reduced() || !root.current?.animate) {
            const a = root.current?.animate?.([{ opacity: 1 }, { opacity: 0 }], { duration: 300, fill: "forwards" })
            if (a) a.onfinish = done; else done()
            return
        }
        const T = 1150
        const ease = "cubic-bezier(.55,0,.15,1)"
        // the word falls away under the X
        letters.current.animate([
            { opacity: 1, transform: "translateY(0)" },
            { opacity: 0, transform: "translateY(5px)" },
        ], { duration: 360, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" })
        // the X comes to the centre and at the viewer
        xGroup.current.animate([
            { transform: "translate(0,0) scale(1)" },
            { transform: `translate(${WORD_CENTRE_DX}px,0) scale(2.4)`, offset: 0.34 },
            { transform: `translate(${WORD_CENTRE_DX}px,0) scale(9)` },
        ], { duration: T, easing: ease, fill: "forwards" })
        // and comes apart: the back stroke down and left, the stripes up and right, staggered
        back.current.animate([
            { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
            { transform: "translate(0,0) rotate(0deg)", opacity: 1, offset: 0.3 },
            { transform: "translate(-30px,26px) rotate(-14deg)", opacity: 0 },
        ], { duration: T, easing: ease, fill: "forwards" })
        const flights = [[16, -22, 8], [24, -30, 14], [32, -36, 22]]
        stripes.current.forEach((el, i) => {
            const [dx, dy, rot] = flights[i]
            el?.animate([
                { transform: "translate(0,0) rotate(0deg)", opacity: 1 },
                { transform: "translate(0,0) rotate(0deg)", opacity: 1, offset: 0.3 + i * 0.06 },
                { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg)`, opacity: 0 },
            ], { duration: T, easing: ease, fill: "forwards" })
        })
        // the ground opens onto the map
        const g = root.current.animate([
            { opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 },
        ], { duration: T + 150, easing: "ease-out", fill: "forwards" })
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
            <svg viewBox="0 0 145 20" style={{ width: "min(72vw, 760px)", overflow: "visible" }}>
                <g fill="none" strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter">
                    <g ref={letters} stroke="currentColor" style={svgEl({})}>
                        {LETTERS.map((d) => <path key={d} d={d} />)}
                    </g>
                    <g ref={xGroup} style={svgEl({ transformOrigin: X_CENTRE })}>
                        <path ref={back} d={X_BACK} stroke="currentColor"
                              style={svgEl({ transformOrigin: X_CENTRE })} />
                        {STRIPES.map(([d, stroke], i) => (
                            <path key={d} d={d} stroke={stroke} ref={(el) => { stripes.current[i] = el }}
                                  style={svgEl({
                                      transformOrigin: X_CENTRE,
                                      // while it waits, the two accents run as the loading mark does
                                      animation: !exiting && i > 0 ? `plx-e${i} 1.6s cubic-bezier(.22,.61,.36,1) infinite` : "none",
                                  })} />
                        ))}
                    </g>
                </g>
            </svg>
        </div>
    )
}
