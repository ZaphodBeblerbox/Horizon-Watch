/**
 * LayerStatus.jsx — one layer's own line in the rail: loading, a count, or
 * why it is empty.
 *
 * These are 10px labels in a dense list, so the mark has to behave
 * differently here than it does on a page. A page-sized loader announces
 * itself; a rail full of them would be a row of things flickering at the
 * corner of your eye while you are trying to read the one you care about.
 *
 * So: the mark only appears for the loading state, at 11px, and it is the
 * only thing that moves. Every settled state — a count, "none here", an
 * error — stays plain text, because a layer that has finished has nothing
 * to animate about. That keeps motion in the rail meaning exactly one
 * thing, which is what makes it worth noticing at all.
 */
import Loading from "../ui/Loading.jsx"

export default function LayerStatus({ status, fallback = "" }) {
    if (!status) return fallback ? <>{fallback}</> : null

    if (status.state === "loading") {
        return (
            <Loading
                size={11}
                inline
                label={status.text && status.text !== "loading…" ? status.text : "Loading"}
                // The label is for screen readers and the tooltip; in a
                // column this narrow the word would push the count out or
                // wrap the row, so it is hidden visually and the mark
                // carries it.
                style={{ gap: 0 }}
                labelHidden
            />
        )
    }

    return (
        <span style={{ color: status.state === "error" ? "var(--amber)" : undefined }}>
            {status.text || fallback}
        </span>
    )
}
