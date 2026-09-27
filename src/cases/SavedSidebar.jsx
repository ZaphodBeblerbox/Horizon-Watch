/**
 * SavedSidebar.jsx — the writer's reference pane: a minimap at the top, and
 * below it everything saved off the map to write about.
 *
 * Clicking an item puts it in the document. That is the whole point of
 * saving it — a list you can only look at makes you go and find the thing
 * again somewhere else.
 *
 * The minimap shows where the saved items are, with the hovered one
 * highlighted, so the list has a geography rather than being names in an
 * arbitrary order.
 */

import { useState, useEffect, useCallback } from "react"
import MiniMap from "../reports/MiniMap.jsx"
import { useSaved, removeSaved, savedLabel, savedMeta } from "../state/savedForBriefing.js"
import { getFilingCase } from "../state/filingCase.js"
import { listNodes, fileUrl } from "../lib/casesApi.js"
import Loading from "../ui/Loading.jsx"

/**
 * The case's own filing, in the pane you write from.
 *
 * Recent holds what you kept in this sitting and is capped at 120. The case
 * is the durable copy: Signals/<type> and Screenshots/<type>, everything
 * ever filed. Writing a report a week later needs the second one, and
 * having to leave the editor to find it is how people end up keeping a
 * folder of screenshots on the desktop instead.
 */
function CaseTree({ onInsert }) {
    const caseId = getFilingCase()
    const [nodes, setNodes] = useState(null)
    const [open, setOpen] = useState({})
    const load = useCallback(() => {
        if (!caseId) { setNodes([]); return }
        listNodes(caseId).then((r) => setNodes(Array.isArray(r) ? r : r?.nodes || []))
                         .catch(() => setNodes([]))
    }, [caseId])
    useEffect(() => { load() }, [load])

    if (!caseId) {
        return <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "8px 12px", lineHeight: 1.6 }}>
            No case open. Open one in Workstation and anything you save from the
            map files itself here, under Signals and Screenshots.
        </p>
    }
    if (nodes === null) return <Loading size={18} inline label="Loading case files" style={{ padding: "8px 12px" }} />

    const childrenOf = (pid) => nodes.filter((n) => (n.parent_id || null) === (pid || null))
                                     .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "folder" ? -1 : 1))
    const roots = childrenOf(null)
    if (roots.length === 0) {
        return <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "8px 12px", lineHeight: 1.6 }}>
            This case has nothing filed yet.
        </p>
    }

    const Row = ({ n, depth }) => {
        const isFolder = n.kind === "folder"
        const kids = isFolder ? childrenOf(n.id) : []
        const isOpen = open[n.id] !== false            // folders start open
        return (
            <>
                <div role="button"
                     onClick={() => isFolder
                         ? setOpen((p) => ({ ...p, [n.id]: !isOpen }))
                         : onInsert?.({
                             id: `case:${n.id}`,
                             kind: n.kind === "signal" ? "signal" : "capture",
                             headline: n.name,
                             imageUrl: n.kind === "file" && (n.mime || "").startsWith("image/")
                                 ? fileUrl(caseId, n.id) : null,
                             detail: n.kind === "signal" ? "filed signal" : n.mime || null,
                         })}
                     title={isFolder ? (isOpen ? "Collapse" : "Expand") : "Insert into the document"}
                     style={{
                         display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                         padding: "5px 10px 5px " + (10 + depth * 12) + "px",
                         borderBottom: "1px solid var(--line)",
                         font: "400 11.5px var(--font)",
                         color: isFolder ? "var(--txt-3)" : "var(--txt-2)",
                     }}>
                    <svg className="icon sm" style={{ flexShrink: 0, opacity: .8 }}>
                        <use href={isFolder ? "#i-case" : n.kind === "signal" ? "#i-pin" : "#i-doc"} />
                    </svg>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden",
                                   textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.name}</span>
                    {isFolder && kids.length > 0 && (
                        <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{kids.length}</span>
                    )}
                </div>
                {isFolder && isOpen && kids.map((k) => <Row key={k.id} n={k} depth={depth + 1} />)}
            </>
        )
    }
    return <div>{roots.map((n) => <Row key={n.id} n={n} depth={0} />)}</div>
}

export default function SavedSidebar({ onInsert }) {
    const items = useSaved()
    const [hover, setHover] = useState(null)
    const [tab, setTab] = useState("recent")

    const located = items.filter((i) => i.lat != null && i.lon != null)
    const focus = hover && hover.lat != null
        ? { lat: hover.lat, lon: hover.lon }
        : located[0] ? { lat: located[0].lat, lon: located[0].lon } : null

    return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div style={{ borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                <MiniMap
                    focus={focus}
                    context={located.map((i) => ({ lat: i.lat, lon: i.lon }))}
                    height={150}
                />
            </div>

            {/* Two places a thing can be: what you kept just now, and what
                the case has on file. They are genuinely different lists —
                Recent is capped and per-session-ish, the case is the record
                — so they get a switch rather than being merged into one
                list that is sometimes truncated without saying so. */}
            <div style={{ display: "flex", borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                {[["recent", "Recent"], ["case", "Case files"]].map(([k, label]) => (
                    <button key={k} onClick={() => setTab(k)}
                            aria-pressed={tab === k}
                            style={{
                                flex: 1, padding: "6px 8px", background: tab === k ? "var(--bg-3)" : "transparent",
                                border: "none", borderBottom: tab === k ? "1px solid var(--accent)" : "1px solid transparent",
                                color: tab === k ? "var(--txt)" : "var(--txt-4)", cursor: "pointer",
                                font: "400 11px var(--font)",
                            }}>{label}</button>
                ))}
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {tab === "case" ? <CaseTree onInsert={onInsert} /> : items.length === 0 ? (
                    <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "4px 12px", lineHeight: 1.6 }}>
                        Nothing saved yet. Save a detection or a signal from the map and it
                        appears here, ready to drop into the page.
                    </p>
                ) : items.map((i) => (
                    <div
                        key={i.id}
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover(null)}
                        style={{
                            display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 10px",
                            borderBottom: "1px solid var(--line)",
                            background: hover?.id === i.id ? "var(--bg-3, #2a2e34)" : "transparent",
                        }}
                    >
                        {i.imageUrl && (
                            <img src={i.imageUrl} alt="" style={{
                                width: 34, height: 34, objectFit: "cover", flexShrink: 0,
                                border: "1px solid var(--line)",
                            }} />
                        )}
                        <div role="button" onClick={() => onInsert?.(i)} title="Insert into the document"
                             style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                            {/* The headline, wrapped to three lines. A
                                report truncated to one line is a report you
                                have to open something else to read. */}
                            <div style={{
                                font: "400 12px var(--font)", color: "var(--txt-2)", lineHeight: 1.35,
                                display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                            }}>
                                {savedLabel(i)}
                            </div>
                            <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginTop: 2 }}>
                                {savedMeta(i) || i.detail}
                            </div>
                        </div>
                        <span role="button" title="Remove" onClick={() => removeSaved(i.id)}
                              style={{ color: "var(--txt-4)", flexShrink: 0, cursor: "pointer", font: "400 11px var(--font)" }}>
                            &#10005;
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
