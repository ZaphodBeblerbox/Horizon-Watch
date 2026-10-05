/**
 * FileExplorer.jsx — the case's filing system, as a file explorer.
 *
 * A case holds a theater's whole working record: signals, screenshots,
 * briefings, decks, documents and notes, in folders the analyst makes.
 * That is a filesystem, so it is presented as one — an address bar with
 * history, a folder tree, a sortable details list or an icon grid,
 * right-click, F2 to rename, Delete to delete, drag to move, drop to
 * upload. People already know how to drive this; nothing here needs to be
 * learnt.
 *
 * The tree is the SAME CaseNode rows the rest of the app files into. This
 * is a view of the store, not a second one: a signal filed by voice shows
 * up here without anything being copied.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import DocEditor from "./DocEditor.jsx"
import {
    listNodes, createNode, updateNode, deleteNode, getDoc, uploadFile, fileUrl,
} from "../lib/casesApi.js"
import { toast } from "../ui/toast.js"
import Loading from "../ui/Loading.jsx"
import { safeArray } from "../utils/safeArray.js"
import { fmtWhen } from "../utils/formatTime.js"

/* ── what a node looks like ──────────────────────────────────────────── */

const FOLDER_TINT = "#d8b36a"

function iconKind(n) {
    if (n.kind === "folder") return "folder"
    if (n.kind === "doc") return "doc"
    const m = n.mime || ""
    if (m.startsWith("image/")) return "image"
    if (m === "application/pdf") return "pdf"
    if (m.startsWith("video/")) return "video"
    return "file"
}

/** Real shapes, not glyphs: at icon size a "▫" is a speck. */
function Glyph({ kind, size = 16 }) {
    const s = { width: size, height: size, flexShrink: 0, display: "block" }
    const line = "var(--txt-3)"
    if (kind === "folder") {
        return (
            <svg style={s} viewBox="0 0 24 24" aria-hidden="true">
                <path d="M2 6.5A1.5 1.5 0 0 1 3.5 5h5.2l1.8 2.2h8A1.5 1.5 0 0 1 20 8.7V18a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 2 18z"
                      fill={FOLDER_TINT} fillOpacity=".22" stroke={FOLDER_TINT} strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
        )
    }
    const page = (
        <>
            <path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"
                  fill="none" stroke={line} strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M13 3v5h5" fill="none" stroke={line} strokeWidth="1.3" strokeLinejoin="round" />
        </>
    )
    if (kind === "doc") {
        return (
            <svg style={s} viewBox="0 0 24 24" aria-hidden="true">
                {page}
                <path d="M8 12h7M8 15h7M8 18h4" stroke="var(--acc-hi)" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
        )
    }
    if (kind === "image") {
        return (
            <svg style={s} viewBox="0 0 24 24" aria-hidden="true">
                {page}
                <circle cx="9.5" cy="13" r="1.4" fill="#8fa6c6" />
                <path d="M7 19l3.5-4 2.5 2.6 2-2.1L18 19z" fill="#8fa6c6" fillOpacity=".55" />
            </svg>
        )
    }
    if (kind === "pdf") {
        return (
            <svg style={s} viewBox="0 0 24 24" aria-hidden="true">
                {page}
                <text x="12" y="18" textAnchor="middle" fill="#c4453c"
                      style={{ font: "700 6px var(--font)" }}>PDF</text>
            </svg>
        )
    }
    if (kind === "video") {
        return (
            <svg style={s} viewBox="0 0 24 24" aria-hidden="true">
                {page}
                <path d="M10 13.5l5 2.6-5 2.6z" fill="#8fa6c6" />
            </svg>
        )
    }
    return <svg style={s} viewBox="0 0 24 24" aria-hidden="true">{page}</svg>
}

function typeLabel(n) {
    if (n.kind === "folder") return "File folder"
    if (n.kind === "doc") return "Document"
    const m = n.mime || ""
    if (m.startsWith("image/")) return `${m.slice(6).toUpperCase()} image`
    if (m === "application/pdf") return "PDF document"
    const ext = (n.name.split(".").pop() || "").toUpperCase()
    return ext && ext !== n.name.toUpperCase() ? `${ext} file` : "File"
}

function fmtBytes(b) {
    if (b == null) return ""
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`
    if (b < 1024 * 1024 * 1024) return `${(b / 1048576).toFixed(1)} MB`
    return `${(b / 1073741824).toFixed(1)} GB`
}

/* The backend sends naive UTC. Date.parse reads a bare timestamp as LOCAL,
   which is how a file saved a minute ago gets stamped an hour out. */
function fmtDate(iso) {
    if (!iso) return ""
    // fmtWhen reads a naive timestamp as UTC, which is the fix this
    // function used to make by hand.
    const out = fmtWhen(iso, { precision: "minute" })
    return out && out !== String(iso) ? out : ""
}

/* ── tree maths ──────────────────────────────────────────────────────── */

function childrenOf(nodes, parentId) {
    return nodes.filter((n) => (n.parent_id || null) === (parentId || null))
}

function pathOf(nodes, id) {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const out = []
    const seen = new Set()
    let cur = byId.get(id)
    while (cur && !seen.has(cur.id)) {
        seen.add(cur.id)
        out.unshift(cur)
        cur = cur.parent_id ? byId.get(cur.parent_id) : null
    }
    return out
}

function isDescendant(nodes, candidateId, ancestorId) {
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const seen = new Set()
    let cur = byId.get(candidateId)
    while (cur?.parent_id && !seen.has(cur.parent_id)) {
        if (cur.parent_id === ancestorId) return true
        seen.add(cur.parent_id)
        cur = byId.get(cur.parent_id)
    }
    return false
}

function descendants(nodes, id) {
    const out = []
    const walk = (p) => {
        for (const n of nodes) if ((n.parent_id || null) === p) { out.push(n); walk(n.id) }
    }
    walk(id)
    return out
}

/** A name that does not collide with its siblings — "New folder (2)". */
function uniqueName(nodes, parentId, base) {
    const taken = new Set(childrenOf(nodes, parentId).map((n) => n.name.toLowerCase()))
    if (!taken.has(base.toLowerCase())) return base
    for (let i = 2; i < 500; i++) {
        const t = `${base} (${i})`
        if (!taken.has(t.toLowerCase())) return t
    }
    return `${base} ${Date.now()}`
}

const SORTERS = {
    name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" }),
    updated_at: (a, b) => String(a.updated_at || "").localeCompare(String(b.updated_at || "")),
    type: (a, b) => typeLabel(a).localeCompare(typeLabel(b)) || a.name.localeCompare(b.name),
    size: (a, b) => (a.size_bytes || 0) - (b.size_bytes || 0),
}

/* ── the explorer ────────────────────────────────────────────────────── */

export default function FileExplorer({ caseId, readOnly = false, rootLabel = "Case files", onNewCase = null }) {
    const [nodes, setNodes] = useState([])
    const [loading, setLoading] = useState(false)

    const [cwd, setCwd] = useState(null)                 // folder id, null = case root
    const [hist, setHist] = useState([null])             // visited folders
    const [histAt, setHistAt] = useState(0)

    const [sel, setSel] = useState(() => new Set())      // selected node ids
    const [anchor, setAnchor] = useState(null)           // for shift-range
    const [renaming, setRenaming] = useState(null)       // node id being renamed
    const [open, setOpen] = useState(null)               // node being viewed/edited
    const [docHtml, setDocHtml] = useState(null)
    const [menu, setMenu] = useState(null)               // {x, y, node}

    const [view, setView] = useState(() => localStorage.getItem("plx.explorer.view") || "details")
    const [sort, setSort] = useState({ key: "name", dir: 1 })
    const [query, setQuery] = useState("")

    const [expanded, setExpanded] = useState(() => new Set())
    const [dropTarget, setDropTarget] = useState(null)   // folder id (or "__cwd__") under the cursor
    const [busy, setBusy] = useState("")                 // status-bar progress line

    const shell = useRef(null)
    const fileInput = useRef(null)

    /* ── loading ─────────────────────────────────────────────────────── */

    const refresh = useCallback(() => {
        if (!caseId) return
        setLoading(true)
        listNodes(caseId)
            .then((v) => setNodes(safeArray(v)))
            .catch((e) => toast(e.message || "Could not load case files", { icon: "i-alert" }))
            .finally(() => setLoading(false))
    }, [caseId])

    useEffect(() => {
        refresh()
        setCwd(null); setHist([null]); setHistAt(0)
        setSel(new Set()); setOpen(null); setQuery("")
    }, [refresh])

    // A document's body is fetched when it is opened, never with the listing.
    useEffect(() => {
        if (!open || open.kind !== "doc") { setDocHtml(null); return }
        let live = true
        setDocHtml(null)
        getDoc(caseId, open.id)
            .then((d) => { if (live) setDocHtml(d.body_html || "") })
            .catch(() => { if (live) setDocHtml("") })
        return () => { live = false }
    }, [caseId, open])

    /* ── navigation ──────────────────────────────────────────────────── */

    const go = useCallback((folderId) => {
        setOpen(null)
        setSel(new Set())
        setQuery("")
        setCwd(folderId)
        setHist((h) => [...h.slice(0, histAt + 1), folderId])
        setHistAt((i) => i + 1)
        // Reveal where we landed in the tree on the left.
        setExpanded((e) => {
            const next = new Set(e)
            for (const p of pathOf(nodes, folderId)) next.add(p.id)
            return next
        })
    }, [histAt, nodes])

    const trail = useMemo(() => (cwd ? pathOf(nodes, cwd) : []), [nodes, cwd])
    const canBack = histAt > 0
    const canFwd = histAt < hist.length - 1
    const parentId = trail.length ? (trail[trail.length - 1].parent_id || null) : null
    const canUp = cwd != null

    const back = () => { if (canBack) { const i = histAt - 1; setHistAt(i); setCwd(hist[i]); setOpen(null); setSel(new Set()) } }
    const fwd = () => { if (canFwd) { const i = histAt + 1; setHistAt(i); setCwd(hist[i]); setOpen(null); setSel(new Set()) } }
    const up = () => { if (canUp) go(parentId) }

    /* ── what the pane shows ─────────────────────────────────────────── */

    const items = useMemo(() => {
        const q = query.trim().toLowerCase()
        // SEARCH LOOKS DOWNWARD, like Explorer's: searching a folder means
        // searching everything under it, not just its own children.
        const base = q
            ? (cwd ? descendants(nodes, cwd) : nodes).filter((n) => n.name.toLowerCase().includes(q))
            : childrenOf(nodes, cwd)
        const s = SORTERS[sort.key] || SORTERS.name
        return [...base].sort((a, b) =>
            (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) || s(a, b) * sort.dir)
    }, [nodes, cwd, query, sort])

    const selected = useMemo(() => items.filter((n) => sel.has(n.id)), [items, sel])
    const only = selected.length === 1 ? selected[0] : null

    /* ── selection ───────────────────────────────────────────────────── */

    const click = (n, e) => {
        if (e.shiftKey && anchor) {
            const a = items.findIndex((x) => x.id === anchor)
            const b = items.findIndex((x) => x.id === n.id)
            if (a >= 0 && b >= 0) {
                const [lo, hi] = a < b ? [a, b] : [b, a]
                setSel(new Set(items.slice(lo, hi + 1).map((x) => x.id)))
                return
            }
        }
        if (e.metaKey || e.ctrlKey) {
            setSel((p) => { const s = new Set(p); s.has(n.id) ? s.delete(n.id) : s.add(n.id); return s })
            setAnchor(n.id)
            return
        }
        setSel(new Set([n.id]))
        setAnchor(n.id)
    }

    const openNode = useCallback((n) => {
        if (n.kind === "folder") go(n.id)
        else setOpen(n)
    }, [go])

    /* ── mutations ───────────────────────────────────────────────────── */

    const newNode = async (kind) => {
        const base = kind === "folder" ? "New folder" : "New document"
        const name = uniqueName(nodes, cwd, base)
        try {
            const n = await createNode(caseId, { kind, name, parent_id: cwd })
            setNodes((p) => [...p, n])
            setSel(new Set([n.id]))
            // Created, then named — the way Explorer does it, so the name is
            // typed over a live row instead of into a modal that stops everything.
            setRenaming(n.id)
        } catch (e) { toast(e.message || `Could not create ${kind}`, { icon: "i-alert" }) }
    }

    const doUpload = useCallback(async (files, into = undefined) => {
        const target = into === undefined ? cwd : into
        const list = Array.from(files || [])
        for (let i = 0; i < list.length; i++) {
            const f = list[i]
            setBusy(`Uploading ${f.name}${list.length > 1 ? ` (${i + 1} of ${list.length})` : ""}…`)
            try {
                const n = await uploadFile(caseId, f, target)
                setNodes((p) => [...p, n])
            } catch (e) {
                toast(`${f.name}: ${e.message || "upload failed"}`, { icon: "i-alert" })
            }
        }
        setBusy("")
    }, [caseId, cwd])

    const commitRename = async (id, name) => {
        setRenaming(null)
        const was = nodes.find((n) => n.id === id)
        const next = (name || "").trim()
        if (!next || !was || next === was.name) return
        try {
            const n = await updateNode(caseId, id, { name: next })
            setNodes((p) => p.map((x) => (x.id === id ? n : x)))
            setOpen((o) => (o?.id === id ? n : o))
        } catch (e) { toast(e.message || "Could not rename", { icon: "i-alert" }) }
    }

    const move = useCallback(async (ids, parent) => {
        const list = ids.filter((id) => id !== parent && !isDescendant(nodes, parent, id))
        if (!list.length) return
        for (const id of list) {
            try {
                const n = await updateNode(caseId, id, { parent_id: parent })
                setNodes((p) => p.map((x) => (x.id === id ? n : x)))
            } catch (e) { toast(e.message || "Could not move", { icon: "i-alert" }) }
        }
    }, [caseId, nodes])

    const remove = useCallback(async (list) => {
        if (!list.length) return
        const inside = list.reduce((a, n) => a + (n.kind === "folder" ? descendants(nodes, n.id).length : 0), 0)
        const what = list.length === 1
            ? `"${list[0].name}"${inside ? ` and the ${inside} item${inside === 1 ? "" : "s"} inside it` : ""}`
            : `${list.length} items${inside ? ` and the ${inside} inside them` : ""}`
        if (!confirm(`Delete ${what}? This cannot be undone.`)) return
        for (const n of list) {
            try { await deleteNode(caseId, n.id) }
            catch (e) { toast(e.message || `Could not delete ${n.name}`, { icon: "i-alert" }) }
        }
        setSel(new Set()); setOpen(null)
        refresh()
    }, [caseId, nodes, refresh])

    /* ── keyboard ────────────────────────────────────────────────────── */

    const onKeyDown = (e) => {
        if (renaming || open) return
        const tag = (e.target.tagName || "").toLowerCase()
        if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return

        if (e.key === "Enter" && only) { e.preventDefault(); openNode(only); return }
        if (e.key === "F2" && only && !readOnly) { e.preventDefault(); setRenaming(only.id); return }
        if ((e.key === "Delete" || e.key === "Backspace") && selected.length && !readOnly) {
            e.preventDefault()
            if (e.key === "Backspace" && !selected.length) return
            if (e.key === "Backspace") { up(); return }
            remove(selected); return
        }
        if (e.key === "Backspace") { e.preventDefault(); up(); return }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
            e.preventDefault(); setSel(new Set(items.map((n) => n.id))); return
        }
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault()
            const i = only ? items.findIndex((x) => x.id === only.id) : -1
            const j = Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))
            const n = items[j]
            if (n) { setSel(new Set([n.id])); setAnchor(n.id) }
        }
    }

    useEffect(() => {
        if (!menu) return
        const close = () => setMenu(null)
        window.addEventListener("click", close)
        window.addEventListener("scroll", close, true)
        return () => { window.removeEventListener("click", close); window.removeEventListener("scroll", close, true) }
    }, [menu])

    useEffect(() => { localStorage.setItem("plx.explorer.view", view) }, [view])

    /* ── drops ───────────────────────────────────────────────────────── */

    const dropOn = (folderId) => ({
        onDragOver: (e) => {
            if (readOnly) return
            e.preventDefault(); e.stopPropagation()
            e.dataTransfer.dropEffect = e.dataTransfer.types.includes("Files") ? "copy" : "move"
            setDropTarget(folderId ?? "__root__")
        },
        onDragLeave: (e) => { e.stopPropagation(); setDropTarget(null) },
        onDrop: (e) => {
            if (readOnly) return
            e.preventDefault(); e.stopPropagation()
            setDropTarget(null)
            const files = Array.from(e.dataTransfer?.files || [])
            if (files.length) { doUpload(files, folderId); return }
            const ids = (e.dataTransfer.getData("text/plx-nodes") || "").split(",").filter(Boolean)
            if (ids.length) move(ids, folderId)
        },
    })

    const dropHighlight = (id) => (dropTarget === (id ?? "__root__")
        ? { background: "var(--acc-dim)", outline: "1px solid var(--acc-line)" } : null)

    /* ── chrome ──────────────────────────────────────────────────────── */

    // GLASS, NOT A FILL. The window behind this is translucent over the
    // map; a solid --bg-1 here would punch an opaque rectangle through it
    // and the explorer would be the one pane in the app that is not glass.
    const pane = { background: "transparent", border: "1px solid var(--gline)" }

    return (
        <div
            ref={shell}
            tabIndex={0}
            onKeyDown={onKeyDown}
            data-testid="file-explorer"
            style={{
                display: "flex", flexDirection: "column", height: "100%", minHeight: 420,
                width: "100%", minWidth: 0, outline: "none", ...pane,
            }}
        >
            {/* address bar */}
            <div style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
                borderBottom: "1px solid var(--gline)", background: "var(--glass2)", flexShrink: 0,
            }}>
                <NavBtn label="Back" disabled={!canBack} onClick={back}>‹</NavBtn>
                <NavBtn label="Forward" disabled={!canFwd} onClick={fwd}>›</NavBtn>
                <NavBtn label="Up one level" disabled={!canUp} onClick={up}>↑</NavBtn>

                <div
                    {...dropOn(null)}
                    style={{
                        flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 2,
                        padding: "0 8px", height: 26, overflow: "hidden",
                        background: "var(--glass2)", border: "1px solid var(--gline)",
                        ...(dropHighlight(null) || {}),
                    }}
                >
                    <Crumb onClick={() => go(null)} active={!cwd}>{rootLabel}</Crumb>
                    {trail.map((n, i) => (
                        <span key={n.id} style={{ display: "flex", alignItems: "center", minWidth: 0 }}>
                            <span style={{ color: "var(--txt-4, var(--txt-3))", padding: "0 2px" }}>›</span>
                            <Crumb onClick={() => go(n.id)} active={i === trail.length - 1}
                                   dropProps={dropOn(n.id)} highlight={dropHighlight(n.id)}>
                                {n.name}
                            </Crumb>
                        </span>
                    ))}
                </div>

                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={cwd ? `Search ${trail[trail.length - 1]?.name || ""}` : "Search case files"}
                    style={{
                        width: 190, height: 26, padding: "0 8px", background: "var(--glass2)",
                        border: "1px solid var(--gline)", color: "var(--txt)",
                        font: "400 12px var(--font)", outline: "none",
                    }}
                />
            </div>

            {/* toolbar */}
            <div style={{
                display: "flex", alignItems: "center", gap: 4, padding: "5px 8px",
                borderBottom: "1px solid var(--gline)", background: "var(--glass2)", flexShrink: 0,
            }}>
                {/* A NEW CASE IS REACHABLE FROM THE FILES THEMSELVES. The
                    folder button is where people go looking for their filing,
                    and starting a new case is part of filing — not something
                    to be found only in a list on the other side of the window. */}
                {onNewCase && <Tool onClick={onNewCase}>New case</Tool>}
                <Tool onClick={() => newNode("folder")} disabled={readOnly}>New folder</Tool>
                <Tool onClick={() => newNode("doc")} disabled={readOnly}>New document</Tool>
                <Tool onClick={() => fileInput.current?.click()} disabled={readOnly}>Upload</Tool>
                <Sep />
                <Tool onClick={() => only && openNode(only)} disabled={!only}>Open</Tool>
                <Tool onClick={() => only && setRenaming(only.id)} disabled={!only || readOnly}>Rename</Tool>
                <Tool onClick={() => remove(selected)} disabled={!selected.length || readOnly}>Delete</Tool>
                {only?.kind === "file" && (
                    <a className="plx-tool" href={fileUrl(caseId, only.id)} download={only.name}
                       style={TOOL_STYLE}>Download</a>
                )}
                <div style={{ flex: 1 }} />
                <Tool onClick={refresh} title="Reload the case tree">Refresh</Tool>
                <Sep />
                <Tool onClick={() => setView("details")} on={view === "details"} title="Details">☰</Tool>
                <Tool onClick={() => setView("icons")} on={view === "icons"} title="Large icons">▦</Tool>
                <input
                    ref={fileInput} type="file" multiple style={{ display: "none" }}
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.csv,.txt,.json,.geojson,.docx,.pptx,.xlsx,.kml,.kmz"
                    onChange={(e) => { doUpload(e.target.files); e.target.value = "" }}
                />
            </div>

            {/* body */}
            <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
                <NavTree
                    nodes={nodes} cwd={cwd} rootLabel={rootLabel}
                    expanded={expanded} setExpanded={setExpanded}
                    onGo={go} dropOn={dropOn} dropHighlight={dropHighlight}
                />

                <div
                    {...dropOn(cwd)}
                    onClick={(e) => { if (e.target === e.currentTarget) setSel(new Set()) }}
                    style={{
                        flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column",
                        position: "relative",
                        ...(dropTarget === (cwd ?? "__root__") && !open ? { background: "var(--acc-dim)" } : null),
                    }}
                >
                    {open
                        ? <OpenItem
                            caseId={caseId} node={open} docHtml={docHtml} readOnly={readOnly}
                            where={cwd ? (trail[trail.length - 1]?.name || rootLabel) : rootLabel}
                            onClose={() => setOpen(null)}
                            onSave={async (html) => { await updateNode(caseId, open.id, { body_html: html }) }}
                          />
                        : loading
                            ? <Loading size={20} inline label="Reading the case" style={{ padding: 20 }} />
                            : view === "details"
                                ? <Details
                                    items={items} sel={sel} sort={sort} setSort={setSort} nodes={nodes}
                                    renaming={renaming} commitRename={commitRename} setRenaming={setRenaming}
                                    onClick={click} onOpen={openNode} onMenu={setMenu}
                                    readOnly={readOnly} dropOn={dropOn} dropHighlight={dropHighlight}
                                    searching={!!query.trim()} rootLabel={rootLabel}
                                  />
                                : <Icons
                                    items={items} sel={sel}
                                    renaming={renaming} commitRename={commitRename} setRenaming={setRenaming}
                                    onClick={click} onOpen={openNode} onMenu={setMenu}
                                    readOnly={readOnly} dropOn={dropOn} dropHighlight={dropHighlight}
                                  />}

                    {!loading && !open && !items.length && (
                        <div style={{
                            position: "absolute", inset: 0, display: "flex", alignItems: "center",
                            justifyContent: "center", pointerEvents: "none", padding: 24, textAlign: "center",
                        }}>
                            <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", lineHeight: 1.7, maxWidth: 380 }}>
                                {query.trim()
                                    ? `Nothing here matches "${query.trim()}".`
                                    : "This folder is empty. Make a folder, start a document, or drop a PDF or an image anywhere in here."}
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* status bar */}
            <div style={{
                display: "flex", alignItems: "center", gap: 14, padding: "4px 10px",
                borderTop: "1px solid var(--gline)", background: "var(--glass2)", flexShrink: 0,
                font: "400 11px var(--font)", color: "var(--txt-3)",
            }}>
                <span>{items.length} item{items.length === 1 ? "" : "s"}</span>
                {selected.length > 0 && (
                    <span>
                        {selected.length} selected
                        {(() => {
                            const b = selected.reduce((a, n) => a + (n.size_bytes || 0), 0)
                            return b ? ` · ${fmtBytes(b)}` : ""
                        })()}
                    </span>
                )}
                {busy && <span style={{ color: "var(--acc-hi)" }}>{busy}</span>}
                <div style={{ flex: 1 }} />
                {readOnly && <span>Read-only — this case was shared with you to look at.</span>}
            </div>

            {menu && (
                <ContextMenu
                    menu={menu} caseId={caseId} readOnly={readOnly}
                    onOpen={openNode} onRename={(n) => setRenaming(n.id)}
                    onDelete={(n) => remove(sel.has(n.id) ? selected : [n])}
                    onNewFolder={() => newNode("folder")} onNewDoc={() => newNode("doc")}
                    onUpload={() => fileInput.current?.click()}
                    onNewCase={onNewCase}
                    onClose={() => setMenu(null)}
                    count={sel.has(menu.node?.id) ? selected.length : 1}
                />
            )}
        </div>
    )
}

/* ── chrome bits ─────────────────────────────────────────────────────── */

const TOOL_STYLE = {
    height: 24, padding: "0 9px", display: "inline-flex", alignItems: "center",
    background: "transparent", border: "1px solid transparent", color: "var(--txt-2)",
    font: "400 11.5px var(--font)", cursor: "pointer", textDecoration: "none",
}

function Tool({ children, on, disabled, ...rest }) {
    return (
        <button
            type="button" disabled={disabled} {...rest}
            style={{
                ...TOOL_STYLE,
                color: disabled ? "var(--txt-4, #6b7080)" : on ? "var(--txt)" : "var(--txt-2)",
                background: on ? "var(--acc-dim)" : "transparent",
                border: on ? "1px solid var(--acc-line)" : "1px solid transparent",
                cursor: disabled ? "default" : "pointer",
            }}
        >{children}</button>
    )
}

function Sep() {
    return <span style={{ width: 1, height: 16, background: "var(--gline2)", margin: "0 3px" }} />
}

function NavBtn({ children, label, disabled, onClick }) {
    return (
        <button
            type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick}
            style={{
                width: 26, height: 26, display: "grid", placeItems: "center",
                background: "transparent", border: "1px solid var(--gline)",
                color: disabled ? "var(--txt-4, #6b7080)" : "var(--txt-2)",
                font: "400 14px var(--font)", cursor: disabled ? "default" : "pointer",
            }}
        >{children}</button>
    )
}

function Crumb({ children, onClick, active, dropProps, highlight }) {
    return (
        <button
            type="button" onClick={onClick} {...(dropProps || {})}
            style={{
                maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                background: "transparent", border: "1px solid transparent", padding: "2px 5px",
                color: active ? "var(--txt)" : "var(--txt-3)",
                font: `${active ? 600 : 400} 11.5px var(--font)`, cursor: "pointer",
                ...(highlight || {}),
            }}
        >{children}</button>
    )
}

/* ── the folder tree on the left ─────────────────────────────────────── */

function NavTree({ nodes, cwd, rootLabel, expanded, setExpanded, onGo, dropOn, dropHighlight }) {
    const folders = useMemo(() => nodes.filter((n) => n.kind === "folder"), [nodes])
    const kids = useCallback(
        (p) => folders.filter((n) => (n.parent_id || null) === (p || null))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })),
        [folders])

    const toggle = (id) => setExpanded((e) => {
        const s = new Set(e); s.has(id) ? s.delete(id) : s.add(id); return s
    })

    const Row = ({ n, depth }) => {
        const children = kids(n.id)
        const isOpen = expanded.has(n.id)
        const here = cwd === n.id
        return (
            <>
                <div
                    {...dropOn(n.id)}
                    onClick={() => onGo(n.id)}
                    style={{
                        display: "flex", alignItems: "center", gap: 4, height: 24,
                        padding: `0 6px 0 ${6 + depth * 13}px`, cursor: "pointer",
                        background: here ? "var(--acc-dim)" : "transparent",
                        borderLeft: here ? "2px solid var(--acc-hi)" : "2px solid transparent",
                        ...(dropHighlight(n.id) || {}),
                    }}
                >
                    <span
                        onClick={(e) => { e.stopPropagation(); if (children.length) toggle(n.id) }}
                        style={{
                            width: 12, textAlign: "center", color: "var(--txt-3)",
                            font: "400 9px var(--font)", visibility: children.length ? "visible" : "hidden",
                        }}
                    >{isOpen ? "▾" : "▸"}</span>
                    <Glyph kind="folder" size={14} />
                    <span style={{
                        font: `${here ? 600 : 400} 11.5px var(--font)`,
                        color: here ? "var(--txt)" : "var(--txt-2)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{n.name}</span>
                </div>
                {isOpen && children.map((c) => <Row key={c.id} n={c} depth={depth + 1} />)}
            </>
        )
    }

    return (
        <div style={{
            width: 212, flexShrink: 0, borderRight: "1px solid var(--gline)",
            overflow: "auto", padding: "4px 0", background: "transparent",
        }}>
            <div
                {...dropOn(null)}
                onClick={() => onGo(null)}
                style={{
                    display: "flex", alignItems: "center", gap: 5, height: 25, padding: "0 8px",
                    cursor: "pointer", background: cwd == null ? "var(--acc-dim)" : "transparent",
                    borderLeft: cwd == null ? "2px solid var(--acc-hi)" : "2px solid transparent",
                    ...(dropHighlight(null) || {}),
                }}
            >
                <Glyph kind="folder" size={15} />
                <span style={{
                    font: `${cwd == null ? 600 : 400} 11.5px var(--font)`,
                    color: cwd == null ? "var(--txt)" : "var(--txt-2)",
                }}>{rootLabel}</span>
            </div>
            {kids(null).map((n) => <Row key={n.id} n={n} depth={1} />)}
        </div>
    )
}

/* ── details view ────────────────────────────────────────────────────── */

const COLS = [
    { key: "name", label: "Name", grow: true },
    { key: "updated_at", label: "Date modified", width: 148 },
    { key: "type", label: "Type", width: 118 },
    { key: "size", label: "Size", width: 82, right: true },
]

function Details({
    items, sel, sort, setSort, nodes, renaming, commitRename, setRenaming,
    onClick, onOpen, onMenu, readOnly, dropOn, dropHighlight, searching, rootLabel,
}) {
    const head = (c) => (
        <button
            key={c.key} type="button"
            onClick={() => setSort((s) => (s.key === c.key ? { key: c.key, dir: -s.dir } : { key: c.key, dir: 1 }))}
            style={{
                flex: c.grow ? 1 : `0 0 ${c.width}px`, minWidth: 0, height: 26,
                display: "flex", alignItems: "center", justifyContent: c.right ? "flex-end" : "flex-start",
                gap: 4, padding: "0 10px", background: "transparent",
                border: "none", borderRight: "1px solid var(--gline)",
                color: "var(--txt-3)", font: "500 11px var(--font)", cursor: "pointer",
            }}
        >
            {c.label}
            <span style={{ opacity: sort.key === c.key ? 1 : 0, font: "400 8px var(--font)" }}>
                {sort.dir > 0 ? "▲" : "▼"}
            </span>
        </button>
    )

    return (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
            <div style={{
                display: "flex", borderBottom: "1px solid var(--gline)",
                background: "var(--glass2)", flexShrink: 0,
            }}>{COLS.map(head)}</div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {items.map((n) => {
                    const on = sel.has(n.id)
                    const where = searching
                        ? (pathOf(nodes, n.parent_id).map((p) => p.name).join(" / ") || rootLabel)
                        : null
                    return (
                        <div
                            key={n.id}
                            draggable={!readOnly && renaming !== n.id}
                            onDragStart={(e) => {
                                const ids = on ? [...sel] : [n.id]
                                e.dataTransfer.setData("text/plx-nodes", ids.join(","))
                                e.dataTransfer.effectAllowed = "move"
                            }}
                            {...(n.kind === "folder" ? dropOn(n.id) : {})}
                            onClick={(e) => onClick(n, e)}
                            onDoubleClick={() => onOpen(n)}
                            onContextMenu={(e) => {
                                e.preventDefault()
                                if (!sel.has(n.id)) onClick(n, e)
                                onMenu({ x: e.clientX, y: e.clientY, node: n })
                            }}
                            style={{
                                display: "flex", alignItems: "center", height: 27, cursor: "default",
                                background: on ? "var(--acc-dim)" : "transparent",
                                borderBottom: "1px solid var(--gline)",
                                ...(n.kind === "folder" ? (dropHighlight(n.id) || {}) : {}),
                            }}
                        >
                            <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 7, padding: "0 10px" }}>
                                <Glyph kind={iconKind(n)} size={15} />
                                {renaming === n.id
                                    ? <RenameBox name={n.name} onDone={(v) => commitRename(n.id, v)} onCancel={() => setRenaming(null)} />
                                    : <span style={{
                                        font: "400 12px var(--font)", color: "var(--txt)",
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                    }}>{n.name}</span>}
                                {where && (
                                    <span style={{
                                        font: "400 10px var(--font)", color: "var(--txt-3)", flexShrink: 0,
                                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220,
                                    }}>in {where}</span>
                                )}
                            </div>
                            <Cell w={148}>{fmtDate(n.updated_at || n.created_at)}</Cell>
                            <Cell w={118}>{typeLabel(n)}</Cell>
                            <Cell w={82} right>{n.kind === "folder" ? "" : fmtBytes(n.size_bytes)}</Cell>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function Cell({ children, w, right }) {
    return (
        <div style={{
            flex: `0 0 ${w}px`, padding: "0 10px", textAlign: right ? "right" : "left",
            font: "400 11px var(--mono)", color: "var(--txt-3)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{children}</div>
    )
}

/* ── icon view ───────────────────────────────────────────────────────── */

function Icons({ items, sel, renaming, commitRename, setRenaming, onClick, onOpen, onMenu, readOnly, dropOn, dropHighlight }) {
    return (
        <div style={{
            flex: 1, minHeight: 0, overflow: "auto", padding: 12,
            display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(112px, 1fr))",
            gap: 6, alignContent: "start",
        }}>
            {items.map((n) => {
                const on = sel.has(n.id)
                return (
                    <div
                        key={n.id}
                        draggable={!readOnly && renaming !== n.id}
                        onDragStart={(e) => {
                            const ids = on ? [...sel] : [n.id]
                            e.dataTransfer.setData("text/plx-nodes", ids.join(","))
                            e.dataTransfer.effectAllowed = "move"
                        }}
                        {...(n.kind === "folder" ? dropOn(n.id) : {})}
                        onClick={(e) => onClick(n, e)}
                        onDoubleClick={() => onOpen(n)}
                        onContextMenu={(e) => {
                            e.preventDefault()
                            if (!sel.has(n.id)) onClick(n, e)
                            onMenu({ x: e.clientX, y: e.clientY, node: n })
                        }}
                        style={{
                            display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
                            padding: "12px 6px 9px", cursor: "default", minWidth: 0,
                            background: on ? "var(--acc-dim)" : "transparent",
                            border: on ? "1px solid var(--acc-line)" : "1px solid transparent",
                            ...(n.kind === "folder" ? (dropHighlight(n.id) || {}) : {}),
                        }}
                    >
                        <Glyph kind={iconKind(n)} size={42} />
                        {renaming === n.id
                            ? <RenameBox name={n.name} onDone={(v) => commitRename(n.id, v)} onCancel={() => setRenaming(null)} />
                            : <span style={{
                                font: "400 11px var(--font)", color: "var(--txt)", textAlign: "center",
                                lineHeight: 1.35, width: "100%",
                                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                                overflow: "hidden", wordBreak: "break-word",
                            }}>{n.name}</span>}
                    </div>
                )
            })}
        </div>
    )
}

/* ── inline rename ───────────────────────────────────────────────────── */

function RenameBox({ name, onDone, onCancel }) {
    const ref = useRef(null)
    useEffect(() => {
        const el = ref.current
        if (!el) return
        el.focus()
        // Select the stem, not the extension — renaming "scan.png" is
        // almost never a request to retype ".png".
        const dot = name.lastIndexOf(".")
        el.setSelectionRange(0, dot > 0 ? dot : name.length)
    }, [name])
    return (
        <input
            ref={ref} defaultValue={name}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => onDone(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === "Enter") { e.preventDefault(); onDone(e.currentTarget.value) }
                if (e.key === "Escape") { e.preventDefault(); onCancel() }
            }}
            style={{
                flex: 1, minWidth: 0, width: "100%", height: 20, padding: "0 4px",
                background: "var(--glass2)", border: "1px solid var(--acc-line)",
                color: "var(--txt)", font: "400 12px var(--font)", outline: "none",
            }}
        />
    )
}

/* ── right-click ─────────────────────────────────────────────────────── */

function ContextMenu({ menu, caseId, readOnly, onOpen, onRename, onDelete, onNewFolder, onNewDoc, onUpload, onNewCase, onClose, count }) {
    const n = menu.node
    const item = (label, fn, disabled) => (
        <button
            type="button" disabled={disabled}
            onClick={(e) => { e.stopPropagation(); onClose(); fn() }}
            style={{
                display: "block", width: "100%", textAlign: "left", padding: "5px 14px",
                background: "transparent", border: "none",
                color: disabled ? "var(--txt-4, #6b7080)" : "var(--txt-2)",
                font: "400 11.5px var(--font)", cursor: disabled ? "default" : "pointer",
            }}
        >{label}</button>
    )
    return (
        <div
            onClick={(e) => e.stopPropagation()}
            onContextMenu={(e) => { e.preventDefault(); onClose() }}
            style={{
                position: "fixed", left: Math.min(menu.x, window.innerWidth - 190),
                top: Math.min(menu.y, window.innerHeight - 190), zIndex: 9000, width: 178,
                padding: "4px 0", background: "var(--glass)", border: "1px solid var(--gline2)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                boxShadow: "var(--gshadow)",
            }}
        >
            {n ? (
                <>
                    {item(n.kind === "folder" ? "Open" : n.kind === "doc" ? "Edit" : "View", () => onOpen(n))}
                    {n.kind === "file" && (
                        <a href={fileUrl(caseId, n.id)} download={n.name} onClick={onClose}
                           style={{
                               display: "block", padding: "5px 14px", color: "var(--txt-2)",
                               font: "400 11.5px var(--font)", textDecoration: "none",
                           }}>Download</a>
                    )}
                    <div style={{ height: 1, background: "var(--gline)", margin: "4px 0" }} />
                    {item("Rename", () => onRename(n), readOnly || count > 1)}
                    {item(count > 1 ? `Delete ${count} items` : "Delete", () => onDelete(n), readOnly)}
                </>
            ) : (
                <>
                    {item("New folder", onNewFolder, readOnly)}
                    {item("New document", onNewDoc, readOnly)}
                    {item("Upload…", onUpload, readOnly)}
                    {onNewCase && <div style={{ height: 1, background: "var(--gline)", margin: "4px 0" }} />}
                    {onNewCase && item("New case", onNewCase)}
                </>
            )}
        </div>
    )
}

/* ── opening a document or a file ────────────────────────────────────── */

function OpenItem({ caseId, node, docHtml, readOnly, where, onClose, onSave }) {
    const url = fileUrl(caseId, node.id)
    const isImage = (node.mime || "").startsWith("image/")
    const isPdf = node.mime === "application/pdf"

    useEffect(() => {
        const esc = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", esc)
        return () => window.removeEventListener("keydown", esc)
    }, [onClose])

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 9, padding: "5px 10px",
                borderBottom: "1px solid var(--gline)", background: "var(--glass2)", flexShrink: 0,
            }}>
                <button
                    type="button" onClick={onClose}
                    style={{ ...TOOL_STYLE, border: "1px solid var(--gline)" }}
                >‹ {where}</button>
                <Glyph kind={iconKind(node)} size={15} />
                <span style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>{node.name}</span>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>
                    {node.kind === "file" ? `${node.mime || "file"} · ${fmtBytes(node.size_bytes)}` : fmtDate(node.updated_at)}
                </span>
                <div style={{ flex: 1 }} />
                {node.kind === "file" && (
                    <a href={url} download={node.name} style={{ ...TOOL_STYLE, border: "1px solid var(--gline)" }}>Download</a>
                )}
            </div>

            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {node.kind === "doc" && (docHtml === null
                    ? <Loading size={20} inline label="Opening" style={{ padding: 20 }} />
                    : <DocEditor key={node.id} name={node.name} initialHtml={docHtml} onSave={onSave} readOnly={readOnly} />)}

                {node.kind === "file" && (
                    <div style={{
                        flex: 1, minHeight: 0, overflow: "auto", background: "var(--glass2)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                    }}>
                        {isImage && <img src={url} alt={node.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
                        {isPdf && <iframe title={node.name} src={url} style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />}
                        {!isImage && !isPdf && (
                            <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                                No preview for this file type — download it to open it.
                            </p>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

export { fmtBytes, fmtDate, typeLabel, uniqueName, pathOf, isDescendant, descendants, SORTERS }
