/**
 * DocEditor.jsx — a word processor on a real page.
 *
 * THE PAGE IS THE POINT. The editing surface is an 8.5x11in white sheet
 * with the PARALLAX mark in its top-left corner and TRIFECTA TECHNOLOGIES
 * centred at its foot — the same PageFrame the briefings use. What you
 * type on is what exports, so there is no second "export layout" that can
 * drift from what you were looking at.
 *
 * Formatting runs through document.execCommand. It is deprecated, and the
 * alternative is a custom model over contenteditable — which means
 * reimplementing selection, composition (IME), undo and clipboard
 * semantics. execCommand is the only path that gets all four right in
 * every browser today, and this is a document editor, not a text-editing
 * research project.
 *
 * Paste is cleaned. Pasting from Word or a web page otherwise carries an
 * entire foreign stylesheet in, which then prints — that is how a document
 * ends up with three fonts nobody chose.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import PageFrame from "../print/PageFrame.jsx"
import { PrintSurface, exportPdf } from "../print/printSurface.jsx"
import { fmtWhen } from "../utils/formatTime.js"

const FONTS = [
    ["Times New Roman", "'Times New Roman', Times, serif"],
    ["Georgia", "Georgia, serif"],
    ["Garamond", "Garamond, Georgia, serif"],
    ["Arial", "Arial, Helvetica, sans-serif"],
    ["Helvetica", "Helvetica, Arial, sans-serif"],
    ["Calibri", "Calibri, Candara, 'Segoe UI', sans-serif"],
    ["Verdana", "Verdana, Geneva, sans-serif"],
    ["Courier New", "'Courier New', Courier, monospace"],
]
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48]

function exec(cmd, value = null) {
    document.execCommand(cmd, false, value)
}

function Btn({ cmd, value, title, children, active = false, onRun }) {
    return (
        <button
            type="button"
            title={title}
            aria-pressed={active}
            // onMouseDown, not onClick: clicking a toolbar button moves
            // focus out of the editable area and the selection is lost
            // before the command runs. Preventing the default keeps it.
            onMouseDown={(e) => { e.preventDefault(); onRun ? onRun() : exec(cmd, value) }}
            style={{
                minWidth: 26, height: 24, padding: "0 6px",
                background: active ? "var(--bg-3, #2a2e34)" : "transparent",
                border: "1px solid var(--line)", borderRadius: 3,
                color: "var(--txt-2)", cursor: "pointer", font: "400 12px var(--font)",
            }}
        >{children}</button>
    )
}

function Sep() {
    return <span style={{ width: 1, height: 18, background: "var(--line)", margin: "0 3px" }} />
}

const SELECT = {
    height: 24, background: "var(--bg-0)", color: "var(--txt-2)",
    border: "1px solid var(--line)", borderRadius: 3, font: "400 11px var(--font)",
    padding: "0 4px", cursor: "pointer",
}
const BTN = { height: 24, font: "400 11px var(--font)", padding: "0 10px" }
const IMGBTN = {
    minWidth: 22, height: 20, padding: "0 5px", background: "transparent",
    border: "1px solid #3a3f46", borderRadius: 2, color: "#d5dae0",
    cursor: "pointer", font: "400 10px system-ui",
}

export default function DocEditor({ name, initialHtml = "", onSave, readOnly = false }) {
    const ref = useRef(null)
    const [dirty, setDirty] = useState(false)
    const [saving, setSaving] = useState(false)
    const [savedAt, setSavedAt] = useState(null)
    const [marks, setMarks] = useState({})
    const [printHtml, setPrintHtml] = useState(initialHtml)

    // Written to the DOM once. React must not re-render this subtree from
    // state on every keystroke: that resets the caret to the start of the
    // document, which makes typing impossible.
    useEffect(() => {
        if (ref.current && ref.current.innerHTML !== initialHtml) {
            ref.current.innerHTML = initialHtml || ""
        }
        setPrintHtml(initialHtml || "")
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const refreshMarks = useCallback(() => {
        if (typeof document.queryCommandState !== "function") return
        const q = (c) => { try { return document.queryCommandState(c) } catch { return false } }
        setMarks({
            bold: q("bold"), italic: q("italic"), underline: q("underline"),
            strikeThrough: q("strikeThrough"),
            justifyLeft: q("justifyLeft"), justifyCenter: q("justifyCenter"),
            justifyRight: q("justifyRight"), justifyFull: q("justifyFull"),
            insertUnorderedList: q("insertUnorderedList"),
            insertOrderedList: q("insertOrderedList"),
        })
    }, [])

    useEffect(() => {
        document.addEventListener("selectionchange", refreshMarks)
        return () => document.removeEventListener("selectionchange", refreshMarks)
    }, [refreshMarks])

    const touch = useCallback(() => {
        setDirty(true)
        // The print copy mirrors the live DOM. Reading innerHTML at export
        // time instead would read it during a render pass, when it may not
        // reflect the last command yet.
        if (ref.current) setPrintHtml(ref.current.innerHTML)
    }, [])

    // `auto` distinguishes the timer from a person pressing Save. A caller
    // that has nowhere to put the document yet must be able to ignore the
    // timer and only ask where it goes when the writer actually asks to
    // save — otherwise the question is asked every 1.8 seconds, forever.
    const save = useCallback(async (auto = false) => {
        if (!onSave || !ref.current) return
        setSaving(true)
        try {
            const ok = await onSave(ref.current.innerHTML, { auto })
            // A caller returns false for "not stored" — an autosave with
            // nowhere to go. Claiming "Saved" then would be a lie.
            if (ok !== false) { setDirty(false); setSavedAt(new Date()) }
        } finally {
            setSaving(false)
        }
    }, [onSave])

    // Autosave, trailing. An editor that only saves on a button press is an
    // editor that loses work.
    useEffect(() => {
        if (!dirty || readOnly) return
        const t = setTimeout(() => { save(true) }, 1800)
        return () => clearTimeout(t)
    }, [dirty, readOnly, save])

    useEffect(() => {
        const onKey = (e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(false) }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [save])

    const onPaste = useCallback((e) => {
        e.preventDefault()
        const html = e.clipboardData.getData("text/html")
        const text = e.clipboardData.getData("text/plain")
        if (html) {
            const doc = new DOMParser().parseFromString(html, "text/html")
            doc.querySelectorAll("style,script,meta,link").forEach((n) => n.remove())
            doc.querySelectorAll("*").forEach((n) => {
                n.removeAttribute("style"); n.removeAttribute("class"); n.removeAttribute("id")
            })
            exec("insertHTML", doc.body.innerHTML)
        } else {
            exec("insertText", text)
        }
        touch()
    }, [touch])

    const insertImage = useCallback((file) => {
        // Inline as a data URI so the image belongs to the document and
        // survives export. A blob: URL is revoked with the page and would
        // print as a broken-image box.
        const fr = new FileReader()
        fr.onload = () => { exec("insertImage", fr.result); touch() }
        fr.readAsDataURL(file)
    }, [touch])

    // ── Placing an image ────────────────────────────────────────────────
    // Clicking an image selects it and raises a small toolbar over it.
    // Dragging already works: contenteditable moves an image to the caret
    // natively, and reimplementing that with absolute coordinates would
    // take the picture out of the text flow, which is what makes it
    // reflow correctly across a page break.
    const [imgSel, setImgSel] = useState(null)   // {el, top, left}

    const placeImage = useCallback((how) => {
        const el = imgSel?.el
        if (!el) return
        const fig = el.closest("figure") || el
        if (how === "left" || how === "right") {
            fig.style.float = how
            fig.style.margin = how === "left" ? "4px 14px 8px 0" : "4px 0 8px 14px"
            fig.style.textAlign = ""
        } else if (how === "center") {
            fig.style.float = ""
            fig.style.margin = "14px auto"
            fig.style.textAlign = "center"
        } else if (how === "full") {
            fig.style.float = ""; fig.style.margin = "14px 0"; fig.style.textAlign = "center"
            el.style.width = "100%"
        } else if (typeof how === "number") {
            el.style.width = `${how}%`
            el.style.height = "auto"
        }
        touch()
        // Re-measure: the toolbar sits over the image and the image just moved.
        requestAnimationFrame(() => {
            const r = el.getBoundingClientRect()
            const host = ref.current?.getBoundingClientRect()
            if (host) setImgSel({ el, top: r.top - host.top, left: r.left - host.left })
        })
    }, [imgSel, touch])

    const onEditorClick = useCallback((e) => {
        const el = e.target
        if (el?.tagName === "IMG") {
            const r = el.getBoundingClientRect()
            const host = ref.current?.getBoundingClientRect()
            setImgSel({ el, top: r.top - (host?.top || 0), left: r.left - (host?.left || 0) })
        } else {
            setImgSel(null)
        }
    }, [])

    const applyPtSize = useCallback((pt) => {
        // execCommand fontSize only understands 1-7. Tag the selection with
        // the sentinel, then rewrite those nodes to the real pt value, so
        // 11pt means 11pt on the printed page.
        exec("fontSize", "7")
        ref.current?.querySelectorAll('font[size="7"]').forEach((n) => {
            n.removeAttribute("size")
            n.style.fontSize = `${pt}pt`
        })
        touch()
    }, [touch])

    return (
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
            {!readOnly && (
                <div style={{
                    display: "flex", alignItems: "center", gap: 3, flexWrap: "wrap",
                    padding: "6px 10px", borderBottom: "1px solid var(--line)",
                    background: "var(--bg-1)", flexShrink: 0,
                }}>
                    <select title="Font" style={SELECT} defaultValue={FONTS[0][1]}
                            onChange={(e) => { exec("fontName", e.target.value); touch() }}>
                        {FONTS.map(([label, stack]) => <option key={label} value={stack}>{label}</option>)}
                    </select>

                    <select title="Size" style={{ ...SELECT, width: 58 }} defaultValue={12}
                            onChange={(e) => applyPtSize(e.target.value)}>
                        {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>

                    <Sep />
                    <Btn cmd="bold" title="Bold" active={marks.bold}><b>B</b></Btn>
                    <Btn cmd="italic" title="Italic" active={marks.italic}><i>I</i></Btn>
                    <Btn cmd="underline" title="Underline" active={marks.underline}><u>U</u></Btn>
                    <Btn cmd="strikeThrough" title="Strikethrough" active={marks.strikeThrough}><s>S</s></Btn>

                    <Sep />
                    <input type="color" title="Text colour" defaultValue="#1b1f24"
                           onChange={(e) => { exec("foreColor", e.target.value); touch() }}
                           style={{ width: 26, height: 24, padding: 0, border: "1px solid var(--line)", background: "none", cursor: "pointer" }} />
                    <input type="color" title="Highlight" defaultValue="#ffff00"
                           onChange={(e) => { exec("hiliteColor", e.target.value); touch() }}
                           style={{ width: 26, height: 24, padding: 0, border: "1px solid var(--line)", background: "none", cursor: "pointer" }} />

                    <Sep />
                    <select title="Paragraph style" style={{ ...SELECT, width: 96 }} defaultValue="p"
                            onChange={(e) => { exec("formatBlock", e.target.value); touch() }}>
                        <option value="p">Body</option>
                        <option value="h1">Heading 1</option>
                        <option value="h2">Heading 2</option>
                        <option value="h3">Heading 3</option>
                        <option value="blockquote">Quote</option>
                        <option value="pre">Preformatted</option>
                    </select>

                    <Sep />
                    <Btn cmd="justifyLeft" title="Align left" active={marks.justifyLeft}>&#8801;</Btn>
                    <Btn cmd="justifyCenter" title="Centre" active={marks.justifyCenter}>&#8803;</Btn>
                    <Btn cmd="justifyRight" title="Align right" active={marks.justifyRight}>&#8802;</Btn>
                    <Btn cmd="justifyFull" title="Justify" active={marks.justifyFull}>&#9776;</Btn>

                    <Sep />
                    <Btn cmd="insertUnorderedList" title="Bullets" active={marks.insertUnorderedList}>&bull;</Btn>
                    <Btn cmd="insertOrderedList" title="Numbering" active={marks.insertOrderedList}>1.</Btn>
                    <Btn cmd="outdent" title="Decrease indent">&#8676;</Btn>
                    <Btn cmd="indent" title="Increase indent">&#8677;</Btn>

                    <Sep />
                    <Btn cmd="insertHorizontalRule" title="Horizontal rule">&mdash;</Btn>
                    <Btn title="Insert table" onRun={() => {
                        exec("insertHTML",
                            '<table style="width:100%;border-collapse:collapse;margin:10px 0">' +
                            Array.from({ length: 3 }, () =>
                                "<tr>" + Array.from({ length: 3 }, () =>
                                    '<td style="border:1px solid #b9b5ac;padding:5px 7px">&nbsp;</td>').join("") +
                                "</tr>").join("") +
                            "</table>")
                        touch()
                    }}>&#9638;</Btn>
                    <label title="Insert image" style={{
                        minWidth: 26, height: 24, padding: "0 6px", display: "inline-flex",
                        alignItems: "center", justifyContent: "center", border: "1px solid var(--line)",
                        borderRadius: 3, color: "var(--txt-2)", cursor: "pointer", font: "400 12px var(--font)",
                    }}>
                        &#9635;
                        <input type="file" accept="image/*" style={{ display: "none" }}
                               onChange={(e) => { const f = e.target.files?.[0]; if (f) insertImage(f); e.target.value = "" }} />
                    </label>

                    <Sep />
                    <Btn cmd="undo" title="Undo">&#8630;</Btn>
                    <Btn cmd="redo" title="Redo">&#8631;</Btn>
                    <Btn cmd="removeFormat" title="Clear formatting">&#10005;</Btn>

                    <div style={{ flex: 1 }} />
                    <span style={{ font: "400 10px var(--font)", color: "var(--txt-3)", marginRight: 6 }}>
                        {saving ? "Saving…" : dirty ? "Unsaved" : savedAt ? `Saved ${fmtWhen(savedAt, { precision: "minute" }).split(", ")[1]}` : ""}
                    </span>
                    <button type="button" className="btn" style={BTN}
                            onMouseDown={(e) => { e.preventDefault(); save(false) }}>Save</button>
                    <button type="button" className="btn primary" style={BTN}
                            title='Opens the print dialog — choose "Save as PDF". Only the page exports, never the app.'
                            onMouseDown={(e) => { e.preventDefault(); exportPdf() }}>Export PDF</button>
                </div>
            )}

            {/* The editing surface: the same branded sheet the PDF is. */}
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "#3a3d42", padding: 22 }}>
                <div style={{ display: "flex", justifyContent: "center" }}>
                    <PageFrame id="doc-edit-page" style={{ boxShadow: "0 8px 30px rgba(0,0,0,.5)", position: "relative" }}>
                        {imgSel && !readOnly && (
                            <div
                                contentEditable={false}
                                onMouseDown={(e) => e.preventDefault()}
                                style={{
                                    position: "absolute", zIndex: 5,
                                    top: Math.max(0, imgSel.top - 30), left: imgSel.left,
                                    display: "flex", gap: 2, padding: 3,
                                    background: "#1b1f24", borderRadius: 3,
                                    boxShadow: "0 2px 8px rgba(0,0,0,.4)",
                                }}
                            >
                                {[["left", "Wrap left"], ["center", "Centre"], ["right", "Wrap right"], ["full", "Full width"]]
                                    .map(([k, label]) => (
                                        <button key={k} type="button" title={label}
                                                onClick={() => placeImage(k)} style={IMGBTN}>
                                            {k === "left" ? "\u25E7" : k === "right" ? "\u25E8" : k === "center" ? "\u25A3" : "\u25AD"}
                                        </button>
                                    ))}
                                <span style={{ width: 1, background: "#444", margin: "0 2px" }} />
                                {[25, 50, 75, 100].map((w) => (
                                    <button key={w} type="button" title={`${w}% width`}
                                            onClick={() => placeImage(w)} style={IMGBTN}>{w}</button>
                                ))}
                            </div>
                        )}
                        <div
                            ref={ref}
                            contentEditable={!readOnly}
                            suppressContentEditableWarning
                            onInput={touch}
                            onClick={onEditorClick}
                            onPaste={onPaste}
                            onDrop={(e) => {
                                const f = e.dataTransfer?.files?.[0]
                                if (f && f.type.startsWith("image/")) { e.preventDefault(); insertImage(f) }
                            }}
                            spellCheck
                            style={{
                                outline: "none", minHeight: "8.6in",
                                font: "12pt/1.55 'Times New Roman', Times, serif", color: "#1b1f24",
                            }}
                        />
                    </PageFrame>
                </div>
            </div>

            {/* WHAT EXPORTS. A clean copy of the same page, portalled to
                <body> so printSurface's allowlist shows it and hides the
                app. The sheet above is scrolled and sits on a dark desk —
                printing that is what produced a screenshot of the UI. */}
            <PrintSurface>
                <PageFrame footerNote={name || null}>
                    <div style={{ font: "12pt/1.55 'Times New Roman', Times, serif", color: "#1b1f24" }}
                         dangerouslySetInnerHTML={{ __html: printHtml }} />
                </PageFrame>
            </PrintSurface>
        </div>
    )
}
