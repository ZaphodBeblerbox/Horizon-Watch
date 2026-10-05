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
export default function PlxWordmark({ anim = false }) {
    const ease = " 1.6s cubic-bezier(.22,.61,.36,1) infinite"
    const body = [
        "M1.3 21.3 V1.3 H8 C11.6 1.3 12.7 3.5 12.7 6.2 C12.7 8.9 11.6 11 8 11 H1.3",
        "M37.3 21.3 V1.3 H44 C47.6 1.3 48.7 3.5 48.7 6.2 C48.7 8.9 47.6 11 44 11 H37.3 M43.5 11 L49.8 21.3 M73.3 -1.3 V18.7 H83 M88.8 -1.3 V18.7 H98.5",
        "M17.74 21.3 L23.3 1.3 H25.7 L31.26 21.3",
        "M53.74 21.3 L59.3 1.3 H61.7 L67.26 21.3 M103.24 21.3 L108.8 1.3 H111.2 L116.76 21.3",
        "M121.2 -1.3 L134.8 21.3 M134.8 -1.3 L121.2 21.3",
    ]
    return (
        <svg viewBox="0 0 145 20" width="100%" height="100%"
             style={{ display: "block", overflow: "hidden" }} aria-label="PARALLAX">
            <g fill="none" strokeWidth="2.6" strokeLinecap="butt" strokeLinejoin="miter">
                <g stroke="currentColor">{body.map((d, i) => <path key={i} d={d} />)}</g>
                <path d="M138.98 -1.3 L131.6 11" stroke="var(--acchi)"
                      style={anim ? { animation: "plx-e1" + ease } : null} />
                <path d="M143.18 -1.3 L139.4 5" stroke="var(--acchi)"
                      style={anim ? { animation: "plx-e2" + ease } : null} />
            </g>
        </svg>
    )
}
