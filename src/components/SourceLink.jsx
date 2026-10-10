/**
 * SourceLink.jsx — "the original post", opened inside Parallax.
 *
 * A Telegram or X post opens in the in-app source reader (SourceViewer,
 * through the platforms' own embeds) — never another page (owner,
 * 2026-10-10). Only a source that cannot be shown in a frame (a news site)
 * opens a tab, and says so with ↗.
 */
import { embedFor, openSource } from "../inspector/sourceEmbed.js"

export default function SourceLink({ url, children = "original", style = {}, className }) {
    if (!url) return null
    if (embedFor(url)) {
        return (
            <button type="button" className={className} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSource(url) }}
                    style={{ border: 0, background: "none", padding: 0, cursor: "pointer", font: "inherit", color: "var(--acc-hi, var(--acchi))", ...style }}>
                {children}
            </button>
        )
    }
    return <a className={className} href={url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--acc-hi, var(--acchi))", ...style }}>{children} ↗</a>
}
