/**
 * WebContext.jsx — "What we found": what the web agent (backend/web_agent.py)
 * found about this item, with its cited articles. Each citation opens in the
 * in-app source viewer (SourceViewer: a post in its embed, an article as the
 * citation's own card), never by navigating away. Nothing when there is no
 * `web_context` on the item.
 */
import { hostOf, openSource } from "../inspector/sourceEmbed.js"
import { stripEmoji } from "../lib/liveSignals.js"

const when = (iso) => {
    const t = Date.parse(iso || "")
    if (!Number.isFinite(t)) return null
    return new Date(t).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default function WebContext({ item, compact = false }) {
    const ctx = item?.web_context
    const found = (Array.isArray(ctx?.findings) ? ctx.findings : []).filter((f) => f && f.url)
    const summary = stripEmoji(ctx?.summary || "")
    if (!ctx || (!found.length && !summary)) return null
    const shown = found.slice(0, compact ? 3 : 6)
    return (
        <section data-testid="web-context" style={{ margin: compact ? "8px 0 0" : "0 0 var(--space-4, 16px)" }}>
            <div style={{ font: "600 10.5px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--txt-3, var(--txt3))", marginBottom: 4 }}>
                What we found
            </div>
            {summary && <div style={{ font: "400 13px/1.45 var(--font)", color: "var(--txt)", marginBottom: shown.length ? 6 : 0 }}>{summary}</div>}
            {!found.length && <div style={{ font: "400 12px var(--font)", color: "var(--txt-3, var(--txt3))" }}>No outside reporting cited.</div>}
            {shown.map((f) => (
                <button key={f.url} type="button" data-testid="web-context-link"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSource(f.url, f) }}
                        style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "none", padding: "4px 0", cursor: "pointer", font: "inherit" }}>
                    <span style={{ font: "600 12.5px var(--font)", color: "var(--acc-hi, var(--acchi))" }}>{stripEmoji(f.source || f.domain || hostOf(f.url))}</span>
                    {when(f.published_at) && <span style={{ font: "400 12px var(--font)", color: "var(--txt-3, var(--txt3))" }}> · {when(f.published_at)}</span>}
                    {!compact && f.summary && <span style={{ display: "block", font: "400 12.5px/1.4 var(--font)", color: "var(--txt-2, var(--txt2, var(--txt)))" }}>{stripEmoji(f.summary)}</span>}
                </button>
            ))}
        </section>
    )
}
