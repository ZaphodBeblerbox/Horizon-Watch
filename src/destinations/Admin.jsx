/**
 * Admin.jsx — the superadmin console: who is waiting, and who is in.
 *
 * TWO LISTS, IN THIS ORDER. The pending requests are at the top because
 * this screen exists for one recurring job — somebody is waiting to be let
 * in — and a queue sorted alphabetically among forty colleagues is a queue
 * nobody works. Under it, the roster, which is the slower job: roles,
 * capability, and who else can administer this.
 *
 * A DECISION IS MADE AGAINST A REASON, not an address. What the person
 * wrote when they asked is shown on the request, because "approve
 * j.smith@…" is not a decision anybody can actually make.
 *
 * Revoking is not deleting. Turning an account off leaves their cases,
 * documents and uploads exactly where they are; deleting is a second,
 * louder action. Conflating the two is how you end up with nobody willing
 * to do the first one.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
    listAllUsers, approveUser, revokeUser, deleteUser, updateUser,
} from "../lib/adminApi.js"
import { ACCESS_ROLES, ACCESS_ROLE_IDS } from "../lib/capabilities.js"
import { getCurrentUser } from "../state/authStore.js"
import { toast } from "../ui/toast.js"
import Loading from "../ui/Loading.jsx"
import Avatar from "../ui/Avatar.jsx"
import { MODE_SURFACE, MODE_BODY } from "../plx6/modeWindow.js"

const EYE = {
    font: "500 10px var(--mono)", letterSpacing: ".14em",
    textTransform: "uppercase", color: "var(--txt-3)",
}
const ROLES = ["observer", "analyst", "admin"]

const BTN = {
    height: 24, padding: "0 10px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt-2)",
    font: "400 11.5px var(--font)", cursor: "pointer", borderRadius: 0,
}
const PRIMARY = {
    ...BTN, border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
    color: "var(--txt)", fontWeight: 600,
}
const DANGER = { ...BTN, color: "var(--red)", borderColor: "rgba(196,69,60,.45)" }

function ago(iso) {
    if (!iso) return "never"
    const d = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`)
    if (Number.isNaN(+d)) return "never"
    const s = Math.max(0, (Date.now() - d) / 1000)
    if (s < 90) return "just now"
    if (s < 5400) return `${Math.round(s / 60)} min ago`
    if (s < 172800) return `${Math.round(s / 3600)} h ago`
    return `${Math.round(s / 86400)} d ago`
}

/**
 * @param embedded  rendered inside the Profile's own scrolling column,
 *                  which already has a heading, padding and a scroller —
 *                  so this drops its surface and its header and becomes a
 *                  section rather than a screen.
 */
export default function Admin({ embedded = false }) {
    const me = getCurrentUser()
    const [users, setUsers] = useState(null)
    const [err, setErr] = useState(null)
    const [busy, setBusy] = useState(null)      // user id being acted on
    const [q, setQ] = useState("")
    const [confirmDelete, setConfirmDelete] = useState(null)
    const [groupBy, setGroupBy] = useState("company")
    // Who changed in the last few seconds, so a decision leaves a visible
    // trace on the row rather than only in a toast that has gone by the
    // time you look up.
    const [justDid, setJustDid] = useState({})

    const refresh = useCallback(() => {
        setErr(null)
        listAllUsers()
            .then(setUsers)
            .catch((e) => { setUsers([]); setErr(e.message || "Could not load the roster") })
    }, [])
    useEffect(() => { refresh() }, [refresh])

    const pending = useMemo(() => (users || []).filter((u) => !u.approved), [users])
    const roster = useMemo(() => {
        const text = q.trim().toLowerCase()
        return (users || [])
            .filter((u) => u.approved)
            .filter((u) => !text || `${u.name} ${u.email} ${u.title || ""} ${u.company || ""}`.toLowerCase().includes(text))
    }, [users, q])

    /* Grouped, because a roster is read by asking "who is at X" or "who can
       do Y" — not by scrolling an alphabet. Company is the default: an
       account's organisation is the first thing that decides what it should
       be able to see.

       Somebody with no company set is not hidden and not silently folded
       into the first group; they get a bucket that says so, which is also
       the prompt to go and fill it in. */
    const groups = useMemo(() => {
        const keyOf = {
            company: (u) => u.company || "No company set",
            role: (u) => u.role || "observer",
            access: (u) => (u.is_super_admin ? "Superadmins" : u.capability_role
                ? (ACCESS_ROLES[u.capability_role]?.label || u.capability_role)
                : "No capability role"),
        }[groupBy]
        if (!keyOf) return [{ key: null, items: roster }]
        const by = new Map()
        for (const u of roster) {
            const k = keyOf(u)
            if (!by.has(k)) by.set(k, [])
            by.get(k).push(u)
        }
        return [...by.entries()]
            .map(([key, items]) => ({
                key,
                items: items.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)),
            }))
            // Biggest first, but an "unset" bucket always goes last however
            // big it is — it is a to-do list, not a department.
            .sort((a, b) => {
                const unset = (k) => /^No /.test(k) ? 1 : 0
                return unset(a.key) - unset(b.key)
                    || b.items.length - a.items.length
                    || a.key.localeCompare(b.key)
            })
    }, [roster, groupBy])

    /* Every action is optimistic about nothing: the server's answer for
       that one row replaces it, and a refusal is shown as what the server
       said rather than as "something went wrong". */
    const act = async (id, fn, after, mark) => {
        setBusy(id)
        setErr(null)
        try {
            const next = await fn()
            setUsers((p) => (p || []).map((u) => (u.id === id ? next : u)))
            if (after) toast(after, { icon: "i-check" })
            if (mark) {
                // An approved request LEAVES the queue, so without this the
                // only evidence it worked is a row that vanished — which is
                // indistinguishable from a row that failed to render.
                setJustDid((p) => ({ ...p, [id]: mark }))
                setTimeout(() => setJustDid((p) => {
                    const n = { ...p }; delete n[id]; return n
                }), 9000)
            }
        } catch (e) {
            const why = e.message || "That did not work"
            toast(why, { icon: "i-alert" })
            // AND on the page. A toast is gone in four seconds and this is a
            // refusal somebody needs to act on.
            setErr(why)
        } finally { setBusy(null) }
    }

    const remove = async (u) => {
        setBusy(u.id)
        try {
            await deleteUser(u.id)
            setUsers((p) => (p || []).filter((x) => x.id !== u.id))
            toast(`Deleted ${u.name || u.email}`, { icon: "i-check" })
        } catch (e) {
            toast(e.message || "Could not delete", { icon: "i-alert" })
        } finally { setBusy(null); setConfirmDelete(null) }
    }

    if (!me?.is_super_admin) {
        return (
            <div style={embedded ? {} : { ...MODE_SURFACE, ...MODE_BODY }} data-testid="view-root-admin">
                <h1 style={{ font: "600 18px var(--font)", color: "var(--txt)", margin: 0 }}>Administration</h1>
                <p style={{ font: "400 12.5px/1.7 var(--font)", color: "var(--txt-3)", maxWidth: 520, marginTop: 10 }}>
                    This console is for superadmins. It shows every account in the organisation and
                    decides who can sign in, so it is not something a role grants itself.
                </p>
            </div>
        )
    }

    return (
        <div style={embedded
            ? { display: "flex", flexDirection: "column", minWidth: 0 }
            : { ...MODE_SURFACE }} data-testid="view-root-admin">
            <div style={{
                display: "flex", alignItems: "center", gap: 12, height: 42, flexShrink: 0,
                // EMBEDDED, THE PAGE'S OWN CLOSE BUTTON IS IN THIS CORNER.
                // It is absolutely positioned over the whole screen, so the
                // console has to leave it room or Refresh sits underneath it.
                padding: embedded ? "0 42px 0 0" : "0 16px",
                borderBottom: embedded ? 0 : "1px solid var(--gline)",
            }}>
                <b style={{ font: embedded ? "600 20px var(--font)" : "600 13px var(--font)", color: "var(--txt)" }}>
                    Administration
                </b>
                <span style={{ ...EYE }}>
                    {pending.length ? `${pending.length} waiting` : "no requests waiting"}
                </span>
                <div style={{ flex: 1 }} />
                <input
                    value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the roster"
                    style={{
                        width: 210, height: 25, padding: "0 9px", background: "var(--glass2)",
                        border: "1px solid var(--gline)", color: "var(--txt)",
                        font: "400 12px var(--font)", outline: "none", borderRadius: 0,
                    }}
                />
                <button style={BTN} onClick={refresh}>Refresh</button>
            </div>

            <div style={embedded
                ? { paddingTop: 14 }
                : { flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
                {err && (
                    <div style={{
                        font: "400 12px/1.6 var(--font)", color: "var(--red)",
                        border: "1px solid rgba(196,69,60,.4)", padding: "9px 12px", marginBottom: 14,
                    }}>{err}</div>
                )}

                {users === null && <Loading size={20} inline label="Reading the roster" />}

                {users !== null && (
                    <>
                        {/* ── requests ──────────────────────────────── */}
                        <div style={{ ...EYE, marginBottom: 8 }}>Access requests</div>
                        {!pending.length && (
                            <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", margin: "0 0 22px" }}>
                                Nobody is waiting. New requests appear here the moment somebody asks for an account.
                            </p>
                        )}
                        {pending.map((u) => (
                            <div key={u.id} style={{
                                display: "flex", gap: 12, padding: 12, marginBottom: 8,
                                border: "1px solid var(--acc-line)", background: "var(--acc-dim)",
                            }}>
                                <Avatar user={u} size={34} />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                                        <b style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>{u.name || "No name given"}</b>
                                        <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>{u.email}</span>
                                        <span style={{ font: "400 11px var(--mono)", color: "var(--txt-3)" }}>
                                            asked {ago(u.created_at)}
                                        </span>
                                    </div>
                                    {/* The reason they gave. See the file's own note on why. */}
                                    <p style={{
                                        font: "400 12px/1.6 var(--font)",
                                        color: u.request_note ? "var(--txt-2)" : "var(--txt-3)",
                                        margin: "6px 0 10px", maxWidth: 680, whiteSpace: "pre-wrap",
                                    }}>
                                        {u.request_note || "They gave no reason."}
                                    </p>
                                    <div style={{ display: "flex", gap: 6 }}>
                                        <button style={PRIMARY} disabled={busy === u.id}
                                                onClick={() => act(u.id, () => approveUser(u.id),
                                                    `${u.name || u.email} can now sign in`,
                                                    "Approved — they can sign in now")}>
                                            {busy === u.id ? "Approving…" : "Approve"}
                                        </button>
                                        <button style={DANGER} disabled={busy === u.id}
                                                onClick={() => setConfirmDelete(u)}>
                                            Decline and delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        ))}

                        {/* ── roster ────────────────────────────────── */}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "26px 0 8px" }}>
                            <span style={EYE}>
                                Roster · {roster.length}{q.trim() ? ` of ${(users || []).filter((u) => u.approved).length}` : ""}
                            </span>
                            <div style={{ flex: 1 }} />
                            <span style={EYE}>Group by</span>
                            {[["company", "company"], ["role", "role"], ["access", "access"], ["none", "flat"]].map(([k, l]) => (
                                <button key={k} type="button" onClick={() => setGroupBy(k)} style={{
                                    height: 21, padding: "0 8px", borderRadius: 0, cursor: "pointer",
                                    border: `1px solid ${groupBy === k ? "var(--acc-line)" : "var(--gline)"}`,
                                    background: groupBy === k ? "var(--acc-dim)" : "transparent",
                                    color: groupBy === k ? "var(--txt)" : "var(--txt-3)",
                                    font: "400 11px var(--font)",
                                }}>{l}</button>
                            ))}
                        </div>

                        <div style={{ display: "flex", ...EYE, padding: "0 10px 5px", borderBottom: "1px solid var(--gline)" }}>
                            <span style={{ flex: 1 }}>Person</span>
                            <span style={{ width: 122 }}>Role</span>
                            <span style={{ width: 150 }}>Capability</span>
                            <span style={{ width: 170 }}>Company</span>
                            <span style={{ width: 96 }}>Last seen</span>
                            <span style={{ width: 210, textAlign: "right" }}>Access</span>
                        </div>

                        {groups.map((grp) => (
                            <div key={grp.key ?? "__all__"}>
                                {grp.key != null && (
                                    <div style={{
                                        display: "flex", alignItems: "center", gap: 8,
                                        padding: "11px 10px 4px",
                                    }}>
                                        <span style={{ ...EYE, color: "var(--txt-2)" }}>{grp.key}</span>
                                        <span style={{ font: "400 10.5px var(--mono)", color: "var(--txt-3)" }}>
                                            {grp.items.length}
                                        </span>
                                        <span style={{ flex: 1, height: 1, background: "var(--gline)" }} />
                                    </div>
                                )}
                        {grp.items.map((u) => {
                            const self = u.id === me.id
                            return (
                                <div key={u.id} style={{
                                    display: "flex", alignItems: "center", gap: 0, padding: "9px 10px",
                                    borderBottom: "1px solid var(--gline)",
                                    opacity: busy === u.id ? 0.55 : 1,
                                }}>
                                    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 9 }}>
                                        <Avatar user={u} size={26} />
                                        <div style={{ minWidth: 0 }}>
                                            {/* The NAME ellipses, the badges do not.
                                                A long address truncating the word
                                                "superadmin" to "SUPERADM…" hides the
                                                one thing this row is for. */}
                                            <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                                                <span style={{
                                                    font: "600 12.5px var(--font)", color: "var(--txt)",
                                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                                }}>{u.name || u.email}</span>
                                                {u.is_super_admin && (
                                                    <span style={{
                                                        flex: "none", padding: "1px 5px", font: "500 9.5px var(--mono)",
                                                        letterSpacing: ".1em", textTransform: "uppercase",
                                                        whiteSpace: "nowrap",
                                                        color: "var(--acc-hi)", border: "1px solid var(--acc-line)",
                                                    }}>superadmin</span>
                                                )}
                                                {self && <span style={{ flex: "none", font: "400 10px var(--mono)", color: "var(--txt-3)" }}>you</span>}
                                                {justDid[u.id] && (
                                                    <span style={{
                                                        flex: "none", padding: "1px 6px", font: "400 10px var(--font)",
                                                        color: "var(--tag-green, var(--green))",
                                                        border: "1px solid var(--gline2)", whiteSpace: "nowrap",
                                                    }}>{justDid[u.id]}</span>
                                                )}
                                            </div>
                                            <div style={{
                                                font: "400 10.5px var(--mono)", color: "var(--txt-3)",
                                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                            }}>{[u.email, u.title, u.company].filter(Boolean).join(" · ")}</div>
                                        </div>
                                    </div>

                                    <select
                                        value={u.role || "observer"} disabled={busy === u.id}
                                        onChange={(e) => act(u.id, () => updateUser(u.id, { role: e.target.value }))}
                                        style={{ width: 112, height: 24, marginRight: 10, background: "var(--glass2)", border: "1px solid var(--gline)", color: "var(--txt-2)", font: "400 11.5px var(--font)", borderRadius: 0 }}
                                    >
                                        {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                                    </select>

                                    <select
                                        value={u.capability_role || ""} disabled={busy === u.id}
                                        onChange={(e) => act(u.id, () => updateUser(u.id, { capability_role: e.target.value || null }))}
                                        style={{ width: 140, height: 24, marginRight: 10, background: "var(--glass2)", border: "1px solid var(--gline)", color: "var(--txt-2)", font: "400 11.5px var(--font)", borderRadius: 0 }}
                                    >
                                        <option value="">none</option>
                                        {ACCESS_ROLE_IDS.map((r) => <option key={r} value={r}>{ACCESS_ROLES[r].label}</option>)}
                                    </select>

                                    {/* Committed on blur, not per keystroke: a PUT
                                        for every letter typed into a company name
                                        is forty requests to set one word. */}
                                    <input
                                        defaultValue={u.company || ""} key={`c-${u.id}-${u.company || ""}`}
                                        placeholder="—" disabled={busy === u.id}
                                        onBlur={(e) => {
                                            const v = e.target.value.trim()
                                            if (v !== (u.company || "")) act(u.id, () => updateUser(u.id, { company: v || null }))
                                        }}
                                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur() }}
                                        style={{
                                            width: 160, height: 24, marginRight: 10, padding: "0 7px",
                                            background: "var(--glass2)", border: "1px solid var(--gline)",
                                            color: "var(--txt-2)", font: "400 11.5px var(--font)",
                                            borderRadius: 0, outline: "none",
                                        }}
                                    />

                                    <span style={{ width: 96, font: "400 11px var(--mono)", color: "var(--txt-3)" }}>
                                        {ago(u.last_seen || u.last_login)}
                                    </span>

                                    <div style={{ width: 210, display: "flex", gap: 5, justifyContent: "flex-end" }}>
                                        <button
                                            style={u.is_super_admin ? { ...BTN, color: "var(--acc-hi)" } : BTN}
                                            disabled={busy === u.id}
                                            title={u.is_super_admin ? "Remove superadmin" : "Make superadmin"}
                                            onClick={() => act(u.id, () => updateUser(u.id, { is_super_admin: !u.is_super_admin }),
                                                u.is_super_admin ? `${u.name || u.email} is no longer a superadmin`
                                                                 : `${u.name || u.email} is now a superadmin`)}
                                        >{u.is_super_admin ? "− admin" : "+ admin"}</button>
                                        <button style={BTN} disabled={busy === u.id || self}
                                                title={self ? "You cannot revoke your own access" : "Sign them out and keep their work"}
                                                onClick={() => act(u.id, () => revokeUser(u.id), `${u.name || u.email} can no longer sign in`)}>
                                            Revoke
                                        </button>
                                        <button style={DANGER} disabled={busy === u.id || self}
                                                onClick={() => setConfirmDelete(u)}>Delete</button>
                                    </div>
                                </div>
                            )
                        })}
                            </div>
                        ))}

                        {!roster.length && q.trim() && (
                            <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", marginTop: 12 }}>
                                Nobody on the roster matches “{q.trim()}”.
                            </p>
                        )}
                    </>
                )}
            </div>

            {/* Deleting says what goes with it. A confirmation that does not
                name the consequence is a formality. */}
            {confirmDelete && (
                <div style={{
                    position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center",
                    background: "rgba(10,14,31,.55)",
                }} onClick={() => setConfirmDelete(null)}>
                    <div onClick={(e) => e.stopPropagation()} style={{
                        width: 420, padding: 18, background: "var(--glass)",
                        backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                        border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                    }}>
                        <b style={{ font: "600 13px var(--font)", color: "var(--txt)" }}>
                            Delete {confirmDelete.name || confirmDelete.email}?
                        </b>
                        <p style={{ font: "400 12px/1.65 var(--font)", color: "var(--txt-3)", margin: "9px 0 14px" }}>
                            {confirmDelete.approved
                                ? "The account is removed. Cases and documents they own stay in the database but nobody will be signed in as their owner. If you only want to stop them signing in, revoke instead."
                                : "The request is removed. They can ask again with the same address."}
                        </p>
                        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                            <button style={BTN} onClick={() => setConfirmDelete(null)}>Cancel</button>
                            <button style={DANGER} onClick={() => remove(confirmDelete)}>Delete</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
