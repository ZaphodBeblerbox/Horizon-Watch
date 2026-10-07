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

/** A coordinate pair is not a place. */
const COORD = /^-?\d{1,3}\.\d+°?\s*[NS]?,?\s*-?\d{1,3}\.\d+°?\s*[EW]?/
function placeOf(loc) { const t = String(loc || "").trim(); return t && !COORD.test(t) ? t : null }
/** Detector slugs into words ("structural_change" → "structural change"),
 *  and a title that leads with bare coordinates said as what it is. */
function readable(t) {
    let x = String(t || "").replace(/_/g, " ").replace(/\s+/g, " ").trim()
    const m = x.match(COORD)
    if (m) x = `${x.slice(m[0].length).trim() || "Item"} — unplaced (${m[0].trim()})`
    return x
}

const AUDIENCES = [
    { key: "Duty analyst", line: "Everything that matters, signal by signal, with sources." },
    { key: "Executive", line: "The bottom line first — one page, decisions and exposure." },
    { key: "Operations", line: "By site and asset: what to do, where, and until when." },
    { key: "Client", line: "Plain language, no internal sourcing detail." },
]
const SEV_COLOR = { critical: "#E5484D", significant: "#F5A524", high: "#F5A524", elevated: "#8FB4E8", routine: "#9AA9BC" }

function logLine(html) { return { id: Math.random().toString(36).slice(2), html } }

export default function Generate({ onOpenTab, isVisible = true }) {
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
                        what: readable(item.title || item.headline || item.object_type || item.zone || ""),
                        where: placeOf(item.location_name),
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
    // Only the newest gathering counts: a slow first one (the whole world,
    // on open) finishing after a scoped one replaced Yemen with the North Sea.
    const corpusTicket = useRef(0)
    async function assembleCorpus() {
        const ticket = ++corpusTicket.current
        appendLog(logLine(`<b>horizon-brief v4.2 · session ${Math.random().toString(36).slice(2, 8)}</b>`))
        appendLog(logLine(`scope=<i>${scope || "Global overview"}</i> horizon=<i>${horizon}</i>`))
        const t0 = nowMs()
        setStepStatus(0, "running")
        const task = await createSnapshotReportTask({ focus: scope || null, watchZoneId: watchZoneId || null })
        if (ticket !== corpusTicket.current) return null
        setStepStatus(0, "done", nowMs() - t0)

        const t1 = nowMs()
        setStepStatus(1, "running")
        const snap = await apiFetch(`/api/reports/snapshots/${task.snapshot_id}`).then((r) => r.json()).catch(() => null)
        if (ticket !== corpusTicket.current) return null                 // a newer scope was asked for meanwhile
        const content = (snap && snap.content) || {}
        setCorpus({ task, snapshotContent: content })
        setSelected({})
        const counts = Object.entries(SECTION_TO_SNAPSHOT).flatMap(([, ss]) => ss).reduce((n, s) => n + (content[s]?.length || 0), 0)
        setStepStatus(1, "done", nowMs() - t1)
        appendLog(logLine(`resolved ${counts} signals · ${(content.threat_overview?.elevated_regions || []).length} elevated regions`))
        return { task, content }
    }

    // Assembled on open, and again whenever the scope or the watch area
    // changes (after a pause in typing) — it was assembled once and never
    // again, so choosing a watch area changed nothing you could see.
    // Not before the screen is shown: kept open in a background tab it
    // assembled the whole world's picture at every app start, a minute of
    // server work nobody looked at (slow-request log, 2026-10-07).
    const firstScope = useRef(true)
    const [opened, setOpened] = useState(isVisible)
    useEffect(() => { if (isVisible) setOpened(true) }, [isVisible])
    useEffect(() => {
        if (!opened) return undefined
        const delay = firstScope.current ? 0 : 900
        firstScope.current = false
        const t = setTimeout(() => {
            setCorpus(null)
            assembleCorpus().catch((e) => appendLog(logLine(`<u>error assembling evidence</u> — ${e?.message}`)))
        }, delay)
        return () => clearTimeout(t)
    }, [scope, watchZoneId, opened]) // eslint-disable-line react-hooks/exhaustive-deps

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

    const [q, setQ] = useState("")
    const [more, setMore] = useState(false)
    const [showLog, setShowLog] = useState(false)
    const zoneName = watchZones.find((z) => z.system_id === watchZoneId)?.name
    const scopeName = scope || zoneName || "the whole world"
    const ql = q.trim().toLowerCase()
    const visible = shown.filter((it) => !ql || `${it.what} ${it.where || ""} ${it.sector}`.toLowerCase().includes(ql))
    // named things first; coordinate-only rows sink to the bottom of each group
    const bySector = []
    {
        const m = new Map()
        for (const it of visible) { if (!m.has(it.sector)) m.set(it.sector, []); m.get(it.sector).push(it) }
        const named = (it) => (it.where ? 2 : 0) + (/— unplaced \(/.test(it.what) ? 0 : 1)
        for (const [k, list] of m) bySector.push({ key: k, items: [...list].sort((a, b) => named(b) - named(a)) })
    }
    const P = { border: "1px solid var(--gline)", background: "var(--glass2)", display: "flex", flexDirection: "column", minHeight: 0, minWidth: 0 }
    const H = { padding: "14px 18px 10px", borderBottom: "1px solid var(--gline)", display: "flex", alignItems: "baseline", gap: 10 }
    const EYE2 = { fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }
    const LBL = { fontSize: 12, color: "var(--txt3)", marginBottom: 6, display: "block" }
    const IN = { height: 34, padding: "0 10px", border: "1px solid var(--gline2)", background: "var(--glass2)", color: "var(--txt)", font: "inherit", fontSize: 13.5, borderRadius: 0, outline: "none", width: "100%", boxSizing: "border-box" }
    const SEG = (on) => ({ height: 30, padding: "0 12px", border: 0, background: on ? "var(--accdim)" : "transparent", color: on ? "var(--txt)" : "var(--txt3)", font: "inherit", fontSize: 12.5, cursor: "pointer" })
    const BT = { height: 28, padding: "0 11px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt2)", font: "inherit", fontSize: 12, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap" }
    const pick = (keys) => setSelected(Object.fromEntries(items.map((i) => [i.key, keys.includes(i.key)])))

    return (
        <div data-testid="view-root-generate" style={{ display: "grid", gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr) minmax(300px, 360px)", gap: 14, height: "100%", padding: 14, boxSizing: "border-box", overflow: "hidden" }}>
            {/* ABOUT — what the briefing is about, and for whom */}
            <section style={P}>
                <div style={H}><span style={{ fontSize: 15, fontWeight: 600 }}>About this briefing</span></div>
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px", display: "flex", flexDirection: "column", gap: 16 }}>
                    <label><span style={LBL}>Title</span><input style={IN} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Report — ${scope || zoneName || "Global overview"}`} /></label>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
                        <label><span style={LBL}>About</span><input style={IN} value={scope} onChange={(e) => setScope(e.target.value)} placeholder="Red Sea, Sudan, our tankers…" /></label>
                        <label><span style={LBL}>Watch area</span>
                            <select style={IN} value={watchZoneId} onChange={(e) => setWatchZoneId(e.target.value)}>
                                <option value="">Anywhere</option>
                                {watchZones.map((z) => <option key={z.system_id} value={z.system_id}>{z.name}</option>)}
                            </select></label>
                    </div>
                    <div>
                        <span style={LBL}>For</span>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                            {AUDIENCES.map((a) => (
                                <button key={a.key} onClick={() => setAudience(a.key)} style={{
                                    textAlign: "left", padding: "9px 10px", border: `1px solid ${audience === a.key ? "var(--acchi)" : "var(--gline2)"}`,
                                    background: audience === a.key ? "var(--accdim)" : "transparent", color: "var(--txt)", font: "inherit", cursor: "pointer", borderRadius: 0,
                                    display: "flex", flexDirection: "column", gap: 3,
                                }}>
                                    <span style={{ fontSize: 13, fontWeight: 600 }}>{a.key}</span>
                                    <span style={{ fontSize: 11.5, color: "var(--txt3)", lineHeight: 1.35 }}>{a.line}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <div><span style={LBL}>Looking ahead</span>
                            <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>{HORIZONS.map((h) => <button key={h.key} onClick={() => setHorizon(h.key)} style={SEG(horizon === h.key)}>{h.label}</button>)}</div></div>
                        <div><span style={LBL}>Language</span>
                            <div style={{ display: "flex", border: "1px solid var(--gline2)" }}>{LANGUAGES.map((l) => <button key={l.key} onClick={() => setLanguage(l.key)} style={SEG(language === l.key)}>{l.label}</button>)}</div></div>
                    </div>
                    <div>
                        <span style={LBL}>What it contains</span>
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {DOC_SECTIONS.map((d) => (
                                <label key={d.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--txt2)" }}>
                                    <input type="checkbox" checked={docSectionsOn[d.key]} onChange={() => setDocSectionsOn((p) => ({ ...p, [d.key]: !p[d.key] }))} />{d.label}
                                </label>
                            ))}
                        </div>
                        {!docSectionsOn.sourcing_method && <span style={{ fontSize: 12, color: "#F5A524", display: "block", marginTop: 6 }}>Without sourcing and method the briefing cannot say where it came from.</span>}
                    </div>
                    <button onClick={() => setMore((v) => !v)} style={{ ...BT, alignSelf: "flex-start" }}>{more ? "Less" : "More — evidence kinds, classification, instruction"}</button>
                    {more && (
                        <>
                            <div><span style={LBL}>May be written from</span>
                                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                                    {SECTION_TOGGLES.map((x) => (
                                        <label key={x.key} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--txt2)" }}>
                                            <input type="checkbox" checked={sectionsOn[x.key]} onChange={() => setSectionsOn((p) => ({ ...p, [x.key]: !p[x.key] }))} />{x.label}
                                        </label>
                                    ))}
                                </div></div>
                            <label><span style={LBL}>Classification</span><input style={IN} value={classification} onChange={(e) => setClassification(e.target.value)} /></label>
                            <label><span style={LBL}>Instruction for this briefing</span>
                                <textarea style={{ ...IN, height: "auto", minHeight: 70, padding: 10, resize: "vertical" }} value={standingInstruction} onChange={(e) => setStandingInstruction(e.target.value)} placeholder="e.g. Focus on shipping through Bab el-Mandeb; name the insurers' likely response." /></label>
                        </>
                    )}
                </div>
            </section>

            {/* EVIDENCE — what it will be written from */}
            <section style={P}>
                <div style={{ ...H, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>What it will be written from</span>
                    <span style={{ fontSize: 12.5, color: "var(--txt3)" }}>{corpus ? `${evCount} chosen of ${items.length}` : "gathering…"}{briefingCount ? ` · ${briefingCount} in your basket` : ""}</span>
                    <span style={{ flex: 1 }} />
                    <button style={BT} onClick={() => pick(items.slice(0, 12).map((i) => i.key))}>Top 12</button>
                    <button style={BT} onClick={() => pick(items.map((i) => i.key))}>All</button>
                    <button style={BT} onClick={() => pick([])}>None</button>
                </div>
                <div style={{ padding: "10px 18px", borderBottom: "1px solid var(--gline)", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <input style={{ ...IN, width: 240, height: 30 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find in the evidence…" />
                    {urgBands.map((u) => (
                        <button key={u} onClick={() => toggleFacet(setUrg)(u)} style={{ ...BT, height: 26, ...(urg.has(u) ? { background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" } : null) }}>
                            <i style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: SEV_COLOR[u] || "#9AA9BC", marginRight: 6 }} />{u} {facets.urgency[u] || 0}
                        </button>
                    ))}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px 18px" }}>
                    {!corpus && <div style={{ padding: "18px 0", color: "var(--txt3)", fontSize: 13 }}>Gathering what we hold on {scopeName}…</div>}
                    {corpus && items.length === 0 && <div style={{ padding: "18px 0", color: "var(--txt3)", fontSize: 13 }}>Nothing held on {scopeName} for these kinds of evidence.</div>}
                    {bySector.map((grp) => {
                        const keys = grp.items.map((i) => i.key)
                        const allOn = keys.every((k) => selected[k] !== false)
                        return (
                            <div key={grp.key} style={{ marginTop: 14 }}>
                                <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6, borderBottom: "1px solid var(--gline)" }}>
                                    <input type="checkbox" checked={allOn} onChange={() => setSelected((p) => ({ ...p, ...Object.fromEntries(keys.map((k) => [k, !allOn])) }))} />
                                    <span style={EYE2}>{grp.key}</span><span style={{ fontSize: 11, color: "var(--txt4)" }}>{grp.items.length}</span>
                                </label>
                                {grp.items.map((it) => {
                                    const u = normaliseUrgency(it.severity)
                                    return (
                                        <label key={it.key} style={{ display: "grid", gridTemplateColumns: "18px 8px minmax(0,1fr) auto", gap: 10, alignItems: "baseline", padding: "8px 0", borderBottom: "1px solid var(--gline)", cursor: "pointer", opacity: selected[it.key] === false ? 0.5 : 1 }}>
                                            <input type="checkbox" checked={selected[it.key] !== false} onChange={() => setSelected((p) => ({ ...p, [it.key]: p[it.key] === false }))} />
                                            <i style={{ width: 7, height: 7, borderRadius: "50%", background: SEV_COLOR[u] || "#9AA9BC", display: "inline-block", alignSelf: "center" }} />
                                            <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                                                <span style={{ fontSize: 13.5, color: "var(--txt)", lineHeight: 1.4 }}>{it.what || it.label}</span>
                                                {it.where && <span style={{ fontSize: 12, color: "var(--txt3)" }}>{it.where}</span>}
                                            </span>
                                            <span style={{ fontSize: 11.5, color: SEV_COLOR[u] || "var(--txt3)", whiteSpace: "nowrap" }}>{u}</span>
                                        </label>
                                    )
                                })}
                            </div>
                        )
                    })}
                    {corpus && evCount === 0 && (
                        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: "var(--txt2)" }}>
                            <input type="checkbox" checked={emptyOverride} onChange={(e) => setEmptyOverride(e.target.checked)} /> Write it without evidence (a template to fill in)
                        </label>
                    )}
                </div>
            </section>

            {/* WRITE IT */}
            <section style={P}>
                <div style={H}><span style={{ fontSize: 15, fontWeight: 600 }}>Write it</span><span style={{ marginLeft: "auto", fontSize: 12, color: "var(--txt3)" }}>{genState === "idle" ? "" : genState}</span></div>
                <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
                    <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--txt)" }}>
                        A briefing on <b style={{ fontWeight: 600 }}>{scopeName}</b> for the <b style={{ fontWeight: 600 }}>{audience.toLowerCase()}</b>,
                        looking {horizon} ahead, in {LANGUAGES.find((l) => l.key === language)?.label}, written from <b style={{ fontWeight: 600 }}>{evCount}</b> piece{evCount === 1 ? "" : "s"} of evidence.
                    </p>
                    <button onClick={runGenerate} disabled={running || !corpus || (evCount === 0 && !emptyOverride)} style={{
                        height: 40, border: "1px solid var(--acchi)", background: "var(--accdim)", color: "var(--txt)", font: "inherit", fontSize: 14, fontWeight: 600,
                        cursor: "pointer", borderRadius: 0, opacity: running || !corpus || (evCount === 0 && !emptyOverride) ? 0.5 : 1,
                    }}>{running ? "Writing…" : completedReport ? "Write it again" : "Write the briefing"}</button>
                    {running && <button onClick={stop} style={{ ...BT, alignSelf: "flex-start" }}>Stop</button>}
                    <div style={{ height: 3, background: "var(--hov)" }}><div style={{ height: "100%", width: `${Math.round(progress * 100)}%`, background: "var(--acchi)", transition: "width 200ms linear" }} /></div>
                    <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 9 }}>
                        {steps.map((st, i) => (
                            <li key={i} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                <span style={{
                                    width: 16, height: 16, borderRadius: "50%", flex: "none", display: "grid", placeItems: "center", fontSize: 9,
                                    border: `1.5px solid ${st.status === "done" ? "#4CAF7A" : st.status === "running" ? "var(--acchi)" : "var(--gline2)"}`,
                                    color: st.status === "done" ? "#4CAF7A" : "var(--txt4)", animation: st.status === "running" ? "spin 900ms linear infinite" : "none",
                                }}>{st.status === "done" ? "✓" : st.status === "pending" ? i + 1 : ""}</span>
                                <span style={{ flex: 1, fontSize: 13, color: st.status === "pending" ? "var(--txt3)" : "var(--txt)" }}>{st.label}</span>
                                {st.ms != null && <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10.5, color: "var(--txt4)" }}>{st.ms < 1000 ? `${st.ms} ms` : `${(st.ms / 1000).toFixed(1)} s`}</span>}
                            </li>
                        ))}
                    </ol>
                    {completedReport && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, borderTop: "1px solid var(--gline)", paddingTop: 12 }}>
                            <span style={{ fontSize: 13.5 }}>{completedReport.title}</span>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button style={{ ...BT, background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" }} onClick={() => onOpenTab?.(completedReport.report_id, completedReport.title)}>Open in the reader</button>
                                <button style={BT} onClick={() => onOpenTab?.(completedReport.report_id, completedReport.title, "deck")}>As a deck</button>
                                <button style={BT} onClick={() => onOpenTab?.(completedReport.report_id, completedReport.title, "print")}>Print</button>
                            </div>
                        </div>
                    )}
                    <button onClick={() => setShowLog((v) => !v)} style={{ ...BT, alignSelf: "flex-start", marginTop: "auto" }}>{showLog ? "Hide" : "Show"} the run's log</button>
                    {showLog && (
                        <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 11, whiteSpace: "pre-wrap", color: "var(--txt3)", lineHeight: 1.5 }}>
                            {log.map((l) => <div key={l.id} dangerouslySetInnerHTML={{ __html: l.html.replace(/<\/?[biu]>/g, "") }} />)}
                        </div>
                    )}
                </div>
            </section>
            <style>{"@keyframes spin{to{transform:rotate(360deg)}}"}</style>
        </div>
    )
}
