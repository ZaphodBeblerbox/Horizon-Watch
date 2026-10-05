/**
 * ForecastToday.jsx — forecasts that name something and can be wrong.
 *
 * WHAT THIS REPLACES AS THE DEFAULT VIEW. The board view asks questions
 * like "Escalation in non-state conflict, 0-3 months" and answers 90%
 * against a base rate of 33%. Both numbers are real and the board is worth
 * keeping — but as a forecast it names no actor, no place and no object, it
 * resolves over a quarter, and nothing in it can ever be shown to have
 * been wrong. An analyst reading it learns nothing they can act on.
 *
 * These say instead:
 *
 *   62%  Sudan · RSF may attempt to retake Babanusa
 *        because the garrison's resupply has not been reported since
 *        Tuesday · by 2026-10-12
 *        ▸ 2 signals, click to see them
 *
 * An actor, a place, an action, a reason, a probability, a date, and the
 * signals it rests on. Each carries a resolution criterion written before
 * the fact, so it later gets marked happened / did not — which is what
 * turns the probability into something with a track record instead of
 * decoration.
 */
import { useCallback, useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const SEV = {
    critical: "var(--red)", significant: "var(--amber)",
    high: "var(--amber)", elevated: "var(--acc-hi)", routine: "var(--steel)",
}

/** The probability, as a figure and a bar. */
function Prob({ p }) {
    if (p == null) return <div style={{ width: 46 }} />
    // Colour by how far from "no view" it is, not by how high. 55% and 45%
    // are both the model shrugging; 90% and 10% are both a claim.
    const edge = Math.abs(p - 50) / 50
    return (
        <div style={{ width: 46, flexShrink: 0 }}>
            <div style={{
                font: "600 15px var(--mono)",
                color: edge > 0.5 ? "var(--txt)" : "var(--txt-2)",
            }}>{p}%</div>
            <div style={{ height: 2, background: "var(--gline2)", marginTop: 3 }}>
                <div style={{
                    width: `${p}%`, height: "100%",
                    background: edge > 0.5 ? "var(--acc-hi)" : "var(--steel)",
                }} />
            </div>
        </div>
    )
}

export default function ForecastToday() {
    const [data, setData] = useState(null)
    const [open, setOpen] = useState(null)
    const [score, setScore] = useState(null)
    const [due, setDue] = useState([])
    const [busy, setBusy] = useState(false)
    const [note, setNote] = useState(null)

    const read = useCallback(() => {
        const opts = { credentials: "include" }
        fetch(`${API_BASE}/api/enrich/outlook`, opts)
            .then((r) => (r.ok ? r.json() : null)).then(setData)
            .catch((e) => setData({ ok: false, why: String(e.message || e) }))
        fetch(`${API_BASE}/api/enrich/outlook/scorecard`, opts)
            .then((r) => (r.ok ? r.json() : null)).then(setScore).catch(() => {})
        fetch(`${API_BASE}/api/enrich/outlook/due`, opts)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => setDue(safeArray(d?.due))).catch(() => {})
    }, [])
    useEffect(read, [read])

    /* Recording is explicit. A forecast stored silently on page view would
       fill the scorecard with things nobody committed to. */
    const commit = async () => {
        setBusy(true); setNote(null)
        try {
            const r = await fetch(`${API_BASE}/api/enrich/outlook/record`,
                                  { method: "POST", credentials: "include" })
            const d = await r.json()
            setNote(d?.stored != null
                ? `${d.stored} recorded${d.already ? `, ${d.already} already on the board` : ""}`
                : (d?.why || "Could not record those."))
            read()
        } catch (e) { setNote(String(e.message || e)) }
        finally { setBusy(false) }
    }

    const mark = async (fid, outcome) => {
        await fetch(`${API_BASE}/api/enrich/outlook/forecasts/${fid}/resolve`, {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ outcome }),
        }).catch(() => {})
        read()
    }

    const rows = safeArray(data?.outlook)

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ── waiting on a verdict ──────────────────────────────────
                Shown FIRST and before anything new. An unresolved forecast
                left quietly open is what turns a scorecard into a lie by
                omission, so the queue is the first thing in the module. */}
            {due.length > 0 && (
                <section>
                    <div style={{ ...EYE, marginBottom: 7 }}>
                        Waiting on a verdict · {due.length}
                    </div>
                    {due.map((f) => (
                        <div key={f.id} style={{
                            padding: "9px 0", borderBottom: "1px solid var(--gline)",
                        }}>
                            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                                <Prob p={f.probability} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ font: "400 13px/1.5 var(--font)", color: "var(--txt)" }}>
                                        {[f.place, f.statement].filter(Boolean).join(" · ")}
                                    </div>
                                    <div style={{ font: "400 11px/1.5 var(--font)", color: "var(--txt-3)" }}>
                                        Settled by: {f.criterion}
                                    </div>
                                </div>
                            </div>
                            <div style={{ display: "flex", gap: 6, marginTop: 7, marginLeft: 56 }}>
                                <button className="btn sm" onClick={() => mark(f.id, "happened")}>
                                    it happened
                                </button>
                                <button className="btn sm" onClick={() => mark(f.id, "did_not")}>
                                    it did not
                                </button>
                                {/* A bad criterion is a fault in the forecast, not
                                    a wrong call, so it is excluded rather than
                                    counted as a miss. */}
                                <button className="btn sm" onClick={() => mark(f.id, "void")}
                                        title="The criterion turned out not to be checkable">
                                    unanswerable
                                </button>
                            </div>
                        </div>
                    ))}
                </section>
            )}

            {/* ── today ──────────────────────────────────────────────── */}
            <section>
                <div style={{
                    display: "flex", alignItems: "baseline", gap: 8, marginBottom: 7,
                }}>
                    <div style={EYE}>Today</div>
                    <div style={{ ...EYE, letterSpacing: 0, textTransform: "none", flex: 1 }}>
                        {data == null ? "reading the signals…"
                            : rows.length ? `${rows.length} from ${data.count} signals`
                            : (data.ok ? "nothing specific in today's signals" : (data.why || "unavailable"))}
                    </div>
                    {rows.length > 0 && (
                        <button className="btn sm primary" disabled={busy} onClick={commit}>
                            {busy ? "recording…" : "record these"}
                        </button>
                    )}
                </div>
                {note && <div style={{ ...EYE, letterSpacing: 0, textTransform: "none", marginBottom: 7 }}>{note}</div>}

                {rows.map((o, i) => (
                    <div key={i} style={{ borderBottom: "1px solid var(--gline)", padding: "10px 0" }}>
                        <div
                            onClick={() => setOpen(open === i ? null : i)}
                            style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}
                        >
                            <Prob p={o.probability} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ font: "400 13.5px/1.5 var(--font)", color: "var(--txt)" }}>
                                    {o.place && <span style={{ color: "var(--acc-hi)" }}>{o.place} · </span>}
                                    {o.statement}
                                </div>
                                {o.because && (
                                    <div style={{ font: "400 11.5px/1.6 var(--font)", color: "var(--txt-2)", marginTop: 2 }}>
                                        {o.because}
                                    </div>
                                )}
                                <div style={{ ...EYE, marginTop: 3 }}>
                                    {[o.resolves_by ? `by ${o.resolves_by}` : null,
                                      `${o.citations?.length || 0} signal${o.citations?.length === 1 ? "" : "s"}`,
                                     ].filter(Boolean).join(" · ")}
                                </div>
                            </div>
                        </div>

                        {open === i && (
                            <div style={{ marginLeft: 56, marginTop: 8 }}>
                                <div style={{ ...EYE, marginBottom: 5 }}>Settled by</div>
                                <div style={{
                                    font: "400 12px/1.6 var(--font)", color: "var(--txt-2)",
                                    marginBottom: 9,
                                }}>{o.criterion}</div>
                                <div style={{ ...EYE, marginBottom: 5 }}>What it rests on</div>
                                {safeArray(o.citations).map((c, j) => (
                                    <div
                                        key={j}
                                        onClick={() => c.lat != null && window.dispatchEvent(
                                            new CustomEvent("akili:fly-to", { detail: { lat: c.lat, lon: c.lon } }))}
                                        style={{
                                            display: "flex", gap: 7, padding: "5px 0",
                                            cursor: c.lat != null ? "pointer" : "default",
                                        }}
                                    >
                                        <i style={{
                                            width: 5, height: 5, marginTop: 5, flexShrink: 0,
                                            background: SEV[String(c.severity || "").toLowerCase()] || "var(--steel)",
                                        }} />
                                        <div style={{ minWidth: 0 }}>
                                            <div style={{ font: "400 11.5px/1.5 var(--font)", color: "var(--txt-2)" }}>
                                                {c.headline}
                                            </div>
                                            <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>
                                                {[c.location, c.source].filter(Boolean).join(" · ")}
                                                {c.lat != null ? " · on the map →" : ""}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </section>

            {/* ── the record ────────────────────────────────────────────
                With its n, always. A Brier score over four forecasts is not
                a track record, and printing it without the count invites it
                to be read as one. */}
            {score && (
                <section style={{ borderTop: "1px solid var(--gline)", paddingTop: 10 }}>
                    <div style={{ ...EYE, marginBottom: 5 }}>The record</div>
                    <div style={{ font: "400 12px/1.6 var(--font)", color: "var(--txt-2)" }}>
                        {score.n
                            ? <>Brier {score.brier} over {score.n} resolved
                                {" "}({score.happened} happened, {score.did_not} did not).
                                {" "}A flat 50% on everything would score {score.reference?.always_50_percent}.
                                {score.open ? ` ${score.open} still open.` : ""}</>
                            : (score.note || "Nothing has resolved yet.")}
                    </div>
                </section>
            )}
        </div>
    )
}
