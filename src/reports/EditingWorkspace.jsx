import { useEffect, useMemo, useRef, useState } from "react"
import SectionHeader from "./SectionHeader.jsx"
import ReportSourcesTab from "./ReportSourcesTab.jsx"
import ReportIndicatorsTab from "./ReportIndicatorsTab.jsx"
import ReportMapTab from "./ReportMapTab.jsx"
import { claimMetaLine } from "./citationLine.js"
import { FILTER_BUCKETS, bucketForKind, matchesFilter, synthesizeFindingId } from "./findingBucket.js"
import { formatTaskRegion } from "./taskDisplay.js"
import { coordsForRegion } from "../data/regionCoords.js"
import { patchReport, submitReportForReview } from "./reportApi.js"
import { Button, Panel } from "../ui/index.js"

const WEIGHTS = ["High", "Medium", "Low"]
const AUTOSAVE_INTERVAL_MS = 8000

/**
 * Per-section "weight" label control. REAL LOCAL-ONLY UI STATE — per the
 * task spec, the backend Report row has no per-section weight field, and
 * nothing else in this codebase persists one. Kept as in-memory React state
 * on EditingWorkspace, scoped per report_id (reset if a different report is
 * opened) — NOT sent in any PATCH body, NOT restored on reload. Documented
 * here and in the commit message rather than silently faked as "saved".
 */
function WeightControl({ value, onChange }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            style={{
                background: "var(--bg-input)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                color: "var(--text-secondary)", fontSize: "var(--text-xs)", padding: "2px 6px", fontFamily: "var(--font-sans)",
            }}
        >
            {WEIGHTS.map((w) => <option key={w} value={w}>{w} weight</option>)}
        </select>
    )
}

/**
 * A single AI Council comment well, rendered full-width directly under the
 * claim it's attached to. `resolved` / `onResolve` are REAL LOCAL-ONLY
 * state (see EditingWorkspace's `resolvedIds` — there is no backend field
 * for this). Resolving is bookkeeping only: it never rewrites claim.text.
 */
function CommentWell({ claimId, finding, resolved, onResolve }) {
    const label = bucketForKind(finding.kind)
    const commentId = synthesizeFindingId(claimId, finding.kind)
    const body = finding.detail || finding.comment ||
        (finding.verdict ? `Verdict: ${finding.verdict}` : finding.passed === false ? "Check failed." : "Check passed.")
    return (
        <div style={{
            background: "var(--ai-comment)", border: "1px solid var(--border-strong)", borderRadius: "var(--radius-md)",
            padding: "var(--space-3)", marginTop: "var(--space-2)", marginBottom: "var(--space-3)", opacity: resolved ? 0.55 : 1,
        }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
                <span style={{ color: "var(--text-primary)", fontSize: "var(--text-callout-title)", fontWeight: "var(--weight-semibold)" }}>
                    AI Council Comment · {label}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "var(--text-callout-meta)", fontFamily: "var(--font-mono)" }}>{commentId}</span>
            </div>
            <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-body)", marginBottom: 6 }}>
                {resolved ? <s>{body}</s> : body}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <span
                    role="button" tabIndex={0}
                    onClick={() => onResolve(commentId)}
                    onKeyDown={(e) => { if (e.key === "Enter") onResolve(commentId) }}
                    style={{ color: "var(--text-link)", fontSize: "var(--text-xs)", cursor: "pointer" }}
                >
                    {resolved ? "Reopen" : "Resolve"}
                </span>
            </div>
        </div>
    )
}

/**
 * A manually-added claim, staged locally until Save Draft/autosave — every
 * real claim needs a real citation (_validate_claims(), main.py), and a
 * brand-new analyst-authored claim has no snapshot item to point at, so it
 * takes a real "external" citation (a genuine, pre-existing citation type —
 * see report_council.py) with a real source URL the analyst supplies,
 * rather than a fake/placeholder citation. Left out of the saved claim list
 * entirely if the analyst leaves either field blank, rather than sending a
 * half-formed claim.
 */
function NewClaimRow({ sectionId, claim, onChange, onRemove, editable }) {
    return (
        <div style={{ marginBottom: "var(--space-3)", border: "1px dashed var(--border-strong)", borderRadius: "var(--radius-sm)", padding: "var(--space-2)" }}>
            <textarea
                value={claim.text}
                disabled={!editable}
                onChange={(e) => onChange(sectionId, claim.tempId, { text: e.target.value })}
                rows={2}
                placeholder="New claim text"
                style={{
                    width: "100%", boxSizing: "border-box", resize: "vertical", background: "var(--bg-input)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
                    fontSize: "var(--text-body)", fontFamily: "var(--font-sans)", padding: "var(--space-2)", lineHeight: "20px",
                }}
            />
            <div style={{ display: "flex", gap: "var(--space-2)", marginTop: 4, alignItems: "center" }}>
                <input
                    type="text"
                    value={claim.url}
                    disabled={!editable}
                    onChange={(e) => onChange(sectionId, claim.tempId, { url: e.target.value })}
                    placeholder="Source URL (required to save this claim)"
                    style={{
                        flex: 1, boxSizing: "border-box", background: "var(--bg-input)", border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)", color: "var(--text-secondary)", fontSize: "var(--text-xs)",
                        fontFamily: "var(--font-mono)", padding: "4px 6px",
                    }}
                />
                {editable && (
                    <span
                        role="button" tabIndex={0}
                        onClick={() => onRemove(sectionId, claim.tempId)}
                        onKeyDown={(e) => { if (e.key === "Enter") onRemove(sectionId, claim.tempId) }}
                        style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", cursor: "pointer", flexShrink: 0 }}
                    >Remove</span>
                )}
            </div>
            {!claim.url.trim() && (
                <div style={{ color: "var(--text-muted)", fontSize: "10px", marginTop: 2 }}>Not saved until a source URL is added.</div>
            )}
        </div>
    )
}

function EditableClaim({ claim, draftText, onTextChange, findings, resolvedIds, onResolve, activeFilter }) {
    const visibleFindings = (findings || []).filter((f) => matchesFilter(f.kind, activeFilter))
    return (
        <div style={{ marginBottom: "var(--space-3)" }}>
            <textarea
                value={draftText}
                onChange={(e) => onTextChange(claim.claim_id, e.target.value)}
                rows={Math.max(2, Math.ceil((draftText || "").length / 70))}
                style={{
                    width: "100%", boxSizing: "border-box", resize: "vertical", background: "var(--bg-input)",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-primary)",
                    fontSize: "var(--text-body)", fontFamily: "var(--font-sans)", padding: "var(--space-2)", lineHeight: "20px",
                }}
            />
            <div style={{ color: "var(--text-secondary)", fontSize: "10px", fontFamily: "var(--font-mono)", marginTop: 2 }}>
                {claimMetaLine(claim)}
            </div>
            {visibleFindings.map((f) => (
                <CommentWell
                    key={synthesizeFindingId(claim.claim_id, f.kind)}
                    claimId={claim.claim_id}
                    finding={f}
                    resolved={resolvedIds.has(synthesizeFindingId(claim.claim_id, f.kind))}
                    onResolve={onResolve}
                />
            ))}
        </div>
    )
}

/**
 * Editing mode — 3 fixed columns (left 220px controls, center flexible
 * editable document, right 320px Original Data Package). Only meaningful
 * while the report is still "draft" (PATCH /api/reports/{id} rejects any
 * other status — see backend/main.py's update_report()); a non-draft report
 * renders read-only inputs with editing disabled rather than silently
 * failing every PATCH.
 *
 * Local-only state, all documented at each declaration below and in the
 * commit message: sectionWeights (no backend field exists), resolvedIds (no
 * backend field exists), activeFilter (UI-only), draftKeyJudgments/
 * draftClaimText (staged edits, flushed to the server by Save Draft / the
 * real autosave interval, not on every keystroke).
 */
export default function EditingWorkspace({ report, sections, task, onReportChange }) {
    const editable = report?.status === "draft"

    const [draftKeyJudgments, setDraftKeyJudgments] = useState(report?.key_judgments || "")
    const [draftClaimText, setDraftClaimText] = useState(() =>
        Object.fromEntries((report?.claims || []).map((c) => [c.claim_id, c.text]))
    )
    // section_id -> array of {tempId, text, url} — manually-added claims
    // staged locally until save (see NewClaimRow docstring for why they need
    // a real source URL). Reset alongside the other draft state below.
    const [newClaimsBySection, setNewClaimsBySection] = useState({})
    const [sectionWeights, setSectionWeights] = useState({}) // section_id -> "High"|"Medium"|"Low", local-only, see WeightControl docstring
    const [resolvedIds, setResolvedIds] = useState(() => new Set()) // commentId -> resolved, local-only, see CommentWell docstring
    const [activeFilter, setActiveFilter] = useState("All")
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [lastSavedAt, setLastSavedAt] = useState(null)
    const [error, setError] = useState("")
    const [submitting, setSubmitting] = useState(false)
    const [rightTab, setRightTab] = useState("summary")

    // Reset local editing state whenever a different report is opened.
    useEffect(() => {
        setDraftKeyJudgments(report?.key_judgments || "")
        setDraftClaimText(Object.fromEntries((report?.claims || []).map((c) => [c.claim_id, c.text])))
        setNewClaimsBySection({})
        setDirty(false)
    }, [report?.report_id]) // eslint-disable-line react-hooks/exhaustive-deps

    // Only a new claim with BOTH real text and a real source URL is actually
    // saveable (_validate_claims(), main.py, requires a non-empty url on an
    // "external" citation) — a half-filled row stays local/pending rather
    // than being sent and rejected.
    const buildPatchBody = () => {
        const savedNewClaims = Object.values(newClaimsBySection).flat()
            .filter((c) => c.text.trim() && c.url.trim())
            .map((c) => ({ text: c.text.trim(), citation: { type: "external", url: c.url.trim() } }))
        return {
            key_judgments: draftKeyJudgments,
            claims: [
                ...(report?.claims || []).map((c) => ({ ...c, text: draftClaimText[c.claim_id] ?? c.text })),
                ...savedNewClaims,
            ],
        }
    }

    const save = async () => {
        if (!editable || saving) return
        setSaving(true); setError("")
        try {
            const updated = await patchReport(report.report_id, buildPatchBody())
            onReportChange?.(updated)
            // The saved report now carries any COMPLETE staged rows as real
            // claims (with real claim_ids) via report.claims on the next
            // render — drop only those so they aren't resubmitted as
            // duplicates, but keep any still-incomplete row (blank text or
            // url) so the analyst doesn't lose in-progress typing.
            setNewClaimsBySection((prev) =>
                Object.fromEntries(
                    Object.entries(prev)
                        .map(([sid, rows]) => [sid, rows.filter((c) => !(c.text.trim() && c.url.trim()))])
                        .filter(([, rows]) => rows.length > 0)
                )
            )
            setDirty(false)
            setLastSavedAt(new Date())
        } catch (e) {
            setError(e.message || "Save failed")
        } finally {
            setSaving(false)
        }
    }

    // Real autosave: fires a real PATCH every 8s, but only while there are
    // actual unsaved local edits (`dirty`) and the report is still editable —
    // not a decorative "autosave on" label. Uses a ref for the latest
    // save/dirty closures so the interval doesn't need to be torn down and
    // rebuilt on every keystroke.
    const saveRef = useRef(save)
    saveRef.current = save
    useEffect(() => {
        if (!editable) return
        const t = setInterval(() => {
            if (dirty) saveRef.current()
        }, AUTOSAVE_INTERVAL_MS)
        return () => clearInterval(t)
    }, [editable, dirty])

    const handleKeyJudgmentsChange = (text) => { setDraftKeyJudgments(text); setDirty(true) }
    const handleClaimTextChange = (claimId, text) => { setDraftClaimText((prev) => ({ ...prev, [claimId]: text })); setDirty(true) }
    const handleResolve = (commentId) => setResolvedIds((prev) => {
        const next = new Set(prev)
        if (next.has(commentId)) next.delete(commentId); else next.add(commentId)
        return next
    })
    const handleWeightChange = (sectionId, weight) => setSectionWeights((prev) => ({ ...prev, [sectionId]: weight }))

    let newClaimSeq = 0
    const handleAddClaim = (sectionId) => {
        newClaimSeq += 1
        const tempId = `new-${sectionId}-${Date.now()}-${newClaimSeq}`
        setNewClaimsBySection((prev) => ({ ...prev, [sectionId]: [...(prev[sectionId] || []), { tempId, text: "", url: "" }] }))
        setDirty(true)
    }
    const handleNewClaimChange = (sectionId, tempId, patch) => {
        setNewClaimsBySection((prev) => ({
            ...prev,
            [sectionId]: (prev[sectionId] || []).map((c) => (c.tempId === tempId ? { ...c, ...patch } : c)),
        }))
        setDirty(true)
    }
    const handleRemoveNewClaim = (sectionId, tempId) => {
        setNewClaimsBySection((prev) => ({ ...prev, [sectionId]: (prev[sectionId] || []).filter((c) => c.tempId !== tempId) }))
        setDirty(true)
    }

    const submitForReview = async () => {
        if (submitting) return
        setSubmitting(true); setError("")
        try {
            if (dirty) await save()
            const updated = await submitReportForReview(report.report_id)
            onReportChange?.(updated)
        } catch (e) {
            setError(e.message || "Submit for review failed")
        } finally {
            setSubmitting(false)
        }
    }

    const coords = useMemo(() => coordsForRegion(task?.region), [task?.task_id])

    return (
        <div style={{ display: "flex", height: "100%", minHeight: 0 }}>
            {/* Left column — controls */}
            <div style={{ flex: "0 0 220px", background: "var(--bg-panel)", borderRight: "1px solid var(--border)", padding: "var(--space-4)", overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
                <div style={{ color: "var(--text-secondary)", fontFamily: "var(--font-mono)", fontSize: "var(--text-callout-meta)" }}>{report?.report_id}</div>
                <Button size="sm" variant="ghost" disabled={!editable || saving} onClick={save} style={{ width: "100%" }}>
                    {saving ? "Saving…" : "Save Draft"}
                </Button>
                <Button size="sm" variant="primary" disabled={!editable || submitting} onClick={submitForReview} style={{ width: "100%" }}>
                    {submitting ? "Submitting…" : "Submit for AI Review"}
                </Button>
                {!editable && (
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                        This report is {report?.status} — only draft reports can be edited.
                    </div>
                )}
                {error && <div style={{ color: "var(--danger)", fontSize: "var(--text-xs)" }}>{error}</div>}
                <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)" }}>
                    {saving ? "Saving…" : lastSavedAt ? `Last saved ${lastSavedAt.toLocaleTimeString()}` : "Not saved yet"}
                    {editable && <> · <span style={{ color: dirty ? "var(--warn)" : "var(--live)" }}>{dirty ? "autosave pending" : "autosave idle"}</span></>}
                </div>

                <div style={{ marginTop: "var(--space-3)", borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>
                        Comments
                    </div>
                    {FILTER_BUCKETS.map((f) => (
                        <div
                            key={f}
                            role="button" tabIndex={0}
                            onClick={() => setActiveFilter(f)}
                            onKeyDown={(e) => { if (e.key === "Enter") setActiveFilter(f) }}
                            style={{
                                padding: "4px 8px", borderRadius: "var(--radius-sm)", cursor: "pointer", marginBottom: 2,
                                background: activeFilter === f ? "color-mix(in srgb, var(--accent-blue) 16%, transparent)" : "transparent",
                                color: activeFilter === f ? "var(--accent-blue)" : "var(--text-secondary)",
                                fontSize: "var(--text-sm)",
                            }}
                        >{f}</div>
                    ))}
                </div>
            </div>

            {/* Center column — editable document */}
            <div style={{ flex: 1, minWidth: 0, background: "var(--bg-app)", overflowY: "auto", padding: "var(--space-5) 28px" }}>
                <div style={{ color: "var(--text-primary)", fontSize: "var(--text-page-title)", fontWeight: "var(--weight-semibold)", marginBottom: "var(--space-2)" }}>
                    {report?.title}
                </div>
                {(sections || []).map((section) => (
                    <div key={section.section_id}>
                        <SectionHeader
                            number={section.number}
                            title={section.title}
                            right={<WeightControl value={sectionWeights[section.section_id] || "Medium"} onChange={(w) => handleWeightChange(section.section_id, w)} />}
                        />
                        {section.section_id === "key_judgments" ? (
                            <textarea
                                value={draftKeyJudgments}
                                disabled={!editable}
                                onChange={(e) => handleKeyJudgmentsChange(e.target.value)}
                                rows={6}
                                placeholder="3-7 high-confidence bullets; most important first"
                                style={{
                                    width: "100%", boxSizing: "border-box", background: "var(--bg-input)", border: "1px solid var(--border)",
                                    borderRadius: "var(--radius-sm)", color: "var(--text-primary)", fontSize: "var(--text-body)",
                                    fontFamily: "var(--font-sans)", padding: "var(--space-2)", lineHeight: "20px",
                                }}
                            />
                        ) : (
                            <>
                                {section.note && <div style={{ color: "var(--text-secondary)", fontSize: "var(--text-xs)", marginBottom: 8, maxWidth: "68ch" }}>{section.note}</div>}
                                {(section.claims || []).length === 0 && !section.note && (
                                    <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No claims in this section.</div>
                                )}
                                {(section.claims || []).map((claim) => (
                                    <EditableClaim
                                        key={claim.claim_id}
                                        claim={claim}
                                        draftText={draftClaimText[claim.claim_id] ?? claim.text}
                                        onTextChange={handleClaimTextChange}
                                        findings={claim.findings}
                                        resolvedIds={resolvedIds}
                                        onResolve={handleResolve}
                                        activeFilter={activeFilter}
                                    />
                                ))}
                                {(newClaimsBySection[section.section_id] || []).map((claim) => (
                                    <NewClaimRow
                                        key={claim.tempId}
                                        sectionId={section.section_id}
                                        claim={claim}
                                        onChange={handleNewClaimChange}
                                        onRemove={handleRemoveNewClaim}
                                        editable={editable}
                                    />
                                ))}
                                {editable && (
                                    <span
                                        role="button" tabIndex={0}
                                        onClick={() => handleAddClaim(section.section_id)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleAddClaim(section.section_id) }}
                                        style={{ color: "var(--text-link)", fontSize: "var(--text-xs)", cursor: "pointer", display: "inline-block", marginTop: 4 }}
                                    >+ Add claim</span>
                                )}
                            </>
                        )}
                    </div>
                ))}
            </div>

            {/* Right column — Original Data Package */}
            <div style={{ flex: "0 0 320px", background: "var(--bg-panel)", borderLeft: "1px solid var(--border)", display: "flex", flexDirection: "column", minHeight: 0 }}>
                <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                    {["summary", "map", "sources", "indicators", "timeline"].map((t) => (
                        <div
                            key={t}
                            role="button" tabIndex={0}
                            onClick={() => setRightTab(t)}
                            onKeyDown={(e) => { if (e.key === "Enter") setRightTab(t) }}
                            style={{
                                flex: 1, textAlign: "center", padding: "8px 4px", cursor: "pointer", fontSize: "var(--text-xs)",
                                textTransform: "capitalize", color: rightTab === t ? "var(--accent-blue)" : "var(--text-secondary)",
                                borderBottom: rightTab === t ? "2px solid var(--accent-blue)" : "2px solid transparent",
                            }}
                        >{t}</div>
                    ))}
                </div>
                <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-3)" }}>
                    {rightTab === "summary" && <SummaryTab task={task} />}
                    {rightTab === "map" && <div style={{ height: 320 }}><ReportMapTab center={[coords.lat, coords.lon]} zoom={coords.zoom} task={task} /></div>}
                    {rightTab === "sources" && <ReportSourcesTab collected={task?.collected} />}
                    {rightTab === "indicators" && <ReportIndicatorsTab collected={task?.collected} />}
                    {rightTab === "timeline" && <TimelineTab collected={task?.collected} />}
                </div>
            </div>
        </div>
    )
}

/**
 * Summary sub-tab — reuses the exact same task fields TaskStatusBar.jsx
 * already displays (focus/region/period), via the same formatTaskRegion()
 * helper, rather than a second implementation of "how do we format a task's
 * region" (the task's own instruction not to duplicate this).
 */
function SummaryTab({ task }) {
    if (!task) return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>No task loaded.</div>
    return (
        <div style={{ fontSize: "var(--text-sm)", color: "var(--text-secondary)", display: "flex", flexDirection: "column", gap: 8 }}>
            <div><span style={{ color: "var(--text-muted)" }}>Focus:</span> {task.focus || "—"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Region:</span> {formatTaskRegion(task)}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Period start:</span> {task.period_start ? new Date(task.period_start).toLocaleString() : "—"}</div>
            <div><span style={{ color: "var(--text-muted)" }}>Period end:</span> {task.period_end ? new Date(task.period_end).toLocaleString() : "open-ended"}</div>
        </div>
    )
}

/**
 * Timeline sub-tab — a simple, real, chronological list built from
 * task.collected. Only fusion_events (created_at) and sentinel_detections
 * (scan_timestamp) carry a real per-item timestamp in the collected payload
 * (see backend/briefing_prep.py); surge_events and news_assessments do not
 * expose one there today (surge_events only has a human-readable
 * time_window description, news_assessments has none at all) — those are
 * listed in an honest "undated" group afterward rather than fabricating a
 * timestamp for them.
 */
function TimelineTab({ collected }) {
    const dated = []
    const undated = []
    for (const f of collected?.fusion_events || []) {
        if (f.created_at) dated.push({ id: f.fusion_id, at: f.created_at, label: f.title || "Fusion event" })
        else undated.push({ id: f.fusion_id, label: f.title || "Fusion event" })
    }
    for (const d of collected?.sentinel_detections || []) {
        if (d.scan_timestamp) dated.push({ id: d.detection_id, at: d.scan_timestamp, label: `${d.object_type || "Detection"} (confidence ${d.confidence ?? "—"})` })
        else undated.push({ id: d.detection_id, label: d.object_type || "Detection" })
    }
    for (const s of collected?.surge_events || []) {
        undated.push({ id: s.surge_id, label: `${s.headline || "Surge event"} (${s.time_window || "time window unknown"})` })
    }
    for (const a of collected?.news_assessments || []) {
        undated.push({ id: a.assessment_id, label: a.headline || "News assessment" })
    }
    dated.sort((a, b) => new Date(b.at) - new Date(a.at))

    if (dated.length === 0 && undated.length === 0) {
        return <div style={{ color: "var(--text-muted)", fontSize: "var(--text-sm)" }}>Nothing collected yet.</div>
    }
    return (
        <div style={{ fontSize: "var(--text-xs)", color: "var(--text-secondary)" }}>
            {dated.map((item) => (
                <div key={item.id} style={{ padding: "6px 0", borderBottom: "1px solid var(--border)" }}>
                    <div style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}>{new Date(item.at).toLocaleString()}</div>
                    <div style={{ color: "var(--text-primary)" }}>{item.label}</div>
                </div>
            ))}
            {undated.length > 0 && (
                <>
                    <div style={{ color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 10, marginBottom: 4, fontSize: "10px" }}>
                        Undated (no real timestamp in the collected payload)
                    </div>
                    {undated.map((item) => (
                        <div key={item.id} style={{ padding: "4px 0", color: "var(--text-primary)" }}>{item.label}</div>
                    ))}
                </>
            )}
        </div>
    )
}
