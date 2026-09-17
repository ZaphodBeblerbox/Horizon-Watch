/**
 * NotificationTray.jsx — the record (PARALLAX spec §5.5).
 *
 * 352px, slides from the right. Dismissing a card removes the interruption,
 * never the item, so everything that ever arrived is still here — which is
 * what makes dismissing safe in the first place. The footer says so
 * permanently rather than relying on the user having been told once.
 *
 * Mute silences cards only. The tray keeps filling and says so in a banner,
 * because muting is a statement about interruption, not about relevance.
 */

import { useEffect, useMemo, useState } from "react"
import {
    subscribeNotifications, getNotifications, markRead, markAllRead,
    setMuted, KIND,
} from "../state/notificationStore.js"

const FILTERS = [
    { key: "all", label: "all" },
    { key: "unread", label: "unread" },
    { key: "onme", label: "on me" },
    { key: "detectors", label: "detectors" },
    { key: "feeds", label: "feeds" },
]

function ago(ts) {
    const m = Math.floor((Date.now() - ts) / 60000)
    if (m < 1) return "now"
    if (m < 60) return `${m}m`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h`
    return `${Math.floor(h / 24)}d`
}

export default function NotificationTray({ open, onClose, onOpenItem = null }) {
    const [{ items, muted }, setState] = useState(() => getNotifications())
    const [filter, setFilter] = useState("all")

    useEffect(() => subscribeNotifications((s) => setState({ items: s.items, muted: s.muted })), [])

    const unread = useMemo(() => items.filter((i) => !i.read).length, [items])

    const rows = useMemo(() => items.filter((i) => {
        if (filter === "unread") return !i.read
        if (filter === "onme") return i.kind === "assign" || i.kind === "rfi"
        if (filter === "detectors") return i.kind === "detector"
        if (filter === "feeds") return i.kind === "feed"
        return true
    }), [items, filter])

    return (
        <aside className={`notiftray${open ? " open" : ""}`} aria-hidden={!open} aria-label="Notifications">
            <div style={{
                height: 32, flex: "none", display: "flex", alignItems: "center", gap: 8,
                padding: "0 11px", borderBottom: "1px solid var(--line)",
            }}>
                <svg className="icon sm"><use href="#i-bell" /></svg>
                <b style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>Notifications</b>
                <button
                    onClick={() => setMuted(!muted)}
                    title={muted ? "Unmute cards" : "Mute cards — the tray keeps filling"}
                    style={{
                        marginLeft: "auto", height: 20, padding: "0 8px", fontSize: 10.5,
                        border: "1px solid var(--line)", cursor: "pointer",
                        background: muted ? "var(--bg-3)" : "var(--bg-1)",
                        color: muted ? "var(--txt)" : "var(--txt-3)",
                    }}
                >{muted ? "muted" : "mute"}</button>
                <button className="nc-x" onClick={onClose} aria-label="Close">×</button>
            </div>

            {muted && (
                <div style={{
                    flex: "none", padding: "6px 11px", borderBottom: "1px solid var(--line-soft)",
                    font: "400 10.5px var(--font)", color: "var(--sev-high)", background: "var(--tr31)",
                }}>
                    Cards are muted. Notifications still arrive and are still recorded here.
                </div>
            )}

            <div className="ntfilt">
                {FILTERS.map((f) => (
                    <button
                        key={f.key}
                        aria-pressed={filter === f.key}
                        onClick={() => setFilter(f.key)}
                    >{f.label}{f.key === "unread" && unread > 0 ? ` ${unread}` : ""}</button>
                ))}
                <button className="ntread" onClick={markAllRead}>mark all read</button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {rows.length === 0 && (
                    <div className="empty" style={{ paddingTop: 28 }}>
                        <svg className="icon lg"><use href="#i-bell" /></svg>
                        <p>{items.length === 0
                            ? "Nothing has arrived yet. This tray is the record — anything that does will stay here."
                            : "No notifications match this filter."}</p>
                    </div>
                )}
                {rows.map((n) => {
                    const kind = KIND[n.kind] || KIND.signal
                    return (
                        <button
                            key={n.id}
                            className={`nrow${n.read ? "" : " un"}`}
                            onClick={() => { markRead(n.id); if (onOpenItem) onOpenItem(n) }}
                        >
                            <i className={`dia ${n.sev}`} style={{ marginTop: 4 }} />
                            <svg className="icon sm" style={{ marginTop: 2, color: "var(--txt-3)" }}><use href={`#${kind.icon}`} /></svg>
                            <span style={{ minWidth: 0 }}>
                                <span style={{
                                    display: "block", font: "600 12px var(--font)", color: "var(--txt)",
                                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                }}>{n.title}</span>
                                {n.sub && <span style={{
                                    display: "block", font: "400 10.5px var(--font)", color: "var(--txt-3)", marginTop: 1,
                                }}>{n.sub}</span>}
                            </span>
                            <span style={{ font: "9.5px var(--mono)", color: "var(--txt-4)" }}>{ago(n.ts)}</span>
                        </button>
                    )
                })}
            </div>

            <div style={{
                flex: "none", padding: "7px 11px", borderTop: "1px solid var(--line)",
                font: "400 10px var(--font)", color: "var(--txt-4)", lineHeight: 1.45,
            }}>
                Dismissing a card removes the interruption, never the item. This tray is the record.
            </div>
        </aside>
    )
}
