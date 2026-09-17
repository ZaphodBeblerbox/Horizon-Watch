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
// three-way switch plus the sky control (PARALLAX spec §4.3). The control's
// rail position is driven by the same live blend/elevationDeg value the
// store computes — never a second, independently-computed approximation
// that could drift out of sync. Manual Light/Dark hold the rail fully up or
// fully down rather than substituting a different drawing, so the control
// is always the same object; only where it sits in the cycle changes.

const MODES = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "auto", label: "Auto" },
]



/**
 * The sky control (PARALLAX spec §4.3).
 *
 * ONE sky, TWO bodies on a single rail 18px apart, clipped by the disc with
 * a horizon line across it. As t goes 0 -> 1 the rail translates -18t: the
 * moon sets as the sun rises, both passing behind the skyline. It is NOT two
 * icons that swap — a swapping pair can only ever say "day" or "night",
 * whereas this shows WHERE IN THE CYCLE you are, which is the entire point
 * of an automatic theme. The sun is what stays continuous while the palette
 * itself is binary.
 *
 * glow = clamp((t - 0.35) / 0.4) — the sun brightens as it clears the line.
 */
function SkyGlyph({ mode, blend, size = 19 }) {
    // Manual modes hold a position rather than tracking the sky: fully up
    // for light, fully down for dark. The control still reads as the same
    // object, so switching modes does not change what kind of thing it is.
    const t = mode === "auto" ? Math.max(0, Math.min(1, blend ?? 0))
        : (mode === "light" ? 1 : 0)
    const glow = Math.max(0, Math.min(1, (t - 0.35) / 0.4))
    const clipId = "skyclip-" + size

    return (
        <svg viewBox="0 0 24 24" className="skyi" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
            <defs>
                <clipPath id={clipId}><circle cx="12" cy="12" r="9.2" /></clipPath>
            </defs>
            <circle cx="12" cy="12" r="9.2" className="skydisc" />
            <g clipPath={`url(#${clipId})`}>
                <rect x="2" y="12.4" width="20" height="10" className="skyground" opacity={0.25 + 0.45 * t} />
                <g transform={`translate(0, ${-18 * t})`}>
                    <g transform="translate(12,27)" opacity={0.4 + 0.6 * glow}>
                        <circle r="3.1" className="sun" />
                        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                            <line key={a} x1="0" y1="-4.6" x2="0" y2="-5.9" transform={`rotate(${a})`} className="sunray" />
                        ))}
                    </g>
                    <g transform="translate(12,9)" opacity={1 - glow}>
                        <path d="M2.9,0a3.1,3.1 0 1,1 -3.1,-3.1 a2.5,2.5 0 0,0 3.1,3.1z" className="moon" />
                    </g>
                </g>
            </g>
            <line x1="2.8" y1="12.4" x2="21.2" y2="12.4" className="skyline" />
            <circle cx="12" cy="12" r="9.2" className="skyring" />
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

    const glyph = <SkyGlyph mode={mode} renderedTheme={renderedTheme} blend={blend} elevationDeg={elevationDeg} />

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
                id="btn-theme"
                // `held` draws a 4px corner tick when the mode was chosen
                // explicitly, so "auto" is never ambiguous — without it a
                // held light theme at midday is indistinguishable from an
                // automatic one, and the user cannot tell whether the app
                // will turn on its own later.
                className={`iconbtn sky${mode === "auto" ? "" : " held"}`}
                onClick={() => setOpen((v) => !v)}
                title={`Theme: ${MODES.find((m) => m.value === mode)?.label} — Alt+T cycles auto, light, dark`}
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
                            {m.value === "auto" && <SkyGlyph mode="auto" renderedTheme={renderedTheme} blend={blend} elevationDeg={elevationDeg ?? 0} size={14} />}
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
