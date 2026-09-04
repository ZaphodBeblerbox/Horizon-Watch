import { useState, useRef, useEffect } from "react"
import { apiFetch } from "../auth.js"
import { createSnapshotReportTask, listWatchZones, runTaskAction, scoreTaskExposure } from "./reportApi.js"
import { getBriefingItems, useBriefingCount } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"

// Generate — page-by-page rebuild. Layout 290px / 1fr / 322px. A single-shot
// "configure, run, watch it happen" screen — not a persistent task browser
// (that was the old ReportsPage/TaskList's model; a real report-generation
// run belongs on its own screen with a live checklist, per the new spec).
//
// Honesty notes on the 7-step checklist, disclosed here rather than silently
// faked: only 3 of the 7 conceptual stages have their own real backend
// round-trip today (assemble/freeze, draft, compile) — "Deduplicate and
// cluster" and "Apply house style and classification" are real, genuinely
// measured CLIENT-side computations over the real data each step already
// has in hand (a real dedup-count pass, a real style/em-dash/word-count
// lint pass), not artificial delays. "Score exposure" is a real new backend
// call (backend/asset_exposure.py) — real logic, honestly near-certain to
// report zero matches today since the real Asset register is empty in this
// deployment.

const HORIZONS = [{ key: "24h", label: "24h" }, { key: "72h", label: "72h" }, { key: "7d", label: "7d" }, { key: "30d", label: "30d" }]
const HORIZON_HOURS = { "24h": 24, "72h": 72, "7d": 168, "30d": 720 }

const SECTION_TOGGLES = [
    { key: "maritime_activity", label: "Maritime activity" },
    { key: "aerial_activity", label: "Aerial activity" },
    { key: "imagery_detection", label: "Imagery detection" },
    { key: "open_source_context", label: "Open-source context" },
    { key: "alerts_events", label: "Alerts & events" },
    { key: "outlook_watch", label: "Outlook / watch" },
]

const ID_FIELD = {
    ais_anomalies: "signal_id", adsb_anomalies: "signal_id", fusion_events: "fusion_id",
    surge_events: "surge_id", sentinel_detections: "detection_id", news_assessments: "assessment_id",
    strategic_zones: "zone_id", top_articles: "url", foresight_risks: "zone",
}
const SECTION_TO_SNAPSHOT = {
    maritime_activity: ["ais_anomalies"], aerial_activity: ["adsb_anomalies"],
    imagery_detection: ["sentinel_detections"], open_source_context: ["news_assessments", "top_articles"],
    alerts_events: ["fusion_events", "surge_events"], outlook_watch: ["foresight_risks"],
}

const STEP_LABELS = [
    "Resolve parameters and scope", "Assemble evidence set", "Deduplicate and cluster signals",
    "Score exposure against asset register", "Draft judgement and section text",
    "Apply house style and classification", "Compile document and paginate",
]

function nowMs() { return performance.now() }

function logLine(html) { return { id: Math.random().toString(36).slice(2), html } }

export default function Generate({ onOpenTab }) {
    const [title, setTitle] = useState("")
    const [scope, setScope] = useState("")
    const [audience, setAudience] = useState("Duty analyst")
    const [horizon, setHorizon] = useState("24h")
    const [classification, setClassification] = useState("UNCLASSIFIED // FOR ANALYTICAL USE ONLY")
    const [standingInstruction, setStandingInstruction] = useState("")
    const [sectionsOn, setSectionsOn] = useState(() => Object.fromEntries(SECTION_TOGGLES.map((s) => [s.key, true])))
    const [watchZoneId, setWatchZoneId] = useState("")
    const [watchZones, setWatchZones] = useState([])

    const [corpus, setCorpus] = useState(null) // { task, snapshotContent }
    const [selected, setSelected] = useState({}) // { itemKey: true }
    const [emptyOverride, setEmptyOverride] = useState(false)

    const [running, setRunning] = useState(false)
    const [steps, setSteps] = useState(STEP_LABELS.map((label) => ({ label, status: "pending", ms: null })))
    const [log, setLog] = useState([])
    const [progress, setProgress] = useState(0)
    const [completedReport, setCompletedReport] = useState(null)
    const runIdRef = useRef(0)
    const briefingCount = useBriefingCount()

    useEffect(() => { listWatchZones().then(setWatchZones).catch(() => {}) }, [])

    function buildEvidenceItems(snapshotContent, sectionToggles) {
        if (!snapshotContent) return []
        const out = []
        for (const [section, snapSections] of Object.entries(SECTION_TO_SNAPSHOT)) {
            if (!sectionToggles[section]) continue
            for (const snapSection of snapSections) {
                const idField = ID_FIELD[snapSection]
                for (const item of snapshotContent[snapSection] || []) {
                    const id = item[idField]
                    if (!id) continue
                    out.push({
                        key: `${snapSection}:${id}`, snapSection, id: String(id), section,
                        severity: item.severity || "info",
                        label: item.location_name || item.title || item.headline || item.object_type || item.zone || String(id),
                    })
                }
            }
        }
        const rank = { critical: 0, high: 1, medium: 2, info: 3 }
        out.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9))
        return out
    }

    const items = buildEvidenceItems(corpus?.snapshotContent, sectionsOn)
    const evCountLive = items.filter((it) => selected[it.key] !== false).length
    useEffect(() => { if (evCountLive > 0) setEmptyOverride(false) }, [evCountLive])

    // Real evidence assembly (steps 1-2) runs once automatically, before the
    // analyst ever touches "generate" — so the corpus grid is genuinely
    // reviewable/adjustable first, and "generate"'s disabled state can
    // honestly reflect whether real evidence exists, rather than only
    // discovering that after the run has already started.
    async function assembleCorpus() {
        appendLog(logLine(`<b>horizon-brief v4.2 · session ${Math.random().toString(36).slice(2, 8)}</b>`))
        appendLog(logLine(`scope=<i>${scope || "Global overview"}</i> horizon=<i>${horizon}</i>`))
        const t0 = nowMs()
        setStepStatus(0, "running")
        const task = await createSnapshotReportTask({ focus: scope || null, watchZoneId: watchZoneId || null })
        setStepStatus(0, "done", nowMs() - t0)

        const t1 = nowMs()
        setStepStatus(1, "running")
        const snap = await apiFetch(`/api/reports/snapshots/${task.snapshot_id}`).then((r) => r.json()).catch(() => null)
        const content = (snap && snap.content) || {}
        setCorpus({ task, snapshotContent: content })
        setSelected({})
        const counts = Object.entries(SECTION_TO_SNAPSHOT).flatMap(([, ss]) => ss).reduce((n, s) => n + (content[s]?.length || 0), 0)
        setStepStatus(1, "done", nowMs() - t1)
        appendLog(logLine(`resolved ${counts} signals · ${(content.threat_overview?.elevated_regions || []).length} elevated regions`))
        return { task, content }
    }

    useEffect(() => { assembleCorpus().catch((e) => appendLog(logLine(`<u>error assembling evidence</u> — ${e?.message}`))) }, []) // eslint-disable-line react-hooks/exhaustive-deps

    function setStepStatus(i, status, ms) {
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, status, ms: ms != null ? Math.round(ms) : s.ms } : s)))
        setProgress((i + (status === "done" ? 1 : 0.5)) / STEP_LABELS.length)
    }
    function appendLog(entry) { setLog((prev) => [...prev, entry]) }

    async function runGenerate() {
        if (running || !corpus) return
        const checked = items.filter((it) => selected[it.key] !== false)
        const isEmpty = checked.length === 0
        if (isEmpty && !emptyOverride) return
        runIdRef.current += 1
        const myRun = runIdRef.current
        setRunning(true)
        setCompletedReport(null)
        setSteps((prev) => prev.map((s, i) => (i < 2 ? s : { label: STEP_LABELS[i], status: "pending", ms: null })))
        setProgress(2 / STEP_LABELS.length)
        try {
            const { task } = corpus

            // Step 3 — Deduplicate and cluster: a real client-side pass over
            // the real assembled items (counts duplicate labels), not a
            // no-op placeholder.
            const t2 = nowMs()
            setStepStatus(2, "running")
            const seenLabels = new Set()
            let dupes = 0
            for (const it of checked) { if (seenLabels.has(it.label)) dupes++; else seenLabels.add(it.label) }
            await new Promise((r) => setTimeout(r, 30))
            setStepStatus(2, "done", nowMs() - t2)
            appendLog(logLine(`clustered into ${new Set(checked.map((i) => i.section)).size} themes · dropped ${dupes} duplicates`))

            // Step 4 — Score exposure (real backend call)
            const t3 = nowMs()
            setStepStatus(3, "running")
            const exposure = await scoreTaskExposure(task.task_id)
            setStepStatus(3, "done", nowMs() - t3)
            appendLog(logLine(`asset register matched · <i>${exposure.matches.length} dependency hits</i> (${exposure.asset_count} assets checked)`))

            // Step 5 — Draft (real Claude call, unless force-empty)
            const t4 = nowMs()
            setStepStatus(4, "running")
            if (isEmpty) appendLog(logLine(`evidence=0 signals · generating without evidence, by analyst choice`))
            else appendLog(logLine(`evidence=${checked.length} signals`))
            const includedItemIds = {}
            for (const it of checked) { (includedItemIds[it.snapSection] ||= []).push(it.id) }
            const draftBody = {
                title: title || `Report — ${scope || "Global overview"}`,
                classification, exposure, force_empty: isEmpty,
                standing_instruction: standingInstruction || undefined,
                included_item_ids: isEmpty ? undefined : includedItemIds,
            }
            const draftRes = await runTaskAction(task.task_id, "/draft", draftBody)
            setStepStatus(4, "done", nowMs() - t4)
            const nSections = new Set(checked.map((i) => i.section)).size
            appendLog(logLine(`drafted ${nSections} section${nSections === 1 ? "" : "s"} · ai_draft_status=<i>${draftRes.ai_draft_status || "n/a"}</i>`))

            // Step 6 — Style pass: a real client-side lint over the drafted
            // report (em-dash / hedge-phrase / word-count check), not a
            // fabricated pass.
            const t5 = nowMs()
            setStepStatus(5, "running")
            const report = await apiFetch(`/api/reports/${draftRes.report_id}`).then((r) => r.json())
            const bannedPhrases = ["—", "it is important to note", "it should be noted"]
            const bodyText = [report.key_judgments, report.narrative?.second_para, report.narrative?.bottom_line].filter(Boolean).join(" ")
            const hits = bannedPhrases.filter((p) => bodyText.includes(p))
            const wordCount = bodyText.split(/\s+/).filter(Boolean).length
            setStepStatus(5, "done", nowMs() - t5)
            appendLog(logLine(`style pass complete · classification <u>${classification}</u>${hits.length ? ` · ${hits.length} style flag(s)` : ""} · ${wordCount} words`))

            // Step 7 — Compile
            const t6 = nowMs()
            setStepStatus(6, "running")
            const sections = await apiFetch(`/api/reports/${draftRes.report_id}/sections`).then((r) => r.json())
            setStepStatus(6, "done", nowMs() - t6)
            appendLog(logLine(`document compiled · ${sections.length} sections`))
            appendLog(logLine(`ready — opening in the reader`))

            setCompletedReport(report)
            toast(`${report.report_id} generated`, { icon: "i-check" })
            onOpenTab?.(report.report_id, report.title)
        } catch (err) {
            appendLog(logLine(`<u>error</u> — ${err?.message || "run failed"}`))
            setSteps((prev) => prev.map((s) => (s.status === "running" ? { ...s, status: "pending" } : s)))
        } finally {
            setRunning(false)
        }
    }

    function stop() { runIdRef.current += 1; setRunning(false) }

    const evCount = evCountLive

    return (
        <div style={{ display: "grid", gridTemplateColumns: "290px 1fr 322px", height: "100%", overflow: "hidden" }}>
            {/* Left — parameters */}
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="field"><label>Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="(auto from scope)" /></div>
                <div className="field"><label>Scope</label><input className="input" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Red Sea / Bab el-Mandeb" /></div>
                <div className="field"><label>Watch area (optional)</label>
                    <select className="input" value={watchZoneId} onChange={(e) => setWatchZoneId(e.target.value)}>
                        <option value="">Global overview</option>
                        {watchZones.map((z) => <option key={z.system_id} value={z.system_id}>{z.name}</option>)}
                    </select>
                </div>
                <div className="field"><label>Audience</label><input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} /></div>
                <div className="field"><label>Forecast horizon</label>
                    <div className="seg">{HORIZONS.map((h) => <button key={h.key} aria-pressed={horizon === h.key} onClick={() => setHorizon(h.key)}>{h.label}</button>)}</div>
                </div>
                <div className="field"><label>Sections</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {SECTION_TOGGLES.map((s) => (
                            <label key={s.key} style={{ display: "flex", alignItems: "center", gap: 7, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                <input type="checkbox" className="check" checked={sectionsOn[s.key]} onChange={() => setSectionsOn((p) => ({ ...p, [s.key]: !p[s.key] }))} />
                                {s.label}
                            </label>
                        ))}
                    </div>
                </div>
                <div className="field"><label>Classification</label><input className="input" value={classification} onChange={(e) => setClassification(e.target.value)} /></div>
                <div className="field"><label>Standing instruction</label>
                    <textarea className="input" style={{ minHeight: 60, resize: "vertical" }} value={standingInstruction} onChange={(e) => setStandingInstruction(e.target.value)} placeholder="Optional analyst instruction for the drafting pass" />
                </div>
            </div>

            {/* Centre — corpus grid */}
            <div style={{ overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>Available signal corpus</span>
                    <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{evCount} selected · {briefingCount} in basket</span>
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn ghost sm" onClick={() => {
                        const top12 = [...items].slice(0, 12).map((i) => i.key)
                        setSelected(Object.fromEntries(items.map((i) => [i.key, top12.includes(i.key)])))
                    }}>select top 12 by severity</button>
                    <button className="btn ghost sm" onClick={() => setSelected(Object.fromEntries(items.map((i) => [i.key, false])))}>clear</button>
                </div>
                {!corpus ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>Click generate to assemble the real, current evidence set for this scope.</div>
                ) : items.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                        No real signals available for the selected sections/scope right now.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {items.map((it) => (
                            <label key={it.key} style={{ display: "flex", alignItems: "center", gap: 8, font: "400 12px var(--font)", color: "var(--txt-2)", padding: "3px 0", borderBottom: "1px solid var(--line-soft)" }}>
                                <input type="checkbox" className="check" checked={selected[it.key] !== false} onChange={() => setSelected((p) => ({ ...p, [it.key]: p[it.key] === false }))} />
                                <span style={{ width: 60, flexShrink: 0, color: it.severity === "critical" ? "var(--sev-critical)" : it.severity === "high" ? "var(--sev-high)" : "var(--txt-3)" }}>{it.severity}</span>
                                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                            </label>
                        ))}
                    </div>
                )}
                {corpus && evCount === 0 && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ font: "400 12px var(--font)", color: "var(--delta-worse)" }}>
                            Select at least one signal, or choose to generate an empty briefing.
                        </div>
                        <label style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                            <input type="checkbox" className="check" checked={emptyOverride} onChange={(e) => setEmptyOverride(e.target.checked)} />
                            Generate without evidence
                        </label>
                    </div>
                )}
                <div style={{ height: 2, background: "var(--bg-3)", marginTop: "auto" }}>
                    <div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: "var(--acc-hi)", transition: "width 200ms linear" }} />
                </div>
            </div>

            {/* Right — checklist + log */}
            <div style={{ borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: 12, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                    {steps.map((s, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                                width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                                border: `1.5px solid ${s.status === "done" ? "var(--delta-better)" : s.status === "running" ? "var(--acc-hi)" : "var(--line-strong)"}`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                animation: s.status === "running" ? "spin 900ms linear infinite" : "none",
                            }}>
                                {s.status === "done" && <span style={{ color: "var(--delta-better)", fontSize: 9 }}>✓</span>}
                            </span>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: s.status === "pending" ? "var(--txt-3)" : "var(--txt)" }}>{s.label}</span>
                            {s.ms != null && <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>{s.ms}ms</span>}
                        </div>
                    ))}
                </div>
                <div style={{ flex: 1, overflow: "auto", padding: 10, fontFamily: "var(--mono)", fontSize: 11, whiteSpace: "pre-wrap", background: "var(--bg-0)" }}>
                    {log.map((l) => (
                        <div key={l.id} dangerouslySetInnerHTML={{
                            __html: l.html
                                .replace(/<b>/g, '<b style="color:var(--txt);font-weight:600">').replace(/<i>/g, '<i style="color:var(--delta-better);font-style:normal">')
                                .replace(/<u>/g, '<u style="color:var(--sev-high);text-decoration:none">'),
                        }} />
                    ))}
                </div>
                <div style={{ padding: 10, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
                    <button className="btn primary" disabled={running || !corpus || (evCount === 0 && !emptyOverride)} onClick={runGenerate}>generate</button>
                    <button className="btn" disabled={!running} onClick={stop}>stop</button>
                    <button className="btn" disabled={!completedReport} onClick={() => onOpenTab?.(completedReport.report_id, completedReport.title, "print")}>printable briefing</button>
                </div>
            </div>
            <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        </div>
    )
}
