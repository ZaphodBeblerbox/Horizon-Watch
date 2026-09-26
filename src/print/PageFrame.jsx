/**
 * PageFrame.jsx — the white page itself, and the two marks every page
 * carries: the PARALLAX wordmark in the top-left corner and TRIFECTA
 * TECHNOLOGIES centred at the foot.
 *
 * THE MARKS ARE INSIDE THE PAGE BOX, not `position:fixed` overlays. Fixed
 * positioning repeats per printed sheet in some engines and not others,
 * and silently drops out of headless printToPDF. Because a page here is an
 * explicit `.docpage` section with `break-after:page`, putting the marks
 * inside the section makes them part of the document — so they appear on
 * screen, in the print dialog and in the exported PDF by the same
 * mechanism, with nothing to keep in sync.
 *
 * The logo is inline SVG rather than an <img>. An external asset is one
 * more request that can be un-loaded at the moment the print dialog
 * snapshots the page, which is how a logo becomes a broken-image box in a
 * client-facing PDF.
 */

export const PAGE_W = "8.5in"
export const PAGE_H = "11in"

/* The Echo X — the product's real mark (public/favicon.svg, v4.3 §1): an X
   with two receding echo strokes, the X sitting one unit left so the whole
   mark reads centred once the echoes are counted as part of it.
   
   Drawn here in fixed print colours rather than the theme tokens. A page
   that carries the mark in the app's dark-theme greys prints a pale logo on
   white; a document's ink does not follow the reader's OS scheme. */
export function ParallaxMark({ height = 14 }) {
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "#26231e" }}>
            <svg width={height} height={height} viewBox="0 0 24 24" fill="none"
                 strokeWidth="2.6" strokeLinecap="butt" aria-hidden="true"
                 style={{ display: "block", flexShrink: 0 }}>
                <path stroke="#26231e" d="M3 4L14 20M14 4L3 20" />
                <path stroke="#2f5c90" d="M18 4L12.5 12M22 4L19.25 8" />
            </svg>
            <span style={{
                font: `700 ${Math.round(height * 0.68)}px var(--font, system-ui)`,
                letterSpacing: "0.15em", textTransform: "uppercase", lineHeight: 1,
            }}>Parallax</span>
        </span>
    )
}

export function TrifectaFooter() {
    return (
        <span style={{
            font: "400 8.5px var(--font, system-ui)", letterSpacing: "0.18em",
            textTransform: "uppercase", color: "#6a6f77", lineHeight: 1,
        }}>Trifecta Technologies</span>
    )
}

/**
 * One physical sheet. `padding` leaves room for the two marks so body text
 * can never collide with them.
 */
export default function PageFrame({ children, id, className = "", footerNote = null, style = {} }) {
    return (
        <section
            id={id}
            className={`docpage ${className}`.trim()}
            style={{
                position: "relative", boxSizing: "border-box",
                width: PAGE_W, minHeight: PAGE_H,
                padding: "0.78in 0.8in 0.72in",
                background: "#fff", color: "#1b1f24",
                breakAfter: "page", pageBreakAfter: "always",
                ...style,
            }}
        >
            {/* top-left, hardcoded on every page */}
            <div style={{ position: "absolute", top: "0.36in", left: "0.8in" }}>
                <ParallaxMark />
            </div>

            {children}

            {/* bottom-centre, hardcoded on every page */}
            <div style={{
                position: "absolute", bottom: "0.34in", left: 0, right: 0,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
            }}>
                {footerNote && (
                    <span style={{ font: "400 8px var(--mono, monospace)", color: "#9aa0a8", letterSpacing: "0.04em" }}>
                        {footerNote}
                    </span>
                )}
                <TrifectaFooter />
            </div>
        </section>
    )
}
