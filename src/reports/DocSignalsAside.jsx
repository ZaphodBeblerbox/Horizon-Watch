/**
 * DocSignalsAside.jsx — PARALLAX v6, the ▣ Document aside.
 *
 * "Signals for this document": a locator at the top so the saved set has a
 * geography rather than being names in an arbitrary order, a picker under
 * it, and then the list, each row able to put itself into whatever you are
 * writing.
 *
 * ONE ASIDE, THREE SURFACES. The writer, the deck builder and the
 * generator all need the same thing — what have I saved, where is it, put
 * it in — so it is written once and given an `onInsert` that means
 * something different in each: a block in the document, a slide in the
 * deck, a selected row in the generator.
 *
 * THE PICKER IS BY URGENCY AND SECTOR, because those are the two questions
 * a writer actually asks of a saved set: what is urgent, and what is this
 * section about. A flat list sorted by one key is fine at eight signals and
 * useless at eighty, which is what a week of watching produces. Picking a
 * band and inserting all of it is one gesture, not eighty.
 *
 * The map is 210px and above the list because the first question about a
 * saved signal is where it happened; a list that answers it only by
 * reading place names makes you hold a map in your head.
 */
import { useEffect, useMemo, useState } from "react"
import Minimap from "../components/Minimap.jsx"
import { useSaved, removeSaved, savedLabel, savedMeta } from "../state/savedForBriefing.js"
import {
    SAVED_READ, applyFilters, facetCounts, group, sectorsPresent, urgenciesPresent,
} from "../state/signalPicker.js"

const EYE = {
    fontFamily: "var(--mz-font-mono)", fontWeight: 500, fontSize: 10,
    letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)",
}
const SEV_C = {
    critical: "var(--red)", significant: "var(--amber)",
    high: "var(--amber)", elevated: "var(--acchi)",
}
const KIND_ICON = {
    signal: "#g-event", imagery: "#g-sat", entity: "#g-onto",
    note: "#g-doc", scene: "#g-sat",
}
const MINI_H = 210

const SMALL = {
    height: 22, padding: "0 8px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt)", font: "inherit",
    fontSize: 11, cursor: "pointer", borderRadius: 0,
}

/** A facet chip: the band, how many of it there are, and whether it is on. */
function Chip({ label, count, on, tint, onClick }) {
    return (
        <button
            type="button" onClick={onClick} title={`${label} · ${count}`}
            style={{
                display: "inline-flex", alignItems: "center", gap: 5, height: 20,
                padding: "0 7px", cursor: "pointer", borderRadius: 0,
                border: `1px solid ${on ? "var(--acc-line, var(--gline2))" : "var(--gline)"}`,
                background: on ? "var(--accdim, var(--glass2))" : "transparent",
                color: on ? "var(--txt)" : "var(--txt3)",
                font: "inherit", fontSize: 10.5, whiteSpace: "nowrap",
            }}
        >
            {tint && <i style={{ width: 6, height: 6, background: tint, flexShrink: 0 }} />}
            {label}
            <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 9.5, color: "var(--txt4)" }}>{count}</span>
        </button>
    )
}

export default function DocSignalsAside({
    width = 320,
    title = "Signals for this document",
    insertLabel = "insert",
    onInsert = null,
    hint = "Click a signal to locate it. Insert puts it into what you are writing.",
    footer = null,
    defaultGroupBy = "urgency",
}) {
    const saved = useSaved()
    const [sel, setSel] = useState(null)

    const [urg, setUrg] = useState(() => new Set())
    const [sec, setSec] = useState(() => new Set())
    const [q, setQ] = useState("")
    const [by, setBy] = useState(defaultGroupBy)
    const [picked, setPicked] = useState(() => new Set())

    const all = useMemo(() => saved.filter((s) => s.kind !== "note"), [saved])
    const counts = useMemo(() => facetCounts(all, SAVED_READ, { urgency: urg, sector: sec }), [all, urg, sec])
    const urgBands = useMemo(() => urgenciesPresent(all, SAVED_READ), [all])
    const secBands = useMemo(() => sectorsPresent(all, SAVED_READ), [all])

    const items = useMemo(
        () => applyFilters(all, SAVED_READ, { urgency: urg, sector: sec, q }),
        [all, urg, sec, q])
    const groups = useMemo(() => group(items, SAVED_READ, by), [items, by])

    // A signal that filtering or deleting has taken off the list cannot stay
    // selected — "insert 4 selected" must never insert something invisible.
    useEffect(() => {
        const live = new Set(items.map((s) => s.id))
        setPicked((p) => {
            const next = new Set([...p].filter((id) => live.has(id)))
            return next.size === p.size ? p : next
        })
    }, [items])

    const placed = useMemo(() => items.filter((s) => s.lat != null && s.lon != null), [items])
    const focus = useMemo(() => {
        const s = items.find((x) => x.id === sel)
        return s && s.lat != null ? { lat: s.lat, lon: s.lon } : (placed[0] ? { lat: placed[0].lat, lon: placed[0].lon } : null)
    }, [items, sel, placed])
    const focused = items.find((x) => x.id === sel) || placed[0] || null

    const toggle = (set, put) => (v) => put((p) => {
        const n = new Set(p); n.has(v) ? n.delete(v) : n.add(v); return n
    })
    const toggleUrg = toggle(urg, setUrg)
    const toggleSec = toggle(sec, setSec)
    // A boolean: `urg.size` is 0 when empty and {0 && <x/>} renders the
    // zero, and `q.trim()` is "" which renders nothing but is still not a
    // boolean. Both are hazards the same shape.
    const filtered = urg.size > 0 || sec.size > 0 || q.trim().length > 0

    const copy = (g) => {
        const line = `${savedLabel(g)} — ${savedMeta(g) || "no attribution"}`
        try { navigator.clipboard?.writeText(line) } catch { /* denied */ }
    }

    const insertMany = (list) => {
        if (!onInsert) return
        for (const g of list) onInsert(g)
        setPicked(new Set())
    }

    return (
        <aside data-screen-label="Signals for this document" style={{
            flex: `0 0 ${width}px`, minHeight: 0, display: "flex", flexDirection: "column",
            overflow: "hidden", background: "var(--glass)",
            backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
            border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
        }}>
            <div style={{
                display: "flex", alignItems: "center", gap: 8, height: 36, flex: "none",
                padding: "0 12px", borderBottom: "1px solid var(--gline)",
            }}>
                <b style={{ fontWeight: 600, fontSize: 12.5 }}>{title}</b>
                <span style={{
                    marginLeft: "auto", fontFamily: "var(--mz-font-mono)",
                    fontSize: 10, color: "var(--txt4)",
                }}>{filtered ? `${items.length}/${all.length}` : all.length}</span>
            </div>

            <div style={{
                position: "relative", height: MINI_H, flex: "none",
                borderBottom: "1px solid var(--gline)", background: "var(--sea)",
            }}>
                <Minimap
                    focus={focus}
                    context={placed
                        .filter((s) => s.id !== focused?.id)
                        .map((s) => ({ id: s.id, lat: s.lat, lon: s.lon, ts: Date.parse(s.when) || s.savedAt, severity: s.severity }))}
                    framing="signal"
                    width={width - 2}
                    height={MINI_H}
                    label={focused ? savedLabel(focused).slice(0, 26) : ""}
                    title="Locator"
                    subtitle={placed.length ? "" : "nothing saved has a location"}
                />
                <div style={{
                    position: "absolute", left: 8, right: 8, bottom: 8,
                    display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                    background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
                    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    border: "1px solid var(--gline2)",
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <b style={{
                            display: "block", overflow: "hidden", fontWeight: 600, fontSize: 11,
                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>{focused ? savedLabel(focused) : "Nothing selected"}</b>
                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt3)" }}>
                            {focused ? (savedMeta(focused) || "no attribution recorded") : `${items.length} saved`}
                        </span>
                    </div>
                    {focused?.lat != null && (
                        <button onClick={() => window.dispatchEvent(new CustomEvent("akili:fly-to", {
                            detail: { lat: focused.lat, lon: focused.lon },
                        }))} style={{
                            border: 0, background: "transparent", color: "var(--acchi)",
                            font: "inherit", fontSize: 11, whiteSpace: "nowrap", cursor: "pointer",
                        }}>open on map →</button>
                    )}
                </div>
            </div>

            {/* ── the picker ─────────────────────────────────────────── */}
            {all.length > 0 && (
                <div style={{
                    flex: "none", borderBottom: "1px solid var(--gline)",
                    padding: "8px 12px", display: "flex", flexDirection: "column", gap: 7,
                }}>
                    <input
                        value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search saved signals"
                        style={{
                            height: 24, padding: "0 8px", background: "var(--glass2)",
                            border: "1px solid var(--gline)", color: "var(--txt)",
                            font: "inherit", fontSize: 11, outline: "none", borderRadius: 0,
                        }}
                    />

                    <div>
                        <div style={{ ...EYE, marginBottom: 4 }}>Urgency</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {urgBands.map((u) => (
                                <Chip key={u} label={u} count={counts.urgency[u] || 0} on={urg.has(u)}
                                      tint={SEV_C[u] || "var(--steel)"} onClick={() => toggleUrg(u)} />
                            ))}
                        </div>
                    </div>

                    <div>
                        <div style={{ ...EYE, marginBottom: 4 }}>Sector</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {secBands.map((s) => (
                                <Chip key={s} label={s} count={counts.sector[s] || 0} on={sec.has(s)}
                                      onClick={() => toggleSec(s)} />
                            ))}
                        </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ ...EYE, marginRight: 2 }}>Group</span>
                        {[["urgency", "urgency"], ["sector", "sector"], ["none", "flat"]].map(([k, l]) => (
                            <button key={k} type="button" onClick={() => setBy(k)} style={{
                                height: 20, padding: "0 7px", cursor: "pointer", borderRadius: 0,
                                border: `1px solid ${by === k ? "var(--acc-line, var(--gline2))" : "var(--gline)"}`,
                                background: by === k ? "var(--accdim, var(--glass2))" : "transparent",
                                color: by === k ? "var(--txt)" : "var(--txt3)", font: "inherit", fontSize: 10.5,
                            }}>{l}</button>
                        ))}
                        {filtered && (
                            <button type="button" onClick={() => { setUrg(new Set()); setSec(new Set()); setQ("") }}
                                    style={{
                                        marginLeft: "auto", height: 20, padding: "0 6px", border: 0,
                                        background: "transparent", color: "var(--txt4)",
                                        font: "inherit", fontSize: 10.5, cursor: "pointer",
                                    }}>clear</button>
                        )}
                    </div>
                </div>
            )}

            <div style={{
                padding: "8px 12px", borderBottom: "1px solid var(--gline)", flex: "none",
                fontSize: 11, color: "var(--txt3)", textWrap: "pretty",
            }}>{hint}</div>

            <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
                {groups.map((grp) => {
                    const ids = grp.items.map((g) => g.id)
                    const allPicked = ids.length > 0 && ids.every((id) => picked.has(id))
                    return (
                        <div key={grp.key ?? "__all__"}>
                            {grp.key != null && (
                                <div style={{
                                    position: "sticky", top: 0, zIndex: 1,
                                    display: "flex", alignItems: "center", gap: 7, padding: "5px 12px",
                                    background: "var(--glass2)", borderBottom: "1px solid var(--gline)",
                                    backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                                }}>
                                    <input
                                        type="checkbox" checked={allPicked} aria-label={`Select all in ${grp.key}`}
                                        onChange={() => setPicked((p) => {
                                            const n = new Set(p)
                                            if (allPicked) ids.forEach((id) => n.delete(id))
                                            else ids.forEach((id) => n.add(id))
                                            return n
                                        })}
                                        style={{ margin: 0, cursor: "pointer" }}
                                    />
                                    <span style={{ ...EYE, color: SEV_C[grp.key] || "var(--txt3)" }}>{grp.key}</span>
                                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 9.5, color: "var(--txt4)" }}>
                                        {grp.items.length}
                                    </span>
                                    {onInsert && (
                                        <button onClick={() => insertMany(grp.items)} style={{
                                            marginLeft: "auto", height: 19, padding: "0 7px", border: 0,
                                            background: "transparent", color: "var(--acchi)",
                                            font: "inherit", fontSize: 10.5, cursor: "pointer", whiteSpace: "nowrap",
                                        }}>{insertLabel} all</button>
                                    )}
                                </div>
                            )}

                            {grp.items.map((g) => {
                                const c = SEV_C[SAVED_READ.urgency(g)] || "var(--steel)"
                                const on = g.id === sel
                                return (
                                    <div key={g.id} onClick={() => setSel(g.id)} draggable
                                        onDragStart={(e) => {
                                            // The id is what a drop target needs to build
                                            // a real link; the label is the fallback for
                                            // anything outside the app.
                                            e.dataTransfer.setData("application/x-plx-signal", g.id)
                                            e.dataTransfer.setData("text/plain", savedLabel(g))
                                        }}
                                        style={{
                                            display: "grid", gridTemplateColumns: "14px 16px minmax(0,1fr) auto",
                                            gap: "2px 7px", alignItems: "center", padding: "9px 12px",
                                            borderBottom: "1px solid var(--gline)",
                                            background: on ? "var(--accdim)" : "transparent", cursor: "grab",
                                        }}>
                                        <input
                                            type="checkbox" checked={picked.has(g.id)}
                                            aria-label={`Select ${savedLabel(g)}`}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={() => setPicked((p) => {
                                                const n = new Set(p); n.has(g.id) ? n.delete(g.id) : n.add(g.id); return n
                                            })}
                                            style={{ margin: 0, cursor: "pointer" }}
                                        />
                                        <svg width="13" height="13" style={{ color: c }} aria-hidden>
                                            <use href={KIND_ICON[g.kind] || "#g-event"} />
                                        </svg>
                                        <b title={savedLabel(g)} style={{
                                            fontWeight: 600, overflow: "hidden",
                                            textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>{savedLabel(g)}</b>
                                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 9, color: c }}>
                                            {SAVED_READ.urgency(g)}
                                        </span>
                                        <span /><span />
                                        <span style={{
                                            gridColumn: "3 / 5", overflow: "hidden", fontSize: 11,
                                            color: "var(--txt3)", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                        }}>
                                            {/* The sector is on the row, not only in the
                                                group header — once you have grouped by
                                                urgency it is the thing you cannot see. */}
                                            <span style={{ color: "var(--txt4)" }}>{SAVED_READ.sector(g)}</span>
                                            {savedMeta(g) ? ` · ${savedMeta(g)}` : ""}
                                        </span>
                                        <span /><span />
                                        <span style={{ gridColumn: "3 / 5", display: "flex", gap: 4, marginTop: 5 }}>
                                            {onInsert && (
                                                <button onClick={(e) => { e.stopPropagation(); onInsert(g) }} style={SMALL}>
                                                    {insertLabel}
                                                </button>
                                            )}
                                            <button onClick={(e) => { e.stopPropagation(); copy(g) }} style={SMALL}>copy</button>
                                            <button onClick={(e) => { e.stopPropagation(); removeSaved(g.id) }}
                                                title="Remove from document signals" style={{
                                                    marginLeft: "auto", padding: "0 6px", height: 22, border: 0,
                                                    background: "transparent", color: "var(--txt4)",
                                                    font: "inherit", fontSize: 11, cursor: "pointer",
                                                }}>✕</button>
                                        </span>
                                    </div>
                                )
                            })}
                        </div>
                    )
                })}

                {!items.length && all.length > 0 && (
                    <div style={{ padding: "14px 12px", fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>
                        Nothing saved matches this filter.
                        <div style={{ marginTop: 8 }}>
                            <button onClick={() => { setUrg(new Set()); setSec(new Set()); setQ("") }}
                                    style={{ ...SMALL, height: 26, padding: "0 10px" }}>Show all {all.length} →</button>
                        </div>
                    </div>
                )}

                {!all.length && (
                    <div style={{ padding: "14px 12px", fontSize: 12, color: "var(--txt3)", textWrap: "pretty" }}>
                        No signals saved yet. Use <b style={{ fontWeight: 600 }}>+ briefing</b> on any map
                        card, object view or inbox message.
                        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                            <button onClick={() => window.dispatchEvent(new CustomEvent("akili:open-map"))}
                                style={{ ...SMALL, height: 28, padding: "0 12px", borderRadius: 4 }}>Open the map →</button>
                            <button onClick={() => window.dispatchEvent(new CustomEvent("akili:navigate", { detail: { destination: "inbox" } }))}
                                style={{ ...SMALL, height: 28, padding: "0 12px", borderRadius: 4 }}>Open inbox →</button>
                        </div>
                    </div>
                )}
            </div>

            {/* The selection acts from down here, where it stays put while
                the list scrolls — a bar that only exists once something is
                ticked, so it never takes space it has no use for. */}
            {onInsert && picked.size > 0 && (
                <div style={{
                    flex: "none", display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 12px", borderTop: "1px solid var(--gline)", background: "var(--glass2)",
                }}>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10.5, color: "var(--txt3)" }}>
                        {picked.size} selected
                    </span>
                    <button onClick={() => setPicked(new Set())} style={{
                        height: 22, padding: "0 6px", border: 0, background: "transparent",
                        color: "var(--txt4)", font: "inherit", fontSize: 10.5, cursor: "pointer",
                    }}>clear</button>
                    <button onClick={() => insertMany(items.filter((g) => picked.has(g.id)))} style={{
                        marginLeft: "auto", height: 24, padding: "0 11px", borderRadius: 0,
                        border: "1px solid var(--acc-line, var(--gline2))",
                        background: "var(--accdim, var(--glass2))", color: "var(--txt)",
                        font: "inherit", fontSize: 11, fontWeight: 600, cursor: "pointer",
                    }}>{insertLabel} {picked.size}</button>
                </div>
            )}

            {footer && (
                <div style={{ flex: "none", borderTop: "1px solid var(--gline)", padding: 10 }}>{footer}</div>
            )}
        </aside>
    )
}

export { EYE as ASIDE_EYE }
