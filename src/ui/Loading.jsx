/**
 * Loading.jsx — the Parallax mark, working.
 *
 * Every wait in this product used to be the word "Loading…" in grey 12px.
 * That reads as the app having nothing to say, and it reads the same whether
 * a request is 200ms or thirty seconds from finishing. Several of this
 * backend's endpoints are genuinely slow, so the waits are long and frequent
 * enough that they are part of the product whether or not anyone designed
 * them.
 *
 * So the wait shows the mark instead: the Echo X (public/favicon.svg, v4.3
 * §1) with its two blue echo strokes lifting in sequence, which reads as
 * something working rather than something stalled. The motion is small on
 * purpose — this appears beside content, not instead of it.
 *
 * The animation lives in designSystem.css (.pxl-loading) so it is one
 * definition rather than one per caller, and it stops dead under
 * prefers-reduced-motion, where the mark simply sits at full opacity.
 */

/**
 * @param size  px. 18 inline beside a label, 34 for a panel, 56 for a screen.
 * @param label What is being waited for. Rendered beside the mark when
 *              `inline`, and always given to screen readers — a spinner with
 *              no name tells you something is happening but not what.
 */
export default function Loading({ size = 34, label = "Loading", inline = false,
                                 labelHidden = false, style = {} }) {
    const mark = (
        <svg className="pxl-loading" width={size} height={size} viewBox="0 0 24 24"
             fill="none" strokeWidth="2.6" strokeLinecap="butt"
             role="img" aria-label={label}
             style={{ display: "block", flexShrink: 0 }}>
            <path className="pxl-ink" d="M3 4L14 20M14 4L3 20" />
            <path className="pxl-echo pxl-e1" d="M18 4L12.5 12" />
            <path className="pxl-echo pxl-e2" d="M22 4L19.25 8" />
        </svg>
    )
    if (inline) {
        return (
            <span style={{ display: "inline-flex", alignItems: "center", gap: labelHidden ? 0 : 8, ...style }}>
                {mark}
                {/* In a column too narrow for the word — a layer rail row —
                    the label would wrap the row or push the count out. It
                    stays for screen readers and for the mark's aria-label
                    rather than being dropped, because "something is
                    happening" with no name is not much of a status. */}
                {labelHidden ? null : (
                    <span style={{ font: "400 11px var(--font)", color: "var(--txt-4)",
                                   letterSpacing: ".04em" }}>{label}</span>
                )}
            </span>
        )
    }
    return (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                      padding: "var(--space-4) 0", ...style }}>
            {mark}
        </div>
    )
}

/** The whole-screen wait — app boot, and any module that has nothing yet. */
export function LoadingScreen({ label = "Loading" }) {
    return (
        <div style={{
            position: "absolute", inset: 0, display: "flex", flexDirection: "column",
            alignItems: "center", justifyContent: "center", gap: 14,
            background: "var(--bg-0)", color: "var(--txt)",
        }}>
            <Loading size={56} label={label} />
            <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)",
                           letterSpacing: ".22em", textTransform: "uppercase" }}>
                {label}
            </span>
        </div>
    )
}
