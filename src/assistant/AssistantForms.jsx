/**
 * AssistantForms.jsx — the same set-up steps as plain forms, for when the
 * model is off (or the user prefers a form). Each form posts its fields to
 * /api/assistant/propose, which validates and signs exactly as the model's
 * tools do; the result is the same ConfirmCard.
 */
import { useState } from "react"
import { proposeForm } from "./assistantApi.js"

const KIND_OF_STEP = { here: "interests", theater: "theater", protect: "asset", care: "interests", alert: "alerts" }
const DEFAULT_LEVELS = { near_mine: "Only the most urgent, near my places", theaters: "Also urgent things in my theaters",
                         everything: "Everything that concerns me" }
const DEFAULT_TOPICS = { maritime: "Maritime", aviation: "Aviation", conflict: "Armed conflict",
                         energy: "Energy & infrastructure", cyber: "Cyber", unrest: "Unrest & politics" }

/** The fields a step's form sends. Pure (tested). */
export function formFields(step, v) {
    switch (step) {
        case "here": return { here_place: v.place, here_radius_km: v.radius ? +v.radius : undefined }
        case "theater": return { name: v.name || undefined, place: v.place, radius_km: v.radius ? +v.radius : undefined }
        case "protect": return { name: v.name || undefined, kind: v.kind || undefined, place: v.place, radius_km: v.radius ? +v.radius : undefined }
        case "care": return {
            regions: v.regions || [], topics: v.topics || [],
            countries: String(v.countries || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
        }
        case "alert": return { level: v.level }
        default: return {}
    }
}

export default function AssistantForms({ step, chips, initial = {}, onProposal, onSkip }) {
    const [v, setV] = useState(initial)
    const [why, setWhy] = useState(null)
    const [ask, setAsk] = useState(null)
    const [busy, setBusy] = useState(false)
    const put = (k) => (e) => setV((o) => ({ ...o, [k]: e?.target ? e.target.value : e }))
    const toggle = (k, x) => setV((o) => ({ ...o, [k]: (o[k] || []).includes(x) ? o[k].filter((y) => y !== x) : [...(o[k] || []), x] }))
    const kind = KIND_OF_STEP[step]
    if (!kind) return null

    const submit = async (over) => {
        const vals = { ...v, ...(over || {}) }
        setBusy(true); setWhy(null); setAsk(null)
        try {
            const out = await proposeForm(kind, formFields(step, vals))
            if (out?.proposal) { onProposal?.(out.proposal); setV(initial) }
            else if (out?.ask) setAsk(out.ask)
        } catch (e) {
            setWhy(e?.message || "That did not work.")
        } finally {
            setBusy(false)
        }
    }

    const placeBox = (label, ph) => (
        <label>{label}<input value={v.place || ""} onChange={put("place")} placeholder={ph} /></label>
    )
    return (
        <form className="plx-as-form" data-testid={`assistant-form-${step}`} onSubmit={(e) => { e.preventDefault(); submit() }}>
            {step === "here" && placeBox("Where you are", "A city or an address")}
            {step === "theater" && (<>
                {placeBox("Area to cover", "A city, a country or a region")}
                <div className="row">
                    <label>Name<input value={v.name || ""} onChange={put("name")} placeholder="Optional" maxLength={60} /></label>
                    <label>Radius, km<input inputMode="numeric" value={v.radius || ""} onChange={put("radius")} placeholder="Auto" /></label>
                </div>
            </>)}
            {step === "protect" && (<>
                <div className="row">
                    <label>What<input value={v.name || ""} onChange={put("name")} placeholder="Lyon office" maxLength={60} /></label>
                    <label>Kind<select value={v.kind || ""} onChange={put("kind")}>
                        <option value="">Choose</option>
                        {Object.entries(chips?.kinds || { office: "Office", warehouse: "Warehouse", factory: "Factory",
                                                           vessel_general: "General cargo", port: "Port terminal" })
                            .map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select></label>
                </div>
                {placeBox("Address or place", "12 Rue de Rivoli, Paris")}
                <label>Watch radius, km<input inputMode="numeric" value={v.radius || ""} onChange={put("radius")} placeholder="Default for the kind" /></label>
            </>)}
            {step === "care" && (<>
                <label>Regions</label>
                <div className="plx-as-choices">
                    {(chips?.regions || []).map((r) => (
                        <button type="button" key={r} className="plx-as-chip" aria-pressed={(v.regions || []).includes(r)} onClick={() => toggle("regions", r)}>{r}</button>))}
                </div>
                <label>Topics</label>
                <div className="plx-as-choices">
                    {Object.entries(chips?.topics || DEFAULT_TOPICS).map(([k, l]) => (
                        <button type="button" key={k} className="plx-as-chip" aria-pressed={(v.topics || []).includes(k)} onClick={() => toggle("topics", k)}>{l}</button>))}
                </div>
                <label>Countries<input value={v.countries || ""} onChange={put("countries")} placeholder="France, Ukraine" /></label>
            </>)}
            {step === "alert" && (
                <div className="plx-as-choices" style={{ flexDirection: "column", alignItems: "stretch" }}>
                    {Object.entries(chips?.levels || DEFAULT_LEVELS).map(([k, l]) => (
                        <button type="button" key={k} className="plx-as-chip" aria-pressed={v.level === k}
                                onClick={() => { setV((o) => ({ ...o, level: k })); submit({ level: k }) }}>{l}</button>))}
                </div>
            )}
            {ask && (
                <div>
                    <div className="why">{ask.question}</div>
                    <div className="plx-as-choices">
                        {ask.options.map((o) => (
                            <button type="button" key={o.label} className="plx-as-chip"
                                    onClick={() => { setV((x) => ({ ...x, place: o.label })); submit({ place: o.label }) }}>{o.label}</button>))}
                    </div>
                </div>
            )}
            {why && <div className="why" role="alert">{why}</div>}
            <div className="row" style={{ flex: "none" }}>
                {step !== "alert" && <button className="plx-as-btn" type="submit" disabled={busy}>{busy ? "Checking…" : "Propose"}</button>}
                {onSkip && step !== "theater" && <button className="plx-as-btn" data-quiet="true" type="button" onClick={onSkip}>Skip this step</button>}
            </div>
        </form>
    )
}
