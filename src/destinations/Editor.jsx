/**
 * Editor.jsx — the place you write.
 *
 * Cases hold files. This is the surface for producing them: start a blank
 * document, or open a briefing and edit its prose, then save the result
 * into any case you own as a real document node.
 *
 * WHY A SEPARATE MODULE AND NOT JUST THE TAB INSIDE CASES. Writing is not
 * always filing. A briefing you are drafting does not yet belong to a case,
 * and picking a case first in order to start typing puts the filing
 * decision before the work. So the editor stands on its own and the case is
 * chosen at save time — which is also the moment you actually know where it
 * belongs.
 *
 * Everything written here lands in the same CaseNode documents the Files
 * tab shows, so there is one kind of document in the product, not an
 * "editor document" and a "case document" that drift apart.
 */

import { useCallback, useEffect, useState } from "react"
import DocEditor from "../cases/DocEditor.jsx"
import { listCases, listNodes, createCase, createNode, updateNode, getDoc } from "../lib/casesApi.js"
import { listReports, getReportBundle } from "../reports/reportApi.js"
import { toast } from "../ui/toast.js"
import SidePanel from "../ui/SidePanel.jsx"
import SavedSidebar from "../cases/SavedSidebar.jsx"
import { savedLabel, savedMeta } from "../state/savedForBriefing.js"

/** A briefing's prose, flattened to the editor's HTML. */
function reportToHtml(report, sections) {
    const esc = (t) => String(t ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
    const out = [`<h1>${esc(report?.title || "Untitled briefing")}</h1>`]
    const n = report?.narrative || {}

    if (n.bottom_line) out.push(`<h2>Bottom line</h2><p>${esc(n.bottom_line)}</p>`)
    if (Array.isArray(report?.key_judgments) && report.key_judgments.length) {
        out.push("<h2>Key judgements</h2><ul>")
        for (const k of report.key_judgments) out.push(`<li>${esc(typeof k === "string" ? k : k?.text)}</li>`)
        out.push("</ul>")
    }
    for (const s of sections || []) {
        if (s?.title) out.push(`<h2>${esc(s.title)}</h2>`)
        for (const c of s?.claims || []) if (c?.text) out.push(`<p>${esc(c.text)}</p>`)
    }
    if (n.outlook) out.push(`<h2>Outlook</h2><p>${esc(n.outlook)}</p>`)
    return out.join("\n")
}

export default function Editor() {
    const [source, setSource] = useState(null)   // {kind:"blank"|"report"|"doc", ...}
    const [html, setHtml] = useState(null)
    const [title, setTitle] = useState("Untitled document")
    const [reports, setReports] = useState([])
    const [cases, setCases] = useState([])
    const [recent, setRecent] = useState([])
    const [saveOpen, setSaveOpen] = useState(false)
    const [newCaseTitle, setNewCaseTitle] = useState("")

    useEffect(() => {
        listReports().then((r) => setReports(r || [])).catch(() => setReports([]))
        listCases().then((c) => setCases(c || [])).catch(() => setCases([]))
    }, [])

    // The documents already written, across the cases you can see — so the
    // editor opens onto your work rather than onto an empty screen.
    useEffect(() => {
        if (!cases.length) { setRecent([]); return }
        let live = true
        Promise.all(cases.slice(0, 12).map((c) =>
            listNodes(c.case_id)
                .then((ns) => ns.filter((n) => n.kind === "doc").map((n) => ({ ...n, caseTitle: c.title })))
                .catch(() => [])))
            .then((lists) => {
                if (!live) return
                setRecent(lists.flat()
                    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))
                    .slice(0, 25))
            })
        return () => { live = false }
    }, [cases])

    const openBlank = () => {
        setSource({ kind: "blank" }); setTitle("Untitled document"); setHtml("")
    }

    const openReport = async (r) => {
        try {
            const bundle = await getReportBundle(r.report_id)
            const body = reportToHtml(bundle?.report || r, bundle?.sections)
            setSource({ kind: "report", reportId: r.report_id })
            setTitle(r.title || "Briefing")
            setHtml(body)
        } catch (e) { toast(e.message || "Could not open that briefing", { icon: "i-alert" }) }
    }

    const openDoc = async (d) => {
        try {
            const full = await getDoc(d.case_id, d.id)
            setSource({ kind: "doc", caseId: d.case_id, nodeId: d.id })
            setTitle(d.name); setHtml(full.body_html || "")
        } catch (e) { toast(e.message || "Could not open that document", { icon: "i-alert" }) }
    }

    // An existing case document saves in place. Anything else has to be
    // filed, so it asks where.
    const onSave = useCallback(async (nextHtml, { auto = false } = {}) => {
        setHtml(nextHtml)
        if (source?.kind === "doc") {
            await updateNode(source.caseId, source.nodeId, { body_html: nextHtml })
            return true
        }
        // Nowhere to put it yet. The autosave timer must not turn that into
        // a dialog every 1.8 seconds; it only becomes a question when the
        // writer actually asks to save.
        if (auto) return false
        setSaveOpen(true)
        return false
    }, [source])

    // Dropping a saved item into the page. An image goes in as a figure
    // with its caption, because a satellite crop with no statement of what
    // it is and where it was taken is not evidence — it is a picture.
    const insertSaved = useCallback((item) => {
        const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
        const headline = esc(savedLabel(item))
        const meta = esc(savedMeta(item))
        // The attribution line is part of the artefact, not decoration: a
        // claim on a page without where it came from and when is not
        // evidence, and the writer should not have to retype it.
        const metaLine = meta
            ? `<div style="font:9.5pt Georgia,serif;color:#666;margin-top:3px">${meta}</div>`
            : ""
        let frag
        if (item.imageUrl) {
            frag = `<figure class="doc-figure" style="margin:14px 0;text-align:center">`
                 + `<img src="${esc(item.imageUrl)}" alt="${headline}" style="max-width:100%;height:auto" />`
                 + `<figcaption style="font:italic 10pt Georgia,serif;color:#555;margin-top:5px">`
                 + `${headline}${meta ? `<br/><span style="font-style:normal;font-size:9pt;color:#666">${meta}</span>` : ""}`
                 + `</figcaption></figure><p><br/></p>`
        } else {
            frag = `<blockquote style="border-left:2px solid #1b1f24;padding:2px 0 2px 12px;margin:11px 0">`
                 + `<b>${headline}</b>`
                 + (item.context ? `<div style="margin-top:3px">${esc(item.context)}</div>` : "")
                 + metaLine
                 + `</blockquote><p><br/></p>`
        }
        // The editor must have focus or insertHTML has no range to act on
        // and the fragment is silently dropped.
        const el = document.querySelector('[contenteditable="true"]')
        if (el) {
            el.focus()
            document.execCommand("insertHTML", false, frag)
        }
    }, [])

    // Making the case and filing into it is one action. Sending the writer
    // to another module to create a container, then back to find their
    // place again, is three.
    const createAndFile = async () => {
        const t = newCaseTitle.trim()
        if (!t) return
        try {
            const c = await createCase({ title: t, priority: "moderate" })
            setCases((p) => [c, ...p])
            setNewCaseTitle("")
            await fileInto(c.case_id)
        } catch (e) { toast(e.message || "Could not create that case", { icon: "i-alert" }) }
    }

    const fileInto = async (caseId) => {
        try {
            const node = await createNode(caseId, { kind: "doc", name: title || "Untitled document" })
            await updateNode(caseId, node.id, { body_html: html || "" })
            setSource({ kind: "doc", caseId, nodeId: node.id })
            setSaveOpen(false)
            toast(`Saved to ${cases.find((c) => c.case_id === caseId)?.title || caseId}`, { icon: "i-check" })
        } catch (e) { toast(e.message || "Could not save into that case", { icon: "i-alert" }) }
    }

    return (
        <div style={{ display: "flex", height: "100%", minHeight: 0, background: "var(--bg-0)" }}>
            <SidePanel side="left" label="Sources" width={268} storageKey="editorSource"
                       style={{ overflowY: "auto" }}>
                <div style={{ padding: "9px 12px", borderBottom: "1px solid var(--line)" }}>
                    <button className="btn primary sm" onClick={openBlank} style={{ width: "100%" }}>
                        new document
                    </button>
                </div>

                <Group label="Your documents">
                    {recent.length === 0
                        ? <Note>Nothing written yet.</Note>
                        : recent.map((d) => (
                            <Item key={d.id} active={source?.nodeId === d.id}
                                  onClick={() => openDoc(d)}
                                  title={d.name} sub={d.caseTitle} />
                        ))}
                </Group>

                <Group label="Briefings">
                    {reports.length === 0
                        ? <Note>No briefings yet.</Note>
                        : reports.slice(0, 30).map((r) => (
                            <Item key={r.report_id} active={source?.reportId === r.report_id}
                                  onClick={() => openReport(r)}
                                  title={r.title || r.report_id} sub={r.status} />
                        ))}
                </Group>
            </SidePanel>

            <div style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column" }}>
                {html === null ? (
                    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 30 }}>
                        <p style={{ font: "400 12px var(--font)", color: "var(--txt-3)", lineHeight: 1.65, maxWidth: 400, textAlign: "center" }}>
                            Start a new document, open one of yours, or open a briefing to edit its
                            text. Whatever you write can be saved into any case you own.
                        </p>
                    </div>
                ) : (
                    <>
                        <div style={{
                            display: "flex", alignItems: "center", gap: 10, padding: "6px 12px",
                            borderBottom: "1px solid var(--line)", background: "var(--bg-1)", flexShrink: 0,
                        }}>
                            <input
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                style={{
                                    flex: 1, minWidth: 0, height: 24, background: "transparent",
                                    border: "1px solid transparent", color: "var(--txt)",
                                    font: "600 13px var(--font)", padding: "0 5px",
                                }}
                            />
                            <span style={{ font: "400 10px var(--font)", color: "var(--txt-3)" }}>
                                {source?.kind === "doc"
                                    ? "saves to its case"
                                    : source?.kind === "report"
                                        ? "copy of a briefing — save to file it"
                                        : "not yet filed"}
                            </span>
                            <button className="btn sm" onClick={() => setSaveOpen(true)}>save to case…</button>
                        </div>

                        <div style={{ flex: 1, minHeight: 0 }}>
                            <DocEditor key={source?.nodeId || source?.reportId || "blank"}
                                       name={title} initialHtml={html} onSave={onSave} />
                        </div>
                    </>
                )}
            </div>

            {html !== null && (
                <SidePanel side="right" label="Saved" width={250} storageKey="editorSaved">
                    <SavedSidebar onInsert={insertSaved} />
                </SidePanel>
            )}

            {saveOpen && (
                <Modal onClose={() => setSaveOpen(false)} title="Save to case">
                    <div style={{ display: "flex", gap: 6, padding: "9px 10px", borderBottom: "1px solid var(--line)" }}>
                        <input
                            value={newCaseTitle}
                            onChange={(e) => setNewCaseTitle(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") createAndFile() }}
                            placeholder="New case title…"
                            style={{
                                flex: 1, minWidth: 0, height: 26, background: "var(--bg-0)",
                                border: "1px solid var(--line)", color: "var(--txt)",
                                font: "400 12px var(--font)", padding: "0 7px",
                            }}
                        />
                        <button className="btn sm primary" onClick={createAndFile} disabled={!newCaseTitle.trim()}>
                            create &amp; save
                        </button>
                    </div>
                    {cases.length === 0 ? (
                        <Note>No cases yet — name one above and this document becomes its first file.</Note>
                    ) : cases.map((c) => (
                        <div key={c.case_id} role="button" onClick={() => fileInto(c.case_id)}
                             style={{
                                 padding: "8px 10px", borderBottom: "1px solid var(--line)",
                                 cursor: "pointer", font: "400 12px var(--font)", color: "var(--txt-2)",
                             }}>
                            <div style={{ color: "var(--txt)" }}>{c.title}</div>
                            <div style={{ font: "400 10px var(--mono)", color: "var(--txt-4)" }}>{c.case_id}</div>
                        </div>
                    ))}
                </Modal>
            )}
        </div>
    )
}

function Group({ label, children }) {
    return (
        <div style={{ borderBottom: "1px solid var(--line)" }}>
            <div style={{
                font: "600 10px var(--font)", color: "var(--txt-3)", textTransform: "uppercase",
                letterSpacing: ".06em", padding: "8px 12px 4px",
            }}>{label}</div>
            {children}
        </div>
    )
}

function Item({ title, sub, active, onClick }) {
    return (
        <div role="button" onClick={onClick} style={{
            padding: "5px 12px", cursor: "pointer",
            background: active ? "var(--bg-3, #2a2e34)" : "transparent",
            borderLeft: active ? "2px solid var(--acc-hi)" : "2px solid transparent",
        }}>
            <div style={{ font: "400 12px var(--font)", color: active ? "var(--txt)" : "var(--txt-2)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</div>
            {sub && <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)" }}>{sub}</div>}
        </div>
    )
}

function Note({ children }) {
    return <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "4px 12px 10px", lineHeight: 1.6 }}>{children}</p>
}

function Modal({ title, onClose, children }) {
    return (
        <div onClick={onClose} style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.5)", zIndex: 90,
            display: "flex", alignItems: "center", justifyContent: "center",
        }}>
            <div onClick={(e) => e.stopPropagation()} style={{
                width: 420, maxHeight: "70vh", overflowY: "auto", background: "var(--bg-1)",
                border: "1px solid var(--line)", borderRadius: 4,
            }}>
                <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--line)", font: "600 12px var(--font)", color: "var(--txt)" }}>
                    {title}
                </div>
                {children}
            </div>
        </div>
    )
}
