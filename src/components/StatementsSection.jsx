/**
 * StatementsSection.jsx — what the parties say about this place.
 *
 * Official channels (the IDF, the Houthi military media, the RSF …) are
 * never map pins: a party's claim is not footage from the ground. They are
 * cited here, on the events they are about — located within 75 km in the
 * last 72 hours, or naming the same country when they could not be placed
 * more precisely — attributed, with a link to the original.
 *
 * THE FEW THAT MATTER (owner, 2026-10-23: "not a long list of statements"):
 * one per party, its latest, ranked by how often that party said the same
 * thing (most repeated first) and then by how recent; the rest behind
 * "Show more" (topStatements).
 */
import SourceLink from "./SourceLink.jsx"
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { agoLabel } from "../utils/formatTime.js"

const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
export const TOP_N = 3

const words = (s) => new Set(String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/\w{4,}/g) || [])
function similar(a, b) {
    const A = words(a), B = words(b)
    if (!A.size || !B.size) return false
    let n = 0
    for (const w of A) if (B.has(w)) n += 1
    return n / Math.min(A.size, B.size) >= 0.5
}

/** {top, rest}: one statement per party (its latest), each with `repeats` (how many of that party's
 *  statements say the same), ordered by repeats then recency; `rest` is everything else, newest first. */
export function topStatements(items, n = TOP_N) {
    const list = (Array.isArray(items) ? items : []).filter((s) => s && s.headline)
    const time = (s) => Date.parse(s.posted_at || "") || 0
    const byParty = new Map()
    for (const s of list) {
        const p = s.party || s.channel_title || "Unattributed"
        if (!byParty.has(p)) byParty.set(p, [])
        byParty.get(p).push(s)
    }
    const leads = []
    for (const group of byParty.values()) {
        group.sort((a, b) => time(b) - time(a))
        const lead = group[0]
        const repeats = group.filter((s) => s === lead || similar(s.headline, lead.headline)).length
        leads.push({ ...lead, repeats })
    }
    leads.sort((a, b) => (b.repeats - a.repeats) || (time(b) - time(a)))
    const top = leads.slice(0, n)
    const shown = new Set(top.map((s) => s.id))
    const rest = list.filter((s) => !shown.has(s.id)).sort((a, b) => time(b) - time(a))
    return { top, rest }
}

export default function StatementsSection({ lat, lon, country }) {
    const [items, setItems] = useState([])
    useEffect(() => {
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined
        let live = true
        const q = `lat=${lat}&lon=${lon}&hours=72${country ? `&country=${encodeURIComponent(country)}` : ""}`
        fetch(`${API_BASE}/api/telegram/statements?${q}`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (live) setItems((d?.statements || []).slice(0, 40)) })
            .catch(() => {})
        return () => { live = false }
    }, [lat, lon, country])
    return <StatementList items={items} />
}

function Statement({ s }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }} data-testid="statement">
            <span style={{ fontSize: 12.5, lineHeight: 1.4 }}>{s.headline}</span>
            <span style={{ fontSize: 11, color: "var(--txt3)" }}>
                {s.party || s.channel_title} · official statement · {agoLabel(s.posted_at)}
                {s.repeats > 1 ? ` · said ${s.repeats} times` : ""}
                {s.km != null ? ` · ${s.km} km away` : " · names the country"}
                {s.url && <> · <SourceLink url={s.url}>original</SourceLink></>}
            </span>
        </div>
    )
}

/** The list itself, from the statements the endpoint returned: the few that matter, the rest on request. */
export function StatementList({ items, initiallyOpen = false }) {
    const [open, setOpen] = useState(initiallyOpen)
    const { top, rest } = topStatements(items)
    if (!top.length) return null
    return (
        <section style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 0", borderTop: "1px solid var(--gline)" }}>
            <span style={EYE}>What the parties say</span>
            {top.map((s) => <Statement key={s.id} s={s} />)}
            {open && rest.map((s) => <Statement key={s.id} s={s} />)}
            {rest.length > 0 && (
                <button type="button" onClick={() => setOpen(!open)} data-testid="statements-more"
                        style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, color: "var(--txt3)", fontSize: 11.5, cursor: "pointer", textDecoration: "underline" }}>
                    {open ? "Show fewer" : `Show ${rest.length} more`}
                </button>
            )}
        </section>
    )
}
