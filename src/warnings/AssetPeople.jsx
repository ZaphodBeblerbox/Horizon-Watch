/**
 * AssetPeople.jsx — on an asset's page (desktop) and its sheet (phone):
 *
 *   LINK A PERSON (owner, 2026-10-12: "link a user to an asset, and that
 *   automatically links the user's live location to that asset"). Anyone
 *   with an account, your organisation first and people outside it too;
 *   once linked: "Follows Dmitri's phone · live · 5 s ago", and the asset
 *   is wherever their phone is (backend owned_assets.link_user).
 *
 *   SEND A WARNING to that person: it takes their whole screen with its own
 *   alarm until they acknowledge (warnings/WarningTakeover.jsx); here, what
 *   was sent and whether it was seen and acknowledged.
 */
import { confirmAction } from "../ui/confirm.js"
import { useEffect, useMemo, useState } from "react"
import { getCurrentUser } from "../state/authStore.js"
import { useFreshness, useLiveAsset, useStream } from "../location/useLivePositions.js"
import { assetLink, cancelWarning, linkableUsers, linkUser, sendWarning, sentWarnings, unlinkUser, warningStatus } from "./api.js"

const RED = "#E5484D"
const isAdmin = (u) => !!u?.is_super_admin || String(u?.role || "").toLowerCase() === "admin"

function styles(phone) {
    return phone
        ? { btn: { className: "m2-btn ghost" }, primary: { className: "m2-btn" }, sub: { className: "m2-sub" }, box: { className: "m2-card" } }
        : {
            btn: { style: { height: 32, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt)", font: "inherit", fontSize: 13, cursor: "pointer" } },
            primary: { style: { height: 32, padding: "0 14px", border: 0, background: "var(--txt)", color: "var(--bg, #0b0f16)", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer" } },
            sub: { style: { fontSize: 12.5, color: "var(--txt3)", lineHeight: 1.45 } },
            box: { style: { border: "1px solid var(--gline)", padding: 12, display: "flex", flexDirection: "column", gap: 8 } },
        }
}

function Freshness({ at }) {
    const f = useFreshness(at)
    return <>{f.label}</>
}

/** "Follows Dmitri's phone · live · 5 s ago", from the live stream when it has them. */
function Following({ link, assetId }) {
    useStream(true)
    const live = useLiveAsset(assetId)
    const at = live?.at ?? (link.latest?.at ? Date.parse(link.latest.at) : null)
    return (
        <span data-testid="asset-follows">
            Follows <b style={{ fontWeight: 650 }}>{link.user.name}</b>’s phone
            {link.user.company ? ` (${link.user.company})` : ""} · {at ? <Freshness at={at} /> : "no position shared yet"}
        </span>
    )
}

function Picker({ onPick, onCancel, s, phone }) {
    const [q, setQ] = useState("")
    const [users, setUsers] = useState(null)
    useEffect(() => {
        let live = true
        const t = setTimeout(() => linkableUsers(q).then((d) => { if (live) setUsers(d.users || []) }).catch(() => { if (live) setUsers([]) }), q ? 200 : 0)
        return () => { live = false; clearTimeout(t) }
    }, [q])
    const groups = useMemo(() => {
        const g = { mine: [], outside: [] }
        for (const u of users || []) (u.affiliation === "outside" ? g.outside : g.mine).push(u)
        return g
    }, [users])
    const row = (u) => (
        <button key={u.id} onClick={() => onPick(u)} data-testid={`link-pick-${u.id}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 10, width: "100%", textAlign: "left", padding: "8px 10px", border: 0,
                         borderBottom: "1px solid var(--gline)", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" }}>
            <span>{u.name}{u.affiliation === "you" ? " (you)" : ""}</span>
            <span style={{ opacity: 0.65, fontSize: 12.5 }}>{u.company || u.email}</span>
        </button>
    )
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a person — name, email or company" data-testid="link-search"
                   className={phone ? "m2-input" : undefined}
                   style={{ height: 36, padding: "0 10px", border: "1px solid var(--gline2)", background: "transparent", color: "inherit", font: "inherit", fontSize: 14 }} />
            <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid var(--gline)" }}>
                {users === null ? <div {...s.sub} style={{ ...s.sub.style, padding: 10 }}>Loading…</div> : <>
                    {groups.mine.length > 0 && <div {...s.sub} style={{ ...s.sub.style, padding: "6px 10px" }}>Your organisation</div>}
                    {groups.mine.map(row)}
                    {groups.outside.length > 0 && <div {...s.sub} style={{ ...s.sub.style, padding: "6px 10px" }}>Outside your organisation — linking shares their live location with you and your team</div>}
                    {groups.outside.map(row)}
                    {!users.length && <div {...s.sub} style={{ ...s.sub.style, padding: 10 }}>Nobody found.</div>}
                </>}
            </div>
            <div><button {...s.btn} onClick={onCancel}>Cancel</button></div>
        </div>
    )
}

function SendWarning({ asset, s, onSent }) {
    const [open, setOpen] = useState(false)
    const [msg, setMsg] = useState("")
    const [sev, setSev] = useState("critical")
    const [state, setState] = useState(null)
    const send = async () => {
        setState({ busy: true })
        try {
            await sendWarning({ asset_id: asset.id, message: msg, severity: sev })
            setState(null); setOpen(false); setMsg(""); onSent()
        } catch (e) { setState({ error: e.message }) }
    }
    if (!open) {
        return <button {...s.btn} data-testid="asset-send-warning" onClick={() => setOpen(true)}
                       style={{ ...(s.btn.style || {}), borderColor: RED, color: RED, fontWeight: 650 }}>Send warning</button>
    }
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, border: `1px solid ${RED}`, padding: 10 }}>
            <textarea autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={280} rows={3} data-testid="warning-text"
                      placeholder="What did you notice? e.g. Two cars have followed you since the bridge — turn off at the next exit."
                      style={{ padding: 8, border: "1px solid var(--gline2)", background: "transparent", color: "inherit", font: "inherit", fontSize: 14, resize: "vertical" }} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {["critical", "warning"].map((v) => (
                    <button key={v} {...s.btn} onClick={() => setSev(v)} aria-pressed={sev === v}
                            style={{ ...(s.btn.style || {}), ...(sev === v ? { borderColor: RED, color: RED } : {}) }}>
                        {v === "critical" ? "Critical" : "Warning"}
                    </button>
                ))}
                <button {...s.primary} onClick={send} disabled={!msg.trim() || state?.busy} data-testid="warning-send"
                        style={{ ...(s.primary.style || {}), background: RED, color: "#fff" }}>{state?.busy ? "Sending…" : "Send warning"}</button>
                <button {...s.btn} onClick={() => { setOpen(false); setState(null) }}>Cancel</button>
            </div>
            <div {...s.sub}>
                It takes their whole screen with its own alarm until they acknowledge, whatever Do Not Disturb says, and is sent again every
                2 minutes until they do. Android phones vibrate. An iPhone on silent or in Focus may stay quiet and cannot vibrate for a web app.
            </div>
            {state?.error && <div {...s.sub} style={{ ...(s.sub.style || {}), color: RED }}>{state.error}</div>}
        </div>
    )
}

function SentList({ list, s, me, onChange }) {
    if (!list?.length) return null
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="warning-sent-list">
            {list.slice(0, 4).map((w) => (
                <div key={w.id} {...s.sub} data-testid="warning-sent-row" style={{ ...(s.sub.style || {}), display: "flex", gap: 8, justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ minWidth: 0 }}>
                        <b style={{ color: w.acked_at ? "inherit" : RED, fontWeight: 650 }}>{w.kind === "evacuate" ? "Evacuate" : "Warning"}</b> “{w.message}” —{" "}
                        <span data-testid="warning-status">{warningStatus(w)}</span>
                    </span>
                    {!w.acked_at && !w.cancelled_at && (String(w.from_user) === String(me?.id) || isAdmin(me)) && (
                        <button onClick={() => cancelWarning(w.id).then(onChange).catch(() => {})}
                                style={{ border: 0, background: "transparent", color: "inherit", textDecoration: "underline", cursor: "pointer", font: "inherit", fontSize: 12 }}>Withdraw</button>
                    )}
                </div>
            ))}
        </div>
    )
}

export default function AssetPeople({ asset, variant = "desktop", onChanged }) {
    const phone = variant === "phone"
    const s = styles(phone)
    const me = getCurrentUser()
    const canEdit = !!asset?.mine || String(asset?.owner_id) === String(me?.id) || isAdmin(me)
    const [link, setLink] = useState(null)
    const [picking, setPicking] = useState(false)
    const [err, setErr] = useState(null)
    const [sent, setSent] = useState([])
    const [tick, setTick] = useState(0)
    const linked = link?.user || null

    useEffect(() => {
        let live = true
        assetLink(asset.id).then((d) => { if (live) setLink(d) }).catch(() => { if (live) setLink({ user: null }) })
        return () => { live = false }
    }, [asset.id, asset.identifiers?.user_id, tick])

    // what was sent, and whether it was seen: often while one is open, rarely otherwise
    const open = sent.some((w) => !w.acked_at && !w.cancelled_at)
    useEffect(() => {
        let live = true
        const load = () => sentWarnings({ asset_id: asset.id }).then((d) => { if (live) setSent(d.warnings || []) }).catch(() => {})
        load()
        const t = setInterval(load, open ? 5_000 : 30_000)
        return () => { live = false; clearInterval(t) }
    }, [asset.id, open, tick])
    // and at once when the stream says so
    const stream = useStream(false)
    useEffect(() => stream.listen((ev) => {
        if (ev.type === "warning_update" && ev.warning?.asset_id === asset.id) {
            setSent((xs) => xs.map((w) => (w.id === ev.warning.id ? { ...w, ...ev.warning } : w)))
        }
    }), [stream, asset.id])

    const pick = async (u) => {
        setErr(null)
        try { setLink(await linkUser(asset.id, u.id)); setPicking(false); onChanged?.() } catch (e) { setErr(e.message) }
    }
    const unlink = async () => {
        // our own dialog: window.confirm shows nothing in the desktop app (Tauri)
        if (!(await confirmAction({ title: `Unlink ${linked?.name || "this person"}?`, confirm: "Unlink", danger: true,
                                    message: `${asset.name} stays where it was last seen and no longer follows their phone.` }))) return
        try { setLink(await unlinkUser(asset.id)); onChanged?.() } catch (e) { setErr(e.message) }
    }

    if (!link) return null
    return (
        <div {...s.box} data-testid="asset-people" style={{ ...(s.box.style || {}), ...(phone ? { marginBottom: 10, padding: 10, display: "flex", flexDirection: "column", gap: 8 } : {}) }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
                <span style={{ fontSize: phone ? 14 : 13.5 }}>
                    {linked ? <Following link={link} assetId={asset.id} /> : <span {...s.sub}>No person linked — link one and {asset.name} follows their phone.</span>}
                </span>
                {canEdit && !picking && (
                    <span style={{ display: "flex", gap: 6 }}>
                        <button {...s.btn} data-testid="asset-link-user" onClick={() => setPicking(true)}>{linked ? "Change person" : "Link a person"}</button>
                        {linked && <button {...s.btn} data-testid="asset-unlink-user" onClick={unlink}>Unlink</button>}
                    </span>
                )}
            </div>
            {picking && <Picker s={s} phone={phone} onPick={pick} onCancel={() => setPicking(false)} />}
            {err && <div {...s.sub} style={{ ...(s.sub.style || {}), color: RED }}>{err}</div>}
            {linked && <SendWarning asset={asset} s={s} onSent={() => setTick((n) => n + 1)} />}
            <SentList list={sent} s={s} me={me} onChange={() => setTick((n) => n + 1)} />
        </div>
    )
}
