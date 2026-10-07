/**
 * IssueStudio.jsx — situation reports: who they are for, and writing one.
 *
 * Three columns. The recipient profile (organisation, addressee, sectors,
 * partners, products, countries, the exposure vectors the issue is
 * organised around — derived from the asset register and interests until
 * edited). Generate: cadence (daily ≈ 2 pages, weekly ≈ 10, monthly 30–40),
 * language, the cost estimate and the cap, whether the model is available
 * and, if not, why. The runs: a stepper while one is being written (it can
 * take most of an hour for a monthly), then PDF, reader and deck.
 *
 * Backend: backend/briefing/ and routers/briefing_engine.py.
 */
import { useCallback, useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import IssueReader from "./IssueReader.jsx"

const API = `${API_BASE}/api/briefings2`
const EYE = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
const INPUT = { width: "100%", boxSizing: "border-box", height: 30, padding: "0 8px", border: "1px solid var(--gline2)", background: "transparent",
                color: "var(--txt)", font: "inherit", fontSize: 13, borderRadius: 0 }
const COL = { minWidth: 0, overflow: "auto", padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 }
const CATEGORIES = [["unrest", "Unrest & protest"], ["sabotage", "Sabotage & hybrid"], ["kinetic", "Violence & attacks"], ["fire", "Fires"],
                    ["crime", "Crime"], ["maritime", "Maritime"], ["aviation", "Aviation"], ["navigation", "Navigation interference"]]
const CADENCES = [["daily", "Daily", "≈ 2 pages"], ["weekly", "Weekly", "≈ 10 pages"], ["monthly", "Monthly", "30–40 pages"]]
const LANGS = [["de", "Deutsch"], ["en", "English"], ["fr", "Français"]]
const STAGES = ["profile", "collect", "research", "write", "validate", "print", "done"]

const get = (u) => fetch(u, { credentials: "include" }).then((r) => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
const send = (u, method, body) => fetch(u, { method, credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })
    .then(async (r) => r.ok ? r.json() : Promise.reject(new Error((await r.json().catch(() => ({}))).detail || `${r.status}`)))

function Btn({ children, onClick, primary, disabled }) {
    return <button onClick={onClick} disabled={disabled} style={{
        height: 30, padding: "0 14px", border: primary ? 0 : "1px solid var(--gline2)", borderRadius: 0,
        background: primary ? "var(--acc)" : "transparent", color: primary ? "var(--mz-cream)" : "var(--txt)",
        font: "inherit", fontSize: 13, fontWeight: primary ? 600 : 400, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
    }}>{children}</button>
}

function Field({ label, children }) {
    return <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--txt3)" }}>{label}{children}</label>
}

function ListInput({ value, onChange, placeholder }) {
    const [t, setT] = useState((value || []).join(", "))
    useEffect(() => setT((value || []).join(", ")), [value])
    return <input style={INPUT} value={t} placeholder={placeholder} onChange={(e) => setT(e.target.value)}
        onBlur={() => onChange(t.split(",").map((x) => x.trim()).filter(Boolean))} />
}

function Profile({ profile, setProfile, onSave, onReset, saving }) {
    if (!profile) return <Loading label="loading the profile" />
    const set = (k, v) => setProfile({ ...profile, [k]: v })
    const setVec = (i, k, v) => set("vectors", profile.vectors.map((x, j) => j === i ? { ...x, [k]: v } : x))
    return <>
        <div style={EYE}>Recipient profile{profile.derived ? " · derived, not yet saved" : ""}</div>
        <Field label="Organisation"><input style={INPUT} value={profile.org || ""} onChange={(e) => set("org", e.target.value)} /></Field>
        <Field label="Addressee (role)"><input style={INPUT} value={profile.addressee || ""} placeholder="e.g. Head of Corporate Security" onChange={(e) => set("addressee", e.target.value)} /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <Field label="Contact name"><input style={INPUT} value={profile.contact?.name || ""} onChange={(e) => set("contact", { ...profile.contact, name: e.target.value })} /></Field>
            <Field label="Contact e-mail"><input style={INPUT} value={profile.contact?.email || ""} onChange={(e) => set("contact", { ...profile.contact, email: e.target.value })} /></Field>
        </div>
        <Field label="Sectors"><ListInput value={profile.sectors} onChange={(v) => set("sectors", v)} placeholder="defence, drones, energy" /></Field>
        <Field label="Products"><ListInput value={profile.products} onChange={(v) => set("products", v)} placeholder="what you make or run" /></Field>
        <Field label="Partners and customers"><ListInput value={profile.partners} onChange={(v) => set("partners", v)} placeholder="names, comma separated" /></Field>
        <Field label="Countries watched"><ListInput value={profile.countries} onChange={(v) => set("countries", v)} placeholder="Germany, Ukraine" /></Field>
        <Field label="Notes for the writer"><textarea style={{ ...INPUT, height: 70, padding: 8, resize: "vertical" }} value={profile.notes || ""}
            placeholder="what the issue should keep an eye on" onChange={(e) => set("notes", e.target.value)} /></Field>

        <div style={EYE}>Sites — from the asset register</div>
        {(profile.sites || []).length === 0
            ? <div style={{ fontSize: 13, color: "var(--txt3)" }}>No assets registered. Add them under Assets; each one becomes a site the issue reports on.</div>
            : profile.sites.map((s) => <div key={s.id} style={{ fontSize: 13, display: "flex", gap: 8 }}>
                <b style={{ fontWeight: 600 }}>{s.name}</b><span style={{ color: "var(--txt3)" }}>{s.kind.replace(/_/g, " ")} · {s.address || s.country || `${s.lat?.toFixed?.(2)}, ${s.lon?.toFixed?.(2)}`}{s.moves ? " · tracked" : ""}</span></div>)}

        <div style={EYE}>Exposure vectors</div>
        {(profile.vectors || []).map((v, i) => <div key={v.key || i} style={{ border: "1px solid var(--gline)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "var(--txt4)" }}>{v.id}</span>
                <input style={{ ...INPUT, flex: 1 }} value={v.name} onChange={(e) => setVec(i, "name", e.target.value)} />
                <button onClick={() => set("vectors", profile.vectors.filter((_, j) => j !== i))} title="Remove"
                    style={{ border: 0, background: "transparent", color: "var(--txt3)", cursor: "pointer", font: "inherit" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{CATEGORIES.map(([k, lab]) => {
                const on = (v.categories || []).includes(k)
                return <button key={k} onClick={() => setVec(i, "categories", on ? v.categories.filter((c) => c !== k) : [...(v.categories || []), k])} style={{
                    height: 22, padding: "0 8px", fontSize: 11.5, borderRadius: 0, cursor: "pointer", font: "inherit",
                    border: "1px solid var(--gline2)", background: on ? "var(--accdim)" : "transparent", color: on ? "var(--txt)" : "var(--txt3)",
                }}>{lab}</button>
            })}</div>
            <ListInput value={v.keywords} onChange={(x) => setVec(i, "keywords", x)} placeholder="keywords that pull a story in" />
            <input style={INPUT} value={v.decision_area || ""} placeholder="decision it touches (e.g. travel rules, site protection)" onChange={(e) => setVec(i, "decision_area", e.target.value)} />
        </div>)}
        <div style={{ display: "flex", gap: 8 }}>
            <Btn onClick={() => set("vectors", [...(profile.vectors || []), { name: "New vector", categories: ["unrest", "sabotage", "kinetic"], keywords: [], countries: [], sites: [], origin: "user" }])}>Add vector</Btn>
            <div style={{ flex: 1 }} />
            <Btn onClick={onReset}>Reset</Btn>
            <Btn primary onClick={onSave} disabled={saving}>{saving ? "Saving…" : "Save profile"}</Btn>
        </div>
    </>
}

function Stepper({ run }) {
    const at = STAGES.indexOf(run.stage)
    return <div style={{ display: "flex", gap: 3, margin: "6px 0" }}>{STAGES.slice(0, -1).map((s, i) => <div key={s} style={{ flex: 1 }}>
        <div style={{ height: 3, background: run.status === "failed" && i === at ? "#8b3a2f" : i < at || run.status === "done" ? "var(--acc)" : i === at ? "var(--acchi)" : "var(--gline)" }} />
        <div style={{ fontSize: 10, color: i === at && run.status === "running" ? "var(--txt)" : "var(--txt4)", marginTop: 3 }}>{s}</div>
    </div>)}</div>
}

function download(url, name) {
    fetch(url, { credentials: "include" }).then((r) => { if (!r.ok) throw new Error(`${r.status}`); return r.blob() }).then((b) => {
        const u = URL.createObjectURL(b)
        const a = document.createElement("a"); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove()
        setTimeout(() => URL.revokeObjectURL(u), 2000)
    }).catch((e) => window.alert(`download failed: ${e.message}`))   // eslint-disable-line no-alert
}

export default function IssueStudio() {
    const [profile, setProfile] = useState(null)
    const [saving, setSaving] = useState(false)
    const [cadence, setCadence] = useState("weekly")
    const [lang, setLang] = useState("de")
    const [rehearse, setRehearse] = useState(false)
    const [est, setEst] = useState(null)
    const [runs, setRuns] = useState([])
    const [err, setErr] = useState(null)
    const [open, setOpen] = useState(null)

    useEffect(() => { get(`${API}/profile`).then((p) => { setProfile(p); if (p.language) setLang(p.language); if (p.cadence) setCadence(p.cadence) }).catch((e) => setErr(e.message)) }, [])
    useEffect(() => { setEst(null); get(`${API}/estimate?cadence=${cadence}`).then(setEst).catch(() => {}) }, [cadence])
    const loadRuns = useCallback(() => get(`${API}/runs`).then(setRuns).catch(() => {}), [])
    useEffect(() => { loadRuns() }, [loadRuns])
    const active = runs.some((r) => r.status === "queued" || r.status === "running")
    useEffect(() => {
        if (!active) return undefined
        const t = setInterval(loadRuns, 4000)
        return () => clearInterval(t)
    }, [active, loadRuns])

    const save = () => { setSaving(true); send(`${API}/profile`, "PUT", { ...profile, language: lang, cadence }).then(setProfile).catch((e) => setErr(e.message)).finally(() => setSaving(false)) }
    const reset = () => send(`${API}/profile/reset`, "POST").then(setProfile).catch((e) => setErr(e.message))
    const start = () => { setErr(null); send(`${API}/runs`, "POST", { cadence, language: lang, rehearse }).then(() => loadRuns()).catch((e) => setErr(e.message)) }

    if (open) return <IssueReader runId={open} onClose={() => setOpen(null)} />
    const empty = profile && !(profile.sites || []).length && !(profile.countries || []).length

    return <div style={{ display: "grid", gridTemplateColumns: "minmax(300px, 380px) minmax(280px, 340px) 1fr", height: "100%", minHeight: 0 }}>
        <div style={{ ...COL, borderRight: "1px solid var(--gline)" }}>
            <Profile profile={profile} setProfile={setProfile} onSave={save} onReset={reset} saving={saving} />
        </div>
        <div style={{ ...COL, borderRight: "1px solid var(--gline)" }}>
            <div style={EYE}>Write a situation report</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{CADENCES.map(([k, lab, pages]) => <button key={k} onClick={() => setCadence(k)} style={{
                display: "flex", alignItems: "center", height: 36, padding: "0 10px", borderRadius: 0, cursor: "pointer", font: "inherit",
                border: "1px solid var(--gline2)", background: cadence === k ? "var(--accdim)" : "transparent", color: "var(--txt)",
            }}><b style={{ fontWeight: 600 }}>{lab}</b><div style={{ flex: 1 }} /><span style={{ fontSize: 12, color: "var(--txt3)" }}>{pages}</span></button>)}</div>
            <div style={{ display: "flex", gap: 4 }}>{LANGS.map(([k, lab]) => <button key={k} onClick={() => setLang(k)} style={{
                flex: 1, height: 30, borderRadius: 0, cursor: "pointer", font: "inherit", fontSize: 13,
                border: "1px solid var(--gline2)", background: lang === k ? "var(--accdim)" : "transparent", color: "var(--txt)",
            }}>{lab}</button>)}</div>
            {est ? <div style={{ fontSize: 13, color: "var(--txt2)", lineHeight: 1.6 }}>
                <div>Model: <b>{est.model}</b> {est.available ? "" : <span style={{ color: "#c0705f" }}>— not available</span>}</div>
                {!est.available && <div style={{ color: "#c0705f", fontSize: 12.5 }}>{est.reason}. The run will be a rehearsal built from the signals alone.</div>}
                <div>Estimated cost: <b>${est.usd_low.toFixed(2)}–{est.usd_high.toFixed(2)}</b> · cap ${est.cap_usd.toFixed(2)}</div>
                <div style={{ color: "var(--txt3)", fontSize: 12 }}>{Math.round(est.tokens_in / 1000)}k tokens in, {Math.round(est.tokens_out / 1000)}k out, ~{est.searches} web searches. A run that reaches the cap finishes as a rehearsal.</div>
            </div> : <Loading size={14} inline label="estimating" />}
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, color: "var(--txt2)" }}>
                <input type="checkbox" checked={rehearse} onChange={(e) => setRehearse(e.target.checked)} /> Rehearsal only (no model, no cost)</label>
            {empty && <div style={{ fontSize: 12.5, color: "#c0705f" }}>The profile has no sites and no countries — the issue would have nothing to report on.</div>}
            <Btn primary onClick={start} disabled={!profile}>Write the {cadence} report</Btn>
            {err && <div style={{ fontSize: 12.5, color: "#c0705f" }}>{err}</div>}
            <div style={{ fontSize: 12, color: "var(--txt3)", lineHeight: 1.5 }}>
                The run collects every signal of the period that reaches your sites and vectors, researches them on the web, has the
                model write the issue in the fixed structure and prints it. Daily runs take a minute or two; a monthly can take most of an hour.
            </div>
        </div>
        <div style={COL}>
            <div style={EYE}>Reports</div>
            {runs.length === 0 && <div style={{ fontSize: 13, color: "var(--txt3)" }}>None yet.</div>}
            {runs.map((r) => <div key={r.id} style={{ border: "1px solid var(--gline)", padding: "10px 12px" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                    <b style={{ fontWeight: 600 }}>{r.title || `${r.cadence} report`}</b>
                    <span style={{ fontSize: 12, color: "var(--txt3)" }}>{r.language.toUpperCase()} · {String(r.created_at).slice(0, 16).replace("T", " ")}</span>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: r.status === "failed" ? "#c0705f" : "var(--txt3)" }}>
                        {r.status === "done" ? `${r.pages} pages · ${r.mode}` : r.status}{r.ledger?.usd ? ` · $${r.ledger.usd.toFixed(2)}` : ""}</span>
                </div>
                {(r.status === "running" || r.status === "queued") && <><Stepper run={r} />
                    {r.progress && <div style={{ fontSize: 12, color: "var(--txt3)" }}>{r.progress}</div>}</>}
                {r.status === "failed" && <div style={{ fontSize: 12.5, color: "#c0705f", marginTop: 4 }}>{r.error}</div>}
                {r.status === "done" && r.mode === "rehearsal" && r.reason && <div style={{ fontSize: 12, color: "var(--txt3)", marginTop: 4 }}>Rehearsal: {r.reason}</div>}
                {r.status === "done" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <Btn primary onClick={() => setOpen(r.id)}>Read</Btn>
                    <Btn onClick={() => download(`${API}/runs/${r.id}/pdf`, `${r.title || r.id}.pdf`)}>PDF</Btn>
                    <Btn onClick={() => download(`${API}/runs/${r.id}/deck`, `${r.title || r.id}.pptx`)}>Deck</Btn>
                </div>}
            </div>)}
        </div>
    </div>
}
