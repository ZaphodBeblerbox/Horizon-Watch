/**
 * TheaterTabs.jsx — the Desk's top bar (owner, 2026-10-24: "a top bar of the user's theatres you swipe through
 * horizontally, like X's tabs"): "All" first, then each theatre, the chosen one underlined; the bar scrolls sideways
 * when the theatres do not fit, and keeps the chosen tab in view when a swipe on the feed changes it.
 */
import { useEffect, useRef } from "react"
import "./desk.css"

export default function TheaterTabs({ tabs, value, onChange, variant = "desk" }) {
    const bar = useRef(null)
    useEffect(() => {
        const on = bar.current?.querySelector('[aria-selected="true"]')
        if (on?.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" })
    }, [value])
    return (
        <div ref={bar} className={`dk-tabs dk-tabs-${variant}`} role="tablist" aria-label="Theatres" data-testid="desk-theater-tabs" data-nodrag="">
            {tabs.map((t) => (
                <button key={t.id ?? "all"} type="button" role="tab" aria-selected={(value ?? null) === t.id}
                        onClick={() => onChange(t.id)} data-testid="desk-theater-tab">
                    <span>{t.label}</span>
                </button>
            ))}
        </div>
    )
}
