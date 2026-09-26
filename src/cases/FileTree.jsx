/**
 * FileTree.jsx — folders, subfolders, documents and files inside a case.
 *
 * The server returns the nodes flat and this assembles the tree. Flat is
 * also what answers "where can I move this" and "what is the path of that",
 * neither of which a nested payload can answer without being walked.
 *
 * Drag-and-drop moves a node into a folder. The server rejects a move into
 * a node's own subtree; this only stops the obvious cases early so the
 * common mistake does not need a round trip to be told no.
 */

import { useCallback, useMemo, useRef, useState } from "react"

const ICON = { folder: "▸", doc: "≡", file: "▫" }

function kindIcon(n, open) {
    if (n.kind === "folder") return open ? "▾" : "▸"
    if (n.kind === "doc") return "≡"
    if ((n.mime || "").startsWith("image/")) return "▣"
    if (n.mime === "application/pdf") return "▤"
    return "▫"
}

function buildTree(nodes) {
    const byParent = new Map()
    for (const n of nodes) {
        const k = n.parent_id || "__root__"
        if (!byParent.has(k)) byParent.set(k, [])
        byParent.get(k).push(n)
    }
    for (const list of byParent.values()) {
        // Folders first, then by name — a flat alphabetical mix buries
        // structure among leaves.
        list.sort((a, b) =>
            (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) ||
            a.name.localeCompare(b.name))
    }
    return byParent
}

function isDescendant(nodes, candidateId, ancestorId) {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    let cur = byId.get(candidateId)
    const seen = new Set()
    while (cur && cur.parent_id) {
        if (cur.parent_id === ancestorId) return true
        if (seen.has(cur.parent_id)) break
        seen.add(cur.parent_id)
        cur = byId.get(cur.parent_id)
    }
    return false
}

export default function FileTree({
    nodes, selectedId, onSelect, onMove, onDelete, onRename, readOnly = false,
}) {
    const [open, setOpen] = useState(() => new Set())
    const [dragId, setDragId] = useState(null)
    const [dropId, setDropId] = useState(null)
    const [renaming, setRenaming] = useState(null)
    const renameRef = useRef(null)

    const byParent = useMemo(() => buildTree(nodes), [nodes])

    const toggle = useCallback((id) => {
        setOpen((prev) => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }, [])

    const handleDrop = useCallback((targetId) => {
        setDropId(null)
        const id = dragId
        setDragId(null)
        if (!id || id === targetId) return
        if (targetId && isDescendant(nodes, targetId, id)) return
        onMove?.(id, targetId)
    }, [dragId, nodes, onMove])

    const row = (n, depth) => {
        const kids = byParent.get(n.id) || []
        const isOpen = open.has(n.id)
        const selected = n.id === selectedId
        return (
            <div key={n.id}>
                <div
                    role="treeitem"
                    aria-selected={selected}
                    aria-expanded={n.kind === "folder" ? isOpen : undefined}
                    draggable={!readOnly}
                    onDragStart={() => setDragId(n.id)}
                    onDragEnd={() => { setDragId(null); setDropId(null) }}
                    onDragOver={(e) => {
                        if (readOnly || n.kind !== "folder" || !dragId || dragId === n.id) return
                        e.preventDefault(); setDropId(n.id)
                    }}
                    onDragLeave={() => setDropId((p) => (p === n.id ? null : p))}
                    onDrop={(e) => { e.preventDefault(); if (n.kind === "folder") handleDrop(n.id) }}
                    onClick={() => { if (n.kind === "folder") toggle(n.id); onSelect?.(n) }}
                    onDoubleClick={() => { if (!readOnly) setRenaming(n.id) }}
                    style={{
                        display: "flex", alignItems: "center", gap: 6,
                        padding: `3px 8px 3px ${8 + depth * 13}px`,
                        background: dropId === n.id ? "var(--acc-dim, #2b3a4a)"
                                  : selected ? "var(--bg-3, #2a2e34)" : "transparent",
                        color: selected ? "var(--txt)" : "var(--txt-2)",
                        cursor: "pointer", font: "400 12px var(--font)",
                        borderLeft: selected ? "2px solid var(--acc-hi)" : "2px solid transparent",
                    }}
                >
                    <span style={{ width: 10, color: "var(--txt-3)", flexShrink: 0 }}>{kindIcon(n, isOpen)}</span>
                    {renaming === n.id ? (
                        <input
                            ref={renameRef}
                            defaultValue={n.name}
                            autoFocus
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => { setRenaming(null); const v = e.target.value.trim(); if (v && v !== n.name) onRename?.(n.id, v) }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") e.target.blur()
                                if (e.key === "Escape") { setRenaming(null) }
                            }}
                            style={{
                                flex: 1, minWidth: 0, height: 18, background: "var(--bg-0)",
                                border: "1px solid var(--acc-hi)", color: "var(--txt)",
                                font: "400 12px var(--font)", padding: "0 4px",
                            }}
                        />
                    ) : (
                        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {n.name}
                        </span>
                    )}
                    {n.kind === "file" && n.size_bytes != null && (
                        <span style={{ font: "400 10px var(--mono)", color: "var(--txt-4)", flexShrink: 0 }}>
                            {fmtSize(n.size_bytes)}
                        </span>
                    )}
                    {!readOnly && (
                        <span
                            role="button"
                            title="Delete"
                            onClick={(e) => { e.stopPropagation(); onDelete?.(n) }}
                            style={{ color: "var(--txt-4)", flexShrink: 0, padding: "0 2px" }}
                        >&#10005;</span>
                    )}
                </div>
                {n.kind === "folder" && isOpen && kids.map((k) => row(k, depth + 1))}
            </div>
        )
    }

    const roots = byParent.get("__root__") || []

    return (
        <div
            role="tree"
            onDragOver={(e) => { if (dragId && !readOnly) { e.preventDefault(); setDropId("__root__") } }}
            onDrop={(e) => { e.preventDefault(); handleDrop(null) }}
            style={{
                flex: 1, minHeight: 0, overflowY: "auto",
                outline: dropId === "__root__" ? "1px dashed var(--acc-hi)" : "none",
            }}
        >
            {roots.length === 0 ? (
                <p style={{ font: "400 11px var(--font)", color: "var(--txt-3)", padding: "10px 12px", lineHeight: 1.6 }}>
                    Nothing in this case yet. Add a folder, write a document, or drop in a
                    PDF or image.
                </p>
            ) : roots.map((n) => row(n, 0))}
        </div>
    )
}

function fmtSize(b) {
    if (b < 1024) return `${b}B`
    if (b < 1024 * 1024) return `${Math.round(b / 1024)}K`
    return `${(b / 1024 / 1024).toFixed(1)}M`
}
