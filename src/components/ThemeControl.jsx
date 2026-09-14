import { useState, useRef, useEffect } from "react"
import {
    getThemeMode, subscribeThemeMode, setThemeMode,
    getRenderedTheme, subscribeRenderedTheme,
    getBlend, getElevationDeg, subscribeBlend,
    getLocationState, subscribeLocationState,
} from "../state/themeStore.js"

// ThemeControl.jsx — the ONE real theme control (Light/Dark/Auto), used
// identically in the top bar and Settings' General section (per the
// existing real per-user-server-synced mechanism in themeStore.js — this
// is a second RENDER of that one mechanism, never a second store). Real
// three-way switch plus the sun/moon horizon indicator (Part 3 of the
// Auto-theme prompt): in Auto mode the glyph's arc position is driven by
// the exact same live elevationDeg/blend value the token fade uses (both
// read from themeStore's single subscribeBlend() stream) — never a second,
// independently-computed approximation that could drift out of sync. In
// manual Light/Dark, it's the same static sun/moon icon this app already
// used before Auto mode existed (#i-sun/#i-moon, IconSprite.jsx) — no
// arc, no animation, since it reflects the explicit choice, not the sky.

const MODES = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "auto", label: "Auto" },
]

/** Real elevation-only arc position — see themeStore.js's civilTwilightBlend
 * for the color side of this same real value. Deliberately elevation-only
 * (never a fabricated azimuth): elevation=+90 (zenith) sits at the top of
 * the arc, 0 sits exactly on the horizon line, -90 (nadir) at the bottom —
 * a real, continuous, single-value-driven sweep, not a literal east-to-
 * west sky position (this app has no real azimuth calculation to drive
 * that honestly, and none was asked for). */
function glyphOffset(elevationDeg, radius) {
    const el = Math.max(-90, Math.min(90, elevationDeg))
    const rad = (el * Math.PI) / 180
    return { dx: radius * Math.cos(rad), dy: -radius * Math.sin(rad) }
}

function moonPath(r) {
    // Real, standard "two overlapping circles" crescent-moon SVG trick.
    return `M ${-r} 0 A ${r} ${r} 0 1 0 ${r} 0 A ${r * 0.62} ${r * 0.62} 0 1 1 ${-r} 0 Z`
}

/** The horizon-arc sun/moon indicator itself — decorative/informational
 * only (per the prompt's own ground rule): mode/blend/elevation all live
 * in themeStore.js regardless of whether this ever renders. */
function HorizonGlyph({ mode, renderedTheme, blend, elevationDeg, size = 26 }) {
    const R = size * 0.4
    const cx = size / 2
    const cy = size / 2
    const isAuto = mode === "auto" && elevationDeg !== null
    const glyphR = size * 0.15

    if (!isAuto) {
        // Static, non-animated — reflects the explicit manual choice, not
        // real time. Reuses the app's existing sun/moon icon exactly.
        return (
            <svg className="icon sm" width={size} height={size} viewBox="0 0 24 24">
                <use href={renderedTheme === "light" ? "#i-sun" : "#i-moon"} />
            </svg>
        )
    }

    const { dx, dy } = glyphOffset(elevationDeg, R)
    const isDay = elevationDeg >= 0

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: "block", overflow: "visible" }}>
            <line x1={cx - R} y1={cy} x2={cx + R} y2={cy} stroke="var(--txt-4)" strokeWidth="1" opacity="0.6" />
            <circle cx={cx} cy={cy} r={R} fill="none" stroke="var(--txt-4)" strokeWidth="0.75" opacity="0.3" strokeDasharray="1.5 2.5" />
            <g style={{ transform: `translate(${cx + dx}px, ${cy + dy}px)`, transition: "transform 75s linear" }}>
                {isDay ? (
                    <circle r={glyphR} fill="var(--amber)" />
                ) : (
                    <path d={moonPath(glyphR)} fill="var(--txt-2)" />
                )}
            </g>
        </svg>
    )
}

/** The real three-way Light/Dark/Auto choice — a compact icon trigger
 * (top bar) opening a small popover with all three options, or an inline
 * row of the same three options (Settings General) via `inline`. Both
 * read/write the exact same real store — never two competing controls. */
export default function ThemeControl({ inline = false }) {
    const [mode, setMode] = useState(getThemeMode)
    const [renderedTheme, setRenderedTheme] = useState(getRenderedTheme)
    const [{ blend, elevationDeg }, setBlendState] = useState(() => ({ blend: getBlend(), elevationDeg: getElevationDeg() }))
    const [locationState, setLocationState] = useState(getLocationState)
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)

    useEffect(() => subscribeThemeMode(setMode), [])
    useEffect(() => subscribeRenderedTheme(setRenderedTheme), [])
    useEffect(() => subscribeBlend(setBlendState), [])
    useEffect(() => subscribeLocationState(setLocationState), [])

    useEffect(() => {
        if (!open) return
        const onOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
        }
        const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
        document.addEventListener("mousedown", onOutside)
        window.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onOutside)
            window.removeEventListener("keydown", onKey)
        }
    }, [open])

    const glyph = <HorizonGlyph mode={mode} renderedTheme={renderedTheme} blend={blend} elevationDeg={elevationDeg} />

    if (inline) {
        return (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ display: "flex", gap: 4 }}>
                    {MODES.map((m) => (
                        <button
                            key={m.value}
                            onClick={() => setThemeMode(m.value)}
                            style={{
                                padding: "4px 10px", font: "400 11px var(--font)", cursor: "pointer",
                                borderRadius: "var(--r)", border: "1px solid var(--line-strong)",
                                background: mode === m.value ? "var(--acc)" : "var(--bg-2)",
                                color: mode === m.value ? "#fff" : "var(--txt-2)",
                            }}
                        >
                            {m.label}
                        </button>
                    ))}
                </div>
                {glyph}
                {mode === "auto" && locationState === "unavailable" && (
                    <span style={{ font: "400 11px var(--font)", color: "var(--sev-high)" }}>
                        Auto needs a location — allow location access, or Auto stays on your last theme.
                    </span>
                )}
                {mode === "auto" && locationState === "resolving" && (
                    <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>Finding your location…</span>
                )}
            </div>
        )
    }

    return (
        <div ref={containerRef} style={{ position: "relative" }}>
            <button
                onClick={() => setOpen((v) => !v)}
                title={`Theme: ${MODES.find((m) => m.value === mode)?.label}`}
                aria-label="Theme"
                aria-expanded={open}
                style={{
                    width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                    background: "transparent", border: "none", color: "var(--txt-3)", cursor: "pointer",
                }}
            >
                {glyph}
            </button>
            {open && (
                <div style={{
                    position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 2000,
                    width: 200, background: "var(--map-tooltip-bg)",
                    backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                    border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
                    overflow: "hidden", padding: 4,
                }}>
                    {MODES.map((m) => (
                        <button
                            key={m.value}
                            onClick={() => { setThemeMode(m.value); setOpen(false) }}
                            style={{
                                display: "flex", alignItems: "center", gap: 8, width: "100%",
                                padding: "6px 8px", font: "400 11.5px var(--font)", textAlign: "left",
                                borderRadius: "var(--radius-sm)", border: "none", cursor: "pointer",
                                background: mode === m.value ? "var(--acc-dim)" : "transparent",
                                color: mode === m.value ? "var(--acc-hi)" : "var(--text-secondary)",
                            }}
                        >
                            {m.value !== "auto" && (
                                <svg className="icon sm" width={14} height={14} viewBox="0 0 24 24">
                                    <use href={m.value === "light" ? "#i-sun" : "#i-moon"} />
                                </svg>
                            )}
                            {m.value === "auto" && <HorizonGlyph mode="auto" renderedTheme={renderedTheme} blend={blend} elevationDeg={elevationDeg ?? 0} size={14} />}
                            <span>{m.label}</span>
                        </button>
                    ))}
                    {mode === "auto" && locationState === "unavailable" && (
                        <div style={{ padding: "6px 8px", font: "400 10.5px var(--font)", color: "var(--sev-high)", borderTop: "1px solid var(--border)" }}>
                            Auto needs a location — allow location access, or Auto stays on your last theme.
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
