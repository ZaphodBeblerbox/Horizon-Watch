/**
 * DeckBuilder.jsx — build a deck, edit it, present it, export it.
 *
 * Deck.jsx renders a deck DERIVED from a generated report — a presenter
 * whose slides are computed, so nothing in it could be written. This is
 * the authoring half, and it also presents, because a separate "present"
 * window for a deck you are already looking at is a second place to go for
 * something you can do here.
 *
 * WHAT MAKES IT AN EDITOR AND NOT A FORM. The slide rail shows real
 * thumbnails rather than a list of titles — at a glance you are choosing a
 * slide by what it looks like, which is how anyone picks one. The canvas
 * is edited in place at 16:9. The inspector carries layout, the signal the
 * slide is about, and speaker notes that travel into the .pptx as real
 * notes rather than body text.
 *
 * THE MARKS COME FROM print/PageFrame.jsx — the Echo X and the Trifecta
 * line, in the corners report_office.py writes them into every exported
 * slide, so the thing you arrange is the thing PowerPoint opens.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import API_BASE from "../apiBase.js"
import Loading from "../ui/Loading.jsx"
import DocSignalsAside from "./DocSignalsAside.jsx"
import FileToCase from "./FileToCase.jsx"
import { ParallaxMark, TrifectaFooter } from "../print/PageFrame.jsx"
import { savedLabel, savedMeta } from "../state/savedForBriefing.js"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt)", font: "inherit",
    cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const FIELD = {
    width: "100%", padding: "8px 10px", border: "1px solid var(--gline2)",
    background: "var(--glass2)", borderRadius: 0, outline: "none",
    color: "var(--txt)", font: "inherit", fontSize: 13, lineHeight: 1.5,
}
const LAYOUTS = [["Title + body", "body"], ["Title only", "title"],
                 ["Bullets", "bullets"], ["Quote", "quote"]]

let seq = 0
const blank = (over = {}) => ({
    id: `s${++seq}`, title: "", body: "", notes: "", layout: "body", signal: null, ...over,
})

/** One slide, drawn the same way at thumbnail, canvas and present size. */
function Slide({ s, n, total, editable = false, onPatch = () => {}, scale = 1 }) {
    const pad = `${4 * scale}cqw`
    const titleSize = 3.1, bodySize = 1.75
    const common = {
        border: 0, background: "transparent", outline: "none", width: "100%",
        padding: 0, color: "#26231e", resize: "none",
    }
    return (
        <div style={{
            containerType: "inline-size", width: "100%", aspectRatio: "16 / 9",
            display: "flex", flexDirection: "column", boxSizing: "border-box",
            padding: `${pad} ${4.5 * scale}cqw`,
            background: "#fcfbf6", color: "#26231e", overflow: "hidden",
        }}>
            {editable ? (
                <input value={s.title} onChange={(e) => onPatch("title", e.target.value)}
                    placeholder="Slide title"
                    style={{ ...common, font: `600 ${titleSize}cqw/1.1 var(--mz-font-body)`, letterSpacing: "-.01em" }} />
            ) : (
                <div style={{ font: `600 ${titleSize}cqw/1.1 var(--mz-font-body)`, letterSpacing: "-.01em" }}>
                    {s.title || " "}
                </div>
            )}

            <div style={{ height: 1, background: "#d8d3ca", margin: `${1.4 * scale}cqw 0 ${1.6 * scale}cqw` }} />

            {s.layout !== "title" && (
                editable ? (
                    <textarea value={s.body} onChange={(e) => onPatch("body", e.target.value)}
                        placeholder="What happened, why it matters"
                        style={{
                            ...common, flex: 1,
                            font: `400 ${bodySize}cqw/1.55 var(--mz-font-body)`,
                            fontStyle: s.layout === "quote" ? "italic" : "normal",
                        }} />
                ) : (
                    <div style={{
                        flex: 1, whiteSpace: "pre-wrap", overflow: "hidden",
                        font: `400 ${bodySize}cqw/1.55 var(--mz-font-body)`,
                        fontStyle: s.layout === "quote" ? "italic" : "normal",
                    }}>{s.layout === "bullets"
                        ? (s.body || "").split("\n").filter(Boolean).map((l, i) => <div key={i}>· {l}</div>)
                        : s.body}</div>
                )
            )}

            {s.signal && (
                <div style={{
                    marginTop: `${1 * scale}cqw`, padding: `${0.6 * scale}cqw ${1 * scale}cqw`,
                    background: "#f4f2ee", borderLeft: "2px solid #2f5c90",
                    font: `400 ${1.15 * scale}cqw/1.4 var(--mz-font-mono)`, color: "#4a4a44",
                    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis",
                }}>{s.signal.label}</div>
            )}

            <div style={{
                display: "flex", alignItems: "flex-end", justifyContent: "space-between",
                marginTop: `${1.6 * scale}cqw`,
            }}>
                {/* Not retyped: the same mark the printed page carries. */}
                <span style={{ transform: `scale(${Math.min(1, scale)})`, transformOrigin: "left bottom" }}>
                    <ParallaxMark height={12} />
                </span>
                <span style={{
                    display: "flex", alignItems: "baseline", gap: 10,
                    fontFamily: "var(--mz-font-mono)", fontSize: `${1.05 * scale}cqw`,
                    letterSpacing: ".14em", color: "#6a6f77",
                }}>
                    <TrifectaFooter />
                    <span>{n} / {total}</span>
                </span>
            </div>
        </div>
    )
}

export default function DeckBuilder({ onClose = null }) {
    const [title, setTitle] = useState("Untitled deck")
    const [classification, setClassification] = useState("UNCLASSIFIED")
    const [slides, setSlides] = useState(() => [
        blank({ title: "Title slide", body: "What this deck is about." }),
    ])
    const [i, setI] = useState(0)
    const [present, setPresent] = useState(false)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)

    const cur = slides[i] || slides[0]
    const patch = (k, v) => setSlides((s) => s.map((x, n) => (n === i ? { ...x, [k]: v } : x)))

    const add = () => { setSlides((s) => [...s, blank()]); setI(slides.length) }
    const dup = () => setSlides((s) => [...s.slice(0, i + 1), { ...s[i], id: `s${++seq}` }, ...s.slice(i + 1)])
    const del = () => {
        if (slides.length === 1) return
        setSlides((s) => s.filter((_, n) => n !== i))
        setI((n) => Math.max(0, n - 1))
    }
    const move = (d) => {
        const j = i + d
        if (j < 0 || j >= slides.length) return
        setSlides((s) => { const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c })
        setI(j)
    }

    /** A saved signal becomes a slide — title, attribution, and the link. */
    const slideFromSignal = (g) => {
        setSlides((s) => [...s, blank({
            title: savedLabel(g),
            body: g.context || "",
            signal: { id: g.id, label: savedMeta(g) || savedLabel(g) },
        })])
        setI(slides.length)
    }

    /* Present mode lives here rather than in a separate window: the deck
       you want to show is the one already on screen. Arrows move, Escape
       leaves — the same keys Deck.jsx's presenter uses, so the habit
       carries over. */
    useEffect(() => {
        const k = (e) => {
            if (e.target?.matches?.("input,textarea,select,[contenteditable=true]")) return
            if (present) {
                if (e.key === "ArrowRight" || e.key === " ") { e.preventDefault(); setI((n) => Math.min(n + 1, slides.length - 1)) }
                else if (e.key === "ArrowLeft") { setI((n) => Math.max(n - 1, 0)) }
                else if (e.key === "Escape") { e.preventDefault(); setPresent(false) }
            } else if (e.key === "Escape" && onClose) onClose()
        }
        window.addEventListener("keydown", k)
        return () => window.removeEventListener("keydown", k)
    }, [present, slides.length, onClose])

    useEffect(() => {
        window.dispatchEvent(new CustomEvent("akili:present-mode", { detail: { active: present } }))
        return () => window.dispatchEvent(new CustomEvent("akili:present-mode", { detail: { active: false } }))
    }, [present])

    const exportPptx = useCallback(async () => {
        setBusy(true); setErr(null)
        try {
            const r = await fetch(`${API_BASE}/api/decks/export.pptx`, {
                method: "POST", credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    title, classification,
                    slides: slides.map((s) => ({
                        title: s.title,
                        body: s.signal ? `${s.body}\n\n${s.signal.label}` : s.body,
                        notes: s.notes,
                    })),
                }),
            })
            if (!r.ok) throw new Error(`export failed (${r.status})`)
            const blob = await r.blob()
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url; a.download = `${title || "deck"}.pptx`
            document.body.appendChild(a); a.click(); a.remove()
            setTimeout(() => URL.revokeObjectURL(url), 2000)
        } catch (e) { setErr(String(e.message || e)) } finally { setBusy(false) }
    }, [title, classification, slides])

    if (present) {
        return (
            <div style={{
                position: "fixed", inset: 0, zIndex: 200, background: "#15171d",
                display: "flex", flexDirection: "column", alignItems: "center",
                justifyContent: "center", padding: 40, gap: 16,
            }}>
                <div style={{ width: "min(100%, 1500px)", boxShadow: "0 24px 70px rgba(0,0,0,.5)" }}>
                    <Slide s={cur} n={i + 1} total={slides.length} />
                </div>
                <div style={{
                    display: "flex", alignItems: "center", gap: 14,
                    fontFamily: "var(--mz-font-mono)", fontSize: 11, color: "#9aa0ab",
                }}>
                    <button onClick={() => setI((n) => Math.max(0, n - 1))} style={{ ...BTN, color: "#e9eaee" }}>←</button>
                    <span>{i + 1} / {slides.length}</span>
                    <button onClick={() => setI((n) => Math.min(slides.length - 1, n + 1))} style={{ ...BTN, color: "#e9eaee" }}>→</button>
                    <button onClick={() => setPresent(false)} style={{ ...BTN, color: "#e9eaee" }}>Exit (Esc)</button>
                </div>
                {cur.notes && (
                    <div style={{
                        maxWidth: 900, fontSize: 13, lineHeight: 1.6, color: "#b5b9c3",
                        textAlign: "center", textWrap: "pretty",
                    }}>{cur.notes}</div>
                )}
            </div>
        )
    }

    return (
        <div style={{ display: "flex", gap: 12, height: "100%", minHeight: 0, minWidth: 0 }}>
            <div style={{
                flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden",
                border: "1px solid var(--gline)", background: "var(--glass)",
                backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
            }}>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
                    minHeight: 44, flex: "none", padding: "6px 10px 6px 12px",
                    borderBottom: "1px solid var(--gline)",
                }}>
                    <span style={EYE}>Deck</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} style={{
                        ...FIELD, width: 230, padding: "4px 8px", fontWeight: 600, fontSize: 14,
                    }} />
                    <input value={classification} onChange={(e) => setClassification(e.target.value)}
                        title="Printed in the footer of every slide" style={{
                            ...FIELD, width: 170, padding: "4px 8px",
                            fontFamily: "var(--mz-font-mono)", fontSize: 11,
                        }} />
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                        {slides.length} {slides.length === 1 ? "slide" : "slides"} · not saved until exported
                    </span>
                    <div style={{ flex: 1 }} />
                    {err && <span style={{ fontSize: 12, color: "var(--red)" }}>{err}</span>}
                    {busy && <Loading size={13} inline label="building the pptx" />}
                    <FileToCase kind="deck" name={title} style={{ ...BTN, height: 28 }}
                        getHtml={() => slides.map((sl, i) =>
                            `<h2>${i + 1}. ${escapeHtml(sl.title)}</h2>`
                            + (sl.body ? `<p>${escapeHtml(sl.body).replace(/\n/g, "<br>")}</p>` : "")
                            + (sl.notes ? `<p><i>Speaker notes: ${escapeHtml(sl.notes)}</i></p>` : "")
                        ).join("\n")} />
                    <button onClick={() => setPresent(true)} style={BTN}>Present</button>
                    <button onClick={exportPptx} disabled={busy} style={{
                        ...BTN, border: 0, background: "var(--acc)", color: "var(--mz-cream)", fontWeight: 600,
                    }}>Export .pptx</button>
                    {onClose && <button onClick={onClose} style={{ ...BTN, width: 28, padding: 0 }}>✕</button>}
                </div>

                <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "164px minmax(0,1fr) 250px" }}>
                    {/* rail — real thumbnails, not a list of titles */}
                    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid var(--gline)" }}>
                        <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                            {slides.map((s, n) => (
                                <button key={s.id} onClick={() => setI(n)} style={{
                                    display: "flex", gap: 6, padding: 0, border: 0, background: "transparent",
                                    cursor: "pointer", textAlign: "left", font: "inherit",
                                }}>
                                    <span style={{
                                        fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                        color: n === i ? "var(--txt)" : "var(--txt4)", paddingTop: 2,
                                    }}>{String(n + 1).padStart(2, "0")}</span>
                                    <span style={{
                                        flex: 1, minWidth: 0, display: "block",
                                        border: `1px solid ${n === i ? "var(--acchi)" : "var(--gline2)"}`,
                                        outline: n === i ? "2px solid var(--accdim)" : "none",
                                    }}>
                                        <Slide s={s} n={n + 1} total={slides.length} scale={0.5} />
                                    </span>
                                </button>
                            ))}
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: 10, borderTop: "1px solid var(--gline)" }}>
                            <button onClick={add} style={{ ...BTN, height: 26, padding: "0 9px", fontSize: 11 }}>+ slide</button>
                            <button onClick={dup} style={{ ...BTN, height: 26, padding: "0 9px", fontSize: 11 }}>copy</button>
                            <button onClick={() => move(-1)} style={{ ...BTN, height: 26, width: 26, padding: 0 }}>↑</button>
                            <button onClick={() => move(1)} style={{ ...BTN, height: 26, width: 26, padding: 0 }}>↓</button>
                            <button onClick={del} disabled={slides.length === 1} style={{
                                ...BTN, height: 26, padding: "0 9px", fontSize: 11,
                                color: slides.length === 1 ? "var(--txt4)" : "var(--red)",
                            }}>delete</button>
                        </div>
                    </div>

                    {/* canvas */}
                    <div style={{
                        minWidth: 0, minHeight: 0, overflow: "auto", padding: 22,
                        background: "var(--scrim)", display: "flex", justifyContent: "center",
                        alignItems: "flex-start",
                    }}>
                        <div style={{
                            width: "100%", maxWidth: 900,
                            border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                        }}>
                            <Slide s={cur} n={i + 1} total={slides.length} editable onPatch={patch} />
                        </div>
                    </div>

                    {/* inspector */}
                    <div style={{
                        minHeight: 0, overflow: "auto", borderLeft: "1px solid var(--gline)",
                        padding: 14, display: "flex", flexDirection: "column", gap: 14,
                    }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={EYE}>Layout</span>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                                {LAYOUTS.map(([k, v]) => (
                                    <button key={v} onClick={() => patch("layout", v)} style={{
                                        height: 30, border: "1px solid var(--gline2)",
                                        background: cur.layout === v ? "var(--accdim)" : "transparent",
                                        color: cur.layout === v ? "var(--txt)" : "var(--txt3)",
                                        font: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 0,
                                    }}>{k}</button>
                                ))}
                            </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={EYE}>Linked signal</span>
                            {cur.signal ? (
                                <div style={{
                                    display: "flex", alignItems: "center", gap: 8, padding: "7px 9px",
                                    border: "1px solid var(--gline)", fontSize: 11.5,
                                }}>
                                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                        {cur.signal.label}
                                    </span>
                                    <button onClick={() => patch("signal", null)} style={{
                                        border: 0, background: "transparent", color: "var(--txt4)",
                                        font: "inherit", cursor: "pointer",
                                    }}>✕</button>
                                </div>
                            ) : (
                                <span style={{ fontSize: 11, color: "var(--txt4)", textWrap: "pretty" }}>
                                    Press <b style={{ fontWeight: 600 }}>slide</b> on a signal in the aside to
                                    add one as its own slide, with the attribution attached.
                                </span>
                            )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <span style={EYE}>Speaker notes</span>
                            <textarea value={cur.notes} onChange={(e) => patch("notes", e.target.value)}
                                placeholder="What you'll say on this slide"
                                style={{ ...FIELD, minHeight: 150, resize: "vertical" }} />
                            <span style={{ fontSize: 11, color: "var(--txt4)", textWrap: "pretty" }}>
                                These travel into the .pptx as real speaker notes, and show under the slide
                                while you present.
                            </span>
                        </div>
                    </div>
                </div>
            </div>

            <DocSignalsAside
                title="Signals for this deck"
                insertLabel="slide"
                onInsert={slideFromSignal}
                hint="Click a signal to locate it. Slide turns it into its own slide, with the attribution attached."
            />
        </div>
    )
}

function escapeHtml(t) {
    return String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]))
}
