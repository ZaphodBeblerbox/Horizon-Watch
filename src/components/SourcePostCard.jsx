/**
 * SourcePostCard.jsx — a cited source read inside Parallax, as OUR post card (owner, 2026-10-24: "not Telegram's or
 * X's own UI or embed"): the channel or outlet, the time, a short summary of what happened, the original text with
 * its English, its media through our proxy with Download, and "Open original" as a small secondary link.
 *
 * What we hold comes from GET /api/source/card (no model). The summary is asked for when the reader opens the source,
 * never before: one model call on the server (backend/source_card.py, purpose 'explain'), cached there per URL, so a
 * second reader costs nothing; with the model off there is no summary and the card says so quietly.
 *
 * `given` is what the caller already showed (a web finding's title and summary, a news citation): shown at once,
 * merged under what the server holds.
 */
import { useEffect, useState } from "react"
import TelegramMedia from "./TelegramMedia.jsx"
import { PhotoGrid, xProxy } from "./XPost.jsx"
import { sourceCard, sourceSummary } from "../lib/sourceApi.js"
import { hostOf } from "../inspector/sourceEmbed.js"
import { exactTime, mediaOf } from "../desk/deskFeed.js"
import { downloadMedia } from "../assistant/postDraft.js"
import { Avatar } from "../desk/PostView.jsx"
import "../desk/desk.css"

const KIND = { telegram: "Telegram", x: "X", web: "Web" }

export default function SourcePostCard({ url, given = null, phone = false }) {
    const [card, setCard] = useState(null)
    const [sum, setSum] = useState(null)              // null = asking, {summary, why}
    const [dl, setDl] = useState(null)
    useEffect(() => {
        let live = true
        setCard(null); setSum(null)
        if (!url) { setSum({ summary: given?.summary || null }); return undefined }
        sourceCard(url).then((c) => { if (live) setCard(c) }).catch(() => { if (live) setCard({ kind: "web", url, source: hostOf(url), known: false }) })
        // ON CLICK ONLY: the reader opened this source
        sourceSummary(url, { title: given?.title || "", text: given?.text || "", summary: given?.summary || "", source: given?.source || "" })
            .then((d) => { if (live) setSum(d || { summary: null }) })
            .catch(() => { if (live) setSum({ summary: null, why: "The summary could not be fetched." }) })
        return () => { live = false }
    }, [url]) // eslint-disable-line react-hooks/exhaustive-deps

    const c = card || {}
    const kind = c.kind || (url ? "web" : "web")
    const source = c.source || given?.source || hostOf(url) || "Source"
    const at = c.at || given?.when || given?.published_at || null
    const text = c.text || null
    const english = sum?.english || c.english || null
    const headline = c.headline || given?.title || null
    const tg = kind === "telegram" && c.known && (c.media === "video" || c.media === "photo") ? c : null
    const x = kind === "x" && c.known ? c : null
    const media = tg ? mediaOf(tg)
        : x?.videos?.length ? { type: "video", thumb: x.videos[0].poster, video: xProxy(x.videos[0].mp4) }
        : x?.photos?.length ? { type: "photo", thumb: xProxy(x.photos[0]), video: null } : null
    const summary = sum?.summary || (sum && given?.summary) || null

    return (
        <div data-testid="source-card" className="dk-post" style={{ flex: 1, overflowY: "auto", padding: "14px 14px 18px", gap: 12, animation: "none" }}>
            <div className="dk-post-author">
                <Avatar channel={source} person={c.avatar ? { avatar: c.avatar } : null} size={40} />
                <div style={{ minWidth: 0 }}>
                    <div className="dk-post-name" data-testid="source-name">{source}</div>
                    <div className="dk-muted">{[KIND[kind], c.handle ? `@${c.handle}` : null, at ? exactTime(at) : null].filter(Boolean).join(" · ")}</div>
                </div>
            </div>
            <section className="dk-post-en" data-testid="source-summary">
                <div className="dk-h">What happened</div>
                {sum === null ? <p className="dk-muted" style={{ margin: 0 }}>Summarising…</p>
                    : summary ? <p className="dk-post-text" style={{ fontSize: 14.5 }}>{summary}</p>
                    : <p className="dk-muted" style={{ margin: 0 }}>No summary right now{sum?.why ? ` (${String(sum.why).replace(/\.$/, "")})` : ""}.</p>}
            </section>
            {headline && headline !== text && <h3 className="dk-post-headline" style={{ fontSize: 16 }}>{headline}</h3>}
            {text && <p className="dk-post-text" dir="auto" data-testid="source-original" style={{ fontSize: 15 }}>{text}</p>}
            {english && english !== text && (
                <div className="dk-post-en" data-testid="source-english">
                    <div className="dk-h">In English{c.lang && c.lang !== "en" ? ` · from ${String(c.lang).toUpperCase()}` : ""}</div>
                    <p className="dk-post-text" style={{ fontSize: 14.5 }}>{english}</p>
                </div>
            )}
            {card === null && url && <p className="dk-muted">Reading the source…</p>}
            {card && !card.known && kind !== "web" && !text && <p className="dk-muted">We do not hold this post's text; the original has it.</p>}
            {tg && <div className="dk-post-media"><TelegramMedia post={tg} maxHeight={phone ? "60vh" : "52vh"} radius="12px" /></div>}
            {x && (x.videos?.length
                ? <video src={xProxy(x.videos[0].mp4)} poster={x.videos[0].poster || undefined} controls playsInline style={{ width: "100%", maxHeight: "52vh", background: "#000", borderRadius: 12 }} />
                : x.photos?.length ? <div style={{ borderRadius: 12, overflow: "hidden" }}><PhotoGrid photos={x.photos} /></div> : null)}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                {media && <button type="button" className="dk-act" data-testid="source-download" disabled={dl === "busy"} onClick={async () => {
                    setDl("busy"); setDl(await downloadMedia(media, { title: headline || source, phone }))
                }}>{dl === "busy" ? "Downloading…" : dl === "failed" ? "Download failed" : media.type === "video" ? "Download video" : "Download image"}</button>}
                {url && <a href={url} target="_blank" rel="noreferrer noopener" data-testid="source-open-original"
                           style={{ font: "500 12px var(--font)", color: "var(--txt3)", textDecoration: "underline", textUnderlineOffset: 3 }}>Open original</a>}
            </div>
        </div>
    )
}
