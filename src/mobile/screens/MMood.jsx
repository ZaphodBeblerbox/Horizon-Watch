/**
 * MMood.jsx — the mood on Telegram, on the phone (owner, 2026-10-17: "the
 * part that indicates a mood in one country, like France, should be on the
 * top, and all the other countries on the bottom").
 *
 *   on top      one country — yours (where you are), else the tensest —
 *               its index large, how it moved, the days as columns, and
 *               the latest calls to act, each with its channel
 *   below       every other country as a row: its index as a thin bar and
 *               how it moved; tapped, it becomes the one on top
 *
 * The same data and the same honesty as the desktop's Insight › Mood
 * (insight/TelegramMood.jsx, backend/telegram_sentiment.py): which channels
 * a reading rests on is always said.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../../apiBase.js"
import Columns from "../../charts/Columns.jsx"
import SourceLink from "../../components/SourceLink.jsx"
import { getSettings } from "../../state/settingsStore.js"

const ROLE = { official: "official", local: "local", outlet: "news outlets", aggregator: "OSINT aggregators", partisan: "partisan channels" }
const fmtDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const signed = (n) => (n == null ? "" : n > 0 ? `+${n}` : String(n))

/** The country you are in, from the place saved for you ("Paris, France"). */
export function homeCountry(list, here) {
    const label = String(here?.label || "").toLowerCase()
    if (!label) return null
    return (list || []).find((c) => c.name && label.includes(String(c.name).toLowerCase()))?.country || null
}

export default function MMood() {
    const [list, setList] = useState(null)
    const [pick, setPick] = useState(null)
    const [s, setS] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/telegram/mood`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                const c = d?.countries || []
                setList(c)
                if (c.length) setPick((p) => p || homeCountry(c, getSettings()?.interests?.here) || c[0].country)
            })
            .catch(() => setList([]))
    }, [])
    useEffect(() => {
        if (!pick) return
        setS(null)
        fetch(`${API_BASE}/api/telegram/mood?country=${pick}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null))
    }, [pick])
    const top = useMemo(() => (list || []).find((c) => c.country === pick), [list, pick])
    const rest = useMemo(() => (list || []).filter((c) => c.country !== pick), [list, pick])
    if (list === null) return <div className="m2-scroll"><div className="m2-empty">Reading the channels…</div></div>
    if (!list.length) return <div className="m2-scroll"><div className="m2-empty">Not enough rated posts yet. A country appears once it has a dozen in the last two weeks.</div></div>
    const sources = s?.sources ? Object.entries(s.sources).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} from ${ROLE[k] || k}`).join(", ") : ""
    const idx = s?.index_recent ?? s?.index_window ?? top?.index_window
    return (
        <div className="m2-scroll" data-screen-label="Phone mood">
            <section key={pick} className="m2-mood-top" data-testid="m2-mood-top">
                <div className="m2-eyebrow">{homeCountry(list, getSettings()?.interests?.here) === pick ? "Where you are" : "Chosen"}</div>
                <div className="m2-mood-name">{top?.name || pick}</div>
                <div className="m2-mood-index">
                    <b>{idx ?? "—"}</b>
                    <span>
                        {s?.index_recent != null ? "tension, last three days" : "tension, two weeks"}
                        {s?.change != null && <><br />{signed(s.change)} against the days before</>}
                    </span>
                </div>
                {top?.conflict?.rising && (
                    <div className="m2-mood-alert">
                        <i />Calls for armed conflict up {Math.round(top.conflict.ratio * 10) / 10}× in the last 24 h
                    </div>
                )}
                {s ? <>
                    <Columns data={s.days.map((d) => ({ key: d.date, label: fmtDay(d.date), value: d.index ?? 0 }))} height={80}
                             tip={(x) => `index on ${x.label}`} label={`Tension index per day, ${top?.name || pick}`} />
                    <div className="m2-sub" style={{ margin: "8px 0 4px" }}>{s.n} rated posts · {sources}</div>
                    {s.topics?.length > 0 && <div className="m2-sub">About {s.topics.slice(0, 4).join(" · ")}</div>}
                    {s.calls?.length > 0 && <>
                        <div className="m2-h" style={{ marginTop: 18 }}>The latest calls to act</div>
                        {s.calls.slice(0, 5).map((c, i) => (
                            <div key={i} className="m2-mood-call">
                                <div>{c.text}</div>
                                <div className="m2-sub">
                                    {c.mobilise >= 3 ? "To confront · " : "To gather · "}{c.channel}{c.role ? ` (${ROLE[c.role] || c.role})` : ""}
                                    {c.url && <> · <SourceLink url={c.url}>post</SourceLink></>}
                                </div>
                            </div>
                        ))}
                    </>}
                </> : <div className="m2-empty">Loading…</div>}
            </section>

            <div className="m2-h" style={{ marginTop: 22 }}>Other countries</div>
            <div className="m2-card">
                {rest.map((c) => (
                    <button key={c.country} className="m2-mood-row" onClick={() => { setPick(c.country); document.querySelector('[data-screen-label="Phone mood"]')?.scrollTo({ top: 0, behavior: "smooth" }) }}>
                        <span className="m2-mood-row-name">{c.name}{c.conflict?.rising && <i className="m2-mood-dot" title="Calls for conflict rising" />}</span>
                        <span className="m2-mood-bar"><span style={{ width: `${Math.max(2, Math.min(100, c.index_window ?? 0))}%` }} /></span>
                        <span className="m2-mood-num">{c.index_window ?? "—"}<small>{c.change != null ? ` ${signed(c.change)}` : ""}</small></span>
                    </button>
                ))}
            </div>
            <p className="m2-sub" style={{ marginTop: 10, lineHeight: 1.5 }}>Index 0–100: half how tense the posts are, half the share calling people to act. Rated per post by a model; read the posts before acting on a number.</p>
        </div>
    )
}
