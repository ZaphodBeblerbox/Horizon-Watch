import { useState } from "react"

/**
 * useSwap — content swapped in a pane slides in from the side of the tab
 * that was chosen (2026-10-17, the phone's v4 "screens slide in from their
 * tab's side", on the desktop).
 *
 *   <div {...useSwap(tab, TABS.map(([, v]) => v))}>{body()}</div>
 *
 * WITHOUT REMOUNTING. Keying the pane on the tab would replay the motion but
 * throw away every child's state and refetch its data. Instead the wrapper
 * flips between two identical keyframe names (data-p 0/1) — a changed
 * animation-name is what restarts a CSS animation — and data-dir picks the
 * side (desktopV4.css .plx-swap). The first render does not move: nothing
 * animates that is already on screen.
 */
export default function useSwap(value, order = []) {
    const [s, setS] = useState({ value, dir: "", p: 0 })
    if (s.value !== value) {
        const a = order.indexOf(s.value), b = order.indexOf(value)
        setS({ value, dir: a < 0 || b < 0 ? "fade" : b > a ? "r" : "l", p: s.p ? 0 : 1 })
    }
    return { className: "plx-swap", "data-dir": s.dir || undefined, "data-p": s.p }
}
