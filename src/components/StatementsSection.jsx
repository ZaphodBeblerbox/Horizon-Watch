/**
 * StatementsSection.jsx — what the parties say about this place.
 *
 * Official channels (the IDF, the Houthi military media, the RSF …) are
 * never map pins: a party's claim is not footage from the ground. They are
 * cited here, on the events they are about — located within 75 km in the
 * last 72 hours, or naming the same country when they could not be placed
 * more precisely — attributed, with a link to the original.
 */
import SourceLink from "./SourceLink.jsx"
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { agoLabel } from "../utils/formatTime.js"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }

export default function StatementsSection({ lat, lon, country }) {
    const [items, setItems] = useState([])
    useEffect(() => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
        let live = true
        const q = `lat=${lat}&lon=${lon}&hours=72${country ? `&country=${encodeURIComponent(country)}` : ""}`
        fetch(`${API_BASE}/api/telegram/statements?${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live) setItems((d?.statements || []).slice(0, 6)) })
            .catch(() => {})
        return () => { live = false }
    }, [lat, lon, country])
    return <StatementList items={items} />
}

/** The list itself, from the statements the endpoint returned. */
export function StatementList({ items }) {
    if (!items.length) return null
    return (
        <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0", borderTop: "1px solid var(--gline)" }}>
            <span style={EYE}>What the parties say</span>
            {items.map((s) => (
                <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{s.headline}</span>
                    <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                        {s.party || s.channel_title} · official statement · {agoLabel(s.posted_at)}
                        {s.km != null ? ` · ${s.km} km away` : " · names the country"}
                        {s.url && <> · <SourceLink url={s.url}>original</SourceLink></>}
                    </span>
                </div>
            ))}
        </section>
    )
}
