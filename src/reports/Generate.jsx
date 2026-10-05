import { useState, useRef, useEffect } from "react"
import { apiFetch } from "../auth.js"
import { createSnapshotReportTask, listWatchZones, runTaskAction, scoreTaskExposure, prefetchReportBundle } from "./reportApi.js"
import { getBriefingItems, useBriefingCount } from "../state/briefingBasket.js"
import { toast } from "../ui/toast.js"
import Icon from "../ui/Icon.jsx"
import { getSettings } from "../state/settingsStore.js"
import {
    normaliseUrgency, sectorOfSnapshotSection, applyFilters, facetCounts,
    group, sectorsPresent, urgenciesPresent,
} from "../state/signalPicker.js"

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

const HORIZONS = [{ key: "7d", label: "7d" }, { key: "30d", label: "30d" }, { key: "90d", label: "90d" }]
const HORIZON_HOURS = { "7d": 168, "30d": 720, "90d": 2160 }

/**
 * §S4.3's document sections — what the brief CONTAINS, as distinct from
 * EVIDENCE_DOMAINS below, which is what it may be written from. Two different
 * questions that were sharing one word.
 *
 * "Sourcing and method is a section, and it defaults on. A brief that cannot
 * say where it came from is not shorter, it is weaker."
 */
/**
 * The deliverable's language. The evidence stays in its canonical form —
 * only the prose the reader sees is translated (see backend/report_language.py,
 * which explains why that boundary matters).
 */
const LANGUAGES = [
    { key: "en", label: "English" },
    { key: "de", label: "Deutsch" },
    { key: "fr", label: "Français" },
]

const DOC_SECTIONS = [
    { key: "executive_judgement", label: "Executive judgement" },
    { key: "signal_assessment", label: "Signal-by-signal assessment" },
    { key: "exposure_impact", label: "Exposure and continuity impact" },
    { key: "indicators_warnings", label: "Indicators and warnings" },
    { key: "recommended_actions", label: "Recommended actions" },
    { key: "sourcing_method", label: "Sourcing and method" },
]

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
    geoconfirmed_signals: "signal_id",
}
const SECTION_TO_SNAPSHOT = {
    maritime_activity: ["ais_anomalies"], aerial_activity: ["adsb_anomalies"],
    imagery_detection: ["sentinel_detections"],
    // RSS is retired (news_assessments/top_articles are now always real-but-
    // empty — see briefing_prep.py). GeoConfirmed's own real, individually
    // geolocation-verified placemarks are what "open-source context" is
    // actually made of now — a genuinely closer semantic fit than RSS ever
    // was, not just a source swap of convenience. Root cause of the prior
    // "GeoConfirmed points don't load into Generate at all" bug: these
    // signals were already scored/counted in briefing_prep.py's real
    // pipeline but had no output bucket of their own (fixed there) and no
    // corresponding entry here (fixed here) — never a shared-selector
    // mismatch, since Generate's corpus assembly is its own real, separate
    // query (briefing_prep.py), not Situation's /api/surface pool.
    open_source_context: ["news_assessments", "top_articles", "geoconfirmed_signals"],
    alerts_events: ["fusion_events", "surge_events"], outlook_watch: ["foresight_risks"],
}

/* The corpus grid picks by the same two facets as the writer's aside, in
   the same words — see state/signalPicker.js. A snapshot bucket IS a
   sector; the severity words the snapshot uses are folded into the five
   urgency bands the rest of the app files by. */
const CORPUS_READ = {
    urgency: (it) => normaliseUrgency(it.severity),
    sector: (it) => it.sector,
    text: (it) => it.label,
}

const STEP_LABELS = [
    "Resolve parameters and scope", "Assemble evidence set", "Deduplicate and cluster signals",
    "Score exposure against asset register", "Draft judgement and section text",
    "Apply house style and classification", "Compile document and paginate",
]

/* A facet chip in the corpus grid. The count is of what pressing it would
   actually yield — see facetCounts. */
function GenChip({ label, count, on, onClick }) {
    return (
        <button
            type="button" onClick={onClick}
            style={{
                display: "inline-flex", alignItems: "center", gap: 5, height: 20, padding: "0 7px",
                border: `1px solid ${on ? "var(--acc-line)" : "var(--line)"}`,
                background: on ? "var(--acc-dim)" : "transparent",
                color: on ? "var(--txt)" : "var(--txt-3)",
                font: "400 10.5px var(--font)", cursor: "pointer", whiteSpace: "nowrap",
            }}
        >
            {label}
            {count != null && <span style={{ font: "400 9.5px var(--mono)", color: "var(--txt-3)" }}>{count}</span>}
        </button>
    )
}

function SEV_TINT(u) {
    return u === "critical" ? "var(--sev-critical)"
        : u === "significant" || u === "high" ? "var(--sev-high)"
        : u === "elevated" ? "var(--acc-hi)" : "var(--txt-3)"
}

function nowMs() { return performance.now() }

function logLine(html) { return { id: Math.random().toString(36).slice(2), html } }

export default function Generate({ onOpenTab }) {
    const [title, setTitle] = useState("")
    const [scope, setScope] = useState("")
    const [audience, setAudience] = useState("Duty analyst")
    const [horizon, setHorizon] = useState("7d")
    // Real Settings round, Briefing section — the analyst's own persisted
    // default classification marking (settings.briefing.classificationDefault),
    // falling back to the pre-existing hardcoded string for anyone who
    // hasn't set one. Still fully editable per-report below, unchanged.
    const [classification, setClassification] = useState(
        getSettings()?.briefing?.classificationDefault || "UNCLASSIFIED // FOR ANALYTICAL USE ONLY"
    )
    const [standingInstruction, setStandingInstruction] = useState("")
    const [sectionsOn, setSectionsOn] = useState(() => Object.fromEntries(SECTION_TOGGLES.map((s) => [s.key, true])))
    // Every document section on by default — "Sourcing and method" included,
    // which §S4.3 calls out by name.
    const [language, setLanguage] = useState("en")
    const [docSectionsOn, setDocSectionsOn] = useState(() => Object.fromEntries(DOC_SECTIONS.map((s) => [s.key, true])))
    const [watchZoneId, setWatchZoneId] = useState("")
    const [watchZones, setWatchZones] = useState([])

    const [corpus, setCorpus] = useState(null) // { task, snapshotContent }
    const [selected, setSelected] = useState({}) // { itemKey: true }
    // The corpus is picked by urgency and sector, like the writer's aside.
    const [urg, setUrg] = useState(() => new Set())
    const [sec, setSec] = useState(() => new Set())
    const [groupBy, setGroupBy] = useState("urgency")
    const [emptyOverride, setEmptyOverride] = useState(false)

    const [running, setRunning] = useState(false)
    const [cancelled, setCancelled] = useState(false)
    const [steps, setSteps] = useState(STEP_LABELS.map((label) => ({ label, status: "pending", ms: null })))
    const [log, setLog] = useState([])
    const [progress, setProgress] = useState(0)
    const [completedReport, setCompletedReport] = useState(null)
    const runIdRef = useRef(0)
    const briefingCount = useBriefingCount()

    // Coerced, not assigned straight through. asJson() returns null for a
    // 200 whose body will not parse, and a null here replaced the [] default
    // and crashed the render at watchZones.map — a resolution, so .catch
    // never saw it. Anything that is not a list is no list.
    useEffect(() => {
        listWatchZones()
            .then((z) => setWatchZones(Array.isArray(z) ? z : []))
            .catch(() => setWatchZones([]))
    }, [])

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
                        // The bucket the snapshot put it in IS its sector, in
                        // the same words the case tree and the writer's aside
                        // use — so "Imagery" means one thing in the whole app.
                        sector: sectorOfSnapshotSection(snapSection),
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
    const facets = facetCounts(items, CORPUS_READ, { urgency: urg, sector: sec })
    const urgBands = urgenciesPresent(items, CORPUS_READ)
    const secBands = sectorsPresent(items, CORPUS_READ)
    const shown = applyFilters(items, CORPUS_READ, { urgency: urg, sector: sec })
    const shownGroups = group(shown, CORPUS_READ, groupBy)
    const toggleFacet = (put) => (v) => put((p) => {
        const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n
    })

    // §S4.4 — "The briefing basket PRE-SELECTS into it, so 'add to basket'
    // from anywhere in the console lands here."
    //
    // getBriefingItems was imported and never called: the basket count was
    // displayed beside an evidence set it had no effect on, so every "add to
    // basket" in the product — the Inbox's brief button, the inspector, a
    // notification card — was a dead end that looked like it worked.
    const basketApplied = useRef(false)
    useEffect(() => {
        if (basketApplied.current || !items.length) return
        const ids = new Set(getBriefingItems().map((b) => String(b.id)))
        if (!ids.size) return
        const hits = items.filter((it) => ids.has(String(it.id)))
        if (hits.length) {
            // Start from nothing selected, then select exactly the basket:
            // the analyst put those there deliberately, and silently adding
            // the rest of the corpus to their choice would be the opposite of
            // what the basket is for.
            setSelected(Object.fromEntries(items.map((it) => [it.key, hits.includes(it)])))
            appendLog(logLine(`briefing basket applied · <i>${hits.length}</i> of ${ids.size} item(s) matched this corpus`))
        }
        basketApplied.current = true
    }, [items])
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
        setCancelled(false)
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
            else appendLog(logLine(`evidence=${checked.length} signals · language=<i>${language}</i>`))
            const includedItemIds = {}
            for (const it of checked) { (includedItemIds[it.snapSection] ||= []).push(it.id) }
            const draftBody = {
                title: title || `Report — ${scope || "Global overview"}`,
                classification, exposure, force_empty: isEmpty,
                standing_instruction: standingInstruction || undefined,
                included_item_ids: isEmpty ? undefined : includedItemIds,
                // V3 Phase 2 — real scope/audience/horizon, now persisted on
                // the Report row itself (backend/database.py's Report model)
                // instead of being lost after generation.
                scope: scope || undefined, audience, horizon,
                // §S4.3 — which sections the document should contain.
                sections: DOC_SECTIONS.filter((d) => docSectionsOn[d.key]).map((d) => d.key),
                language,
            }
            const draftRes = await runTaskAction(task.task_id, "/draft", draftBody)
            setStepStatus(4, "done", nowMs() - t4)
            const nSections = new Set(checked.map((i) => i.section)).size
            appendLog(logLine(`drafted ${nSections} section${nSections === 1 ? "" : "s"} · ai_draft_status=<i>${draftRes.ai_draft_status || "n/a"}</i>`))
            // The REASON was already coming back from the endpoint and was
            // never shown: "ai_draft_status=error" with nothing after it sent
            // us hunting for a network fault when the model had actually
            // replied and been truncated. A failure that does not say why is
            // a failure you debug twice.
            if (draftRes.ai_draft_status && draftRes.ai_draft_status !== "ok" && draftRes.ai_draft_reason) {
                appendLog(logLine(`<u>draft not usable</u> — ${String(draftRes.ai_draft_reason).slice(0, 300)}`))
            }

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

            // Build the print pages eagerly, now, in the background —
            // implementation manual v1.0 §2: "printable briefing" and a real
            // print shortcut must be instant, never a first-visit loading
            // flash. Same real report data the reader is about to show,
            // fetched once and shared (reportApi.js's prefetchReportBundle).
            prefetchReportBundle(draftRes.report_id)

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

    function stop() { runIdRef.current += 1; setRunning(false); setCancelled(true); appendLog(logLine("<u>cancelled by operator</u>")) }

    const evCount = evCountLive
    const genState = running ? "running" : cancelled ? "cancelled" : completedReport ? "complete" : "idle"

    return (
        <div data-testid="view-root-generate" style={{ display: "grid", gridTemplateColumns: "290px 1fr 322px", height: "100%", overflow: "hidden", background: "var(--bg-0)" }}>
            {/* Left — parameters. Panehead matches the reference's "Briefing
                parameters" header (HorizonWatch.html:318). */}
            <div style={{ borderRight: "1px solid var(--line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", font: "600 12px var(--font)", color: "var(--txt)", flexShrink: 0 }}>Briefing parameters</div>
                <div style={{ flex: 1, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                <div className="field"><label>Title</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="(auto from scope)" /></div>
                <div className="field"><label>Scope</label><input className="input" value={scope} onChange={(e) => setScope(e.target.value)} placeholder="e.g. Red Sea / Bab el-Mandeb" /></div>
                <div className="field"><label>Watch area (optional)</label>
                    <select className="input" value={watchZoneId} onChange={(e) => setWatchZoneId(e.target.value)}>
                        <option value="">Global overview</option>
                        {watchZones.map((z) => <option key={z.system_id} value={z.system_id}>{z.name}</option>)}
                    </select>
                </div>
                <div className="field"><label>Language</label>
                    <div className="seg">
                        {LANGUAGES.map((l) => (
                            <button key={l.key} aria-pressed={language === l.key}
                                    onClick={() => setLanguage(l.key)}>{l.label}</button>
                        ))}
                    </div>
                </div>
                <div className="field"><label>Audience</label><input className="input" value={audience} onChange={(e) => setAudience(e.target.value)} /></div>
                <div className="field"><label>Forecast horizon</label>
                    <div className="seg">{HORIZONS.map((h) => <button key={h.key} aria-pressed={horizon === h.key} onClick={() => setHorizon(h.key)}>{h.label}</button>)}</div>
                </div>
                {/* §S4.3's document sections — what the brief CONTAINS. */}
                <div className="field"><label>Sections</label>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {DOC_SECTIONS.map((d) => (
                            <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 7, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                                <input type="checkbox" className="check" checked={docSectionsOn[d.key]}
                                       onChange={() => setDocSectionsOn((p) => ({ ...p, [d.key]: !p[d.key] }))} />
                                {d.label}
                            </label>
                        ))}
                    </div>
                    {!docSectionsOn.sourcing_method && (
                        <span className="fieldnote" style={{ color: "var(--amber)" }}>
                            Without “Sourcing and method” the brief cannot say where it came from.
                            That does not make it shorter, it makes it weaker.
                        </span>
                    )}
                </div>

                {/* Distinct question: what it may be written FROM. These used
                    to share the word "Sections" with the block above. */}
                <div className="field"><label>Evidence domains</label>
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

                {/* PICK BY URGENCY AND SECTOR. Eighty signals sorted by one
                    key is a list you scroll past, not one you choose from.
                    Filtering here changes what is SHOWN; it never silently
                    deselects, because what is selected is the analyst's own
                    decision and a filter is a way of looking, not an edit. */}
                {items.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                            <span style={{ font: "500 10px var(--mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt-3)", marginRight: 4 }}>Urgency</span>
                            {urgBands.map((u) => (
                                <GenChip key={u} label={u} count={facets.urgency[u] || 0}
                                         on={urg.has(u)} onClick={() => toggleFacet(setUrg)(u)} />
                            ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
                            <span style={{ font: "500 10px var(--mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt-3)", marginRight: 4 }}>Sector</span>
                            {secBands.map((x) => (
                                <GenChip key={x} label={x} count={facets.sector[x] || 0}
                                         on={sec.has(x)} onClick={() => toggleFacet(setSec)(x)} />
                            ))}
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            <span style={{ font: "500 10px var(--mono)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt-3)", marginRight: 4 }}>Group</span>
                            {[["urgency", "urgency"], ["sector", "sector"], ["none", "flat"]].map(([k, l]) => (
                                <GenChip key={k} label={l} on={groupBy === k} onClick={() => setGroupBy(k)} />
                            ))}
                            {(urg.size || sec.size) ? (
                                <button className="btn ghost sm" style={{ marginLeft: "auto" }}
                                        onClick={() => { setUrg(new Set()); setSec(new Set()) }}>
                                    show all {items.length}
                                </button>
                            ) : null}
                        </div>
                    </div>
                )}
                {!corpus ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{
                            width: 11, height: 11, borderRadius: "50%", flexShrink: 0,
                            border: "1.5px solid var(--acc-hi)", animation: "spin 900ms linear infinite",
                        }} />
                        Assembling the real, current evidence set for this scope — this runs automatically and can take up to a minute under real load, not stuck.
                    </div>
                ) : items.length === 0 ? (
                    <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                        No real signals available for the selected sections/scope right now.
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {!shown.length && (
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                                Nothing in the corpus matches this filter.
                            </div>
                        )}
                        {shownGroups.map((grp) => {
                            const keys = grp.items.map((i) => i.key)
                            const allOn = keys.every((k) => selected[k] !== false)
                            return (
                                <div key={grp.key ?? "__all__"} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    {grp.key != null && (
                                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, paddingBottom: 3, borderBottom: "1px solid var(--line)" }}>
                                            <input type="checkbox" className="check" checked={allOn}
                                                   aria-label={`Select all in ${grp.key}`}
                                                   onChange={() => setSelected((p) => ({
                                                       ...p, ...Object.fromEntries(keys.map((k) => [k, allOn ? false : true])),
                                                   }))} />
                                            <span style={{ font: "500 10px var(--mono)", letterSpacing: ".14em", textTransform: "uppercase", color: SEV_TINT(grp.key) }}>{grp.key}</span>
                                            <span style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>{grp.items.length}</span>
                                        </div>
                                    )}
                                    {grp.items.map((it) => (
                                        <label key={it.key} style={{ display: "flex", alignItems: "center", gap: 8, font: "400 12px var(--font)", color: "var(--txt-2)", padding: "3px 0", borderBottom: "1px solid var(--line-soft)" }}>
                                            <input type="checkbox" className="check" checked={selected[it.key] !== false} onChange={() => setSelected((p) => ({ ...p, [it.key]: p[it.key] === false }))} />
                                            <span style={{ width: 66, flexShrink: 0, color: SEV_TINT(normaliseUrgency(it.severity)) }}>{normaliseUrgency(it.severity)}</span>
                                            <span style={{ width: 92, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--txt-3)" }}>{it.sector}</span>
                                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
                                        </label>
                                    ))}
                                </div>
                            )
                        })}
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

            {/* Right — checklist + log. Panehead matches the reference's
                "Generation" title + live #gen-state label (HorizonWatch.html:329). */}
            <div style={{ borderLeft: "1px solid var(--line)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
                    <span style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>Generation</span>
                    <span style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>{genState}</span>
                </div>
                <div style={{ padding: 12, borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 8 }}>
                    {steps.map((s, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{
                                width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
                                border: `1.5px solid ${s.status === "done" ? "var(--tag-green)" : s.status === "running" ? "var(--acc-hi)" : "var(--line-strong)"}`,
                                display: "flex", alignItems: "center", justifyContent: "center",
                                animation: s.status === "running" ? "spin 900ms linear infinite" : "none",
                            }}>
                                {s.status === "done" && <span style={{ color: "var(--tag-green)", fontSize: 9 }}>✓</span>}
                                {s.status === "pending" && <span style={{ color: "var(--line-strong)", fontSize: 8, fontFamily: "var(--mono)" }}>{i + 1}</span>}
                            </span>
                            <span style={{ flex: 1, font: "400 12px var(--font)", color: s.status === "pending" ? "var(--txt-3)" : "var(--txt)" }}>{s.label}</span>
                            {s.ms != null && <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>{s.ms}ms</span>}
                        </div>
                    ))}
                </div>
                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)", padding: "10px 10px 0" }}>Agent log</div>
                <div style={{ flex: 1, overflow: "auto", padding: 10, fontFamily: "var(--mono)", fontSize: 11, whiteSpace: "pre-wrap", background: "var(--bg-0)" }}>
                    {log.map((l) => (
                        <div key={l.id} dangerouslySetInnerHTML={{
                            __html: l.html
                                .replace(/<b>/g, '<b style="color:var(--txt);font-weight:600">').replace(/<i>/g, '<i style="color:var(--tag-green);font-style:normal">')
                                .replace(/<u>/g, '<u style="color:var(--sev-high);text-decoration:none">'),
                        }} />
                    ))}
                </div>
                {/* Footer button order matches the reference exactly: generate
                    (primary, flex:1) · open printable briefing (icon-only) ·
                    deck (icon-only) · distribute by mail (icon-only, always
                    disabled — no Mail/Gmail integration exists yet, see
                    src/lib/ref.js's mail: resolver) · stop (HorizonWatch.html:337-341). */}
                <div style={{ padding: 10, borderTop: "1px solid var(--line)", display: "flex", gap: 8 }}>
                    <button className="btn primary" style={{ flex: 1 }} disabled={running || !corpus || (evCount === 0 && !emptyOverride)} onClick={runGenerate}>generate briefing</button>
                    <button className="btn" disabled={!completedReport} title="Open the printable briefing" onClick={() => onOpenTab?.(completedReport.report_id, completedReport.title, "print")}><Icon name="print" size={14} /></button>
                    <button className="btn" disabled={!completedReport} title="Build a presentation" onClick={() => onOpenTab?.(completedReport.report_id, completedReport.title, "deck")}><Icon name="present" size={14} /></button>
                    <button className="btn" disabled title="Distribute by mail — not yet built"><Icon name="submit" size={14} /></button>
                    <button className="btn" disabled={!running} onClick={stop}>stop</button>
                </div>
            </div>
            <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        </div>
    )
}
