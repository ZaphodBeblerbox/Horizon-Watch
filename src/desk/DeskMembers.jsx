/**
 * DeskMembers.jsx — who is on the company desk, on the desktop (owner,
 * 2026-10-19: "I want to be able to add people to my company desk or
 * remove them"). The phone has the same list in a sheet
 * (mobile/screens/MDesk.jsx DeskMembersBar → MMembers).
 *
 * Everybody on the desk can see who else is; its owner and admins add and
 * remove. The server decides (routers/desk.py) — this only hides what it
 * would refuse and says why when it refuses anyway.
 */
import { useEffect, useState } from "react"
import { addDeskMembers, listDeskMembers, removeDeskMember } from "../lib/deskApi.js"
import { chatPeople } from "../lib/chatApi.js"
import { addablePeople } from "../notify/inbox.js"
import { Face } from "../chat/PersonCard.jsx"

const EYE = { font: "500 10px var(--font)", letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt-3)" }
const BTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt-2)", font: "400 11.5px var(--font)", cursor: "pointer", borderRadius: 0,
}

function roleNote(m) {
    return [m.owner ? "Owner" : m.manager ? "Admin" : null, m.title].filter(Boolean).join(" · ") || m.email
}

/** The short list in the Desk's right column, with Manage / See all. */
export function DeskMembersSummary() {
    const [d, setD] = useState(null)
    const [open, setOpen] = useState(false)
    useEffect(() => { listDeskMembers().then(setD).catch(() => setD(null)) }, [open])
    if (!d?.company) return null
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="desk-members-summary">
            <div style={{ display: "flex", alignItems: "center" }}>
                <span style={{ ...EYE, flex: 1 }}>{d.company} desk · {d.members.length}</span>
                <button style={{ ...BTN, height: 22 }} data-testid="desk-members-open" onClick={() => setOpen(true)}>
                    {d.can_manage ? "Manage" : "See all"}</button>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {d.members.slice(0, 12).map((m) => <Face key={m.id} person={m} size={24} />)}
            </div>
            {open && <DeskMembersDialog initial={d} onClose={() => setOpen(false)} />}
        </div>
    )
}

export default function DeskMembersDialog({ initial = null, onClose }) {
    const [d, setD] = useState(initial)
    const [adding, setAdding] = useState(false)
    const [people, setPeople] = useState(null)
    const [q, setQ] = useState("")
    const [err, setErr] = useState(null)
    const [busy, setBusy] = useState(null)
    useEffect(() => { if (!initial) listDeskMembers().then(setD).catch((e) => setErr(e.message)) }, [initial])
    useEffect(() => { if (adding && !people) chatPeople().then((x) => setPeople(Array.isArray(x) ? x : [])).catch(() => setPeople([])) }, [adding, people])
    const run = async (key, fn) => {
        setBusy(key); setErr(null)
        try { setD(await fn()) } catch (e) { setErr(e?.message || "That did not work") }
        setBusy(null)
    }
    const members = d?.members || []
    const hits = addablePeople(people || [], members.map((m) => m.id), q)
    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center", background: "rgba(10,14,31,.5)", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} data-testid="desk-members-dialog" role="dialog" aria-label="People on the desk" style={{
                width: 440, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--gline)" }}>
                    <b style={{ flex: 1, font: "600 13px var(--font)", color: "var(--txt)" }}>
                        {adding ? "Add people to the desk" : `${d?.company || "Company"} desk · ${members.length}`}</b>
                    {d?.can_manage && <button style={BTN} data-testid="desk-members-add" onClick={() => { setAdding(!adding); setQ(""); setErr(null) }}>{adding ? "Done" : "Add people"}</button>}
                    <button style={{ ...BTN, border: 0 }} aria-label="Close" onClick={onClose}>✕</button>
                </div>
                <div style={{ padding: "6px 14px 14px", overflow: "auto" }}>
                    <p style={{ font: "400 11.5px/1.5 var(--font)", color: "var(--txt-3)", margin: "6px 0" }}>
                        {d?.can_manage ? "People added see the company's posts at once; people removed stop seeing them at once."
                            : "Only the desk's owner or an admin can add or remove people."}
                    </p>
                    {err && <p role="alert" style={{ font: "500 12px var(--font)", color: "var(--txt)", margin: "6px 0" }}>{err}</p>}
                    {adding && (
                        <input autoFocus placeholder="Search by name, email or company" value={q} onChange={(e) => setQ(e.target.value)}
                               style={{ width: "100%", boxSizing: "border-box", height: 30, padding: "0 8px", background: "var(--glass2)", border: "1px solid var(--gline)",
                                        color: "var(--txt)", font: "400 12.5px var(--font)", outline: "none", borderRadius: 0, marginBottom: 6 }} />
                    )}
                    {(adding ? hits.slice(0, 60) : members).map((m) => (
                        <div key={m.id} data-testid={adding ? "desk-candidate" : "desk-member"} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--gline)" }}>
                            <Face person={m} size={28} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ font: "500 12.5px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {m.name}{m.you ? " (you)" : ""}</div>
                                <div style={{ font: "400 11px var(--font)", color: "var(--txt-3)" }}>
                                    {adding ? ([m.title, m.company].filter(Boolean).join(" · ") || m.email) : roleNote(m)}</div>
                            </div>
                            {adding ? (
                                <button style={BTN} disabled={busy === m.id} onClick={() => run(m.id, () => addDeskMembers([m.id]))}>Add</button>
                            ) : d?.can_manage && !m.you && !m.owner ? (
                                <button style={BTN} disabled={busy === m.id} aria-label={`Remove ${m.name}`}
                                        onClick={() => { if (confirm(`Remove ${m.name} from the ${d.company} desk? They stop seeing its posts at once.`)) run(m.id, () => removeDeskMember(m.id)) }}>Remove</button>
                            ) : null}
                        </div>
                    ))}
                    {adding && people !== null && !hits.length && (
                        <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>{q ? "Nobody matches." : "Everyone is already on the desk."}</p>
                    )}
                </div>
            </div>
        </div>
    )
}
