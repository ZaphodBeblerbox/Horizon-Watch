/**
 * BriefingStudio.jsx — PARALLAX v6, Part B ▣ Briefing studio.
 *
 * ONE SURFACE CALLED REPORTS, WITH THREE TABS. Generate was a separate
 * tab, the reader was another, and the deck opened as an overlay on top of
 * the reader. They are three states of one job — assemble, read, present —
 * and the spec puts them behind one header so you can move between them
 * without losing what you selected.
 *
 * SIGNALS IN SCOPE SAYS WHAT THE SIGNAL SAYS. The saved list rendered
 * "Signal (50.5°N 30.4°E)" because savedLabel() preferred a `headline`
 * field almost nothing set and skipped `label`, which is where every
 * caller puts the record's own title. It now reads "Sanctioned vessel VEGA
 * in the Baltic Sea" — the sentence you actually write a briefing from.
 * Fixed in savedForBriefing.js so every consumer gets it, not just this one.
 *
 * THE BRANDING IS NOT THIS FILE'S TO CHANGE. Every rendered page and every
 * slide carries the PARALLAX wordmark and "by Trifecta Technologies"
 * through PageFrame.jsx, which Deck.jsx and PrintLayout.jsx already use.
 * This screen composes those components rather than re-rendering their
 * chrome, so the deck and the printed page keep the identity they had.
 */
import { useMemo, useState } from "react"
import Generate from "./Generate.jsx"
import Briefings from "./Briefings.jsx"
import DeckBuilder from "./DeckBuilder.jsx"
import DocWriter from "./DocWriter.jsx"
import Notes from "./Notes.jsx"
import { useSaved } from "../state/savedForBriefing.js"
import { MODE_SURFACE } from "../plx6/modeWindow.js"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const CARD = {
    border: "1px solid var(--gline)", background: "var(--glass2)",
    borderRadius: 0, overflow: "hidden",
}

function Act({ children, onClick, primary = false }) {
    return (
        <button onClick={onClick} style={{
            height: 28, padding: "0 12px",
            border: primary ? 0 : "1px solid var(--gline2)",
            background: primary ? "var(--acc)" : "transparent",
            color: primary ? "var(--mz-cream)" : "var(--txt)",
            fontWeight: primary ? 600 : 400,
            font: "inherit", whiteSpace: "nowrap", cursor: "pointer", borderRadius: 0,
        }}>{children}</button>
    )
}

export default function BriefingStudio({
    initialReportId = null, onPrint = () => {}, onOpenTab = () => {}, isVisible = true,
}) {
    const [tab, setTab] = useState("generate")
    const [deckId, setDeckId] = useState(null)
    const [reportId, setReportId] = useState(initialReportId)

    const saved = useSaved()
    const { signals, notes } = useMemo(() => ({
        signals: saved.filter((s) => s.kind !== "note"),
        notes: saved.filter((s) => s.kind === "note"),
    }), [saved])

    /* WRITE and BUILD are the two the studio was missing. Everything else
       here assembles a briefing FROM something — saved signals, a
       generated report. Neither let you simply write one, which is what an
       analyst does most days. */
    /* NO SEPARATE "DECK" TAB. There was one that only presented a deck
       derived from a generated report — a second place to go for something
       the builder already does, with its own Present button. The reader's
       "Present as deck" now opens the builder with that report's slides. */
    const TABS = [["Generate", "generate"], ["Notes", "notes"], ["Write", "write"],
                  ["Build deck", "build"], ["Reader", "reader"]]

    const meta = tab === "notes"
        ? `${notes.length} ${notes.length === 1 ? "note" : "notes"}`
        : tab === "generate"
        ? `${signals.length} ${signals.length === 1 ? "signal" : "signals"} · ${notes.length} ${notes.length === 1 ? "note" : "notes"}`
        : tab === "deck" && deckId ? deckId
        : reportId || ""

    /* EXPORT TO SOMETHING THE RECIPIENT CAN EDIT.
       The only way out was a PDF, which is the end of a document's life —
       whoever receives it can read it and nothing else. A briefing is
       usually the start of someone else's work, so Word and PowerPoint are
       offered beside it. Both files carry the PARALLAX wordmark and the
       Trifecta Technologies line on every page and slide. */
    const [busy, setBusy] = useState(null)
    const download = async (rid, fmt) => {
        if (!rid) return
        setBusy(fmt)
        try {
            const r = await fetch(`${API_BASE}/api/reports/${rid}/${fmt}`, { credentials: "include" })
            if (!r.ok) throw new Error(`export failed (${r.status})`)
            const blob = await r.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = `${rid}.${fmt}`
            document.body.appendChild(a)
            a.click()
            a.remove()
            // Revoked on the next tick: revoking synchronously races the
            // download in Safari and hands you a zero-byte file.
            setTimeout(() => URL.revokeObjectURL(url), 2000)
        } catch (e) {
            // eslint-disable-next-line no-alert
            window.alert(String(e.message || e))
        } finally { setBusy(null) }
    }

    const exportActs = (rid) => rid ? [
        ["Word (.docx)", () => download(rid, "docx"), false],
        ["PowerPoint (.pptx)", () => download(rid, "pptx"), false],
        ["PDF", () => onPrint(rid), false],
    ] : []

    const acts = tab === "reader"
        ? [...exportActs(reportId), ["Present as deck", () => { setDeckId(reportId); setTab("build") }, true]]
        : []

    return (
        <section data-screen-label="Reports" style={MODE_SURFACE}>
            <div style={{
                display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
                minHeight: 48, boxSizing: "border-box", flex: "none",
                padding: "6px 10px 6px 16px", borderBottom: "1px solid var(--gline)",
            }}>
                <h2 style={{
                    margin: 0, fontFamily: "var(--mz-font-body)", fontWeight: 600,
                    fontSize: 17, letterSpacing: "-.01em", whiteSpace: "nowrap",
                }}>Reports</h2>
                <nav style={{ display: "flex", gap: 2, padding: 2, border: "1px solid var(--gline)" }}>
                    {TABS.map(([k, v]) => (
                        <button key={v} onClick={() => setTab(v)} style={{
                            height: 26, padding: "0 14px", border: 0, borderRadius: 0,
                            background: tab === v ? "var(--accdim)" : "transparent",
                            color: tab === v ? "var(--txt)" : "var(--txt3)",
                            font: "inherit", whiteSpace: "nowrap", cursor: "pointer",
                        }}>{k}</button>
                    ))}
                </nav>
                <span style={{
                    fontFamily: "var(--mz-font-mono)", fontSize: 10,
                    color: "var(--txt4)", whiteSpace: "nowrap",
                }}>{meta}</span>
                <div style={{ flex: 1 }} />
                {busy && <Loading size={14} inline label={`building the ${busy}`} />}
                {acts.map(([k, go, primary]) => <Act key={k} onClick={go} primary={primary}>{k}</Act>)}
            </div>

            {tab === "generate" && (
                /* FULL HEIGHT, NOT A CARD IN A SCROLLING GRID.
                   Generate is a three-column surface that sizes itself to
                   100% of its parent. Nesting it inside an auto-fit grid
                   card collapsed that to the card's content height, which
                   cut off the bottom of the parameters column — where the
                   "generate briefing" button lives. The screen was not
                   merely clipped; the one control it exists for was off the
                   end of it. */
                // Generate has its own evidence panel; the saved-signals aside
                // that sat beside it repeated it in the old style. "Write it
                // yourself" is a quiet line under the header, not a toolbar.
                <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px 0", fontSize: 12.5, color: "var(--txt3)" }}>
                        Or start from blank:
                        <button onClick={() => setTab("write")} style={{ border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", cursor: "pointer", padding: 0 }}>a document</button>
                        ·
                        <button onClick={() => setTab("build")} style={{ border: 0, background: "transparent", color: "var(--acchi)", font: "inherit", cursor: "pointer", padding: 0 }}>a deck</button>
                    </div>
                    <div style={{ flex: 1, minHeight: 0 }}>
                        <Generate onOpenTab={(rid, title, kind) => {
                            if (kind === "deck") { setDeckId(rid); setTab("build") }
                            else if (kind === "print") onPrint(rid)
                            else { setReportId(rid); setTab("reader") }
                            onOpenTab(rid, title, kind)
                        }} />
                    </div>
                </div>
            )}

            {tab === "notes" && (
                <div style={{ flex: 1, minHeight: 0, padding: 12, display: "flex", minWidth: 0 }}>
                    <Notes />
                </div>
            )}

            {tab === "write" && (
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                    <DocWriter onClose={() => setTab("generate")} />
                </div>
            )}

            {tab === "build" && (
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                    <DeckBuilder onClose={() => setTab("generate")} />
                </div>
            )}

            {tab === "reader" && (
                <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                    <Briefings
                        initialReportId={reportId}
                        onPrint={onPrint}
                        onOpenDeck={(id) => { setDeckId(id); setTab("deck") }}
                        onOpenGenerate={() => setTab("generate")}
                        isVisible={isVisible}
                    />
                </div>
            )}

        </section>
    )
}
