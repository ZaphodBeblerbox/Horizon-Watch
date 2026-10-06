/**
 * Dots.jsx — a "a · b · c" line where any part may be Arabic, Persian or
 * Hebrew. Joined as one string, a right-to-left channel name reorders its
 * neighbours ("17:48 · اليماني الباس Z" — the Z of the time jumps across
 * the name). Each part is isolated in its own <bdi>, so every part keeps
 * its own direction and the line keeps its order.
 */
export default function Dots({ text, sep = " · " }) {
    if (text == null || text === "") return null
    const parts = String(text).split(sep)
    return parts.map((p, i) => (
        <span key={i}>{i > 0 && sep}<bdi>{p}</bdi></span>
    ))
}
