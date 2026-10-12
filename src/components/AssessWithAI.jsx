/**
 * AssessWithAI.jsx — "Assess with AI": a vision model's second opinion on one
 * finding (backend/finding_assess.py), ONLY when this button is pressed
 * (owner, 2026-10-12: "only when we press on the detected thing — so it can
 * say 'I think that actually is something' or not").
 *
 * On show it asks, for free, whether this finding was already assessed (then
 * the verdict is shown, never paid twice) and what a run would cost; the cost
 * is on the button. Pressed: a spinner, then the verdict card, labelled as a
 * second opinion and not evidence. Used in the finding views: FindingPreview
 * (the phone sheet, the desktop inspector) and FindingViewer (Imagery).
 */
import { useEffect, useState } from "react"
import { apiFetch } from "../auth.js"

const TONE = { likely_real: "#FF3B30", uncertain: "#FFB300", likely_benign: "#4caf7a" }
const WORD = { likely_real: "Likely real", uncertain: "Uncertain", likely_benign: "Likely nothing of note" }
const BTN = { height: 30, padding: "0 12px", border: "1px solid var(--gline2, rgba(255,255,255,.2))", background: "transparent",
              color: "inherit", font: "inherit", fontSize: 12.5, cursor: "pointer" }

const path = (zoneId, findingId) => `/api/findings/${encodeURIComponent(zoneId)}/${encodeURIComponent(findingId)}/assess`
export const usd = (v) => (v == null ? "" : v < 0.01 ? `about $${Number(v).toFixed(4)}` : `about $${Number(v).toFixed(2)}`)

async function call(p, method = "GET") {
    const r = await apiFetch(p, { method, _timeout: 90000 })
    const d = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(typeof d?.detail === "string" ? d.detail : `the server answered ${r.status}`)
    return d
}

export default function AssessWithAI({ zoneId, findingId, compact = false }) {
    const [st, setSt] = useState({ status: "idle" })
    useEffect(() => {
        if (!zoneId || !findingId) return undefined
        let live = true
        setSt({ status: "idle" })
        call(path(zoneId, findingId))
            .then((d) => { if (live) setSt(d.status === "ready" ? { status: "ready", a: d.assessment } : { status: "idle", preview: d }) })
            .catch(() => { if (live) setSt({ status: "idle" }) })
        return () => { live = false }
    }, [zoneId, findingId])
    if (!zoneId || !findingId) return null

    const run = async () => {
        setSt((s) => ({ ...s, status: "running" }))
        try {
            const d = await call(path(zoneId, findingId), "POST")
            setSt({ status: "ready", a: d.assessment })
        } catch (e) {
            setSt((s) => ({ ...s, status: "error", error: e.message }))
        }
    }
    const p = st.preview
    const off = p && (!p.enabled || p.over_budget)

    if (st.status === "ready" && st.a) {
        const a = st.a
        const col = TONE[a.verdict] || TONE.uncertain
        return (
            <div data-ai-assessment={a.verdict} style={{ border: `1px solid ${col}`, padding: compact ? 10 : 12, display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, lineHeight: 1.45 }}>
                <span style={{ fontSize: 11, letterSpacing: ".04em", textTransform: "uppercase", opacity: 0.75 }}>AI assessment — a second opinion, not evidence</span>
                <span style={{ fontSize: 15, fontWeight: 600, color: col }}>
                    {WORD[a.verdict] || a.verdict}{a.most_likely ? ` · ${a.most_likely}` : ""}
                    <span style={{ fontWeight: 400, fontSize: 12, opacity: 0.8, color: "var(--txt, inherit)" }}> · {Math.round((a.confidence ?? 0.5) * 100)}% sure</span>
                </span>
                {a.alternatives?.length > 0 && <span style={{ opacity: 0.8 }}>Could also be: {a.alternatives.join(", ")}</span>}
                <ul style={{ margin: "2px 0", paddingLeft: 18 }}>{(a.reasons || []).map((r) => <li key={r}>{r}</li>)}</ul>
                {a.would_confirm?.length > 0 && <span><b style={{ fontWeight: 600 }}>What would confirm it:</b> {a.would_confirm.join("; ")}</span>}
                {(a.limits || []).map((l) => <span key={l} style={{ fontSize: 11.5, opacity: 0.7 }}>{l}</span>)}
                <span style={{ fontSize: 11, opacity: 0.55 }}>
                    {a.model}{a.cost_usd != null ? ` · $${Number(a.cost_usd).toFixed(4)}` : ""}{a.assessed_at ? ` · ${String(a.assessed_at).slice(0, 16).replace("T", " ")} UTC` : ""}
                    {a.images?.length ? ` · looked at ${a.images.length} image${a.images.length === 1 ? "" : "s"}` : ""}
                </span>
            </div>
        )
    }
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
            <button data-assess-ai onClick={run} disabled={st.status === "running" || off} style={{ ...BTN, opacity: off ? 0.5 : 1, cursor: off ? "default" : "pointer" }}>
                {st.status === "running" ? "Assessing…" : "Assess with AI"}
            </button>
            {st.status === "running" && <span className="plx-spin" aria-label="Assessing" style={{ width: 14, height: 14, border: "2px solid currentColor", borderRightColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "plx-ai-spin .8s linear infinite" }} />}
            <style>{"@keyframes plx-ai-spin{to{transform:rotate(360deg)}}"}</style>
            {st.status !== "running" && p && !off && <span style={{ opacity: 0.65 }}>{usd(p.estimate_usd)} · a second opinion from {p.model}, only when asked</span>}
            {off && <span style={{ opacity: 0.65 }}>{p.over_budget ? "This month's AI budget is spent." : "The AI assessment is not set up here."}</span>}
            {st.status === "error" && <span role="alert" style={{ color: "var(--red, #e5484d)" }}>{st.error}</span>}
        </div>
    )
}
