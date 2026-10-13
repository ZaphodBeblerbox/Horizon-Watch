/**
 * StrikeSourceMedia.jsx — the videos and photos of the reports a strike pin
 * stands for, in our own frames: Telegram posts through TelegramMedia,
 * X posts (GeoConfirmed's sources) through XPost. The pin replaces their
 * markers on the map (globe/strikes.js covers), so their footage is here.
 * Used by the desktop inspector (StrikeEventDetail) and the phone's sheet.
 */
import API_BASE from "../apiBase.js"
import TelegramMedia from "../components/TelegramMedia.jsx"
import XPost, { xPostId } from "../components/XPost.jsx"

const MAX = 4

/** [{kind: "telegram", post} | {kind: "x", url}], newest report last, at most MAX. */
export function strikeMedia(event) {
    const out = []
    const seenX = new Set()
    for (const s of event?.sources || []) {
        if (s?.post && (s.post.media || s.post.thumb_url)) {
            const t = s.post.thumb_url
            out.push({ kind: "telegram", key: s.post.id,
                       post: { ...s.post, thumb_url: t && !/^https?:/.test(t) ? `${API_BASE}${t}` : t } })
        } else if (xPostId(s?.url) && !seenX.has(xPostId(s.url))) {
            seenX.add(xPostId(s.url))
            out.push({ kind: "x", key: `x:${s.url}`, url: s.url })
        }
    }
    return out.slice(0, MAX)
}

export default function StrikeSourceMedia({ event, maxHeight = "46vh", radius = "var(--radius)" }) {
    const items = strikeMedia(event)
    if (!items.length) return null
    return (
        <div data-testid="strike-media" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {items.map((m) => m.kind === "telegram"
                ? <TelegramMedia key={m.key} post={m.post} maxHeight={maxHeight} radius={radius} />
                : <XPost key={m.key} url={m.url} />)}
        </div>
    )
}
