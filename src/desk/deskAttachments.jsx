/**
 * deskAttachments.jsx — what a desk post can carry, and how it shows.
 *
 * The desk is where the team shares what it has seen (owner, 2026-10-06:
 * "like a Twitter brief"). A post carries at most one thing, and each kind
 * shows as the thing itself, not as a link to it:
 *
 *   signal    the saved signal, with the map one click away
 *   briefing  the report's card — read it in the reader
 *   telegram  the footage, playing in the post
 *   file      an image shown, anything else to download
 *   place     a named place on a small map
 *   asset     an asset of ours, with its model and how exposed it is
 *
 * The pickers choose one; Attachment renders one. Kept apart from Desk.jsx
 * so a "Share to the desk" anywhere in the app builds the same shapes.
 */
import { useEffect, useMemo, useState } from "react"
import API_BASE from "../apiBase.js"
import { listReports } from "../reports/reportApi.js"
import { useSaved, savedLabel, savedMeta } from "../state/savedForBriefing.js"
import { SAVED_READ } from "../state/signalPicker.js"
import { deskFileUrl } from "../lib/deskApi.js"
import TelegramMedia from "../components/TelegramMedia.jsx"
import AssetThumb from "../assets/AssetThumb.jsx"
import PlacePicker from "../search/PlacePicker.jsx"
import PinMap from "../ui/PinMap.jsx"
import Dots from "../ui/Dots.jsx"
import { agoLabel } from "../utils/formatTime.js"

const SEV = { critical: "#E5484D", significant: "#F5A524", high: "#F5A524", elevated: "#8FB4E8", routine: "#9AA9BC" }
const EXPO = { high: "#E5484D", elevated: "#F5A524", low: "#8FB4E8", quiet: "#4CAF7A", unknown: "#9AA9BC" }
const BOX = { border: "1px solid var(--gline)", background: "var(--glass2)", borderRadius: 10, overflow: "hidden" }
const LINK = { border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", fontSize: 12.5, cursor: "pointer", padding: 0 }
const abs = (u) => (!u ? null : u.startsWith("http") ? u : `${API_BASE}${u}`)
const flyTo = (lat, lon, altitude = 80_000) => {
    window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "situation" } }))
    setTimeout(() => window.dispatchEvent(new CustomEvent("akili:fly-to", { detail: { lat, lon, altitude } })), 300)
}

/* ── how each kind shows in a post ─────────────────────────────────────── */

export function Attachment({ att, postId, compact = false }) {
    if (!att) return null
    if (att.kind === "signal") {
        return (
            <div style={{ ...BOX, padding: "10px 12px", display: "flex", gap: 10, alignItems: "center" }}>
                <i style={{ width: 8, height: 8, borderRadius: "50%", background: SEV[att.urgency] || "#9AA9BC", flex: "none" }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: "var(--txt)", lineHeight: 1.4 }}>{att.headline}</div>
                    <div style={{ fontSize: 12, color: "var(--txt3)" }}><Dots text={[att.sector, att.meta].filter(Boolean).join(" · ")} /></div>
                </div>
                {att.lat != null && <button onClick={() => flyTo(att.lat, att.lon)} style={LINK}>map →</button>}
            </div>
        )
    }
    if (att.kind === "briefing") {
        return (
            <button onClick={() => {
                window.__plxOpenReport = att.report_id
                window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "briefings" } }))
                window.dispatchEvent(new CustomEvent("akili:open-report", { detail: { id: att.report_id } }))
            }} style={{ ...BOX, display: "flex", gap: 14, alignItems: "stretch", padding: 0, width: "100%", textAlign: "left", cursor: "pointer", color: "var(--txt)", font: "inherit" }}>
                <span style={{ width: 6, background: "var(--acchi)", flex: "none" }} />
                <span style={{ padding: "12px 14px 12px 0", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)" }}>Briefing · {att.status || "draft"}</span>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{att.title}</span>
                    {att.summary && <span style={{ fontSize: 13, color: "var(--txt2)", lineHeight: 1.45 }}>{att.summary}</span>}
                    <span style={{ fontSize: 12, color: "var(--acchi)" }}>Read it →</span>
                </span>
            </button>
        )
    }
    if (att.kind === "telegram") {
        return (
            <div style={BOX}>
                {!compact && <TelegramMedia post={{ ...att, thumb_url: abs(att.thumb_url) }} maxHeight="420px" radius="0" />}
                <div style={{ padding: "10px 12px", display: "flex", flexDirection: "column", gap: 3 }}>
                    <span style={{ fontSize: 13.5, color: "var(--txt)", lineHeight: 1.4 }}>{att.headline}</span>
                    <span style={{ fontSize: 12, color: "var(--txt3)" }}><Dots text={[att.place, att.channel_title || att.channel, att.verification].filter(Boolean).join(" · ")} /></span>
                    {att.lat != null && <button onClick={() => flyTo(att.lat, att.lon, 40_000)} style={{ ...LINK, alignSelf: "flex-start" }}>where it was filmed →</button>}
                </div>
            </div>
        )
    }
    if (att.kind === "file") {
        return (att.mime || "").startsWith("image/")
            ? <a href={deskFileUrl(postId)} download={att.name} style={{ display: "block", ...BOX }}>
                <img src={deskFileUrl(postId)} alt={att.name} style={{ display: "block", width: "100%", maxHeight: 460, objectFit: "contain", background: "#000" }} />
              </a>
            : <a href={deskFileUrl(postId)} download={att.name} style={{ ...BOX, display: "inline-flex", padding: "9px 12px", color: "var(--txt)", fontSize: 13, textDecoration: "none" }}>{att.name} · download</a>
    }
    if (att.kind === "place") {
        return (
            <div style={BOX}>
                {!compact && <PinMap center={{ lat: att.lat, lon: att.lon }} pin={{ lat: att.lat, lon: att.lon }} zoom={att.zoom || 12} height={220} />}
                <div style={{ padding: "9px 12px", display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ flex: 1, fontSize: 13.5 }}>{att.name}</span>
                    <button onClick={() => flyTo(att.lat, att.lon, 30_000)} style={LINK}>map →</button>
                </div>
            </div>
        )
    }
    if (att.kind === "asset") {
        return (
            <button onClick={() => {
                window.__plxAssetSel = att.id
                window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "assets" } }))
                window.dispatchEvent(new CustomEvent("akili:open-asset", { detail: { id: att.id } }))
            }} style={{ ...BOX, display: "flex", gap: 12, alignItems: "center", padding: "8px 12px", width: "100%", textAlign: "left", cursor: "pointer", color: "var(--txt)", font: "inherit" }}>
                <AssetThumb kind={att.asset_kind} group={att.group} width={96} height={60} />
                <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
                    <span style={{ fontSize: 14.5, fontWeight: 600 }}>{att.name}</span>
                    <span style={{ fontSize: 12, color: "var(--txt3)", display: "flex", alignItems: "center", gap: 6 }}>
                        <i style={{ width: 7, height: 7, borderRadius: "50%", background: EXPO[att.exposure] || EXPO.unknown }} />
                        {att.kind_label}{att.exposure ? ` · ${att.exposure}` : ""}
                    </span>
                </span>
            </button>
        )
    }
    return null
}

/* ── choosing one ─────────────────────────────────────────────────────── */

function Shell({ title, onClose, children, search, onSearch }) {
    return (
        <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9000, display: "grid", placeItems: "center", background: "rgba(10,14,31,.5)", padding: 20 }}>
            <div onClick={(e) => e.stopPropagation()} style={{
                width: 560, maxWidth: "100%", maxHeight: "80vh", display: "flex", flexDirection: "column",
                background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)", borderRadius: 12, overflow: "hidden",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "14px 16px", borderBottom: "1px solid var(--gline)" }}>
                    <b style={{ flex: 1, fontSize: 14 }}>{title}</b>
                    <button onClick={onClose} style={{ border: 0, background: "transparent", color: "var(--txt3)", cursor: "pointer", fontSize: 15 }}>✕</button>
                </div>
                {onSearch && (
                    <div style={{ padding: "10px 16px" }}>
                        <input autoFocus value={search} onChange={(e) => onSearch(e.target.value)} placeholder="Search"
                            style={{ width: "100%", boxSizing: "border-box", height: 32, padding: "0 10px", background: "var(--glass2)", border: "1px solid var(--gline)", color: "var(--txt)", font: "inherit", fontSize: 13, outline: "none", borderRadius: 6 }} />
                    </div>
                )}
                <div style={{ flex: 1, minHeight: 0, overflow: "auto", borderTop: "1px solid var(--gline)" }}>{children}</div>
            </div>
        </div>
    )
}

const Row = ({ onClick, children }) => (
    <div onClick={onClick} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--gline)", cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--accdim)" }} onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}>{children}</div>
)
const Empty = ({ children }) => <p style={{ padding: 16, margin: 0, fontSize: 13, color: "var(--txt3)", lineHeight: 1.6 }}>{children}</p>

export function SignalPicker({ onPick, onClose }) {
    const saved = useSaved()
    const [q, setQ] = useState("")
    const items = useMemo(() => {
        const t = q.trim().toLowerCase()
        return saved.filter((s) => s.kind !== "note").filter((s) => !t || SAVED_READ.text(s).toLowerCase().includes(t))
    }, [saved, q])
    return (
        <Shell title="Share a signal you saved" onClose={onClose} search={q} onSearch={setQ}>
            {!items.length && <Empty>{q.trim() ? "Nothing saved matches that." : "Nothing saved yet — use “+ briefing” on a map card or an Inbox item."}</Empty>}
            {items.map((s) => (
                <Row key={s.id} onClick={() => onPick({ kind: "signal", id: s.id, headline: savedLabel(s), meta: savedMeta(s) || null, lat: s.lat ?? null, lon: s.lon ?? null, urgency: SAVED_READ.urgency(s), sector: SAVED_READ.sector(s) })}>
                    <i style={{ width: 8, height: 8, borderRadius: "50%", background: SEV[SAVED_READ.urgency(s)] || "#9AA9BC", flex: "none" }} />
                    <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5 }}>{savedLabel(s)}</span>
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>{SAVED_READ.sector(s)}{savedMeta(s) ? ` · ${savedMeta(s)}` : ""}</span>
                    </span>
                </Row>
            ))}
        </Shell>
    )
}

export function BriefingPicker({ onPick, onClose }) {
    const [rows, setRows] = useState(null)
    const [q, setQ] = useState("")
    useEffect(() => { listReports().then((r) => setRows(Array.isArray(r) ? r : [])).catch(() => setRows([])) }, [])
    const shown = (rows || []).filter((r) => !q.trim() || `${r.title}`.toLowerCase().includes(q.trim().toLowerCase()))
    return (
        <Shell title="Share a briefing" onClose={onClose} search={q} onSearch={setQ}>
            {rows === null && <Empty>Reading the briefings…</Empty>}
            {rows && !shown.length && <Empty>No briefing matches.</Empty>}
            {shown.map((r) => (
                <Row key={r.report_id} onClick={() => onPick({ kind: "briefing", report_id: r.report_id, title: r.title, status: r.status, created_at: r.created_at, summary: (r.key_judgments || "").slice(0, 220) || null })}>
                    <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5 }}>{r.title}</span>
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>{r.status} · {agoLabel(r.created_at)}</span>
                    </span>
                </Row>
            ))}
        </Shell>
    )
}

export function TelegramPicker({ onPick, onClose }) {
    const [rows, setRows] = useState(null)
    const [q, setQ] = useState("")
    useEffect(() => {
        fetch(`${API_BASE}/api/telegram/posts?hours=168`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { posts: [] }))
            .then((d) => setRows((d.posts || []).filter((p) => p.thumb_url || p.media === "video"))).catch(() => setRows([]))
    }, [])
    const shown = (rows || []).filter((p) => !q.trim() || `${p.headline} ${p.place}`.toLowerCase().includes(q.trim().toLowerCase()))
    return (
        <Shell title="Share footage from the ground" onClose={onClose} search={q} onSearch={setQ}>
            {rows === null && <Empty>Reading the footage…</Empty>}
            {rows && !shown.length && <Empty>No footage matches.</Empty>}
            {shown.map((p) => (
                <Row key={p.id} onClick={() => onPick({ kind: "telegram", id: p.id, channel: p.channel, msg_id: p.msg_id, channel_title: p.channel_title, headline: p.headline, place: p.place, lat: p.lat, lon: p.lon, media: p.media, thumb_url: p.thumb_url, verification: p.verification, posted_at: p.posted_at })}>
                    {p.thumb_url ? <img src={abs(p.thumb_url)} alt="" style={{ width: 84, height: 52, objectFit: "cover", borderRadius: 6, flex: "none" }} /> : <span style={{ width: 84, height: 52, background: "#000", borderRadius: 6, flex: "none" }} />}
                    <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5 }}>{p.headline}</span>
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}><Dots text={[p.place, p.channel_title || p.channel, agoLabel(p.posted_at)].filter(Boolean).join(" · ")} /></span>
                    </span>
                </Row>
            ))}
        </Shell>
    )
}

export function AssetPicker({ onPick, onClose }) {
    const [rows, setRows] = useState(null)
    useEffect(() => {
        fetch(`${API_BASE}/api/my-assets`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { assets: [] }))
            .then((d) => setRows(d.assets || [])).catch(() => setRows([]))
    }, [])
    return (
        <Shell title="Share one of our assets" onClose={onClose}>
            {rows === null && <Empty>Reading the register…</Empty>}
            {rows && !rows.length && <Empty>Nothing in the register yet.</Empty>}
            {(rows || []).map((a) => (
                <Row key={a.id} onClick={() => onPick(assetAttachment(a))}>
                    <AssetThumb kind={a.kind} group={a.group} width={84} height={52} />
                    <span style={{ minWidth: 0 }}>
                        <span style={{ display: "block", fontSize: 13.5 }}>{a.name}</span>
                        <span style={{ fontSize: 12, color: "var(--txt3)" }}>{a.kind_label} · {a.exposure}</span>
                    </span>
                </Row>
            ))}
        </Shell>
    )
}

export function PlacePick({ onPick, onClose }) {
    return (
        <Shell title="Share a place" onClose={onClose}>
            <div style={{ padding: 16 }}>
                <PlacePicker label="Place" placeholder="A town, a port, a base, an address…"
                    onPick={(p) => onPick({ kind: "place", name: [p.label, String(p.sub || "").split(" · ")[0]].filter(Boolean).join(", "), lat: Number(p.lat), lon: Number(p.lon), zoom: 12 })} />
            </div>
        </Shell>
    )
}

/** The shape an asset is shared in (also used by "Share to the desk" on the asset's page). */
export function assetAttachment(a) {
    return { kind: "asset", id: a.id, name: a.name, asset_kind: a.kind, kind_label: a.kind_label, group: a.group, exposure: a.exposure }
}
