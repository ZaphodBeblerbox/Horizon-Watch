/**
 * SourceLink.jsx — "the original post", opened inside Parallax.
 *
 * Every source (a Telegram or X post, a news article, a web finding) opens in
 * the in-app source viewer as our own post card (SourceViewer ->
 * SourcePostCard, owner 2026-10-24), never another page and never the
 * platform's embed. The viewer carries "Open original" as a small link.
 */
import { openSource } from "../inspector/sourceEmbed.js"

export default function SourceLink({ url, children = "original", style = {}, className, card = null }) {
    if (!url) return null
    return (
        // a link (it can be copied), whose click opens our card instead of leaving
        <a href={url} className={className} data-testid="source-link" onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSource(url, card) }}
           style={{ cursor: "pointer", color: "var(--acc-hi, var(--acchi))", ...style }}>
            {children}
        </a>
    )
}
