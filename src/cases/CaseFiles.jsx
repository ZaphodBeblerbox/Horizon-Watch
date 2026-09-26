/**
 * CaseFiles.jsx — the contents of one case: a folder tree on the left, and
 * whatever is selected on the right (a document to edit, an image or PDF to
 * look at, a folder's contents).
 *
 * Satellite imagery, PDFs and photographs are handled in the app rather
 * than in a folder on someone's desktop, so the evidence sits with the case
 * it belongs to and travels with it when the case is shared.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import FileTree from "./FileTree.jsx"
import DocEditor from "./DocEditor.jsx"
import {
    listNodes, createNode, updateNode, deleteNode, getDoc, uploadFile, fileUrl,
} from "../lib/casesApi.js"
import { toast } from "../ui/toast.js"

export default function CaseFiles({ caseId, readOnly = false }) {
    const [nodes, setNodes] = useState([])
    const [selected, setSelected] = useState(null)
    const [docHtml, setDocHtml] = useState(null)
    const [loading, setLoading] = useState(false)
    const [dragOver, setDragOver] = useState(false)
    const fileInput = useRef(null)

    const refresh = useCallback(() => {
        if (!caseId) return
        setLoading(true)
        listNodes(caseId)
            .then(setNodes)
            .catch((e) => toast(e.message || "Could not load case files", { icon: "i-alert" }))
            .finally(() => setLoading(false))
    }, [caseId])

    useEffect(() => { refresh(); setSelected(null); setDocHtml(null) }, [refresh])

    // A document's body is fetched only when it is opened. Listing a case
    // should not drag every document's full text along with it.
    useEffect(() => {
        if (!selected || selected.kind !== "doc") { setDocHtml(null); return }
        let live = true
        getDoc(caseId, selected.id)
            .then((d) => { if (live) setDocHtml(d.body_html || "") })
            .catch(() => { if (live) setDocHtml("") })
        return () => { live = false }
    }, [caseId, selected])

    const parentForNew = selected?.kind === "folder" ? selected.id : (selected?.parent_id || null)

    const addFolder = async () => {
        const name = prompt("Folder name")?.trim()
        if (!name) return
        try {
            const n = await createNode(caseId, { kind: "folder", name, parent_id: parentForNew })
            setNodes((p) => [...p, n]); setSelected(n)
        } catch (e) { toast(e.message || "Could not create folder", { icon: "i-alert" }) }
    }

    const addDoc = async () => {
        const name = prompt("Document name")?.trim()
        if (!name) return
        try {
            const n = await createNode(caseId, { kind: "doc", name, parent_id: parentForNew })
            setNodes((p) => [...p, n]); setSelected(n); setDocHtml("")
        } catch (e) { toast(e.message || "Could not create document", { icon: "i-alert" }) }
    }

    const doUpload = useCallback(async (files) => {
        for (const f of files) {
            try {
                const n = await uploadFile(caseId, f, parentForNew)
                setNodes((p) => [...p, n])
            } catch (e) {
                toast(`${f.name}: ${e.message || "upload failed"}`, { icon: "i-alert" })
            }
        }
    }, [caseId, parentForNew])

    const saveDoc = useCallback(async (html) => {
        if (!selected) return
        await updateNode(caseId, selected.id, { body_html: html })
    }, [caseId, selected])

    const move = async (id, parentId) => {
        try {
            const n = await updateNode(caseId, id, { parent_id: parentId })
            setNodes((p) => p.map((x) => (x.id === id ? n : x)))
        } catch (e) { toast(e.message || "Could not move", { icon: "i-alert" }) }
    }

    const rename = async (id, name) => {
        try {
            const n = await updateNode(caseId, id, { name })
            setNodes((p) => p.map((x) => (x.id === id ? n : x)))
            setSelected((s) => (s?.id === id ? n : s))
        } catch (e) { toast(e.message || "Could not rename", { icon: "i-alert" }) }
    }

    const remove = async (n) => {
        const kids = nodes.filter((x) => x.parent_id === n.id).length
        const what = n.kind === "folder" && kids
            ? `"${n.name}" and the ${kids} item${kids === 1 ? "" : "s"} inside it`
            : `"${n.name}"`
        if (!confirm(`Delete ${what}? This cannot be undone.`)) return
        try {
            await deleteNode(caseId, n.id)
            setSelected((s) => (s?.id === n.id ? null : s))
            refresh()
        } catch (e) { toast(e.message || "Could not delete", { icon: "i-alert" }) }
    }

    return (
        <div
            style={{ display: "flex", height: "100%", minHeight: 0, border: "1px solid var(--line)" }}
            onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setDragOver(true) } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                if (readOnly) return
                const files = Array.from(e.dataTransfer?.files || [])
                if (files.length) { e.preventDefault(); setDragOver(false); doUpload(files) }
            }}
        >
            <div style={{
                width: 258, flexShrink: 0, borderRight: "1px solid var(--line)",
                display: "flex", flexDirection: "column", minHeight: 0,
                background: dragOver ? "var(--acc-dim, #2b3a4a)" : "transparent",
            }}>
                <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--line)" }}>
                    <button className="btn sm" onClick={addFolder} disabled={readOnly} title="New folder">+ folder</button>
                    <button className="btn sm" onClick={addDoc} disabled={readOnly} title="New document">+ doc</button>
                    <button className="btn sm" onClick={() => fileInput.current?.click()} disabled={readOnly} title="Upload a PDF, image or satellite crop">upload</button>
                    <input
                        ref={fileInput} type="file" multiple style={{ display: "none" }}
                        accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.tif,.tiff,.csv,.txt,.json,.geojson"
                        onChange={(e) => { doUpload(Array.from(e.target.files || [])); e.target.value = "" }}
                    />
                </div>
                {loading
                    ? <p style={{ font: "400 11px var(--font)", color: "var(--txt-3)", padding: "10px 12px" }}>Loading…</p>
                    : <FileTree
                        nodes={nodes} selectedId={selected?.id} readOnly={readOnly}
                        onSelect={setSelected} onMove={move} onRename={rename} onDelete={remove}
                      />}
            </div>

            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {!selected && (
                    <Empty>
                        Select a document to edit it, or a file to view it. Drop a PDF or an
                        image anywhere here to add it to this case.
                    </Empty>
                )}

                {selected?.kind === "doc" && docHtml !== null && (
                    <DocEditor
                        key={selected.id}
                        name={selected.name}
                        initialHtml={docHtml}
                        onSave={saveDoc}
                        readOnly={readOnly}
                    />
                )}

                {selected?.kind === "file" && <FileView caseId={caseId} node={selected} />}

                {selected?.kind === "folder" && (
                    <Empty>
                        <b>{selected.name}</b> — {nodes.filter((n) => n.parent_id === selected.id).length} item(s).
                        New folders, documents and uploads go in here while it is selected.
                    </Empty>
                )}
            </div>
        </div>
    )
}

function Empty({ children }) {
    return (
        <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            padding: 30, textAlign: "center",
        }}>
            <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", lineHeight: 1.65, maxWidth: 380 }}>
                {children}
            </p>
        </div>
    )
}

function FileView({ caseId, node }) {
    const url = fileUrl(caseId, node.id)
    const isImage = (node.mime || "").startsWith("image/")
    const isPdf = node.mime === "application/pdf"

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 10, padding: "6px 10px",
                borderBottom: "1px solid var(--line)", background: "var(--bg-1)", flexShrink: 0,
            }}>
                <span style={{ font: "600 12px var(--font)", color: "var(--txt)" }}>{node.name}</span>
                <span style={{ font: "400 10px var(--mono)", color: "var(--txt-3)" }}>{node.mime}</span>
                <div style={{ flex: 1 }} />
                {/* A real link, not a fetch-and-blob: the browser's own
                    download handling gets the filename and the progress UI
                    right, and the cookie goes with it. */}
                <a className="btn sm" href={url} download={node.name}
                   style={{ textDecoration: "none" }}>download</a>
            </div>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#2b2e33", display: "flex", alignItems: "center", justifyContent: "center" }}>
                {isImage && <img src={url} alt={node.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} />}
                {isPdf && <iframe title={node.name} src={url} style={{ width: "100%", height: "100%", border: 0, background: "#fff" }} />}
                {!isImage && !isPdf && (
                    <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                        No preview for this file type — download it to open it.
                    </p>
                )}
            </div>
        </div>
    )
}
