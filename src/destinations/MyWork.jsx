/**
 * MyWork.jsx — PARALLAX v6, ▣ Module instanced as "My work".
 *
 * What is waiting on you: things assigned to you, people who have
 * @mentioned you, questions put to you, and your cases.
 *
 * ONE CALL, NOT FOUR SCREENS' WORTH. Assignments, comments and the
 * activity log are all keyed by `record_ref` and answer one record at a
 * time — correct for a record's own panel and useless for "what is waiting
 * on me". GET /api/my-work was added for this; it returns the counts and
 * the rows together, so the KPI strip and the tables below it cannot
 * disagree.
 *
 * THE SPEC'S FOURTH TAB IS "MAIL", AND THERE IS NO MAIL. No inbox, no
 * SMTP, no Gmail — Reports' own distribute button is disabled for exactly
 * this reason. A Mail tab here would be four blocks of invented threads.
 * What this app genuinely has that is message-shaped and addressed to a
 * person is the @mention: a comment on a record, with an author, a body
 * and a resolved flag. So the tab is Mentions, and it is real.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import ModuleShell from "./ModuleShell.jsx"
import { getCurrentUser } from "../state/authStore.js"

const safeArray = (v) => (Array.isArray(v) ? v : [])

/**
 * THE BACKEND RETURNS NAIVE UTC. `datetime.utcnow().isoformat()` has no
 * offset and no Z, so `Date.parse` reads it as LOCAL time — a record
 * created a second ago showed "2h" on a UTC+2 machine, and would have
 * shown a time in the future west of Greenwich. Anything without an
 * offset is UTC, because that is what the server wrote.
 */
const utc = (iso) => {
    if (!iso) return NaN
    const s = String(iso)
    return Date.parse(/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`)
}

const ago = (iso) => {
    const t = utc(iso)
    if (!Number.isFinite(t)) return "—"
    const m = Math.round((Date.now() - t) / 60000)
    if (m < 1) return "just now"
    if (m < 60) return `${m}m`
    if (m < 1440) return `${Math.round(m / 60)}h`
    return `${Math.round(m / 1440)}d`
}
const due = (iso) => {
    if (!iso) return { v: "—", c: "var(--txt4)" }
    const d = Math.round((utc(iso) - Date.now()) / 86400000)
    if (!Number.isFinite(d)) return { v: "—", c: "var(--txt4)" }
    if (d < 0) return { v: `${-d}d over`, c: "var(--red)" }
    if (d === 0) return { v: "today", c: "var(--amber)" }
    return { v: `${d}d`, c: "var(--txt2)" }
}

/** A reference-grammar string, as something a person can read. */
const refLabel = (ref) => {
    const [kind, id] = String(ref || "").split(":")
    const names = {
        sig: "Signal", ent: "Entity", case: "Case", aoi: "Area",
        brf: "Briefing", rpt: "Report", fus: "Fusion", doc: "Document",
    }
    return `${names[kind] || kind || "Record"} ${id || ""}`.trim()
}

export default function MyWork({ onClose = null, onOpenModule = () => {}, onOpenCase = () => {} }) {
    const [tab, setTab] = useState("queues")
    const [data, setData] = useState(null)
    const [err, setErr] = useState(null)
    const [users, setUsers] = useState([])
    const [team, setTeam] = useState([])
    const [caseIdx, setCaseIdx] = useState(0)
    const me = getCurrentUser()

    const load = useCallback(() => {
        fetch(`${API_BASE}/api/my-work`, { credentials: "include" })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
            .then(setData)
            .catch((e) => setErr(e.message))
    }, [])

    useEffect(() => {
        load()
        const o = { credentials: "include" }
        fetch(`${API_BASE}/api/users`, o).then((r) => (r.ok ? r.json() : []))
            .then((u) => setUsers(safeArray(u))).catch(() => {})
        fetch(`${API_BASE}/api/teams`, o).then((r) => (r.ok ? r.json() : []))
            .then(async (ts) => {
                const list = safeArray(ts)
                if (!list.length) return
                const m = await fetch(`${API_BASE}/api/teams/${list[0].id}/members`, o)
                    .then((r) => (r.ok ? r.json() : [])).catch(() => [])
                setTeam(safeArray(m))
            }).catch(() => {})
    }, [load])

    const nameOf = useMemo(() => {
        const m = new Map(users.map((u) => [u.id, u.name || u.email]))
        return (id) => m.get(id) || (id ? `${String(id).slice(0, 8)}…` : "—")
    }, [users])

    const c = data?.counts || {}
    const cases = safeArray(data?.cases)
    const activeCase = cases[caseIdx] || null

    /* ── blocks per tab ─────────────────────────────────────────────── */
    const blocks = useMemo(() => {
        if (!data) return []

        if (tab === "queues") {
            const assignments = safeArray(data.assignments)
            const rfis = safeArray(data.rfis)
            const overdue = assignments.filter((a) => a.due_at && utc(a.due_at) < Date.now()).length
            return [
                {
                    kind: "kpi", span: 12, key: "kpi",
                    kpis: [
                        { k: "Assigned to me", v: String(c.assignments ?? 0),
                          d: overdue ? `${overdue} past due` : "none past due",
                          c: overdue ? "var(--red)" : "var(--txt)" },
                        { k: "Mentions", v: String(c.mentions ?? 0), d: "unresolved" },
                        { k: "Questions to me", v: String(c.rfis ?? 0), d: "open RFIs" },
                        { k: "Awaiting my review", v: String(c.awaiting_review ?? 0),
                          d: `of ${c.cases ?? 0} cases`,
                          c: (c.awaiting_review ?? 0) > 0 ? "var(--amber)" : "var(--txt)" },
                    ],
                },
                {
                    kind: "table", span: 12, key: "assign",
                    title: "Assigned to me", meta: `${assignments.length}`,
                    head: ["Record", "Assigned by", "Due", "Age"],
                    cols: "2fr 1.2fr .7fr .5fr", minW: "560px",
                    empty: "Nothing is assigned to you. Assignments are made from a record's own panel.",
                    rows: assignments.map((a) => {
                        const d = due(a.due_at)
                        return {
                            key: a.id,
                            cells: [
                                { v: refLabel(a.record_ref) },
                                { v: nameOf(a.assigned_by), c: "var(--txt2)" },
                                { v: d.v, c: d.c, mono: true },
                                { v: ago(a.created_at), c: "var(--txt3)", mono: true },
                            ],
                        }
                    }),
                },
                {
                    kind: "table", span: 12, key: "rfis",
                    title: "Questions put to me", meta: `${rfis.length}`,
                    head: ["ID", "Question", "Case", "Status", "Age"],
                    cols: ".7fr 2.4fr .9fr .8fr .5fr", minW: "620px",
                    empty: "No open questions. An RFI is raised against a case and addressed to a person.",
                    rows: rfis.map((r) => ({
                        key: r.rfi_id,
                        cells: [
                            { v: r.rfi_id, c: "var(--txt3)", mono: true },
                            { v: r.question },
                            { v: r.case_id, c: "var(--txt2)", mono: true },
                            { v: r.status, c: r.status === "open" ? "var(--amber)" : "var(--txt2)" },
                            { v: ago(r.created_at), c: "var(--txt3)", mono: true },
                        ],
                    })),
                },
            ]
        }

        if (tab === "mentions") {
            const mentions = safeArray(data.mentions)
            return [
                {
                    kind: "list", span: 12, key: "mentions",
                    title: "Where you were mentioned", meta: `${mentions.length} unresolved`,
                    empty: "Nobody has @mentioned you. Mentions are made in a comment on a record, "
                        + "and stay here until someone resolves the thread.",
                    items: mentions.map((m) => ({
                        key: m.comment_id,
                        title: m.body,
                        sub: `${nameOf(m.author_user_id)} · ${refLabel(m.record_ref)}`,
                        right: ago(m.created_at),
                    })),
                },
                {
                    kind: "text", span: 12, key: "why",
                    title: "Why this is not a mailbox",
                    paras: [{
                        t: "The spec puts Mail here. This deployment has no mail system — no inbox, no "
                         + "SMTP, no Gmail — which is also why Reports cannot distribute a briefing. "
                         + "What it does have is the @mention: a comment on a record, by a person, that "
                         + "stays open until someone resolves it. That is what this tab shows.",
                        isP: true,
                    }],
                },
            ]
        }

        if (tab === "cases") {
            return [
                {
                    kind: "table", span: 12, key: "cases",
                    title: "Cases", meta: `${cases.length}`,
                    head: ["ID", "Title", "Owner", "Stage", "Priority", "Updated"],
                    cols: ".8fr 2fr 1fr .7fr .7fr .6fr", minW: "640px",
                    empty: "No cases. You see the ones you own and the ones shared with you, nothing else.",
                    rows: cases.map((k, i) => ({
                        key: k.case_id, on: i === caseIdx,
                        // First click selects (so the two blocks below
                        // follow it); clicking the one already selected
                        // opens the workspace.
                        go: () => (i === caseIdx ? onOpenCase(k.case_id) : setCaseIdx(i)),
                        cells: [
                            { v: k.case_id, c: "var(--txt3)", mono: true },
                            { v: k.title },
                            { v: nameOf(k.owner_user_id), c: "var(--txt2)" },
                            { v: k.approval_stage || k.status,
                              c: k.approval_stage === "review" ? "var(--amber)" : "var(--txt2)" },
                            { v: k.priority,
                              c: k.priority === "critical" ? "var(--red)"
                                : k.priority === "high" ? "var(--amber)" : "var(--txt2)" },
                            { v: ago(k.updated_at), c: "var(--txt3)", mono: true },
                        ],
                    })),
                },
                {
                    kind: "list", span: 6, key: "refs",
                    title: activeCase ? `${activeCase.case_id} · linked records` : "Linked records",
                    meta: activeCase ? `${safeArray(activeCase.refs).length}` : "",
                    empty: "Nothing is linked to this case yet.",
                    items: safeArray(activeCase?.refs).map((r, i) => ({
                        key: i,
                        title: refLabel(typeof r === "string" ? r : r.ref),
                        sub: typeof r === "string" ? r : (r.label || r.ref),
                    })),
                },
                {
                    kind: "text", span: 6, key: "note",
                    title: "Latest note",
                    empty: "No notes on this case.",
                    paras: (() => {
                        const notes = safeArray(activeCase?.notes)
                        const last = notes[notes.length - 1]
                        if (!last) return []
                        const body = typeof last === "string" ? last : (last.text || last.body || "")
                        const who = typeof last === "object" ? nameOf(last.user_id) : null
                        const at = typeof last === "object" ? last.at : null
                        return [
                            ...(who || at ? [{ t: [who, at ? ago(at) + " ago" : null].filter(Boolean).join(" · "), isMeta: true }] : []),
                            { t: body, isP: true },
                        ]
                    })(),
                },
            ]
        }

        // Team
        return [
            {
                kind: "table", span: 7, key: "team",
                title: "Roster", meta: `${team.length}`,
                head: ["Name", "Role", "Title", "Timezone"],
                cols: "1.2fr .8fr 1fr .8fr", minW: "480px",
                empty: "No team members. A team is configured by an administrator.",
                rows: team.map((u) => ({
                    key: u.id,
                    cells: [
                        { v: u.name || u.email },
                        { v: u.role || "—", c: "var(--txt2)" },
                        { v: u.title || "—", c: "var(--txt2)" },
                        { v: u.timezone || "UTC", c: "var(--txt3)", mono: true },
                    ],
                })),
            },
            {
                kind: "text", span: 5, key: "activity",
                title: "Activity",
                paras: [{
                    t: "There is no org-wide activity feed to show. The activity log is written per "
                     + "record and queried by reference, so it answers “what happened to this case” "
                     + "and cannot answer “what has the team been doing”. It is on a record's own "
                     + "panel, where it is written.",
                    isP: true,
                }],
            },
        ]
    }, [tab, data, c, cases, activeCase, team, nameOf, caseIdx, onOpenCase])

    const meta = data
        ? `${c.assignments ?? 0} assigned · ${c.mentions ?? 0} mentions · ${c.rfis ?? 0} questions`
        : "reading your queue"

    const TABS = [["Queues", "queues"], ["Mentions", "mentions"],
                  ["Cases", "cases"], ["Team", "team"]]

    return (
        <ModuleShell
            icon="#g-work"
            title="My work"
            label="My work"
            tabs={TABS}
            tab={tab}
            onTab={setTab}
            meta={meta}
            actions={[
                { k: "Refresh", go: load, title: "Re-read the queue" },
                /* Into the case WORKSPACE, not back into this queue. They
                   were sharing a tab type, so this button reopened the
                   screen you were already on. */
                { k: "Open cases", primary: true, title: "Open the case workspace",
                  go: onOpenCase },
            ]}
            onClose={onClose}
            blocks={blocks}
        >
            {err && (
                <div style={{ gridColumn: "span 12", padding: 14, color: "var(--txt3)" }}>
                    Your queue did not load ({err}).
                </div>
            )}
            {!data && !err && (
                <div style={{ gridColumn: "span 12", padding: 14 }}>
                    <Loading size={20} inline label={`Reading ${me?.name ? me.name + "'s" : "your"} queue`} />
                </div>
            )}
        </ModuleShell>
    )
}
