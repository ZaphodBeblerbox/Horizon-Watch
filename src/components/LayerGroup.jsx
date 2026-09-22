/**
 * LayerGroup.jsx — a collapsible band in the Layers rail.
 *
 * The rail had grown into one continuous scroll of toggles: event
 * domains, context layers, airspace, GFW, infrastructure, theatres, all
 * at the same visual weight with nothing to collapse. Finding the one
 * switch you wanted meant reading all of them.
 *
 * Open state is remembered per group, because which bands an operator
 * keeps open is a working preference, not a session detail. It is kept
 * in localStorage rather than anywhere shared: it is a per-viewer
 * convenience and losing it costs nothing.
 *
 * The count of what is ON in a collapsed group stays visible. A
 * collapsed band that hides the fact that three layers are active would
 * make the map disagree with the panel, which is the one thing a layer
 * rail must never do.
 */
import { useCallback, useEffect, useState } from "react"

const KEY = "akili-layergroups-v1"

function readOpen() {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        // Private window, blocked storage, or a corrupted value — the
        // rail must still render, so a failed read is simply "defaults".
        return {}
    }
}

function writeOpen(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

export default function LayerGroup({ id, title, note = null, activeCount = 0,
                                     defaultOpen = true, children }) {
    const [open, setOpen] = useState(() => {
        const saved = readOpen()
        return typeof saved[id] === "boolean" ? saved[id] : defaultOpen
    })

    useEffect(() => {
        const saved = readOpen()
        if (saved[id] !== open) writeOpen({ ...saved, [id]: open })
    }, [id, open])

    const toggle = useCallback(() => setOpen((v) => !v), [])

    return (
        <div style={{ padding: "4px 0", borderBottom: "1px solid var(--line-soft)" }}>
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                title={open ? "Collapse" : "Expand"}
                style={{
                    display: "flex", alignItems: "center", gap: 6, width: "100%",
                    padding: "6px 12px", background: "none", border: "none",
                    cursor: "pointer", textAlign: "left",
                    font: "600 11px var(--font)", color: "var(--txt-3)",
                }}
            >
                <svg className="icon sm" style={{
                    transform: open ? "rotate(90deg)" : "none",
                    transition: "transform 120ms ease",
                    flex: "0 0 auto", opacity: 0.7,
                }}><use href="#i-next" /></svg>
                <span>{title}</span>
                {note ? (
                    <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>
                        {note}
                    </span>
                ) : null}
                {/* Always visible, open or closed — see the header comment. */}
                {activeCount > 0 ? (
                    <span style={{
                        marginLeft: "auto", font: "400 10px var(--mono)",
                        color: "var(--txt-3)",
                    }}>{activeCount} on</span>
                ) : (
                    <span style={{ marginLeft: "auto", font: "400 10px var(--mono)",
                                   color: "var(--txt-4)" }}>off</span>
                )}
            </button>
            {open ? <div>{children}</div> : null}
        </div>
    )
}
