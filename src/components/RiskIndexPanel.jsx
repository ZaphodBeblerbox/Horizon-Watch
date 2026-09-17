/**
 * RiskIndexPanel.jsx — PARALLAX §15, the GDELT country risk index.
 *
 * "A hand-kept table of 1-5 is unfalsifiable: nobody can say why a country is
 * a 5, and nobody notices when it stops being true." So the index is four
 * components with exposed weights, and every row opens into the arithmetic
 * that produced it.
 *
 * WHAT THIS PANEL WILL NOT DO
 * ---------------------------
 * Show a number where there is no data. This app's GDELT cache is frequently
 * thin — at the time of writing it holds 6 events over 0 days of history, so
 * three of the four components come back `null` with an honest status
 * (insufficient_history / no_real_tone_data / no_real_events_in_window) and
 * only the GeoConfirmed confirmation density has anything to say. A panel that
 * rendered those as 0 would report "this country is calm" when the truth is
 * "we did not look". Each component therefore shows its status, and the source
 * tag reflects what actually arrived.
 *
 * THE DELTA IS SCOPED TO WHAT WE ACTUALLY OBSERVED
 * ------------------------------------------------
 * §15 asks for "a signed delta (red up, green down, · unchanged)". Nothing in
 * this system stores a history of index scores, so there is no yesterday to
 * compare against. Rather than invent one, the delta is computed between
 * successive refreshes within this session and labelled as such; before a
 * second observation exists every row reads "·", which is the truthful answer.
 *
 * ⚠ §15's shading is gone. "The index sets shading and sort order only" — the
 * shading was the risk choropleth, removed on a direct instruction along with
 * the rest of the threat-heatmap layer. Sort order survives, and that is now
 * this panel's whole job. Exposure scoring still never reads the index: "an
 * index that both ranks the world and scores your sites launders press volume
 * into your site scores."
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react"
import API_BASE from "../apiBase.js"
import { safeArray } from "../utils/safeArray.js"
import { fetchWithTimeout } from "../utils/fetchWithTimeout.js"

const COMPONENTS = [
    { key: "vol",  label: "Event volume",   note: "vs the country's own 24-month median" },
    { key: "tone", label: "Article tone",   note: "inverted — GDELT tone is negative for bad news" },
    { key: "gold", label: "Conflict share", note: "Goldstein below threshold" },
    { key: "conf", label: "Confirmations",  note: "GeoConfirmed density — an independent check on volume" },
]

const BAND_COLOR = ["", "var(--sev-low)", "var(--sev-low)", "var(--sev-moderate)", "var(--sev-high)", "var(--sev-critical)"]

/** §15's own status vocabulary, said in words rather than shown as a zero. */
const STATUS_TEXT = {
    insufficient_history:      "not enough history",
    no_real_tone_data:         "no tone data",
    no_real_events_in_window:  "no events in window",
    no_real_geoconfirmed_data: "no confirmations",
}

export default function RiskIndexPanel() {
    const [data, setData] = useState(null)
    const [weights, setWeights] = useState(null)
    const [open, setOpen] = useState(null)      // iso of the expanded breakdown
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState(false)
    const prevScores = useRef(null)             // iso -> score, from the previous refresh
    const [deltas, setDeltas] = useState(null)

    const load = useCallback(() => {
        setBusy(true)
        fetchWithTimeout(`${API_BASE}/api/risk-index/countries?window_days=30`)
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
                if (!d) { setError(true); return }
                setError(false)
                const rows = safeArray(d.countries)
                if (prevScores.current) {
                    const next = {}
                    for (const c of rows) {
                        const was = prevScores.current[c.iso_code]
                        if (typeof was === "number" && typeof c.score === "number") next[c.iso_code] = c.score - was
                    }
                    setDeltas(next)
                }
                prevScores.current = Object.fromEntries(rows.map((c) => [c.iso_code, c.score]))
                setData({ ...d, countries: rows })
                setWeights(d.weights)
            })
            .catch(() => setError(true))
            .finally(() => setBusy(false))
    }, [])

    useEffect(() => { load() }, [load])

    const pushWeights = (next) => {
        setWeights(next)   // optimistic: the slider must not lag the thumb
        fetchWithTimeout(`${API_BASE}/api/risk-index/weights`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify(next),
        }).then(() => load()).catch(() => setError(true))
    }

    const resetWeights = () => {
        fetchWithTimeout(`${API_BASE}/api/risk-index/weights/reset`, { method: "POST" })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => { if (d?.weights) setWeights(d.weights); load() })
            .catch(() => setError(true))
    }

    // §15 — the top twelve, by score.
    const top = useMemo(
        () => (data?.countries || []).slice().sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 12),
        [data],
    )
    const maxScore = Math.max(1, ...top.map((c) => c.score ?? 0))

    // The source tag is a statement about the DATA, not about whether the
    // request succeeded. A live 200 carrying six events is still "seeded".
    const live = (data?.real_gdelt_history_days ?? 0) >= 30 && (data?.real_total_gdelt_events ?? 0) > 100

    return (
        <div className="group riskidx">
            <div className="grouphead">
                <h4>Risk index · GDELT</h4>
                <span className={`srctag${live ? "" : " warn"}`} title={
                    live ? "Live GDELT corpus" : `Thin corpus — ${data?.real_total_gdelt_events ?? 0} events over ${Math.round(data?.real_gdelt_history_days ?? 0)} days`
                }>{error ? "unavailable" : live ? "GDELT live" : "seeded"}</span>
            </div>

            {/* Weights — four sliders, the value in mono beside each. */}
            <div className="riskw">
                {COMPONENTS.map((c) => (
                    <label key={c.key} className="riskwrow" title={c.note}>
                        <span className="n">{c.label}</span>
                        <input
                            type="range" min={0} max={1} step={0.05}
                            value={weights?.[c.key] ?? 0}
                            onChange={(e) => pushWeights({ ...weights, [c.key]: Number(e.target.value) })}
                        />
                        <b>{(weights?.[c.key] ?? 0).toFixed(2)}</b>
                    </label>
                ))}
                <div className="riskacts">
                    <button type="button" onClick={resetWeights}>reset weights</button>
                    <button type="button" onClick={load} disabled={busy}>{busy ? "…" : "refresh"}</button>
                </div>
            </div>

            <p className="risknote">
                Four components, weight-normalised. The index sets sort order only —
                exposure scoring never reads it, because an index that both ranks the
                world and scores your sites launders press volume into your site scores.
            </p>

            {error ? (
                <div className="riskempty">Risk index unavailable.</div>
            ) : !top.length ? (
                <div className="riskempty">{busy ? "Reading index…" : "No country has enough real data to score."}</div>
            ) : (
                <div className="riskrank">
                    {top.map((c, i) => {
                        const d = deltas?.[c.iso_code]
                        const dir = typeof d === "number" && Math.abs(d) >= 0.05 ? (d > 0 ? "up" : "down") : "flat"
                        return (
                            <div key={c.iso_code}>
                                <button type="button" className="riskrow"
                                        aria-expanded={open === c.iso_code}
                                        onClick={() => setOpen(open === c.iso_code ? null : c.iso_code)}>
                                    <span className="rk">{i + 1}</span>
                                    <span className="iso">{c.iso_code}</span>
                                    <span className="bar"><i style={{
                                        width: `${((c.score ?? 0) / maxScore) * 100}%`,
                                        background: BAND_COLOR[c.band] || "var(--grey)",
                                    }} /></span>
                                    <b className="sc">{c.score == null ? "—" : c.score.toFixed(1)}</b>
                                    <span className={`dl ${dir}`}>
                                        {dir === "flat" ? "·" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`}
                                    </span>
                                </button>

                                {open === c.iso_code && (
                                    <div className="riskbd">
                                        {/* Contributions are weight-normalised by the
                                            backend so they sum to the index — a band
                                            change always traces to the component that
                                            moved. */}
                                        {COMPONENTS.map((comp) => {
                                            const m = c.components?.[comp.key] || {}
                                            const contrib = c.contributions?.[comp.key]
                                            const missing = m.score == null
                                            return (
                                                <div key={comp.key} className={`riskbdrow${missing ? " missing" : ""}`}>
                                                    <span className="n">{comp.label}</span>
                                                    <span className="v">
                                                        {missing
                                                            ? (STATUS_TEXT[m.status] || m.status || "no data")
                                                            : `${m.score.toFixed(1)} → ${(contrib ?? 0).toFixed(2)}`}
                                                    </span>
                                                </div>
                                            )
                                        })}
                                        <div className="riskbdrow total">
                                            <span className="n">index</span>
                                            <span className="v">{c.score == null ? "—" : c.score.toFixed(2)}</span>
                                        </div>
                                        {Object.keys(c.weights_used || {}).length < COMPONENTS.length && (
                                            <p className="risknote sm">
                                                Scored on {Object.keys(c.weights_used || {}).length} of {COMPONENTS.length} components;
                                                the weights were re-normalised over what was available, so this score is
                                                not comparable to one computed from all four.
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
