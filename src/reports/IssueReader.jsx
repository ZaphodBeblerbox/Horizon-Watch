/**
 * IssueReader.jsx — a situation report read inside Parallax.
 *
 * The same document the PDF prints (backend/briefing/, GET
 * /api/briefings2/runs/{id}/doc), laid out for the screen: a contents rail,
 * the issue in one reading column, and every reference live — [S-07] opens
 * the signal it rests on (what was recorded, where, by which sources, how
 * corroborated, with a "show on the globe"), [Q-03] the web source. The
 * fixed words (headings, tags, bands) come from the server in the issue's
 * language, so the reader and the PDF say the same thing.
 */
import SourceLink from "../components/SourceLink.jsx"
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"

const SERIF = "'Source Serif 4', Georgia, serif"
const LEVEL = { 1: "#5f7a5c", 2: "#a89f68", 3: "#b8892f", 4: "#a85f3a", 5: "#8b3a2f" }
const H1 = { fontFamily: "var(--mz-font-body)", fontWeight: 700, fontSize: 24, margin: "0 0 10px", letterSpacing: "-.01em" }
const H2 = { fontFamily: "var(--mz-font-body)", fontWeight: 650, fontSize: 17, margin: "22px 0 8px" }
const P = { fontFamily: SERIF, fontSize: 15.5, lineHeight: 1.6, margin: "0 0 12px", color: "var(--txt)" }
const LEAD = { fontSize: 14.5, color: "var(--txt2)", margin: "0 0 14px", lineHeight: 1.5 }
const TABLE = { width: "100%", borderCollapse: "collapse", fontSize: 13, margin: "6px 0 16px" }
const TH = { textAlign: "left", padding: "7px 8px", background: "var(--txt)", color: "var(--bg, #fff)", fontWeight: 600, fontSize: 12 }
const TD = { padding: "7px 8px", borderBottom: "1px solid var(--gline)", verticalAlign: "top" }

/** **bold** and [S-01, Q-02] references, as elements. */
function Rich({ text, onRef }) {
    const out = []
    const re = /\*\*(.+?)\*\*|\[((?:[SQ]-\d+)(?:\s*[,;]\s*[SQ]-\d+)*)\]/g
    let last = 0, m, k = 0
    const s = String(text || "")
    while ((m = re.exec(s))) {
        if (m.index > last) out.push(s.slice(last, m.index))
        if (m[1]) out.push(<b key={k++}>{m[1]}</b>)
        else {
            const ids = m[2].split(/\s*[,;]\s*/)
            out.push(<sup key={k++} style={{ whiteSpace: "nowrap" }}>{ids.map((id, i) => (
                <span key={id}>{i ? ", " : ""}<button onClick={() => onRef(id)} style={{
                    border: 0, background: "transparent", padding: 0, cursor: "pointer", color: "var(--acchi)",
                    font: "inherit", fontSize: 11, fontFamily: "var(--mz-font-mono)",
                }}>{id}</button></span>))}</sup>)
        }
        last = re.lastIndex
    }
    if (last < s.length) out.push(s.slice(last))
    return <>{out}</>
}

function Tag({ t, L }) {
    if (!t) return null
    return <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", color: "var(--txt3)", marginRight: 6 }}>
        [{L.tags?.[t] || t}]</span>
}

function Meaning({ text, L, org, onRef }) {
    return <div style={{ border: "1px solid var(--gline2)", background: "var(--glass2)", padding: "12px 14px", margin: "8px 0 18px" }}>
        <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10.5, letterSpacing: ".1em", color: "var(--acchi)", marginBottom: 6 }}>
            {(L.meaning_for || "").toUpperCase()} {String(org || "").toUpperCase()}</div>
        <p style={{ ...P, margin: 0 }}><Rich text={text} onRef={onRef} /></p>
    </div>
}

function Blocks({ blocks, doc, L, onRef }) {
    return (blocks || []).map((b, i) => {
        if (b.type === "p") return <p key={i} style={P}><Tag t={b.tag} L={L} /><Rich text={b.text} onRef={onRef} /></p>
        if (b.type === "h3") return <h4 key={i} style={{ margin: "14px 0 6px", fontSize: 14.5 }}>{b.text}</h4>
        if (b.type === "list") return <ul key={i} style={{ ...P, paddingLeft: 20 }}>{(b.items || []).map((x, j) => <li key={j}><Rich text={x} onRef={onRef} /></li>)}</ul>
        if (b.type === "meaning") return <Meaning key={i} text={b.text} L={L} org={doc.meta.org} onRef={onRef} />
        if (b.type === "table") return <table key={i} style={TABLE}><thead><tr>{(b.columns || []).map((c, j) => <th key={j} style={TH}>{c}</th>)}</tr></thead>
            <tbody>{(b.rows || []).map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n} style={TD}><Rich text={c} onRef={onRef} /></td>)}</tr>)}</tbody></table>
        if (b.type === "figure") {
            const f = doc.figures?.[b.figure]
            if (!f) return null
            return <figure key={i} style={{ margin: "10px 0 18px" }}>
                <div style={{ background: "#fff", padding: 8 }} dangerouslySetInnerHTML={{ __html: f.html }} />
                <figcaption style={{ fontSize: 12, color: "var(--txt3)", marginTop: 6, fontStyle: "italic" }}>{L.figure} {f.number} — {f.caption}</figcaption>
            </figure>
        }
        if (b.type === "signal") return <button key={i} onClick={() => onRef(b.id)} style={{
            display: "grid", gridTemplateColumns: "64px 1fr", gap: 10, width: "100%", textAlign: "left", cursor: "pointer",
            border: 0, borderTop: "1px solid var(--gline)", borderBottom: "1px solid var(--gline)", background: "transparent",
            padding: "10px 0", margin: "6px 0 14px", font: "inherit", color: "inherit",
        }}>
            <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--acchi)", fontWeight: 600 }}>{b.id}</span>
            <span><span style={{ fontFamily: SERIF, fontSize: 14.5 }}>{b.text}</span><br />
                <span style={{ fontSize: 12, color: "var(--txt3)" }}>{b.meta}</span></span>
        </button>
        if (b.type === "org_card") return <div key={i} style={{ border: "1px solid var(--gline2)", padding: 12, margin: "8px 0 16px" }}>
            <div style={{ fontWeight: 650 }}>{b.code} · {b.name}</div><div style={{ fontSize: 12.5, color: "var(--txt3)", marginBottom: 8 }}>{b.subtitle}</div>
            <table style={TABLE}><tbody>{(b.rows || []).map(([k, v], j) => <tr key={j}><th style={{ ...TD, width: 120, textAlign: "left", fontSize: 11 }}>{String(k).toUpperCase()}</th>
                <td style={TD}><Rich text={v} onRef={onRef} /></td></tr>)}</tbody></table></div>
        return null
    })
}

function Part({ id, title, children, kicker }) {
    return <section id={`issue-${id}`} style={{ padding: "26px 0 8px", borderTop: "1px solid var(--gline)" }}>
        {kicker && <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10.5, letterSpacing: ".12em", color: "var(--txt4)", marginBottom: 4 }}>{kicker}</div>}
        <h2 style={H1}>{title}</h2>
        {children}
    </section>
}

function RefPanel({ id, ev, doc, onClose }) {
    if (!id) return null
    const e = id.startsWith("S-") ? (ev?.events || []).find((x) => x.sid === id) : null
    const q = id.startsWith("Q-") ? (doc.sources || []).find((x) => x.id === id) : null
    const finding = id.startsWith("Q-") ? (ev?.findings || []).filter((f) => f.qid === id) : []
    const img = (doc.imagery?.items || []).find((x) => x.sid === id)
    return <aside style={{ width: 340, flex: "none", borderLeft: "1px solid var(--gline)", padding: 16, overflow: "auto", background: "var(--glass2)" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
            <span style={{ fontFamily: "var(--mz-font-mono)", color: "var(--acchi)", fontWeight: 600 }}>{id}</span>
            <div style={{ flex: 1 }} />
            <button onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--txt3)", cursor: "pointer", font: "inherit" }}>Close</button>
        </div>
        {e && <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{e.title}</div>
            {e.detail && <p style={{ fontSize: 13, color: "var(--txt2)", lineHeight: 1.5 }}>{e.detail}</p>}
            <dl style={{ fontSize: 12.5, display: "grid", gridTemplateColumns: "96px 1fr", gap: "4px 8px", margin: "8px 0" }}>
                <dt style={{ color: "var(--txt4)" }}>When</dt><dd style={{ margin: 0 }}>{String(e.when).slice(0, 16).replace("T", " ")} UTC</dd>
                <dt style={{ color: "var(--txt4)" }}>Where</dt><dd style={{ margin: 0 }}>{e.place || e.country || `${e.lat}, ${e.lon}`}</dd>
                {e.site && <><dt style={{ color: "var(--txt4)" }}>Relevance</dt><dd style={{ margin: 0 }}>{e.reach === "precedent" ? `same kind of target as ${e.site}` : `${e.km} km from ${e.site}`}</dd></>}
                <dt style={{ color: "var(--txt4)" }}>Category</dt><dd style={{ margin: 0 }}>{e.category}{e.pattern ? ` · ${e.days_active} days, ${e.reports} reports` : ""}</dd>
                <dt style={{ color: "var(--txt4)" }}>Sources</dt><dd style={{ margin: 0 }}>{(e.sources || []).join(", ")}</dd>
                <dt style={{ color: "var(--txt4)" }}>Confirmed by</dt><dd style={{ margin: 0 }}>{e.corroboration} independent source {e.corroboration === 1 ? "family" : "families"}{e.interested_only ? " · interested parties only" : ""}</dd>
            </dl>
            {img && <img src={img.src} alt="" style={{ width: "100%", margin: "6px 0" }} />}
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat: e.lat, lon: e.lon, altitude: 60000 } }))}
                    style={{ height: 28, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer" }}>Show on the globe</button>
                {e.url && <SourceLink url={e.url} style={{ alignSelf: "center", fontSize: 13 }}>Original</SourceLink>}
            </div>
        </>}
        {q && <>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>{q.title}</div>
            <div style={{ fontSize: 12.5, color: "var(--txt3)", marginBottom: 8 }}>Tier {q.tier} · reliability {q.reliability}{q.note && q.note !== "—" ? ` · ${q.note}` : ""}</div>
            {finding.map((f, i) => <p key={i} style={{ fontSize: 13, lineHeight: 1.5 }}>{f.claim}{f.date ? ` (${f.date})` : ""}</p>)}
            {q.url && <a href={q.url} target="_blank" rel="noreferrer" style={{ color: "var(--acchi)", fontSize: 13, wordBreak: "break-all" }}>{q.url}</a>}
        </>}
        {!e && !q && <p style={{ fontSize: 13, color: "var(--txt3)" }}>This reference is not in the evidence of this issue.</p>}
    </aside>
}

export default function IssueReader({ runId, onClose }) {
    const [doc, setDoc] = useState(null)
    const [ev, setEv] = useState(null)
    const [err, setErr] = useState(null)
    const [ref, setRef] = useState(null)
    useEffect(() => {
        let live = true
        setDoc(null); setErr(null)
        fetch(`${API_BASE}/api/briefings2/runs/${runId}/doc`, { credentials: "include" })
            .then((r) => r.ok ? r.json() : Promise.reject(new Error(`the document could not be loaded (${r.status})`)))
            .then((d) => live && setDoc(d)).catch((e) => live && setErr(String(e.message || e)))
        fetch(`${API_BASE}/api/briefings2/runs/${runId}/evidence`, { credentials: "include" })
            .then((r) => r.ok ? r.json() : null).then((d) => live && setEv(d)).catch(() => {})
        return () => { live = false }
    }, [runId])

    const L = doc?.labels || {}
    const toc = useMemo(() => {
        if (!doc) return []
        const out = []
        const has = (k) => doc[k] && (Array.isArray(doc[k]) ? doc[k].length : Object.values(doc[k]).some((v) => Array.isArray(v) ? v.length : v))
        for (const p of doc.parts || []) {
            if (p === "cover" || p === "contents") continue
            if (p === "sections") { (doc.sections || []).forEach((s) => out.push([s.id, `${s.number} ${s.title}`])); continue }
            if (has(p)) out.push([p, L[p] || p])
        }
        return out
    }, [doc, L])

    if (err) return <div style={{ padding: 24, color: "var(--txt3)" }}>{err}</div>
    if (!doc) return <div style={{ padding: 24 }}><Loading label="loading the issue" /></div>
    return <IssueView doc={doc} ev={ev} toc={toc} refId={ref} setRef={setRef} onClose={onClose} />
}

/** The issue itself, from a loaded document (pure: no fetching). */
export function IssueView({ doc, ev, toc = [], refId = null, setRef = () => {}, onClose }) {
    const L = doc.labels || {}
    const ref = refId
    const m = doc.meta
    const onRef = (id) => setRef(id)
    const go = (id) => document.getElementById(`issue-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })

    return <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
        <nav style={{ width: 230, flex: "none", borderRight: "1px solid var(--gline)", overflow: "auto", padding: "14px 10px",
                      display: typeof window !== "undefined" && window.innerWidth < 760 ? "none" : undefined }}>
            {onClose && <button onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--acchi)", cursor: "pointer", font: "inherit", padding: "0 6px 10px" }}>‹ All reports</button>}
            <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".12em", color: "var(--txt4)", padding: "0 6px 6px" }}>{(L.contents || "").toUpperCase()}</div>
            {toc.map(([id, t]) => <button key={id} onClick={() => go(id)} style={{
                display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", color: "var(--txt2)",
                padding: "5px 6px", font: "inherit", fontSize: 13, cursor: "pointer", lineHeight: 1.3,
            }}>{t}</button>)}
        </nav>
        <div style={{ flex: 1, overflow: "auto", minWidth: 0 }}>
            {onClose && typeof window !== "undefined" && window.innerWidth < 760 && (
                <button onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--acchi)", cursor: "pointer", font: "inherit", padding: "12px 16px 0" }}>‹ All reports</button>
            )}
            <article style={{ maxWidth: 780, margin: "0 auto", padding: typeof window !== "undefined" && window.innerWidth < 760 ? "14px 16px 60px" : "26px 28px 80px" }}>
                <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, letterSpacing: ".12em", color: "var(--txt4)" }}>
                    PARALLAX · {(L[m.cadence] || "").toUpperCase()} · {m.serial}</div>
                <h1 style={{ ...H1, fontSize: 30, margin: "8px 0 6px" }}>{m.title}</h1>
                <div style={{ fontSize: 14, color: "var(--txt2)" }}>{L.for} {m.org} · {L.period} {m.period_label} · {L.cutoff} {m.cutoff_label}</div>
                {m.rehearsal && <div style={{ marginTop: 10, padding: "8px 10px", border: "1px solid #8b3a2f", color: "#c0705f", fontSize: 13 }}>
                    {L.rehearsal}{m.rehearsal_reason ? ` — ${m.rehearsal_reason}` : ""}</div>}

                {doc.key_judgments?.length > 0 && <Part id="key_judgments" title={L.key_judgments}>
                    <p style={LEAD}>{L.kj_lead}</p>
                    {doc.key_judgments.map((k) => <div key={k.id} style={{ display: "grid", gridTemplateColumns: "52px 1fr", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--gline)" }}>
                        <div style={{ fontFamily: "var(--mz-font-mono)", color: "var(--txt4)", fontWeight: 600 }}>{k.id}</div>
                        <div><div style={{ fontWeight: 650, fontSize: 16, marginBottom: 6 }}>{k.title}</div>
                            <p style={P}><Rich text={k.body} onRef={onRef} /></p>
                            <div style={{ display: "flex", gap: 24, fontSize: 12.5, color: "var(--txt2)", flexWrap: "wrap" }}>
                                <span><b>{L.probability}</b> {L.bands?.[k.band]} ({k.low}–{k.high} %)</span>
                                <span><b>{L.confidence}</b> {L.conf?.[k.confidence]}</span>
                                <span><b>{L.change}</b> {k.change}</span></div></div>
                    </div>)}
                </Part>}

                {doc.sites?.length > 0 && <Part id="sites" title={L.sites}>
                    <p style={LEAD}>{L.sites_lead}</p>
                    <table style={TABLE}><thead><tr>{[L.site, L.kind, L.at_site, L.precedents, L.strongest].map((c) => <th key={c} style={TH}>{c}</th>)}</tr></thead>
                        <tbody>{doc.sites.map((s) => <tr key={s.id}><td style={TD}><b>{s.name}</b><br /><span style={{ color: "var(--txt3)", fontSize: 12 }}>{s.place}</span></td>
                            <td style={TD}>{s.kind_label}</td><td style={TD}>{s.events}</td><td style={TD}>{s.precedents}</td>
                            <td style={TD}>{s.strongest ? <Rich text={`${s.strongest.title} [${s.strongest.sid}]`} onRef={onRef} /> : L.none_short}</td></tr>)}</tbody></table>
                    {doc.sites.filter((s) => s.text).map((s) => <p key={s.id} style={P}><b>{s.name}.</b> <Rich text={s.text} onRef={onRef} /></p>)}
                </Part>}

                {doc.exposure?.vectors?.length > 0 && <Part id="exposure" title={L.exposure}>
                    {doc.exposure.lead && <p style={LEAD}>{doc.exposure.lead}</p>}
                    <table style={TABLE}><thead><tr>{["", L.vector, L.level, L.prev, "Δ", L.drivers, L.decision_touched].map((c, i) => <th key={i} style={TH}>{c}</th>)}</tr></thead>
                        <tbody>{doc.exposure.vectors.map((v) => <tr key={v.id}><td style={TD}>{v.id}</td><td style={TD}>{v.name}</td>
                            <td style={{ ...TD, background: LEVEL[v.level], color: "#fff", fontWeight: 700, textAlign: "center" }}>{v.level}</td>
                            <td style={TD}>{v.prev}</td><td style={TD}>{v.delta}</td><td style={TD}><Rich text={v.drivers} onRef={onRef} /></td><td style={TD}><Rich text={v.decision} onRef={onRef} /></td></tr>)}</tbody></table>
                    {doc.exposure.movement && <p style={P}><Rich text={doc.exposure.movement} onRef={onRef} /></p>}
                </Part>}

                {doc.decisions?.items?.length > 0 && <Part id="decisions" title={L.decisions}>
                    {doc.decisions.lead && <p style={LEAD}>{doc.decisions.lead}</p>}
                    {doc.decisions.items.map((d) => <div key={d.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--gline)" }}>
                        <div style={{ fontWeight: 650 }}>{d.id} · {d.what}</div>
                        <div style={{ fontSize: 12.5, color: "var(--txt3)", margin: "3px 0 6px" }}>{L.owner}: {d.owner} · {L.due}: {d.due} · {L.urgency}: {d.urgency} · {d.vector}</div>
                        <p style={{ ...P, margin: 0 }}><Rich text={d.rationale} onRef={onRef} /></p></div>)}
                </Part>}

                {doc.chronology?.rows?.length > 0 && <Part id="chronology" title={L.chronology} kicker={doc.chronology.kicker}>
                    {doc.chronology.lead && <p style={LEAD}>{doc.chronology.lead}</p>}
                    <table style={TABLE}><thead><tr>{[L.date, L.event, L.vector, L.class].map((c) => <th key={c} style={TH}>{c}</th>)}</tr></thead>
                        <tbody>{doc.chronology.rows.map((r, i) => <tr key={i}><td style={{ ...TD, whiteSpace: "nowrap" }}>{r.date}</td><td style={TD}><Rich text={r.event} onRef={onRef} /></td>
                            <td style={TD}>{r.vector}</td><td style={{ ...TD, whiteSpace: "nowrap", fontSize: 11 }}>[{L.tags?.[r.tag] || r.tag}]</td></tr>)}</tbody></table>
                    {doc.chronology.meaning && <Meaning text={doc.chronology.meaning} L={L} org={m.org} onRef={onRef} />}
                </Part>}

                {(doc.sections || []).map((s) => <Part key={s.id} id={s.id} title={s.title} kicker={s.kicker}>
                    {s.lead && <p style={LEAD}>{s.lead}</p>}
                    {(s.subsections || []).map((sub) => <div key={sub.id} id={`issue-${sub.id}`}>
                        <h3 style={H2}>{sub.number} {sub.title}</h3>
                        <Blocks blocks={sub.blocks} doc={doc} L={L} onRef={onRef} /></div>)}
                    <Blocks blocks={s.blocks} doc={doc} L={L} onRef={onRef} />
                </Part>)}

                {doc.imagery?.items?.length > 0 && <Part id="imagery" title={L.imagery}>
                    {doc.imagery.lead && <p style={LEAD}>{doc.imagery.lead}</p>}
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
                        {doc.imagery.items.map((im) => <figure key={im.number} style={{ margin: 0 }}>
                            <img src={im.src} alt="" style={{ width: "100%", display: "block", cursor: "pointer" }} onClick={() => onRef(im.sid)} />
                            <figcaption style={{ fontSize: 12, color: "var(--txt3)", marginTop: 6 }}>{L.figure} {im.number} — <Rich text={im.caption} onRef={onRef} /></figcaption></figure>)}
                    </div>
                    {doc.imagery.meaning && <Meaning text={doc.imagery.meaning} L={L} org={m.org} onRef={onRef} />}
                </Part>}

                {doc.analyst_desk?.question && <Part id="analyst_desk" title={L.analyst_desk} kicker={doc.analyst_desk.kicker}>
                    <h3 style={H2}>{L.question}</h3><p style={{ ...P, fontWeight: 600 }}>{doc.analyst_desk.question}</p>
                    {doc.analyst_desk.why && <p style={P}><Rich text={doc.analyst_desk.why} onRef={onRef} /></p>}
                    <h3 style={H2}>{L.hypotheses}</h3>
                    {(doc.analyst_desk.hypotheses || []).map((h) => <p key={h.id} style={P}><b>{h.id}</b> {h.text} <span style={{ color: "var(--txt3)" }}>— {h.consequence}</span></p>)}
                    {doc.analyst_desk.matrix?.length > 0 && <table style={TABLE}><thead><tr><th style={TH} />{(doc.analyst_desk.hypotheses || []).map((h) => <th key={h.id} style={TH}>{h.id}</th>)}</tr></thead>
                        <tbody>{doc.analyst_desk.matrix.map((r, i) => <tr key={i}><td style={TD}><Rich text={r.label} onRef={onRef} />{r.diagnostic ? " ●" : ""}</td>
                            {(r.scores || []).map((x, j) => <td key={j} style={{ ...TD, textAlign: "center", fontFamily: "var(--mz-font-mono)" }}>{x}</td>)}</tr>)}</tbody></table>}
                    {doc.analyst_desk.assessment && <p style={P}><Tag t="ASSESSMENT" L={L} /><Rich text={doc.analyst_desk.assessment} onRef={onRef} /></p>}
                    {doc.analyst_desk.counter && <><h3 style={H2}>{L.counter}</h3><p style={P}><Rich text={doc.analyst_desk.counter} onRef={onRef} /></p>
                        {doc.analyst_desk.counter_reply && <p style={P}><Rich text={doc.analyst_desk.counter_reply} onRef={onRef} /></p>}</>}
                    {doc.analyst_desk.would_change?.length > 0 && <><h3 style={H2}>{L.would_change}</h3>
                        <ul style={P}>{doc.analyst_desk.would_change.map((w) => <li key={w.id}><b>{w.id}</b> {w.event} — {w.deadline}: {w.effect}</li>)}</ul></>}
                </Part>}

                {doc.scenarios?.items?.length > 0 && <Part id="scenarios" title={L.scenarios}>
                    {doc.scenarios.lead && <p style={LEAD}>{doc.scenarios.lead}</p>}
                    {doc.scenarios.items.map((s) => <div key={s.key} style={{ padding: "10px 0", borderBottom: "1px solid var(--gline)" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}><b>{s.key} · {s.title}</b><div style={{ flex: 1 }} />
                            <div style={{ width: 120, height: 6, background: "var(--gline)" }}><div style={{ width: `${s.p}%`, height: 6, background: "var(--acc)" }} /></div>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 12 }}>{s.p} %</span></div>
                        <p style={{ ...P, margin: "6px 0" }}><Rich text={s.text} onRef={onRef} /></p>
                        <div style={{ fontSize: 12.5, color: "var(--txt2)" }}><b>{L.trigger}:</b> {s.trigger} · <b>{L.measure}:</b> {s.measure}</div></div>)}
                </Part>}

                {doc.indicators?.rows?.length > 0 && <Part id="indicators" title={m.cadence === "daily" ? L.watch : L.indicators}>
                    {doc.indicators.lead && <p style={LEAD}>{doc.indicators.lead}</p>}
                    <table style={TABLE}><thead><tr>{["", L.indicators_col, L.threshold, L.current, L.trend, L.lead_time].map((c, i) => <th key={i} style={TH}>{c}</th>)}</tr></thead>
                        <tbody>{doc.indicators.rows.map((r) => <tr key={r.id}><td style={TD}>{r.id}</td><td style={TD}>{r.name}</td><td style={TD}>{r.threshold}</td>
                            <td style={TD}>{r.current}</td><td style={TD}>{r.trend}</td><td style={TD}>{r.lead}</td></tr>)}</tbody></table>
                </Part>}

                {(doc.calendar?.rows?.length > 0 || doc.calendar?.wildcards?.length > 0) && <Part id="calendar" title={L.calendar}>
                    {doc.calendar.rows?.length > 0 && <table style={TABLE}><tbody>{doc.calendar.rows.map((r, i) => <tr key={i}><td style={{ ...TD, whiteSpace: "nowrap" }}>{r.when}</td>
                        <td style={TD}>{r.what}</td><td style={TD}>{r.vector}</td><td style={TD}><Rich text={r.why} onRef={onRef} /></td></tr>)}</tbody></table>}
                    {(doc.calendar.wildcards || []).map((w, i) => <p key={i} style={P}><b>{w.title}</b> ({w.p}). <Rich text={w.text} onRef={onRef} /> <i>{L.precaution}: {w.precaution}</i></p>)}
                </Part>}

                {(doc.gaps?.rows?.length > 0 || doc.gaps?.excluded?.length > 0) && <Part id="gaps" title={L.gaps}>
                    {doc.gaps.rows?.length > 0 && <table style={TABLE}><tbody>{doc.gaps.rows.map((g) => <tr key={g.id}><td style={TD}>{g.id}</td><td style={TD}>{g.what}</td>
                        <td style={TD}>{g.why}</td><td style={TD}>{g.clarify}</td></tr>)}</tbody></table>}
                    {(doc.gaps.excluded || []).map((x, i) => <p key={i} style={P}><b>{x.title}.</b> {x.text}</p>)}
                </Part>}

                {doc.sources?.length > 0 && <Part id="sources" title={L.sources}>
                    <table style={TABLE}><tbody>{doc.sources.map((s) => <tr key={s.id}><td style={{ ...TD, fontFamily: "var(--mz-font-mono)", whiteSpace: "nowrap" }}>
                        <button onClick={() => onRef(s.id)} style={{ border: 0, background: "transparent", color: "var(--acchi)", cursor: "pointer", font: "inherit", padding: 0 }}>{s.id}</button></td>
                        <td style={TD}>{s.title}{s.url && <><br /><a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--txt3)", fontSize: 12, wordBreak: "break-all" }}>{s.url}</a></>}</td>
                        <td style={TD}>{s.tier}</td><td style={TD}>{L.conf?.[s.reliability] || s.reliability}</td></tr>)}</tbody></table>
                </Part>}

                {doc.method?.procedure && <Part id="method" title={L.method}>
                    <h3 style={H2}>{L.procedure}</h3><p style={P}>{doc.method.procedure}</p>
                    {doc.method.weakest && <><h3 style={H2}>{L.weakest}</h3><p style={P}>{doc.method.weakest}</p></>}
                    {doc.method.limits && <><h3 style={H2}>{L.limits}</h3><p style={P}>{doc.method.limits}</p></>}
                </Part>}

                {doc.glossary?.length > 0 && <Part id="glossary" title={L.glossary}>
                    <table style={TABLE}><tbody>{doc.glossary.map((g) => <tr key={g.term}><td style={{ ...TD, fontWeight: 600, whiteSpace: "nowrap" }}>{g.term}</td><td style={TD}>{g.meaning}</td></tr>)}</tbody></table>
                </Part>}
            </article>
        </div>
        <RefPanel id={ref} ev={ev} doc={doc} onClose={() => setRef(null)} />
    </div>
}
