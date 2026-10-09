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
 * apex and NO crossbar, so each leg reads as a clean angled line. Every
 * letter is level on one baseline and cap line (ui/wordmarkGeometry.js).
 *
 * COLOUR. Letters take currentColor; only the echoes take the accent,
 * and they flip between --acc-hi and --acc with the theme. For mono
 * print the echoes fall back to currentColor and the mark still reads,
 * because they are defined by shape rather than by colour.
 */

import { WORD_VIEWBOX, LETTER_PATHS, X_PATHS, ECHO_PATHS } from "./wordmarkGeometry.js"

/** The clip id must be unique per document, so each instance makes one. */
let _n = 0

export function Wordmark({ className = "wm", title = "PARALLAX" }) {
    const id = `plx-clip-${++_n}`
    return (
        <svg className={className} viewBox={WORD_VIEWBOX} role="img" aria-label={title}>
            <defs>
                <clipPath id={id}>
                    <rect x="-20" y="0" width="190" height="21.3" />
                </clipPath>
            </defs>
            <g clipPath={`url(#${id})`} fill="none" stroke="currentColor"
               strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter">
                <path d={[...LETTER_PATHS, ...X_PATHS].join(" ")} />
                <path className="echo" d={ECHO_PATHS.join(" ")} />
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
