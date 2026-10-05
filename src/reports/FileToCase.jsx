/**
 * FileToCase.jsx — put what you are writing into the case it belongs to.
 *
 * WHY THIS HAS TO EXIST. The case tree, the filing taxonomy and the folder
 * machinery were all already built, and nothing reached them: signals filed
 * themselves only when a "filing case" had been set, and nothing set one;
 * briefings, decks and documents could not be filed at all. A case was a
 * folder structure with no door.
 *
 * It sets the filing case as a side effect of filing, so saving a signal
 * afterwards lands in the same place you just put the document. That is
 * what someone means by "this is what I am working on".
 */
import { useEffect, useState } from "react"
import { listCases, fileProduct } from "../lib/casesApi.js"
import { getFilingCase, setFilingCase } from "../state/filingCase.js"
import { toast } from "../ui/toast.js"

export default function FileToCase({ kind, name, getHtml, style = null }) {
    const [cases, setCases] = useState([])
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const active = getFilingCase()

    useEffect(() => {
        if (!open || cases.length) return
        listCases().then((r) => setCases(Array.isArray(r) ? r : (r?.cases || []))).catch(() => {})
    }, [open, cases.length])

    const file = async (caseId) => {
        setBusy(true)
        try {
            await fileProduct(caseId, { kind, name: name || "Untitled", html: getHtml?.() || "" })
            setFilingCase(caseId)
            toast(`Filed to ${caseId}`)
            setOpen(false)
        } catch (e) {
            toast(`Could not file it — ${e.message || e}`, { icon: "i-alert" })
        } finally { setBusy(false) }
    }

    const BTN = {
        height: 26, padding: "0 12px", border: "1px solid var(--gline2)",
        background: "transparent", color: "var(--txt)", font: "inherit",
        whiteSpace: "nowrap", cursor: "pointer", borderRadius: 0, ...style,
    }

    return (
        <span style={{ position: "relative" }}>
            <button onClick={() => setOpen((v) => !v)} disabled={busy} style={BTN}>
                {busy ? "Filing…" : "File to case"}
            </button>
            {open && (
                <div style={{
                    position: "absolute", right: 0, top: "calc(100% + 4px)", zIndex: 40,
                    minWidth: 260, maxHeight: 280, overflow: "auto",
                    background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                }}>
                    {cases.map((c) => (
                        <button key={c.case_id} onClick={() => file(c.case_id)} style={{
                            display: "grid", gridTemplateColumns: "minmax(0,1fr) auto",
                            gap: "2px 10px", width: "100%", padding: "9px 12px", border: 0,
                            borderBottom: "1px solid var(--gline)",
                            background: c.case_id === active ? "var(--accdim)" : "transparent",
                            color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                        }}>
                            <b style={{
                                fontWeight: 600, overflow: "hidden",
                                textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>{c.title}</b>
                            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                                {c.case_id}
                            </span>
                        </button>
                    ))}
                    {!cases.length && (
                        <div style={{ padding: 12, fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>
                            No cases yet. Open My work and start one — a case is where a question's
                            signals, pictures and products are kept together.
                        </div>
                    )}
                </div>
            )}
        </span>
    )
}
