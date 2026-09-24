/**
 * Wordmark.jsx — "Echo X" (PARALLAX v4.3 §1).
 *
 * A monoline wordmark whose X carries two echoes of its rising stroke,
 * each shorter and set further out: one line seen from three positions.
 * That is the whole idea of parallax, and it is why the echoes must not
 * be animated independently of the X — they are the same stroke, not
 * decoration attached to it.
 *
 * DRAWN, NOT SET IN A TYPEFACE. Pure paths, so the mark is identical
 * wherever it renders and carries no font dependency. The A has a flat
 * apex and NO crossbar, so each leg reads as a clean angled line; the L
 * terminals and X ends overshoot the cap box and are clipped flat, so
 * every terminal is square-cut on the top and bottom lines.
 *
 * COLOUR. Letters take currentColor; only the echoes take the accent,
 * and they flip between --acc-hi and --acc with the theme. For mono
 * print the echoes fall back to currentColor and the mark still reads,
 * because they are defined by shape rather than by colour.
 */

/** The clip id must be unique per document, so each instance makes one. */
let _n = 0

export function Wordmark({ className = "wm", title = "PARALLAX" }) {
    const id = `plx-clip-${++_n}`
    return (
        <svg className={className} viewBox="0 0 145 20" role="img" aria-label={title}>
            <defs>
                <clipPath id={id}>
                    <rect x="-20" y="0" width="190" height="20" />
                </clipPath>
            </defs>
            <g clipPath={`url(#${id})`} fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter">
                <path d="M1.3 21.3V1.3H8C11.6 1.3 12.7 3.5 12.7 6.2S11.6 11 8 11H1.3M37.3 21.3V1.3H44C47.6 1.3 48.7 3.5 48.7 6.2S47.6 11 44 11H37.3M43.5 11L49.8 21.3M73.3-1.3V18.7H83M88.8-1.3V18.7H98.5M17.74 21.3L23.3 1.3H25.7L31.26 21.3M53.74 21.3L59.3 1.3H61.7L67.26 21.3M103.24 21.3L108.8 1.3H111.2L116.76 21.3M121.2-1.3L134.8 21.3M134.8-1.3L121.2 21.3" />
                <path className="echo" d="M138.98-1.3L131.6 11M143.18-1.3L139.4 5" />
            </g>
        </svg>
    )
}

/** The X alone. The glyph is the mark at small sizes. */
export function Glyph({ className = "glyph" }) {
    return (
        <svg className={className} viewBox="0 0 24 24" fill="none"
             stroke="currentColor" strokeWidth="2.2" strokeLinecap="butt"
             aria-hidden="true">
            <path d="M4 4L15 20M15 4L4 20" />
            <path className="echo" d="M19 4L13.5 12M23 4L20.25 8" />
        </svg>
    )
}

export default Wordmark
