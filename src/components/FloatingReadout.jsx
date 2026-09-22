/**
 * FloatingReadout.jsx — a tooltip that can actually explain something.
 *
 * WHY NOT `title`. The native tooltip waits about a second, renders in
 * the OS style, cannot hold structure, truncates, and cannot be styled
 * to match anything. Every chart in this product used one, which is why
 * the panels read as having "no explanations": the explanation existed
 * and was practically unreachable.
 *
 * This shows immediately, holds a heading and several lines, and follows
 * the pointer while staying inside the viewport — a readout pinned to a
 * corner is fine until the thing being explained is in that corner.
 *
 * pointer-events: none throughout, so it can never eat the click on the
 * element it is describing.
 */
import { useCallback, useState } from "react"

const OFFSET = 14
const WIDTH = 300

/**
 * @returns {{readout: React.ReactNode, bind: (content: {title?: string, lines?: string[]}) => object}}
 *
 * `bind` returns the props to spread onto the hoverable element, so a
 * caller never has to remember the three handlers.
 */
export function useFloatingReadout() {
    const [state, setState] = useState(null)

    const bind = useCallback((content) => ({
        onMouseEnter: (e) => setState({ content, x: e.clientX, y: e.clientY }),
        onMouseMove: (e) => setState((prev) => (prev ? { ...prev, x: e.clientX, y: e.clientY } : prev)),
        onMouseLeave: () => setState(null),
        // Keyboard users get the same information; without this the
        // explanation is mouse-only, which is not an explanation.
        onFocus: (e) => {
            const r = e.currentTarget?.getBoundingClientRect?.()
            setState({ content, x: (r?.left ?? 0) + 8, y: (r?.bottom ?? 0) })
        },
        onBlur: () => setState(null),
    }), [])

    const readout = state ? <Readout {...state} /> : null
    return { readout, bind }
}

function Readout({ content, x, y }) {
    // Flipped rather than clipped near an edge: a readout that runs off
    // the right of the window is worse than no readout.
    const vw = typeof window !== "undefined" ? window.innerWidth : 1200
    const vh = typeof window !== "undefined" ? window.innerHeight : 800
    const left = x + OFFSET + WIDTH > vw ? Math.max(8, x - OFFSET - WIDTH) : x + OFFSET
    const flipUp = y + 120 > vh
    const top = flipUp ? Math.max(8, y - 120) : y + OFFSET

    return (
        <div style={{
            position: "fixed", left, top, width: WIDTH, zIndex: 9999,
            pointerEvents: "none",
            background: "var(--bg-2)", border: "1px solid var(--line)",
            borderRadius: 2, padding: "8px 10px",
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
        }}>
            {content?.title ? (
                <div style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>
                    {content.title}
                </div>
            ) : null}
            {(content?.lines || []).filter(Boolean).map((l, i) => (
                <div key={i} style={{ font: "400 10px var(--font)", color: "var(--txt-4)",
                                      marginTop: 3, lineHeight: 1.4 }}>
                    {l}
                </div>
            ))}
        </div>
    )
}

export default useFloatingReadout
