/**
 * MapTip.jsx — PARALLAX spec §6. The one `#maptip` element.
 *
 * Mounted once, by Situation, inside `#mapwrap`. Every layer that wants a
 * hover callout calls mapTip.js's showTip/hideTip; none of them render a
 * card of their own.
 *
 * ⚠ OPAQUE, NOT FROSTED — a deliberate departure from §6.
 *
 * §6 asks for `backdrop-filter: blur(14px) saturate(120%)` and argues the
 * case well: "On a map the thing under the cursor is the thing being asked
 * about; an opaque card answers the question by hiding the subject."
 *
 * It is overridden by a later, direct instruction in this app that every
 * surface is solid — the same instruction that governs §10's map chrome (see
 * the note in designSystem.css) and the notification tray. It is not a
 * preference this file may quietly re-decide: src/globe/mapSurfaceTokens.test.js
 * is a static guard that FAILS any map surface carrying a backdrop blur, and
 * --map-tooltip-bg is defined as a solid colour matching --bg-2 in both
 * themes. §6's concern is answered instead by keeping the card small and
 * offset from the cursor, so it sits beside the subject rather than over it.
 */
import { useEffect, useState } from "react"
import { subscribeTip, getTip, tipPosition } from "../globe/mapTip.js"

export default function MapTip() {
    const [tip, setTip] = useState(getTip)

    useEffect(() => subscribeTip(setTip), [])

    if (!tip) return null
    const { left, top } = tipPosition(tip.x, tip.y)

    return (
        <div id="maptip" className="show" style={{ left, top }} role="tooltip" aria-live="polite">
            {tip.content}
        </div>
    )
}

/**
 * The spec's own tooltip shape — `<b>` title over a `.lbl` line — as a node,
 * so the common case does not make every caller write markup.
 */
export function TipLines({ title, lines = [] }) {
    return (
        <>
            {title ? <b>{title}</b> : null}
            {lines.filter(Boolean).map((l, i) => (
                <span className="lbl" key={i}>{l}</span>
            ))}
        </>
    )
}
