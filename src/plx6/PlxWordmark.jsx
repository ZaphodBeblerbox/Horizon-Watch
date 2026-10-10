/**
 * PlxWordmark.jsx — the PARALLAX wordmark, Part C `plxWord`.
 *
 * THE WORDMARK IS THE ONLY LOGO IN THE CHROME. The X mark (`#g-logo`) is
 * reserved for one job and one job only: a loading indicator (Part F3).
 * Using it as a brand badge beside the wordmark is what made the old top
 * bar read as two logos stacked.
 *
 * `anim` animates the two accent strokes — used by the launch screen and
 * the busy clock, never by the static tab-bar mark.
 */
import { WORD_VIEWBOX, LETTER_PATHS, X_PATHS, ECHO_PATHS, WORD_CLIP, ECHO_STROKE } from "../ui/wordmarkGeometry.js"

let _n = 0

export default function PlxWordmark({ anim = false }) {
    const ease = " 1.6s cubic-bezier(.22,.61,.36,1) infinite"
    const clip = `plx-wm-clip-${++_n}`
    return (
        <svg viewBox={WORD_VIEWBOX} width="100%" height="100%"
             style={{ display: "block", overflow: "visible" }} aria-label="PARALLAX">
            <defs><clipPath id={clip}><rect {...WORD_CLIP} /></clipPath></defs>
            <g fill="none" strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter" clipPath={`url(#${clip})`}>
                <g stroke="currentColor">{[...LETTER_PATHS, ...X_PATHS].map((d) => <path key={d} d={d} />)}</g>
                <path d={ECHO_PATHS[0]} stroke="var(--acchi)" strokeWidth={ECHO_STROKE}
                      style={anim ? { animation: "plx-e1" + ease } : null} />
                <path d={ECHO_PATHS[1]} stroke="var(--acchi)" strokeWidth={ECHO_STROKE}
                      style={anim ? { animation: "plx-e2" + ease } : null} />
            </g>
        </svg>
    )
}
