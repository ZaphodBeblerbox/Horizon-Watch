/** One sprite reference, sized. `<svg><use href="#g-globe"/></svg>` is the
 *  shape every icon in Part B takes; this spares the repetition. */
export default function PlxIcon({ href, size = 16, style = null }) {
    return (
        <svg width={size} height={size} style={style} aria-hidden focusable="false">
            <use href={href} />
        </svg>
    )
}
