// Cases.jsx — Workstation module (§7.6). "A case is what turns sixteen
// modules into one job." Real Case/RFI backend (backend/main.py's
// /api/cases*//api/rfis* — Case/RFI in database.py), attached records
// stored only as real reference-grammar strings (src/lib/ref.js) and
// resolved through it, never a second copy of the referenced record's
// data. The full HWcomments primitive with @mention autocomplete lands in
// the collaboration-primitives pass that follows this one — the right
// pane here is a minimal real note list, built to slot the real primitive
// in later without restructuring.
import { useState, useEffect, useCallback } from "react"
import {
    listCases, getCase, createCase, deleteCase, addCaseRef, addCaseNote, advanceCase,
    listUsers, listRfis, createRfi, answerRfi,
} from "../lib/casesApi.js"
import { label, open as openRef } from "../lib/ref.js"
import { can, requireCapability, currentUserId } from "../lib/capabilities.js"
import { toast } from "../ui/toast.js"
import { useInspectorExtensions } from "../inspector/extensionRegistry.js"
import FileExplorer from "../cases/FileExplorer.jsx"
import CaseSharing from "../cases/CaseSharing.jsx"
import { setFilingCase } from "../state/filingCase.js"
import { safeArray } from "../utils/safeArray.js"

const PRIORITY_COLOR = { critical: "var(--sev-critical)", high: "var(--sev-high)", moderate: "var(--sev-moderate)", low: "var(--sev-low)" }
const STAGES = ["draft", "review", "approved", "issued"]
const STAGE_GATE = { approved: "approve", issued: "issue" }  // next-stage -> real capability required to reach it
const LEDGER_KINDS = [
    { kind: "sig", label: "Signals" }, { kind: "ent", label: "Entities" },
    { kind: "scn", label: "Scenes" }, { kind: "aoi", label: "AOIs" },
    { kind: "onto", label: "Onto" },
]

/* A case is a folder of work, and the list should look like one. The
   priority colour rides on the folder itself rather than sitting beside it
   as a second mark competing for the same glance. */
function CaseFolder({ priority }) {
    return (
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, display: "block" }}>
            <path d="M1.5 3.5h4.2l1.3 1.6h7.5v8.4a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
                  fill="none" stroke={PRIORITY_COLOR[priority] || "var(--txt-3)"} strokeWidth="1.3" strokeLinejoin="round" />
        </svg>
    )
}

function PriorityDiamond({ priority }) {
    return <span style={{ display: "inline-block", width: 7, height: 7, flexShrink: 0, background: PRIORITY_COLOR[priority] || "var(--txt-4)", transform: "rotate(45deg)" }} />
}

function RefChip({ refStr }) {
    const [lbl, setLbl] = useState(refStr)
    useEffect(() => { let live = true; label(refStr).then((l) => { if (live) setLbl(l) }); return () => { live = false } }, [refStr])
    return (
        <span
            className="refchip" role="button" tabIndex={0} onClick={() => openRef(refStr)}
            style={{
                display: "inline-flex", alignItems: "center", padding: "2px 8px", marginRight: 6, marginBottom: 6,
                background: "var(--bg-3)", border: "1px solid var(--line)", borderRadius: "var(--r)",
                font: "400 11px var(--font)", color: "var(--acc-hi)", cursor: "pointer",
            }}
        >
            {lbl}
        </span>
    )
}

function userLabel(users, id) {
    const u = users.find((x) => x.id === id)
    return u ? (u.name || u.email) : (id || "—")
}

export default function Cases() {
    // Workstation round, Part 8 — wires this surface into the app's one
    // real UI extension point for the first time (it previously had none
    // at all, confirmed by audit); the real CollabPanel (comments/
    // @mention/assignment/presence) now renders here automatically,
    // alongside this file's own pre-existing plain note list below.
    const inspectorExtensions = useInspectorExtensions()
    const [cases, setCases] = useState([])
    const [users, setUsers] = useState([])
    const [activeCaseId, setActiveCaseId] = useState(null)

    /* OPENING A CASE FROM SOMEWHERE ELSE. A case shared into a chat is a
       link, and a link that does not go anywhere is a worse answer than
       no link — so the chat says which case, and this opens it. An event
       rather than a prop because the sender (a message bubble) is four
       screens away from this list and threading a callback between them
       would tie the two together for one gesture. */
    useEffect(() => {
        const open = (e) => {
            const id = e?.detail?.caseId
            if (id) setActiveCaseId(id)
        }
        window.addEventListener("akili:open-case", open)
        return () => window.removeEventListener("akili:open-case", open)
    }, [])
    const [activeCase, setActiveCase] = useState(null)
    /* FILES FIRST. A case is the folder its signals, pictures and products
       live in — opening on an Overview of counts put the thing you came for
       one click away every time. */
    const [tab, setTab] = useState("files")
    const [rfis, setRfis] = useState([])
    const [newNote, setNewNote] = useState("")
    const [newCaseTitle, setNewCaseTitle] = useState("")
    const [creatingCase, setCreatingCase] = useState(false)
    const [newRfiQuestion, setNewRfiQuestion] = useState("")
    const [newRfiTo, setNewRfiTo] = useState("")
    const [answerDrafts, setAnswerDrafts] = useState({})
    const [newRef, setNewRef] = useState("")

    const refreshList = useCallback(() => { listCases().then((v) => setCases(safeArray(v))).catch(() => {}) }, [])
    useEffect(() => { refreshList(); listUsers().then((v) => setUsers(safeArray(v))).catch(() => {}) }, [refreshList])
    useEffect(() => {
        if (!cases.length) return
        setActiveCaseId((prev) => prev && cases.some((c) => c.case_id === prev) ? prev : cases[0].case_id)
    }, [cases])

    const refreshActive = useCallback(() => {
        if (!activeCaseId) return
        // Opening a case makes it the one new saves file into, so keeping
        // something off the map lands in the case you are working in
        // rather than asking which case every time.
        setFilingCase(activeCaseId)
        getCase(activeCaseId).then(setActiveCase).catch(() => setActiveCase(null))
        listRfis({ case_id: activeCaseId }).then((v) => setRfis(safeArray(v))).catch(() => setRfis([]))
    }, [activeCaseId])
    useEffect(() => { refreshActive() }, [refreshActive])

    async function handleCreateCase() {
        const title = newCaseTitle.trim()
        if (!title) return
        try {
            const created = await createCase({ title, owner_user_id: currentUserId(), priority: "moderate" })
            setNewCaseTitle(""); setCreatingCase(false)
            await refreshList()
            setActiveCaseId(created.case_id)
        } catch (e) { toast(e.message || "Could not create case", { icon: "i-alert" }) }
    }

    async function handleDeleteCase(c) {
        // Everything inside goes with it — documents, uploads, filed
        // signals. Saying how much is about to disappear is the difference
        // between a confirmation and a formality.
        if (!confirm(`Delete "${c.title}" (${c.case_id}) and everything filed in it? This cannot be undone.`)) return
        try {
            await deleteCase(c.case_id)
            if (activeCaseId === c.case_id) { setActiveCaseId(null); setActiveCase(null) }
            await refreshList()
            toast(`Deleted ${c.case_id}`, { icon: "i-check" })
        } catch (e) { toast(e.message || "Could not delete case", { icon: "i-alert" }) }
    }

    async function handleAddNote() {
        const text = newNote.trim()
        if (!text || !activeCaseId) return
        try {
            const updated = await addCaseNote(activeCaseId, text, currentUserId())
            setActiveCase(updated)
            setNewNote("")
        } catch (e) { toast(e.message || "Could not add note", { icon: "i-alert" }) }
    }

    async function handleAdvance() {
        if (!activeCase) return
        const curI = STAGES.indexOf(activeCase.approval_stage)
        const next = STAGES[curI + 1]
        if (!next) return
        const needed = STAGE_GATE[next]
        if (needed && !requireCapability(needed)) return
        try {
            const updated = await advanceCase(activeCase.case_id)
            setActiveCase(updated)
            toast(`Case advanced to ${next}`, { icon: "i-check" })
        } catch (e) { toast(e.message || "Could not advance case", { icon: "i-alert" }) }
    }

    async function handleAddRef() {
        const ref = newRef.trim()
        if (!ref || !activeCaseId) return
        try {
            const updated = await addCaseRef(activeCaseId, ref)
            setActiveCase(updated)
            setNewRef("")
        } catch (e) { toast(e.message || "Could not attach reference", { icon: "i-alert" }) }
    }

    async function handleRaiseRfi() {
        const question = newRfiQuestion.trim()
        if (!question || !newRfiTo || !activeCaseId) return
        try {
            await createRfi({ case_id: activeCaseId, from_user_id: currentUserId(), to_user_id: newRfiTo, question })
            setNewRfiQuestion(""); setNewRfiTo("")
            listRfis({ case_id: activeCaseId }).then((v) => setRfis(safeArray(v)))
            toast("RFI raised", { icon: "i-check" })
        } catch (e) { toast(e.message || "Could not raise RFI", { icon: "i-alert" }) }
    }

    async function handleAnswerRfi(rfiId) {
        const text = (answerDrafts[rfiId] || "").trim()
        if (!text) return
        try {
            await answerRfi(rfiId, text)
            setAnswerDrafts((p) => ({ ...p, [rfiId]: "" }))
            listRfis({ case_id: activeCaseId }).then((v) => setRfis(safeArray(v)))
            toast("RFI answered", { icon: "i-check" })
        } catch (e) { toast(e.message || "Could not answer RFI", { icon: "i-alert" }) }
    }

    const refCounts = LEDGER_KINDS.reduce((acc, { kind }) => ({ ...acc, [kind]: 0 }), {})
    const refsByKind = {}
    for (const ref of activeCase?.refs || []) {
        const kind = ref.split(":")[0]
        if (kind in refCounts) refCounts[kind]++
        ;(refsByKind[kind] ||= []).push(ref)
    }

    // Timeline (§7.6) — every real event this case's own real data actually
    // has: approval-chain transitions, notes, and RFI creation/answers,
    // merged and sorted by real timestamp. No separate activity-log model
    // exists yet, so this is genuinely everything real available, not a
    // truncated version of a richer log.
    const timeline = activeCase ? [
        ...(activeCase.approval_history || []).map((h) => ({ at: h.at, text: `Advanced to ${h.stage} by ${userLabel(users, h.user_id)}` })),
        ...(activeCase.notes || []).map((n) => ({ at: n.created_at, text: `Note by ${userLabel(users, n.author_user_id)}: ${n.text}` })),
        ...rfis.map((r) => ({ at: r.created_at, text: `RFI ${r.rfi_id} raised to ${userLabel(users, r.to_user_id)}: ${r.question}` })),
        ...rfis.flatMap((r) => (r.answers || []).map((a) => ({ at: a.at, text: `RFI ${r.rfi_id} answered by ${userLabel(users, a.user_id)}: ${a.text}` }))),
    ].sort((a, b) => new Date(a.at) - new Date(b.at)) : []

    const uid = currentUserId()

    return (
        <div data-testid="view-root-cases" style={{ display: "grid", gridTemplateColumns: "260px 1fr 280px", height: "100%", overflow: "hidden", background: "transparent" }}>
            {/* Left — case list */}
            <div style={{ borderRight: "1px solid var(--line)", overflowY: "auto", display: "flex", flexDirection: "column" }}>
                <div style={{ padding: 10, borderBottom: "1px solid var(--line)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ font: "600 11px var(--font)", color: "var(--txt-3)" }}>Cases</span>
                    {creatingCase ? (
                        <input
                            autoFocus className="input" placeholder="Case title" value={newCaseTitle}
                            onChange={(e) => setNewCaseTitle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleCreateCase(); if (e.key === "Escape") setCreatingCase(false) }}
                            onBlur={handleCreateCase}
                            style={{ width: 110, font: "400 11px var(--font)" }}
                        />
                    ) : (
                        <button className="btn ghost sm" onClick={() => setCreatingCase(true)}>+ new</button>
                    )}
                </div>
                {cases.map((c) => (
                    <div
                        key={c.case_id} role="button" tabIndex={0} onClick={() => setActiveCaseId(c.case_id)}
                        style={{ padding: "8px 10px", borderBottom: "1px solid var(--line-soft)", cursor: "pointer", background: c.case_id === activeCaseId ? "var(--bg-3)" : "transparent" }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <CaseFolder priority={c.priority} />
                            <span style={{ flex: 1, minWidth: 0, font: "600 12px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title}</span>
                            {c.owner_user_id === uid && (
                                <span
                                    role="button" title="Delete this case"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteCase(c) }}
                                    style={{ color: "var(--txt-4)", flexShrink: 0, font: "400 11px var(--font)", padding: "0 2px" }}
                                >&#10005;</span>
                            )}
                        </div>
                        <div style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)", marginTop: 2 }}>
                            {c.case_id} · {userLabel(users, c.owner_user_id)} · {c.due_at ? c.due_at.slice(0, 10) : "no due date"}
                        </div>
                        <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", textTransform: "uppercase", marginTop: 2 }}>{c.status}</div>
                    </div>
                ))}
                {cases.length === 0 && <div style={{ padding: 14, font: "400 12px var(--font)", color: "var(--txt-3)" }}>No real cases yet.</div>}
            </div>

            {/* Centre — header + 5 tabs */}
            {!activeCase ? (
                <div style={{ padding: 24, color: "var(--txt-3)", font: "400 13px var(--font)" }}>Select a case.</div>
            ) : (
                <div style={{
                    display: "flex", flexDirection: "column", minHeight: 0,
                    overflow: "hidden", padding: "16px 20px",
                }}>
                    <div style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{activeCase.case_id} · opened {activeCase.opened_at?.slice(0, 10)}</div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                        <span style={{ font: "700 10px var(--font)", padding: "1px 6px", borderRadius: "var(--r)", background: "var(--bg-3)", color: PRIORITY_COLOR[activeCase.priority] || "var(--txt-3)", textTransform: "uppercase" }}>{activeCase.priority}</span>
                        <span style={{ font: "700 10px var(--font)", padding: "1px 6px", borderRadius: "var(--r)", background: "var(--bg-3)", color: "var(--txt-2)", textTransform: "uppercase" }}>{activeCase.status}</span>
                    </div>
                    <div style={{ font: "600 19px var(--font)", color: "var(--txt)", marginTop: 8 }}>{activeCase.title}</div>
                    {activeCase.summary && <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)", marginTop: 6 }}>{activeCase.summary}</div>}

                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                        <button className="btn sm" onClick={() => { if (!can("brief")) { requireCapability("brief"); return } toast("Added to briefing basket", { icon: "i-check" }) }}>brief this case</button>
                        <button className="btn sm" onClick={() => setTab("rfis")}>raise RFI</button>
                        <button className="btn sm" onClick={() => setTab("records")}>plot records</button>
                        <button className="btn sm primary" onClick={handleAdvance} disabled={activeCase.approval_stage === "issued"}>
                            advance ({activeCase.approval_stage} → {STAGES[STAGES.indexOf(activeCase.approval_stage) + 1] || "issued"})
                        </button>
                    </div>
                    <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)", marginTop: 6 }}>
                        Owner: {userLabel(users, activeCase.owner_user_id)} · Watchers: {(activeCase.watchers || []).map((w) => userLabel(users, w)).join(", ") || "none"}
                    </div>

                    <div style={{ display: "flex", gap: 4, marginTop: 16, borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                        {["overview", "files", "records", "rfis", "timeline", "briefing", "sharing"].map((t) => (
                            <button
                                key={t} onClick={() => setTab(t)}
                                style={{
                                    padding: "6px 12px", background: "none", border: "none", borderBottom: tab === t ? "2px solid var(--acc-hi)" : "2px solid transparent",
                                    color: tab === t ? "var(--txt)" : "var(--txt-3)", cursor: "pointer", font: "400 12px var(--font)", textTransform: "capitalize",
                                }}
                            >{t}</button>
                        ))}
                    </div>

                    <div style={{ marginTop: 12, flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
                        {/* The case's own contents: folders, subfolders,
                            documents and uploaded evidence.

                            FILLS WHAT IS LEFT. This was
                            height:calc(100vh - 290px) — a guess at the
                            height of the chrome above it, made from the
                            VIEWPORT while sitting inside a column that was
                            already bounded and scrolling. The 290 was
                            right for one window size and wrong for every
                            other, which is what made the panel run past
                            the bottom of its container. */}
                        {tab === "files" && (
                            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                                <FileExplorer
                                    caseId={activeCaseId}
                                    rootLabel={activeCase.title}
                                    onNewCase={() => setCreatingCase(true)}
                                />
                            </div>
                        )}

                        {tab === "sharing" && <CaseSharing caseId={activeCaseId} />}

                        {tab === "overview" && (
                            <div>
                                <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 8 }}>
                                    {LEDGER_KINDS.map(({ kind, label: l }) => (
                                        <div key={kind} style={{ padding: 8, background: "var(--bg-2)", borderRadius: "var(--r)", textAlign: "center" }}>
                                            <div style={{ font: "700 16px var(--mono)", color: "var(--txt)" }}>{refCounts[kind]}</div>
                                            <div style={{ font: "400 10px var(--font)", color: "var(--txt-3)" }}>{l}</div>
                                        </div>
                                    ))}
                                </div>
                                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginTop: 16, marginBottom: 6 }}>Notes</div>
                                {(activeCase.notes || []).map((n) => (
                                    <div key={n.id} style={{ font: "400 12px var(--font)", color: "var(--txt-2)", marginBottom: 6 }}>
                                        <b style={{ color: "var(--txt)" }}>{userLabel(users, n.author_user_id)}</b>: {n.text}
                                    </div>
                                ))}
                                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginTop: 16, marginBottom: 6 }}>Open RFIs</div>
                                {rfis.filter((r) => r.status === "open").map((r) => <div key={r.rfi_id} style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>{r.rfi_id} → {userLabel(users, r.to_user_id)}: {r.question}</div>)}
                                {rfis.filter((r) => r.status === "open").length === 0 && <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No open RFIs.</div>}
                            </div>
                        )}

                        {tab === "records" && (
                            <div>
                                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                                    <input className="input" placeholder="Attach a reference — e.g. sig:ALT-1a2b3c4d" value={newRef} onChange={(e) => setNewRef(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleAddRef() }} style={{ flex: 1 }} />
                                    <button className="btn sm" onClick={handleAddRef}>attach</button>
                                </div>
                                {LEDGER_KINDS.map(({ kind, label: l }) => (
                                    (refsByKind[kind] || []).length > 0 && (
                                        <div key={kind} className="reflist" style={{ marginBottom: 14 }}>
                                            <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 6 }}>{l}</div>
                                            {refsByKind[kind].map((r) => <RefChip key={r} refStr={r} />)}
                                        </div>
                                    )
                                ))}
                                {(activeCase.refs || []).length === 0 && <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No records attached yet.</div>}
                            </div>
                        )}

                        {tab === "rfis" && (
                            <div>
                                <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                                    <select className="input" value={newRfiTo} onChange={(e) => setNewRfiTo(e.target.value)} style={{ width: 140 }}>
                                        <option value="">To…</option>
                                        {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                                    </select>
                                    <input className="input" placeholder="Question" value={newRfiQuestion} onChange={(e) => setNewRfiQuestion(e.target.value)} style={{ flex: 1 }} />
                                    <button className="btn sm" onClick={handleRaiseRfi}>raise RFI</button>
                                </div>
                                {rfis.map((r) => (
                                    <div key={r.rfi_id} style={{ padding: 10, background: "var(--bg-2)", borderRadius: "var(--r)", marginBottom: 8 }}>
                                        <div style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>{r.rfi_id} — {r.question}</div>
                                        <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>From {userLabel(users, r.from_user_id)} to {userLabel(users, r.to_user_id)} · {r.status}</div>
                                        {(r.answers || []).map((a, i) => (
                                            <div key={i} style={{ font: "400 12px var(--font)", color: "var(--txt-2)", marginTop: 4 }}>↳ {userLabel(users, a.user_id)}: {a.text}</div>
                                        ))}
                                        {r.status === "open" && (
                                            uid === r.to_user_id ? (
                                                <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
                                                    <input className="input" placeholder="Your answer" value={answerDrafts[r.rfi_id] || ""} onChange={(e) => setAnswerDrafts((p) => ({ ...p, [r.rfi_id]: e.target.value }))} style={{ flex: 1 }} />
                                                    <button className="btn sm" onClick={() => handleAnswerRfi(r.rfi_id)}>answer</button>
                                                </div>
                                            ) : (
                                                <div style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginTop: 6 }}>Only {userLabel(users, r.to_user_id)} can answer this RFI.</div>
                                            )
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}

                        {tab === "timeline" && (
                            <div>
                                {timeline.map((e, i) => (
                                    <div key={i} style={{ font: "400 12px var(--font)", color: "var(--txt-2)", marginBottom: 6 }}>
                                        <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-4)" }}>{e.at?.slice(0, 16).replace("T", " ")}</span> — {e.text}
                                    </div>
                                ))}
                                {timeline.length === 0 && <div style={{ font: "400 12px var(--font)", color: "var(--txt-4)" }}>No activity yet.</div>}
                            </div>
                        )}

                        {tab === "briefing" && (
                            <div>
                                <div style={{ display: "flex", gap: 4 }}>
                                    {STAGES.map((s, i) => {
                                        const reached = STAGES.indexOf(activeCase.approval_stage) >= i
                                        const stamp = (activeCase.approval_history || []).find((h) => h.stage === s)
                                        return (
                                            <div key={s} style={{ flex: 1, padding: 8, textAlign: "center", background: reached ? "var(--bg-3)" : "var(--bg-2)", borderRadius: "var(--r)", opacity: reached ? 1 : 0.5 }}>
                                                <div style={{ font: "700 11px var(--font)", color: reached ? "var(--txt)" : "var(--txt-4)", textTransform: "uppercase" }}>{s}</div>
                                                {stamp && <div style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>{userLabel(users, stamp.user_id)} · {stamp.at?.slice(0, 16).replace("T", " ")}</div>}
                                            </div>
                                        )
                                    })}
                                </div>
                                <button className="btn sm primary" style={{ marginTop: 12 }} onClick={handleAdvance} disabled={activeCase.approval_stage === "issued"}>advance</button>
                                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginTop: 16, marginBottom: 6 }}>Chain history</div>
                                {(activeCase.approval_history || []).map((h, i) => (
                                    <div key={i} style={{ font: "400 12px var(--font)", color: "var(--txt-2)", marginBottom: 4 }}>{userLabel(users, h.user_id)} advanced to <b>{h.stage}</b> at {h.at?.slice(0, 16).replace("T", " ")}</div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Right — minimal real discussion (the full HWcomments primitive
                with @mention autocomplete lands in the next pass and slots
                in here without restructuring). */}
            <div style={{ borderLeft: "1px solid var(--line)", overflowY: "auto", padding: 12 }}>
                <div style={{ font: "600 11px var(--font)", color: "var(--txt-3)", marginBottom: 8 }}>Discussion</div>
                {activeCase && (activeCase.notes || []).map((n) => (
                    <div key={n.id} style={{ marginBottom: 8 }}>
                        <div style={{ font: "600 11px var(--font)", color: "var(--txt)" }}>{userLabel(users, n.author_user_id)}</div>
                        <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>{n.text}</div>
                        <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{n.created_at?.slice(0, 16).replace("T", " ")}</div>
                    </div>
                ))}
                {activeCase && (
                    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                        <input className="input" placeholder="Add a note…" value={newNote} onChange={(e) => setNewNote(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") handleAddNote() }} style={{ flex: 1 }} />
                        <button className="btn sm" onClick={handleAddNote}>send</button>
                    </div>
                )}
                {activeCase && inspectorExtensions.map((Ext, i) => (
                    <Ext key={i} recordRef={`case:${activeCase.case_id}`} record={activeCase} />
                ))}
            </div>
        </div>
    )
}
