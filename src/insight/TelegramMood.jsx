/**
 * TelegramMood.jsx — Insight › Mood on Telegram: how tense the talk is per
 * country, and how ready people are to act, over the last two weeks
 * (backend/telegram_sentiment.py).
 *
 * Countries are ranked by their current index; the one chosen shows its
 * daily index and, as a second chart (a different measure, so not a second
 * axis), the posts calling people to act. A day lists its calls. Every
 * reading says which kinds of channel it rests on, because a partisan
 * channel speaks for its side and a country read only through such
 * channels is read through their eyes.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import Columns, { BarList } from "../charts/Columns.jsx"
import Loading from "../ui/Loading.jsx"

const EYEBROW = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const ROLE = { official: "official", local: "local", outlet: "news outlets", aggregator: "OSINT aggregators", partisan: "partisan channels" }
const fmtDay = (iso) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })
const signed = (n) => (n == null ? "" : n > 0 ? `+${n}` : String(n))

export default function TelegramMood() {
    const [list, setList] = useState(null)
    const [pick, setPick] = useState(null)
    const [s, setS] = useState(null)
    const [day, setDay] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/telegram/mood`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null))
            .then((d) => { const c = d?.countries || []; setList(c); if (c.length) setPick((p) => p || (c.find((x) => x.country === "fr") || c[0]).country) })
            .catch(() => setList([]))
    }, [])
    useEffect(() => {
        if (!pick) return
        setS(null); setDay(null)
        fetch(`${API_BASE}/api/telegram/mood?country=${pick}`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).then(setS).catch(() => setS(null))
    }, [pick])
    const name = useMemo(() => (list || []).find((c) => c.country === pick)?.name || pick?.toUpperCase(), [list, pick])
    if (list === null) return <Loading size={20} inline label="Reading the channels" style={{ padding: 16 }} />
    if (!list.length) {
        return <div style={{ color: "var(--txt3)", maxWidth: 620 }}>Not enough rated posts yet. Each post is rated once as it arrives; a country appears here once it has a dozen in the last two weeks.</div>
    }
    const calls = s ? (day ? s.calls.filter((c) => String(c.posted_at).slice(0, 10) === day) : s.calls) : []
    const sources = s ? Object.entries(s.sources).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} from ${ROLE[k] || k}`).join(", ") : ""
    return (
        <div data-testid="telegram-mood" style={{ display: "grid", gridTemplateColumns: "minmax(220px, 300px) minmax(0, 1fr)", gap: 24, alignItems: "start" }}>
            <div>
                <div style={{ ...EYEBROW, marginBottom: 8 }}>Countries · two-week index</div>
                <BarList rows={list.map((c) => ({ key: c.country, label: `${c.name}${c.change != null ? `  ${signed(c.change)}` : ""}`, value: c.index_window ?? 0,
                                                  title: `${c.name}: two-week index ${c.index_window}${c.index_recent != null ? `, last three days ${c.index_recent}` : ", no posts in the last three days"}${c.change != null ? `, ${signed(c.change)} against the days before` : ""} · ${c.n} posts · ${c.topics.join(", ")}` }))}
                         selected={pick} onSelect={(k) => k && setPick(k)} max={100} />
                <p style={{ font: "400 11px/1.5 var(--font)", color: "var(--txt4)", marginTop: 10 }}>
                    Index 0–100: half how tense the posts are, half the share calling people to act. Rated per post by a model; read the posts before acting on a number.
                </p>
            </div>
            <div style={{ minWidth: 0 }}>
                {!s ? <Loading size={18} inline label="Loading" /> : (
                    <>
                        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
                            <b style={{ fontSize: 22, fontWeight: 650 }}>{name}</b>
                            <span style={{ fontSize: 15, color: "var(--txt2)" }}>
                                {s.index_recent != null ? `index ${s.index_recent} over the last three days` : `index ${s.index_window ?? "—"} over two weeks · no posts in the last three days`}
                            </span>
                            {s.change != null && (
                                <span style={{ fontSize: 13, color: s.change > 5 ? "var(--red)" : s.change < -5 ? "var(--green, #4b8b5a)" : "var(--txt3)" }}>
                                    {signed(s.change)} against the {s.days.length - 3} days before
                                </span>
                            )}
                        </div>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt3)", margin: "4px 0 14px" }}>{s.n} rated posts · {sources}</div>

                        <div style={{ ...EYEBROW, marginBottom: 6 }}>Tension index per day</div>
                        <Columns data={s.days.map((d) => ({ key: d.date, label: fmtDay(d.date), value: d.index ?? 0 }))} height={90}
                                 selected={day} onSelect={setDay} tip={(x) => `index on ${x.label}`} label={`Tension index per day, ${name}`} />

                        <div style={{ ...EYEBROW, margin: "16px 0 6px" }}>Posts calling people to act, per day</div>
                        <Columns data={s.days.map((d) => ({ key: d.date, label: fmtDay(d.date), value: d.calls, parts: [{ key: "gather", value: d.calls - d.violent_calls }, { key: "violent", value: d.violent_calls }] }))}
                                 parts={[{ key: "gather", label: "to gather, strike, block", color: "var(--sev-high)" }, { key: "violent", label: "to confront or attack", color: "var(--sev-critical)" }]}
                                 height={60} selected={day} onSelect={setDay} tip={(x) => `calls to act on ${x.label}`} label={`Calls to act per day, ${name}`} />

                        {(s.targets.length > 0 || s.topics.length > 0) && (
                            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 16 }}>
                                {s.targets.length > 0 && <div><div style={EYEBROW}>Aimed at</div><div style={{ color: "var(--txt2)", marginTop: 4 }}>{s.targets.join(" · ")}</div></div>}
                                {s.topics.length > 0 && <div><div style={EYEBROW}>About</div><div style={{ color: "var(--txt2)", marginTop: 4 }}>{s.topics.join(" · ")}</div></div>}
                            </div>
                        )}

                        <div style={{ ...EYEBROW, margin: "18px 0 6px" }}>
                            Calls to act{day ? ` on ${fmtDay(day)}` : " · latest"}
                            {day && <button onClick={() => setDay(null)} style={{ marginLeft: 8, border: 0, background: "none", color: "var(--acc-hi, var(--acchi))", cursor: "pointer", font: "inherit" }}>all days</button>}
                        </div>
                        {calls.length === 0 ? <div style={{ color: "var(--txt4)" }}>None{day ? " that day" : " in the window"}.</div> : calls.map((c, i) => (
                            <div key={i} style={{ padding: "8px 0", borderBottom: "1px solid var(--gline)" }}>
                                <div style={{ font: "400 13px/1.5 var(--font)", color: "var(--txt)" }}>{c.text}</div>
                                <div style={{ font: "400 10.5px var(--mono)", color: c.mobilise >= 3 ? "var(--red)" : "var(--txt4)", marginTop: 3 }}>
                                    {c.mobilise >= 3 ? "call to confront · " : "call to gather · "}{c.channel}{c.role ? ` (${ROLE[c.role] || c.role})` : ""} · {String(c.posted_at).slice(0, 16).replace("T", " ")}Z
                                    {c.target ? ` · aimed at ${c.target}` : ""}
                                    {c.url && <> · <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--acc-hi, var(--acchi))" }}>post</a></>}
                                </div>
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    )
}
