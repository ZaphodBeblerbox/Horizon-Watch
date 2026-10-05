/**
 * DocWriter.jsx — PARALLAX v6, ▣ Document, as an authoring surface.
 *
 * Write a briefing yourself, on the sheet it will print on, with the
 * saved-signals aside beside it.
 *
 * PAGES ARE REAL, AND YOU CAN ADD THEM. The first version was one endless
 * scroll, which is a text box pretending to be a document: you could not
 * see where a page broke, so you could not decide what fell on which page
 * — the only layout decision a briefing actually has. Each page is its own
 * contentEditable sheet at the spec's 760 × 980 with 64/72 padding, and
 * each carries the Echo X and the Trifecta line, the same marks
 * PageFrame.jsx prints and report_office.py writes into the .docx.
 *
 * THE MARKS COME FROM print/PageFrame.jsx. They are not retyped here —
 * two copies of a logo is how one of them ends up stale.
 *
 * execCommand is deprecated and remains the only thing every browser
 * implements for contentEditable formatting. The alternative is a document
 * model with its own selection layer, which is a project, not a toolbar.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import DocSignalsAside from "./DocSignalsAside.jsx"
import { ParallaxMark, TrifectaFooter } from "../print/PageFrame.jsx"
import { useSaved, savedLabel, savedMeta } from "../state/savedForBriefing.js"
import { PrintSurface, exportPdf } from "../print/printSurface.jsx"
import FileToCase from "./FileToCase.jsx"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const TOOL = {
    minWidth: 28, height: 26, padding: "0 6px", border: 0, borderRadius: 0,
    background: "transparent", color: "var(--txt2)",
    fontFamily: "var(--mz-font-mono)", fontSize: 11,
    whiteSpace: "nowrap", cursor: "pointer",
}
const BTN = {
    height: 26, padding: "0 12px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt)", font: "inherit",
    whiteSpace: "nowrap", cursor: "pointer", borderRadius: 0,
}
const SELECT = {
    height: 26, padding: "0 6px", border: "1px solid var(--gline2)",
    background: "var(--glass2)", borderRadius: 0, outline: "none", color: "var(--txt)",
}

const BLOCKS = [["Body", "p"], ["Title", "h1"], ["Heading", "h2"],
                ["Subheading", "h3"], ["Quote", "blockquote"]]
const CMDS = [
    ["B", "bold", "Bold"], ["I", "italic", "Italic"], ["U", "underline", "Underline"],
    ["•", "insertUnorderedList", "Bullets"], ["1.", "insertOrderedList", "Numbered"],
    ["↵", "insertHorizontalRule", "Rule"],
]

const PAGE_W = 760
const PAGE_MIN_H = 980

let pageSeq = 0
const newPage = () => ({ id: `pg${++pageSeq}`, html: "<p><br></p>" })

export default function DocWriter({ onClose = null, initialTitle = "Untitled briefing" }) {
    const [title, setTitle] = useState(initialTitle)
    const [classification, setClassification] = useState("UNCLASSIFIED")
    const [pages, setPages] = useState(() => [newPage()])
    const [active, setActive] = useState(0)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)
    const [words, setWords] = useState(0)
    const refs = useRef([])
    const saved = useSaved()

    const recount = useCallback(() => {
        const t = refs.current.map((el) => el?.innerText || "").join(" ")
        setWords(t.trim() ? t.trim().split(/\s+/).length : 0)
    }, [])
    useEffect(() => { recount() }, [pages.length, recount])

    useEffect(() => {
        if (!onClose) return undefined
        const k = (e) => {
            if (e.key === "Escape" && !e.target?.matches?.("input,textarea,[contenteditable=true]")) onClose()
        }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [onClose])

    const focusActive = () => refs.current[active]?.focus()
    const run = (cmd, arg) => { focusActive(); try { document.execCommand(cmd, false, arg) } catch { /* unsupported */ } recount() }

    /** The live HTML of every sheet, in order. */
    const collect = () => refs.current.map((el) => el?.innerHTML || "").join("\n<hr/>\n")

    const addPage = () => {
        setPages((p) => [...p, newPage()])
        // Focus the new sheet once React has created it.
        setTimeout(() => { setActive(refs.current.length - 1); refs.current[refs.current.length - 1]?.focus() }, 0)
    }
    const removePage = (i) => {
        if (pages.length === 1) return
        refs.current.splice(i, 1)
        setPages((p) => p.filter((_, n) => n !== i))
        setActive((n) => Math.max(0, n - 1))
        recount()
    }

    /**
     * A SIGNAL GOES IN AS A LINK, IN THE SENTENCE.
     *
     * It used to drop a bordered card with the headline and the
     * attribution, which pushes the writer's own sentence aside and turns
     * the page into a stack of quoted boxes. What a briefing actually
     * wants is the claim in the analyst's words with the evidence
     * reachable from it — so this inserts the signal's own wording as an
     * inline hyperlink at the cursor, and nothing else.
     *
     * IT POINTS AT THE SIGNAL, NOT AT A SOURCE ARTICLE. The link exists so
     * a reader of the briefing can get back to the thing on the map — the
     * coordinates, the neighbours, the time — which is what you check when
     * a sentence surprises you. A URL to a news site answers a different
     * question, so the href is the app's own reference grammar
     * (`sig:<id>`, see lib/ref.js) and clicking it flies the map there.
     *
     * It is deliberately dead in the exported PDF and .docx. An in-app
     * reference cannot resolve outside the app, and dressing it up as a
     * working URL would be worse than it plainly being text on the page.
     *
     * The wording is yours. Only the anchor carries the reference, in a
     * data attribute, so you can rewrite the link text to fit your
     * sentence — "the VEGA interdiction" rather than the raw headline —
     * and it still resolves.
     */
    const insertSignal = (g) => {
        focusActive()
        const tip = savedMeta(g) || savedLabel(g)
        const html = `<a href="#sig:${escapeHtml(g.id)}" data-ref="sig:${escapeHtml(g.id)}" `
            + `title="${escapeHtml(tip)} — click to show it on the map" `
            + `style="color:#2f5c90;text-decoration:underline">`
            + `${escapeHtml(savedLabel(g))}</a>&nbsp;`
        try { document.execCommand("insertHTML", false, html) } catch { /* unsupported */ }
        recount()
    }

    /** Clicking a reference in the page takes the map to it. */
    const openRef = (e) => {
        const a = e.target.closest?.("a[data-ref]")
        if (!a) return
        e.preventDefault()
        const id = (a.getAttribute("data-ref") || "").replace(/^sig:/, "")
        const g = saved.find((x) => x.id === id)
        if (!g) return
        window.dispatchEvent(new CustomEvent("akili:open-map"))
        if (g.lat != null && g.lon != null) {
            window.dispatchEvent(new CustomEvent("akili:fly-to", {
                detail: { lat: g.lat, lon: g.lon, altitude: 120000 },
            }))
        }
    }

    const exportDocx = async () => {
        setBusy(true); setErr(null)
        try {
            const r = await fetch(`${API_BASE}/api/documents/export.docx`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title, classification, html: collect() }),
            })
            if (!r.ok) throw new Error(`export failed (${r.status})`)
            const blob = await r.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url; a.download = `${title || "briefing"}.docx`
            document.body.appendChild(a); a.click(); a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 2000)
        } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
    }

    return (
        <div style={{ display: "flex", gap: 12, height: "100%", minHeight: 0, minWidth: 0 }}>
            <div style={{
                flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden",
                border: "1px solid var(--gline)", background: "var(--glass)",
                backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", flexWrap: "wrap", gap: 3,
                    minHeight: 40, boxSizing: "border-box", flex: "none",
                    padding: "4px 8px 4px 12px", borderBottom: "1px solid var(--gline)",
                }}>
                    <span style={{ ...EYE, marginRight: 8 }}>Document</span>
                    <select defaultValue="p" onChange={(e) => run("formatBlock", e.target.value)} style={SELECT}>
                        {BLOCKS.map(([k, v]) => <option key={v} value={v}>{k}</option>)}
                    </select>
                    <span style={{ width: 1, height: 18, background: "var(--gline2)", margin: "0 5px" }} />
                    {CMDS.map(([g, cmd, label]) => (
                        <button key={g} title={label} onMouseDown={(e) => { e.preventDefault(); run(cmd) }}
                            style={TOOL}>{g}</button>
                    ))}
                    <span style={{ width: 1, height: 18, background: "var(--gline2)", margin: "0 5px" }} />
                    <button onClick={addPage} style={{ ...BTN, height: 26 }}>+ page</button>
                    <button onClick={() => removePage(active)} disabled={pages.length === 1}
                        title="Remove the page you are in" style={{
                            ...BTN, height: 26,
                            color: pages.length === 1 ? "var(--txt4)" : "var(--txt2)",
                        }}>− page</button>
                    <div style={{ flex: 1 }} />
                    <span style={{
                        fontFamily: "var(--mz-font-mono)", fontSize: 10,
                        color: "var(--txt4)", marginRight: 6,
                    }}>
                        {pages.length} {pages.length === 1 ? "page" : "pages"} · {words} {words === 1 ? "word" : "words"}
                    </span>
                    {err && <span style={{ fontSize: 12, color: "var(--red)", marginRight: 6 }}>{err}</span>}
                    {busy && <Loading size={13} inline label="building the docx" />}
                    <FileToCase kind="document" name={title} getHtml={collect} style={BTN} />
                    <button onClick={exportDocx} disabled={busy} style={BTN}>Export .docx</button>
                    <button onClick={() => {
                        // Commit what is in the sheets before printing, so
                        // the print copy is this minute's text and not the
                        // last value React happened to hold.
                        setPages((p) => p.map((pg, n) => ({ ...pg, html: refs.current[n]?.innerHTML ?? pg.html })))
                        setTimeout(() => exportPdf(), 0)
                    }} style={BTN}>Export PDF</button>
                    {onClose && <button onClick={onClose} style={{ ...BTN, width: 26, padding: 0 }}>✕</button>}
                </div>

                <div style={{
                    flex: 1, minHeight: 0, overflow: "auto", background: "var(--scrim)",
                    padding: "28px 20px 60px", display: "flex", flexDirection: "column",
                    alignItems: "center", gap: 24,
                }}>
                    {pages.map((pg, i) => (
                        <div key={pg.id} style={{
                            width: "100%", maxWidth: PAGE_W, minHeight: PAGE_MIN_H,
                            boxSizing: "border-box", display: "flex", flexDirection: "column",
                            padding: "64px 72px", background: "#fcfbf6", color: "#26231e",
                            boxShadow: "var(--gshadow)",
                            outline: i === active ? "1px solid var(--acchi)" : "1px solid transparent",
                        }} onMouseDown={() => setActive(i)}>
                            <div style={{
                                display: "flex", alignItems: "baseline", justifyContent: "space-between",
                                marginBottom: 10,
                            }}>
                                <ParallaxMark height={14} />
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 8.5,
                                    letterSpacing: ".18em", textTransform: "uppercase", color: "#6a6f77",
                                }}>{classification}</span>
                            </div>
                            <div style={{ height: 1, background: "#d8d3ca", marginBottom: 22 }} />

                            {i === 0 && (
                                <input value={title} onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Title of the briefing" style={{
                                        border: 0, background: "transparent", outline: "none", width: "100%",
                                        padding: 0, marginBottom: 18, color: "#26231e",
                                        font: "600 30px/1.1 var(--mz-font-body)", letterSpacing: "-.015em",
                                    }} />
                            )}

                            <article
                                ref={(el) => { refs.current[i] = el }}
                                className="plx-docwriter"
                                contentEditable
                                suppressContentEditableWarning
                                onInput={recount}
                                onFocus={() => setActive(i)}
                                onClick={openRef}
                                onDrop={(e) => {
                                    // Dropping is the same gesture as pressing
                                    // insert, so it has to produce the same
                                    // thing: a link, not a bare line of text.
                                    const id = e.dataTransfer.getData("application/x-plx-signal")
                                    const g = id && saved.find((x) => x.id === id)
                                    if (!g) return
                                    e.preventDefault()
                                    setActive(i)
                                    setTimeout(() => insertSignal(g), 0)
                                }}
                                style={{
                                    flex: 1, outline: "none", color: "#26231e",
                                    font: "400 14px/1.75 var(--mz-font-body)",
                                }}
                                dangerouslySetInnerHTML={{ __html: pg.html }}
                            />

                            <div style={{
                                marginTop: 24, paddingTop: 10, borderTop: "1px solid #d8d3ca",
                                display: "flex", alignItems: "baseline", justifyContent: "space-between",
                            }}>
                                <TrifectaFooter />
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 8.5,
                                    letterSpacing: ".18em", color: "#6a6f77",
                                }}>{i + 1} / {pages.length}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* THE SHEETS, AGAIN, FOR THE PRINTER.
                printSurface.jsx is an allowlist: only what it portals to
                <body> reaches the print dialog, so exporting the editor
                itself would produce the app's chrome and none of the
                document. This is the same pages rendered as static HTML —
                no contentEditable, no toolbar, no aside — and it only
                exists during a print. `pages[i].html` is the last committed
                value, so the live sheets are read on each render. */}
            <PrintSurface>
                {pages.map((pg, i) => (
                    <section key={pg.id} className="docpage" style={{
                        boxSizing: "border-box", width: "8.5in", minHeight: "11in",
                        padding: "64px 72px", background: "#fff", color: "#26231e",
                        breakAfter: i < pages.length - 1 ? "page" : "auto",
                        display: "flex", flexDirection: "column",
                    }}>
                        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                            <ParallaxMark height={14} />
                            <span style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 8.5,
                                letterSpacing: ".18em", textTransform: "uppercase", color: "#6a6f77",
                            }}>{classification}</span>
                        </div>
                        <div style={{ height: 1, background: "#d8d3ca", margin: "10px 0 22px" }} />
                        {i === 0 && (
                            <h1 style={{
                                margin: "0 0 18px", font: "600 30px/1.1 var(--mz-font-body)",
                                letterSpacing: "-.015em",
                            }}>{title}</h1>
                        )}
                        <div style={{ flex: 1, font: "400 14px/1.75 var(--mz-font-body)" }}
                            dangerouslySetInnerHTML={{ __html: refs.current[i]?.innerHTML ?? pg.html }} />
                        <div style={{
                            marginTop: 24, paddingTop: 10, borderTop: "1px solid #d8d3ca",
                            display: "flex", alignItems: "baseline", justifyContent: "space-between",
                        }}>
                            <TrifectaFooter />
                            <span style={{
                                fontFamily: "var(--mz-font-mono)", fontSize: 8.5,
                                letterSpacing: ".18em", color: "#6a6f77",
                            }}>{i + 1} / {pages.length}</span>
                        </div>
                    </section>
                ))}
            </PrintSurface>

            <DocSignalsAside
                onInsert={insertSignal}
                insertLabel="insert"
                hint="Click a signal to locate it. Insert drops it into the page you are writing in; you can also drag it onto the sheet."
            />
        </div>
    )
}

function escapeHtml(t) {
    return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
}
