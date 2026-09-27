/**
 * LayerSubGroup.jsx — a collapsible band INSIDE a LayerGroup.
 *
 * The rail had two kinds of heading and only one of them worked. A
 * LayerGroup ("Context layers", "Global infrastructure") collapses; the
 * headings nested inside it — Airspace, Vessel activity events, Frontlines,
 * Live tracks — were plain text, so a group you opened to reach one switch
 * unrolled every switch underneath it. The rail was a single long scroll
 * again, which is the exact problem LayerGroup was added to solve.
 *
 * This is that component one level down: same open-state memory, same rule
 * that a collapsed band still shows how many of its layers are ON, so the
 * panel can never disagree with the map about what is drawn.
 *
 * Kept separate from LayerGroup rather than adding a `depth` prop, because
 * the two differ in more than indentation — a subgroup is quieter, denser,
 * and defaults to closed where a top-level group defaults to open.
 */
import { useCallback, useEffect, useState } from "react"

const KEY = "akili-layersubgroups-v1"

function readOpen() {
    try {
        const raw = localStorage.getItem(KEY)
        return raw ? JSON.parse(raw) : {}
    } catch {
        // Private window, blocked storage, or a corrupted value — the rail
        // must still render, so a failed read is simply "defaults".
        return {}
    }
}

function writeOpen(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
}

export default function LayerSubGroup({
    id, title, note = null, activeCount = 0, defaultOpen = false, children,
}) {
    const [open, setOpen] = useState(() => {
        const saved = readOpen()[id]
        return typeof saved === "boolean" ? saved : defaultOpen
    })

    useEffect(() => {
        const saved = readOpen()[id]
        if (typeof saved === "boolean" && saved !== open) setOpen(saved)
        // Only on mount, and only for this id: a later write from a sibling
        // must not yank this one open or shut under the reader.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id])

    const toggle = useCallback(() => {
        setOpen((prev) => {
            const next = !prev
            writeOpen({ ...readOpen(), [id]: next })
            return next
        })
    }, [id])

    return (
        <div style={{ borderTop: "1px solid var(--line-soft, rgba(255,255,255,.05))" }}>
            <button
                onClick={toggle}
                aria-expanded={open}
                title={open ? `Collapse ${title}` : `Expand ${title}`}
                style={{
                    width: "100%", display: "flex", alignItems: "center", gap: 6,
                    padding: "6px 12px 5px", background: "none", border: "none",
                    cursor: "pointer", textAlign: "left",
                }}
            >
                <svg className="icon sm" style={{
                    flexShrink: 0, opacity: 0.55,
                    transform: open ? "rotate(90deg)" : "none",
                    transition: "transform .12s",
                }}>
                    <use href="#i-next" />
                </svg>
                <span style={{ flex: 1, minWidth: 0, font: "600 11px var(--font)", color: "var(--txt-3)" }}>
                    {title}
                    {note ? (
                        <span style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginLeft: 6 }}>
                            {note}
                        </span>
                    ) : null}
                </span>
                {/* A collapsed band that hides three active layers would make
                    the panel disagree with the map. The count stays. */}
                {activeCount > 0 ? (
                    <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", flexShrink: 0 }}>
                        {activeCount}
                    </span>
                ) : null}
            </button>
            {open ? <div>{children}</div> : null}
        </div>
    )
}
