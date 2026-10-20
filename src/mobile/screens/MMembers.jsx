/**
 * MMembers.jsx — who is in a group, or on the company desk, and changing
 * that (owner, 2026-10-19: "I want to be able to add people to my company
 * desk or remove them" and "edit the members of a message group").
 *
 * One sheet for both, because they are the same question: a list of
 * people, a way to add somebody (search everyone on Parallax), and a way to
 * take somebody out. WHO MAY is the server's decision (routers/chat.py,
 * routers/desk.py); the sheet only hides buttons the server would refuse,
 * and says why when it refuses anyway.
 */
import { useEffect, useState } from "react"
import { chatPeople } from "../../lib/chatApi.js"
import { addablePeople } from "../../notify/inbox.js"
import { Sheet } from "./common.jsx"

function initials(p) {
    if (p?.initials) return p.initials
    const w = String(p?.name || "?").trim().split(/\s+/).filter(Boolean)
    return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || "?").slice(0, 2)).toUpperCase()
}

function Face({ p, size = 40 }) {
    return (
        <span className="mm-face" style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}>
            {p?.avatar ? <img src={p.avatar} alt="" /> : initials(p)}
        </span>
    )
}

const ROW = { display: "grid", gridTemplateColumns: "40px minmax(0, 1fr) auto", gap: 12, alignItems: "center", padding: "8px 0",
              borderBottom: ".5px solid var(--gline2, rgba(255,255,255,.1))" }
const SMALL = { height: 30, padding: "0 12px", fontSize: 13 }

/**
 * members: [{id, name, avatar, note}] · canAdd · canRemove(m) · onAdd(ids) ·
 * onRemove(m) · actions(m) → [[label, fn]] · footer
 */
export default function MMembers({ title, members, canAdd, canRemove, onAdd, onRemove, actions, footer, note, onClose, testid }) {
    const [adding, setAdding] = useState(false)
    const [people, setPeople] = useState(null)
    const [q, setQ] = useState("")
    const [err, setErr] = useState(null)
    const [busy, setBusy] = useState(null)
    useEffect(() => { if (adding && !people) chatPeople().then((d) => setPeople(Array.isArray(d) ? d : [])).catch(() => setPeople([])) }, [adding, people])
    const run = async (key, fn) => {
        setBusy(key); setErr(null)
        try { await fn() } catch (e) { setErr(e?.message || "That did not work") }
        setBusy(null)
    }
    const hits = addablePeople(people || [], (members || []).map((m) => m.id), q)
    return (
        <Sheet onClose={onClose}>
            <div data-testid={testid || "m2-members"}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <div className="m2-eyebrow" style={{ flex: 1 }}>{adding ? "Add people" : `${title} · ${(members || []).length}`}</div>
                    {canAdd && (
                        <button className="m2-btn ghost" style={SMALL} onClick={() => { setAdding(!adding); setQ(""); setErr(null) }}>
                            {adding ? "Done" : "Add people"}</button>
                    )}
                </div>
                {note && !adding && <div className="m2-sub" style={{ marginBottom: 6 }}>{note}</div>}
                {err && <div role="alert" className="m2-sub" style={{ color: "var(--txt)", margin: "6px 0" }}>{err}</div>}
                {adding ? (
                    <>
                        <input className="m2-input" placeholder="Search by name, email or company" value={q}
                               onChange={(e) => setQ(e.target.value)} style={{ width: "100%", boxSizing: "border-box", fontSize: 16, marginBottom: 4 }} />
                        {people === null ? <div className="m2-empty">Loading…</div>
                            : !hits.length ? <div className="m2-empty">{q ? "Nobody matches." : "Everyone is already in."}</div>
                            : hits.slice(0, 60).map((p) => (
                                <div key={p.id} style={ROW}>
                                    <Face p={p} />
                                    <span style={{ minWidth: 0 }}>
                                        <b style={{ display: "block", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{p.name}</b>
                                        <span className="m2-sub">{[p.title, p.company].filter(Boolean).join(" · ") || p.email}</span>
                                    </span>
                                    <button className="m2-btn" style={SMALL} disabled={busy === p.id}
                                            onClick={() => run(p.id, () => onAdd([p.id]))}>Add</button>
                                </div>
                            ))}
                    </>
                ) : (
                    (members || []).map((m) => (
                        <div key={m.id} style={ROW} data-testid="m2-member">
                            <Face p={m} />
                            <span style={{ minWidth: 0 }}>
                                <b style={{ display: "block", fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.name}</b>
                                {m.note && <span className="m2-sub">{m.note}</span>}
                            </span>
                            <span style={{ display: "flex", gap: 6 }}>
                                {(actions?.(m) || []).map(([label, fn]) => (
                                    <button key={label} className="m2-btn ghost" style={SMALL} disabled={busy === m.id} onClick={() => run(m.id, fn)}>{label}</button>
                                ))}
                                {canRemove?.(m) && (
                                    <button className="m2-btn ghost" style={SMALL} disabled={busy === m.id} aria-label={`Remove ${m.name}`}
                                            onClick={() => { if (window.confirm(`Remove ${m.name}?`)) run(m.id, () => onRemove(m)) }}>Remove</button>
                                )}
                            </span>
                        </div>
                    ))
                )}
                {footer && !adding && <div style={{ marginTop: 12 }}>{footer(run)}</div>}
            </div>
        </Sheet>
    )
}
