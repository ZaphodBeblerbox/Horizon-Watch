// SessionControl.jsx — Sessions & Views full round (§3.4/§5.1). The real
// `.sessionctl` mode control at the tab strip's far left: session name +
// a WATCH/WORK chip (hardcoded to WATCH — Workstation mode doesn't exist
// in this codebase yet; wire the chip to real mode state once it does,
// rather than inventing a toggle with nothing behind it) + a ▾ that opens
// a real 308px popover (`#ses-pop`) listing every real session this user
// has. No native dialogs anywhere here (prompt()/confirm()) — new-session
// naming and renames are both inline fields, matching this app's existing
// no-native-dialogs rule (see GlobeAnnotationLayer.jsx's own inline-rename
// precedent).
import { useState, useEffect, useRef } from "react"
import {
    getActiveSession, getActiveViews, subscribeActiveSession,
    listSessions, switchToSession, forkCurrentSessionAsNew,
    renameSession, deleteSession as apiDeleteSession, ensureActiveSession,
} from "../state/sessionStore.js"
import { toast } from "../ui/toast.js"
import { safeArray } from "../utils/safeArray.js"

function sessionSummary(s) {
    const layerCount = (s.domains || []).length
    return `${s.time_window} · ${layerCount} layer${layerCount === 1 ? "" : "s"} · ${s.projection || "world"}`
}

export default function SessionControl({ mode = "watch", onSetMode = null }) {
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState(getActiveSession())
    const [views, setViews] = useState(getActiveViews())
    const [sessions, setSessions] = useState([])
    const [renamingId, setRenamingId] = useState(null)
    const [renameValue, setRenameValue] = useState("")
    const popRef = useRef(null)

    useEffect(() => subscribeActiveSession((s, v) => { setActive(s); setViews(v) }), [])

    function refreshList() {
        listSessions().then((v) => setSessions(safeArray(v))).catch(() => {})
    }

    useEffect(() => { if (open) refreshList() }, [open, active])

    useEffect(() => {
        if (!open) return
        function onDocClick(e) { if (popRef.current && !popRef.current.contains(e.target)) setOpen(false) }
        document.addEventListener("mousedown", onDocClick)
        return () => document.removeEventListener("mousedown", onDocClick)
    }, [open])

    async function handleSwitch(s) {
        if (renamingId) return
        if (s.session_id === active?.session_id) { setOpen(false); return }
        try {
            await switchToSession(s)
            toast(`Switched to ${s.name}`, { icon: "i-check" })
            setOpen(false)
        } catch (e) {
            toast(e?.message || "Could not switch session", { icon: "i-alert" })
        }
    }

    async function handleNew() {
        try {
            const created = await forkCurrentSessionAsNew("Untitled session")
            refreshList()
            setRenamingId(created.session_id)
            setRenameValue(created.name)
        } catch (e) {
            toast(e?.message || "Could not create session", { icon: "i-alert" })
        }
    }

    async function commitRename(s) {
        const name = renameValue.trim()
        setRenamingId(null)
        if (!name || name === s.name) return
        try {
            await renameSession(s.session_id, name)
            refreshList()
        } catch (e) {
            toast(e?.message || "Could not rename session", { icon: "i-alert" })
        }
    }

    async function handleDelete(s, e) {
        e.stopPropagation()
        // Real getter, not this render's `active` state — the state can lag
        // a module-level mirror update by one tick, and comparing against a
        // stale value here would silently skip the fallback below, leaving
        // the just-deleted session as the (now-nonexistent) "active" one.
        const wasActive = s.session_id === getActiveSession()?.session_id
        try {
            await apiDeleteSession(s.session_id)
            setSessions((prev) => prev.filter((x) => x.session_id !== s.session_id))
            toast(`Deleted ${s.name}`, { icon: "i-check" })
            // Deleting the active session leaves nothing applied — pick a
            // real replacement (another existing session, or a freshly
            // seeded default) the same way app boot does.
            if (wasActive) await ensureActiveSession()
        } catch (e2) {
            toast(e2?.message || "Could not delete session", { icon: "i-alert" })
        }
    }

    return (
        <div style={{ position: "relative", flexShrink: 0, height: "100%" }}>
            <button
                id="ses-open" className="sessionctl" onClick={() => setOpen((o) => !o)}
                style={{
                    display: "flex", alignItems: "center", gap: 7, height: "100%", padding: "0 12px",
                    background: "none", border: "none", borderRight: "1px solid var(--line-soft)",
                    cursor: "pointer", color: "var(--txt)", maxWidth: 200,
                }}
            >
                <span style={{
                    font: "600 12px var(--font)", overflow: "hidden", textOverflow: "ellipsis",
                    whiteSpace: "nowrap", maxWidth: 110,
                }}>{active?.name || "Session"}</span>
                {/* Reflects real mode state. Previously hardcoded to WATCH
                    because Workstation mode did not exist; it does now, and a
                    chip that always says WATCH while the rail shows work
                    modules is worse than no chip. */}
                <span style={{
                    font: "700 9px var(--mono)", padding: "1px 5px", borderRadius: "var(--r)",
                    background: "var(--bg-3)", color: "var(--txt-3)", letterSpacing: "0.03em",
                }}>{mode === "work" ? "WORK" : "WATCH"}</span>
                <span style={{ fontSize: 9, color: "var(--txt-3)", flexShrink: 0 }}>▾</span>
            </button>

            {open && (
                <div
                    id="ses-pop" ref={popRef}
                    style={{
                        position: "absolute", top: "100%", left: 0, width: 308, marginTop: 1,
                        background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: "var(--r)",
                        boxShadow: "0 8px 24px rgba(0,0,0,0.45)", zIndex: 500,
                        maxHeight: 420, overflowY: "auto",
                    }}
                >
                    {/* Mode switch (PARALLAX spec §1.2). Workstation is a
                        session MODE, not a destination: it replaces the whole
                        rail rather than sitting alongside the other tools. It
                        therefore belongs beside the tabs, which are also
                        workspace-scoped, and says "this changes what workspace
                        you are in" — which is what it does. The standalone
                        top-right button this replaces implied the opposite. */}
                    {onSetMode && (
                        <div className="modeswitch" style={{
                            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1,
                            background: "var(--line-soft)", borderBottom: "1px solid var(--line)",
                        }}>
                            {[
                                { key: "watch", icon: "i-globe", label: "Watch", sub: "Analysis and reporting" },
                                { key: "work", icon: "i-work", label: "Workstation", sub: "Casework, mail and assignment" },
                            ].map((m) => (
                                <button
                                    key={m.key}
                                    data-mode={m.key}
                                    aria-pressed={mode === m.key}
                                    onClick={() => { onSetMode(m.key); setOpen(false) }}
                                    style={{
                                        display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2,
                                        padding: "8px 10px", border: "none", cursor: "pointer", textAlign: "left",
                                        background: mode === m.key ? "var(--bg-3)" : "var(--bg-2)",
                                        color: mode === m.key ? "var(--txt)" : "var(--txt-3)",
                                    }}
                                >
                                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                        <svg className="icon sm" style={{ width: 13, height: 13 }}><use href={`#${m.icon}`} /></svg>
                                        <b style={{ font: "600 11.5px var(--font)" }}>{m.label}</b>
                                    </span>
                                    <em style={{ font: "400 10px var(--font)", color: "var(--txt-4)", fontStyle: "normal" }}>{m.sub}</em>
                                </button>
                            ))}
                        </div>
                    )}

                    <div style={{
                        padding: "8px 12px", borderBottom: "1px solid var(--line)",
                        display: "flex", justifyContent: "space-between", alignItems: "center",
                    }}>
                        <span style={{
                            font: "600 10.5px var(--font)", color: "var(--txt-3)",
                            textTransform: "uppercase", letterSpacing: "0.06em",
                        }}>Sessions</span>
                        <button id="ses-new" className="btn ghost sm" onClick={handleNew}>+ new</button>
                    </div>

                    {sessions.length === 0 && (
                        <div style={{ padding: 14, font: "400 12px var(--font)", color: "var(--txt-3)" }}>
                            No sessions yet.
                        </div>
                    )}

                    {sessions.map((s) => {
                        const isActive = s.session_id === active?.session_id
                        return (
                            <div
                                key={s.session_id}
                                role="button" tabIndex={0}
                                onClick={() => handleSwitch(s)}
                                style={{
                                    padding: "8px 12px", borderBottom: "1px solid var(--line-soft)",
                                    cursor: "pointer", background: isActive ? "var(--bg-3)" : "transparent",
                                }}
                            >
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                                    {renamingId === s.session_id ? (
                                        <input
                                            autoFocus className="input" value={renameValue}
                                            onClick={(e) => e.stopPropagation()}
                                            onChange={(e) => setRenameValue(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") commitRename(s)
                                                if (e.key === "Escape") setRenamingId(null)
                                            }}
                                            onBlur={() => commitRename(s)}
                                            style={{ font: "600 12px var(--font)", flex: 1, minWidth: 0 }}
                                        />
                                    ) : (
                                        <span
                                            style={{
                                                font: "600 12px var(--font)", color: "var(--txt)",
                                                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                                            }}
                                            onDoubleClick={(e) => { e.stopPropagation(); setRenamingId(s.session_id); setRenameValue(s.name) }}
                                            title="Double-click to rename"
                                        >
                                            {isActive && <span style={{ color: "var(--acc-hi)" }}>● </span>}
                                            {s.name}
                                        </span>
                                    )}
                                    <span
                                        role="button" tabIndex={0} onClick={(e) => handleDelete(s, e)}
                                        style={{ color: "var(--txt-4)", cursor: "pointer", padding: "0 4px", flexShrink: 0 }}
                                        title="Delete session"
                                    >✕</span>
                                </div>
                                <div style={{ font: "400 11px var(--mono)", color: "var(--txt-3)", marginTop: 2 }}>
                                    {sessionSummary(s)}
                                </div>
                                {isActive && views.length > 0 && (
                                    <div style={{ marginTop: 5, display: "flex", flexDirection: "column", gap: 2 }}>
                                        {views.map((v) => (
                                            <div key={v.view_id} style={{ font: "400 10.5px var(--font)", color: "var(--txt-3)", paddingLeft: 10 }}>
                                                · {v.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
