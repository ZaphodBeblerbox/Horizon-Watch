/**
 * LivePositionLine.jsx — where an asset a phone moves is now, and how fresh
 * that is, updating as each position is pushed (location/positionStream.js):
 * "their phone · live · 3 s ago · 48.8566, 2.3522 · within 8 m". Used by
 * the desktop's asset page and the phone's asset sheet. Without a pushed
 * position it says what the server last recorded (`fallback`).
 */
import { useLiveAsset, useNow } from "./useLivePositions.js"
import { freshness } from "./glide.js"

const coarse = (p) => p?.source === "ip" || (p?.accuracy_m ?? 0) >= 1000

export function describeLive(p, now) {
    const f = freshness(p.at, now)
    const what = coarse(p) ? "their connection, city level" : "their phone"
    const acc = !coarse(p) && p.accuracy_m != null ? ` · within ${Math.round(p.accuracy_m)} m` : ""
    return { live: f.live, text: `${what} · ${f.label} · ${(+p.lat).toFixed(5)}, ${(+p.lon).toFixed(5)}${acc}` }
}

export default function LivePositionLine({ assetId, fallback = null, style }) {
    const sp = useLiveAsset(assetId)
    const now = useNow(1000)
    const fbAt = Date.parse(fallback?.as_of || "") || 0
    if (sp && sp.at >= fbAt) {
        const d = describeLive(sp, now)
        return <span data-testid="asset-live-position" data-live={d.live ? 1 : 0} style={style}>
            {d.live && <span aria-hidden style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "#3b8cff", marginRight: 6, boxShadow: "0 0 0 3px rgba(59,140,255,.25)" }} />}
            {d.text}
        </span>
    }
    if (!fallback) return null
    const f = fbAt ? freshness(fbAt, now) : null
    return <span data-testid="asset-live-position" data-live={0} style={style}>{fallback.source}{f ? ` · ${f.label.replace(/^live · /, "")}` : ""}</span>
}
