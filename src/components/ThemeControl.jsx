import { useState, useRef, useEffect } from "react"
import {
    getThemeMode, subscribeThemeMode, setThemeMode,
    getRenderedTheme, subscribeRenderedTheme,
    getBlend, getElevationDeg, subscribeBlend,
    getLocationState, subscribeLocationState, getDayPhase,
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
 * ONE sky, TWO bodies on a real arc, clipped by the disc with a horizon
 * line across it. The sun rises on the left, crosses the top and sets on
 * the right; the moon does the same half a cycle behind it, so one is
 * always below the horizon while the other is above.
 *
 * WHY AN ARC AND NOT A VERTICAL RAIL. The rail moved both bodies straight
 * up and down the same axis, which reads as a lift, not a day. It was also
 * driven by the twilight blend — and that value pins to 0 or 1 for most of
 * the day, so the glyph sat motionless for hours and then jumped twice.
 * The arc is driven by the sun's real hour angle (solarDayPhase), which
 * advances continuously, so the control actually says WHERE IN THE CYCLE
 * you are rather than only which side of the horizon.
 *
 * Elevation alone cannot do this: the same elevation happens twice a day,
 * once climbing and once falling, and the hour angle is what tells them
 * apart.
 */
const ARC_R = 7.4          // radius the bodies travel on
const ARC_CX = 12
const ARC_CY = 12.4        // the horizon line

/**
 * phase 0..1 (0 = solar midnight) -> how far the carriage has turned.
 *
 * A TOURBILLON, NOT TWO BODIES ON A TRACK. The sun and moon are always
 * exactly half a day apart, so they are not two things to position — they
 * are one assembly that turns once a day, the way a tourbillon carriage
 * does. Placing each independently computed the same rotation twice and let
 * them drift apart if either formula was ever touched; here the geometry
 * cannot disagree with itself, because there is only one of it.
 *
 * Derived rather than eyeballed: with the sun drawn at the top of the
 * circle, rotating by (phase x 360 - 180) puts it at the top at solar noon
 * (phase 0.5), at the bottom at midnight, and on the left at sunrise —
 * east to west, the direction the sky actually moves.
 */
function carriageAngle(phase) {
    return phase * 360 - 180
}

function SkyGlyph({ mode, blend, phase, size = 19 }) {
    // Manual modes hold a position rather than tracking the sky: sun at
    // noon for light, moon at its own noon for dark. The control still
    // reads as the same object, so switching modes does not change what
    // kind of thing it is.
    const p = mode === "auto"
        ? ((phase ?? 0) % 1 + 1) % 1
        : (mode === "light" ? 0.5 : 0.0)

    const angle = carriageAngle(p)

    // How day-lit the scene reads. Auto uses the real twilight blend so
    // the ground and the glow match the palette that is actually applied;
    // the arc position and the brightness are two different facts and
    // should not be derived from one another.
    const t = mode === "auto" ? Math.max(0, Math.min(1, blend ?? 0)) : (mode === "light" ? 1 : 0)
    const glow = Math.max(0, Math.min(1, (t - 0.2) / 0.5))
    const clipId = "skyclip-" + size

    return (
        <svg viewBox="0 0 24 24" className="skyi" width={size} height={size} style={{ display: "block", overflow: "visible" }}>
            <defs>
                <clipPath id={clipId}><circle cx="12" cy="12" r="9.2" /></clipPath>
            </defs>
            <circle cx="12" cy="12" r="9.2" className="skydisc" />
            <g clipPath={`url(#${clipId})`}>
                <rect x="2" y={ARC_CY} width="20" height="10" className="skyground" opacity={0.25 + 0.45 * t} />

                {/* ONE CARRIAGE, TURNING. Both bodies sit at fixed ends of
                    the same assembly and the assembly rotates; they cannot
                    drift out of opposition because nothing positions them
                    separately. Each body is counter-rotated inside it so the
                    moon's crescent and the sun's rays stay upright rather
                    than tumbling — a tourbillon's cage turns, the balance
                    inside it does not present a different face. */}
                <g transform={`rotate(${angle.toFixed(2)} ${ARC_CX} ${ARC_CY})`}>
                    <g transform={`translate(${ARC_CX},${ARC_CY - ARC_R})`} opacity={0.35 + 0.65 * glow}>
                        <g transform={`rotate(${(-angle).toFixed(2)})`}>
                            <circle r="2.9" className="sun" />
                            {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
                                <line key={a} x1="0" y1="-4.3" x2="0" y2="-5.5" transform={`rotate(${a})`} className="sunray" />
                            ))}
                        </g>
                    </g>

                    <g transform={`translate(${ARC_CX},${ARC_CY + ARC_R})`} opacity={1 - glow}>
                        <g transform={`rotate(${(-angle).toFixed(2)})`}>
                            <path d="M2.9,0a3.1,3.1 0 1,1 -3.1,-3.1 a2.5,2.5 0 0,0 3.1,3.1z" className="moon" />
                        </g>
                    </g>
                </g>
            </g>
            <line x1="2.8" y1={ARC_CY} x2="21.2" y2={ARC_CY} className="skyline" />
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
    // Read on every blend tick — themeStore recomputes both together.
    const [phase, setPhase] = useState(getDayPhase)
    const [locationState, setLocationState] = useState(getLocationState)
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)

    useEffect(() => subscribeThemeMode(setMode), [])
    useEffect(() => subscribeRenderedTheme(setRenderedTheme), [])
    useEffect(() => subscribeBlend((b) => { setBlendState(b); setPhase(getDayPhase()) }), [])
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

    const glyph = <SkyGlyph mode={mode} renderedTheme={renderedTheme} blend={blend} elevationDeg={elevationDeg} phase={phase} />

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
                            {m.value === "auto" && <SkyGlyph mode="auto" renderedTheme={renderedTheme} blend={blend} elevationDeg={elevationDeg ?? 0} phase={phase} size={14} />}
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
