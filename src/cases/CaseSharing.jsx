/**
 * CaseSharing.jsx — who else can see this case.
 *
 * Sharing is an explicit act, listed explicitly. There is no "the team can
 * see it" state and no role that quietly reads everything: if a person is
 * not on this list, they cannot open the case, its documents, its uploads
 * or its detections. That is the only way "my work is mine unless I share
 * it" is actually true rather than merely intended.
 *
 * Only the owner sees the controls. A sharee who could re-share would make
 * the owner's own list of who can see their work incomplete and wrong.
 */

import { useCallback, useEffect, useState } from "react"
import { listShares, addShare, removeShare, listUsers } from "../lib/casesApi.js"
import { toast } from "../ui/toast.js"
import { currentUserId } from "../lib/capabilities.js"
import { safeArray } from "../utils/safeArray.js"

export default function CaseSharing({ caseId }) {
    const [state, setState] = useState({ owner_user_id: null, shares: [] })
    const [users, setUsers] = useState([])
    const [pick, setPick] = useState("")
    const [canEdit, setCanEdit] = useState(false)
    const [busy, setBusy] = useState(false)

    const refresh = useCallback(() => {
        if (!caseId) return
        listShares(caseId).then(setState).catch(() => {})
    }, [caseId])

    useEffect(() => { refresh(); listUsers().then((v) => setUsers(safeArray(v))).catch(() => setUsers([])) }, [refresh])

    const isOwner = state.owner_user_id && state.owner_user_id === currentUserId()
    const sharedIds = new Set(state.shares.map((s) => s.user_id))
    const candidates = users.filter((u) => u.id !== state.owner_user_id && !sharedIds.has(u.id))

    const add = async () => {
        if (!pick) return
        setBusy(true)
        try {
            await addShare(caseId, pick, canEdit)
            setPick(""); setCanEdit(false); refresh()
            toast("Shared — they have been notified", { icon: "i-check" })
        } catch (e) {
            toast(e.message || "Could not share", { icon: "i-alert" })
        } finally { setBusy(false) }
    }

    const revoke = async (userId, name) => {
        if (!confirm(`Remove ${name}'s access to this case?`)) return
        try { await removeShare(caseId, userId); refresh() }
        catch (e) { toast(e.message || "Could not remove access", { icon: "i-alert" }) }
    }

    return (
        <div style={{ maxWidth: 560 }}>
            <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", lineHeight: 1.65, margin: "0 0 14px" }}>
                Only the people listed here can open this case — its documents, its uploads
                and everything attached to it. Nobody else can, whatever their role.
            </p>

            <Row label="Owner" value={ownerName(users, state.owner_user_id)} note="full access" />

            {state.shares.map((s) => (
                <Row
                    key={s.user_id}
                    label={s.name}
                    value={s.email || s.user_id}
                    note={s.can_edit ? "can edit" : "read only"}
                    onRemove={isOwner ? () => revoke(s.user_id, s.name) : null}
                />
            ))}

            {state.shares.length === 0 && (
                <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "8px 0" }}>
                    Not shared with anyone.
                </p>
            )}

            {isOwner ? (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                    <select value={pick} onChange={(e) => setPick(e.target.value)}
                            style={{ height: 26, minWidth: 210, background: "var(--bg-0)", color: "var(--txt-2)", border: "1px solid var(--line)", font: "400 12px var(--font)", padding: "0 6px" }}>
                        <option value="">Share with…</option>
                        {candidates.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
                    </select>
                    <label style={{ display: "flex", alignItems: "center", gap: 5, font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                        <input type="checkbox" checked={canEdit} onChange={(e) => setCanEdit(e.target.checked)} />
                        can edit
                    </label>
                    <button className="btn sm primary" onClick={add} disabled={!pick || busy}>share</button>
                </div>
            ) : (
                <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", marginTop: 14, lineHeight: 1.6 }}>
                    This case was shared with you. Only its owner can change who else can see it.
                </p>
            )}
        </div>
    )
}

function ownerName(users, id) {
    const u = users.find((x) => x.id === id)
    return u ? (u.name || u.email) : (id || "—")
}

function Row({ label, value, note, onRemove }) {
    return (
        <div style={{
            display: "flex", alignItems: "center", gap: 10, padding: "7px 0",
            borderBottom: "1px solid var(--line)",
        }}>
            <span style={{ font: "600 12px var(--font)", color: "var(--txt)", minWidth: 140 }}>{label}</span>
            <span style={{ flex: 1, font: "400 11px var(--mono)", color: "var(--txt-3)", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
            <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)", textTransform: "uppercase", letterSpacing: ".06em" }}>{note}</span>
            {onRemove && <button className="btn sm" onClick={onRemove}>remove</button>}
        </div>
    )
}
