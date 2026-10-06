/**
 * LocateButton.jsx — opens the Locate workbench for a Telegram post, and
 * says what an analyst already found (where, when, which way).
 */
import { compass, utcClock } from "./locateMath.js"

export default function LocateButton({ post }) {
    if (!post || !post.channel || post.msg_id == null || String(post.channel).startsWith("c/")
        || !(post.thumb_url || post.media === "video")) return null
    const l = post.located
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, margin: "6px 0 12px" }}>
            <button onClick={() => window.dispatchEvent(new CustomEvent("akili:locate", { detail: { post } }))}
                style={{ alignSelf: "flex-start", height: 26, padding: "0 10px", border: "1px solid var(--acchi)", background: "var(--accdim)",
                         color: "var(--txt)", font: "inherit", fontSize: 11.5, cursor: "pointer", borderRadius: 0 }}>
                {l ? "Locate again" : "Locate"} — where, when, which way
            </button>
            {l && (
                <span style={{ fontSize: 11, color: "var(--txt3)", lineHeight: 1.4 }}>
                    Located{l.by ? ` by ${l.by}` : ""}: {Number(l.lat).toFixed(4)}, {Number(l.lon).toFixed(4)}
                    {l.filmed_from ? ` · filmed ${utcClock(Date.parse(l.filmed_from))}–${utcClock(Date.parse(l.filmed_to))} UTC` : ""}
                    {l.heading_deg != null ? ` · heading ${compass(l.heading_deg)}` : ""}
                </span>
            )}
        </div>
    )
}
