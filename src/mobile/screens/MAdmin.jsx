/**
 * MAdmin.jsx — admitting people, on the phone (superadmins only; owner,
 * 2026-10-10). The requests waiting, each with the reason given, Approve or
 * Turn down; then everyone who can sign in, with Revoke. The same calls as
 * the desktop's Admin page (lib/adminApi.js); the server checks the role.
 */
import { useEffect, useState } from "react"
import { listAllUsers, approveUser, deleteUser, revokeUser } from "../../lib/adminApi.js"
import { agoLabel } from "../../utils/formatTime.js"

function Face({ u }) {
    return u.avatar
        ? <img src={u.avatar} alt="" style={{ width: 40, height: 40, borderRadius: 20, objectFit: "cover", flex: "none" }} />
        : <span style={{ width: 40, height: 40, borderRadius: 20, display: "grid", placeItems: "center", background: u.color || "#334", fontWeight: 700, flex: "none" }}>
            {(u.initials || (u.name || u.email || "?").slice(0, 2)).toUpperCase()}
          </span>
}

export default function MAdmin() {
    const [users, setUsers] = useState(null)
    const [busy, setBusy] = useState(null)
    const [msg, setMsg] = useState(null)
    const load = () => listAllUsers().then((d) => setUsers(Array.isArray(d) ? d : d.users || [])).catch((e) => { setUsers([]); setMsg(e.message) })
    useEffect(() => { load() }, [])
    const act = async (id, fn, done) => {
        setBusy(id); setMsg(null)
        try { await fn(); setMsg(done); await load() } catch (e) { setMsg(e.message || "That did not work.") } finally { setBusy(null) }
    }
    const pending = (users || []).filter((u) => !u.approved)
    const roster = (users || []).filter((u) => u.approved)
    return (
        <div className="m2-scroll" data-screen-label="Phone admin">
            {msg && <div className="m2-card" style={{ padding: "10px 14px", marginBottom: 12, fontSize: 13.5 }}>{msg}</div>}
            <div className="m2-h" style={{ marginTop: 2 }}>Waiting to be admitted{pending.length ? ` · ${pending.length}` : ""}</div>
            {users === null ? <div className="m2-empty">Loading…</div>
                : !pending.length ? <div className="m2-card m2-empty">No one is waiting.</div>
                : pending.map((u) => (
                    <div key={u.id} className="m2-card" style={{ padding: 14, marginBottom: 10 }} data-testid="m2-pending">
                        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <Face u={u} />
                            <div style={{ minWidth: 0 }}>
                                <div className="m2-t">{u.name || "No name given"}</div>
                                <div className="m2-sub">{u.email} · asked {agoLabel(u.created_at) || "recently"}</div>
                            </div>
                        </div>
                        <p style={{ margin: "10px 0 12px", fontSize: 14, lineHeight: 1.5, color: u.request_note ? "var(--txt2)" : "var(--txt3)" }}>{u.request_note || "They gave no reason."}</p>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                            <button className="m2-btn" disabled={busy === u.id} onClick={() => act(u.id, () => approveUser(u.id), `${u.name || u.email} can now sign in.`)}>
                                {busy === u.id ? "…" : "Approve"}
                            </button>
                            <button className="m2-btn ghost" disabled={busy === u.id} onClick={() => act(u.id, () => deleteUser(u.id), "Request turned down.")}>Turn down</button>
                        </div>
                    </div>
                ))}
            <div className="m2-h">Can sign in · {roster.length}</div>
            <div className="m2-card">
                {roster.map((u) => (
                    <div key={u.id} className="m2-row" style={{ gridTemplateColumns: "40px minmax(0,1fr) auto", alignItems: "center", cursor: "default" }}>
                        <Face u={u} />
                        <span style={{ minWidth: 0 }}>
                            <span className="m2-t">{u.name || u.email}</span>
                            <span className="m2-sub">{u.is_super_admin ? "Superadmin" : u.capability_role || "Member"}{u.last_seen ? ` · seen ${agoLabel(u.last_seen)}` : ""}</span>
                        </span>
                        {!u.is_super_admin && (
                            <button className="m2-chip" disabled={busy === u.id} onClick={() => act(u.id, () => revokeUser(u.id), `${u.name || u.email} can no longer sign in.`)}>Revoke</button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    )
}
