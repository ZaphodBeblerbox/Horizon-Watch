/**
 * PlxOverlays.jsx — the floating layer. Parts A6 (notifications, alerts,
 * toasts) and A7 (menus, dialogs).
 *
 * THREE NOTIFICATION SYSTEMS, AND THEY ARE NOT THE SAME SYSTEM. This is
 * the distinction the old build never made, which is why everything ended
 * up either shouting or silent:
 *
 *   Notification  a card, top-centre, for a signal that ARRIVED while you
 *                 were looking at something else. Max three. Each one dies
 *                 after exactly 5 s whether or not you saw it, because a
 *                 queue of stale interruptions is worse than a missed one.
 *                 It carries an action, so it is actionable, not just loud.
 *   Alert         the bell's list. Everything live since you opened the
 *                 app, in one place, surviving dismissal of the card.
 *                 Nothing auto-expires here; this is the record.
 *   Toast         a one-line confirmation of something YOU just did.
 *                 2.6 s, no action, no history. "Saved to briefing."
 *
 * Collapsing these into one widget is why products end up with a bell that
 * shows 400 unread "file saved" messages.
 *
 * MENUS ARE POSITIONED, NOT ANCHORED. A7.1 places a dropdown at an
 * explicit {l, t} computed from the button's rect — below it for the menu
 * bar, to its right for the rail — so the same component serves both
 * without knowing which it is.
 */
import { useEffect, useRef } from "react"
import PlxIcon from "./PlxIcon.jsx"

/* ── A6.2 · notification cards ─────────────────────────────────────── */

export function PlxNotifications({ notes = [], onAct = () => {}, onDismiss = () => {} }) {
    return (
        <div data-screen-label="Notifications" style={{
            position: "absolute", left: "50%", top: 48, transform: "translateX(-50%)",
            width: 380, maxWidth: "calc(100% - 120px)",
            display: "flex", flexDirection: "column", gap: 8,
            zIndex: 48, pointerEvents: "none",
        }}>
            {notes.slice(0, 3).map((n) => (
                <div key={n.id} style={{
                    display: "grid", gridTemplateColumns: "28px minmax(0,1fr) auto",
                    gap: "4px 12px", padding: 12,
                    background: "var(--glass)",
                    backdropFilter: "blur(22px) saturate(1.15)",
                    WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                    border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)",
                    pointerEvents: "auto",
                }}>
                    <span style={{
                        gridRow: "span 2", display: "flex", alignItems: "center",
                        justifyContent: "center", width: 28, height: 28,
                        border: "1px solid var(--gline2)",
                        color: n.kind === "imagery" ? "var(--acchi)" : "var(--red)",
                    }}>
                        <PlxIcon href={n.kind === "imagery" ? "#g-sat" : "#g-event"} size={15} />
                    </span>
                    <b style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</b>
                    <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                        {n.t || "now"}
                    </span>
                    <span style={{
                        gridColumn: "2 / 4", fontSize: 12, lineHeight: 1.45,
                        color: "var(--txt2)", textWrap: "pretty",
                    }}>{n.sub}</span>
                    <div style={{ gridColumn: "2 / 4", display: "flex", gap: 6, marginTop: 6 }}>
                        <button onClick={() => onAct(n)} style={{
                            height: 26, padding: "0 10px", border: 0, background: "var(--acc)",
                            color: "var(--mz-cream)", font: "inherit", fontSize: 12,
                            fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
                        }}>{n.act || "Show on map"}</button>
                        <button onClick={() => onDismiss(n)} style={{
                            height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
                            background: "transparent", color: "var(--txt2)",
                            font: "inherit", fontSize: 12, cursor: "pointer",
                        }}>Dismiss</button>
                    </div>
                </div>
            ))}
        </div>
    )
}

/* ── A6.3 · the bell's panel ───────────────────────────────────────── */

export function PlxAlerts({ open, alerts = [], since = "", onClose = () => {}, onPick = () => {}, onHome = () => {} }) {
    if (!open) return null
    return (
        <>
            {/* A transparent scrim, so a click anywhere closes it. */}
            <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 44 }} />
            <section data-screen-label="Alerts" style={{
                position: "absolute", right: 8, top: 42, width: 340, maxHeight: "62vh",
                display: "flex", flexDirection: "column", overflow: "hidden",
                background: "var(--solid)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
                borderRadius: 0, zIndex: 45,
            }}>
                <div style={{
                    display: "flex", alignItems: "center", height: 36,
                    padding: "0 8px 0 12px", borderBottom: "1px solid var(--gline)", flex: "none",
                }}>
                    <b style={{ fontWeight: 600 }}>Live</b>
                    <span style={{
                        marginLeft: 8, fontFamily: "var(--mz-font-mono)",
                        fontSize: 10, color: "var(--txt4)",
                    }}>since {since}</span>
                    <button onClick={onClose} style={{
                        marginLeft: "auto", width: 24, height: 24, border: 0,
                        background: "transparent", color: "var(--txt3)", cursor: "pointer",
                    }}>✕</button>
                </div>

                {alerts.length === 0 ? (
                    <div style={{
                        display: "flex", flexDirection: "column", gap: 10,
                        padding: "14px 12px", fontSize: 12, color: "var(--txt3)", textWrap: "pretty",
                    }}>
                        Nothing new since you opened Parallax. Real-time signals appear
                        here as they arrive; earlier ones are on Home.
                        <button onClick={onHome} style={{
                            alignSelf: "flex-start", height: 28, padding: "0 12px",
                            border: "1px solid var(--gline2)", background: "transparent",
                            color: "var(--txt)", font: "inherit", cursor: "pointer", borderRadius: 4,
                        }}>Go to Home →</button>
                    </div>
                ) : (
                    <div style={{ overflow: "auto" }}>
                        {alerts.map((a, i) => (
                            <button key={a.id || i} onClick={() => onPick(a)} style={{
                                display: "grid", gridTemplateColumns: "1fr auto", gap: "2px 10px",
                                width: "100%", padding: "10px 12px", border: 0,
                                borderBottom: "1px solid var(--gline)", background: "transparent",
                                color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                            }}>
                                <b style={{ fontWeight: 600 }}>{a.title}</b>
                                <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>{a.t}</span>
                                <span style={{ fontSize: 11, color: "var(--txt3)" }}>{a.sub}</span>
                                <span style={{
                                    fontFamily: "var(--mz-font-mono)", fontSize: 10,
                                    letterSpacing: ".06em", color: a.c || "var(--txt3)",
                                }}>{a.sev}</span>
                            </button>
                        ))}
                    </div>
                )}
            </section>
        </>
    )
}

/* ── A6.4 · toast ──────────────────────────────────────────────────── */

export function PlxToast({ text, bottom = 48 }) {
    if (!text) return null
    return (
        <div style={{
            position: "absolute", left: "50%", bottom, transform: "translateX(-50%)",
            padding: "8px 14px",
            background: "var(--glass)",
            backdropFilter: "blur(22px) saturate(1.15)",
            WebkitBackdropFilter: "blur(22px) saturate(1.15)",
            border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
            borderRadius: 999, zIndex: 80, fontSize: 12, whiteSpace: "nowrap",
        }}>{text}</div>
    )
}

/* ── A7.1 · dropdown menus ─────────────────────────────────────────── */

export function PlxMenu({ open, pos = { l: 60, t: 60 }, head = null, items = [], onClose = () => {} }) {
    const ref = useRef(null)
    useEffect(() => {
        if (!open) return
        const esc = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", esc)
        return () => window.removeEventListener("keydown", esc)
    }, [open, onClose])
    if (!open) return null

    return (
        <>
            <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 55 }} />
            <div ref={ref} style={{
                position: "absolute", left: pos.l, top: pos.t, width: 240, zIndex: 56,
                background: "var(--glass)",
                backdropFilter: "blur(22px) saturate(1.15)",
                WebkitBackdropFilter: "blur(22px) saturate(1.15)",
                border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
                borderRadius: 0, padding: "4px 0",
            }}>
                {head && (
                    <div style={{
                        padding: "8px 12px", marginBottom: 4,
                        borderBottom: "1px solid var(--gline)",
                    }}>
                        <b style={{ fontWeight: 600 }}>{head.name}</b>
                        <div style={{ fontSize: 11, color: "var(--txt3)" }}>{head.sub}</div>
                    </div>
                )}
                {items.map(([label, go, kbd], i) => (
                    <button key={i} onClick={() => { onClose(); go && go() }} style={{
                        display: "flex", alignItems: "center", gap: 10, width: "100%",
                        padding: "7px 12px", border: 0, background: "transparent",
                        color: "var(--txt)", font: "inherit", textAlign: "left", cursor: "pointer",
                    }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hov)" }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent" }}
                    >
                        <span style={{ flex: 1 }}>{label}</span>
                        <span style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)" }}>
                            {kbd || ""}
                        </span>
                    </button>
                ))}
            </div>
        </>
    )
}

/* ── A7.2 · dialogs ────────────────────────────────────────────────── */

export function PlxDialog({ open, title, sub = "", width = 480, note = "", primary = "OK", onPrimary = () => {}, onClose = () => {}, children = null }) {
    useEffect(() => {
        if (!open) return
        const esc = (e) => { if (e.key === "Escape") onClose() }
        window.addEventListener("keydown", esc)
        return () => window.removeEventListener("keydown", esc)
    }, [open, onClose])
    if (!open) return null

    return (
        <div onClick={onClose} style={{
            position: "absolute", inset: 0, zIndex: 70, background: "var(--scrim)",
            display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "10vh",
        }}>
            <div onClick={(e) => e.stopPropagation()} style={{
                width, maxWidth: "calc(100% - 32px)", maxHeight: "78vh",
                display: "flex", flexDirection: "column", overflow: "hidden",
                background: "var(--glass)",
                backdropFilter: "blur(26px) saturate(1.15)",
                WebkitBackdropFilter: "blur(26px) saturate(1.15)",
                border: "1px solid var(--gline2)", boxShadow: "var(--gshadow)", borderRadius: 0,
            }}>
                <div style={{
                    display: "flex", alignItems: "flex-start", gap: 8,
                    padding: "12px 10px 10px 16px", borderBottom: "1px solid var(--gline)",
                }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{title}</h3>
                        {sub && <div style={{ fontSize: 11, color: "var(--txt3)", marginTop: 2 }}>{sub}</div>}
                    </div>
                    <button onClick={onClose} style={{
                        width: 24, height: 24, border: 0, background: "transparent",
                        color: "var(--txt3)", cursor: "pointer",
                    }}>✕</button>
                </div>
                <div style={{
                    flex: 1, overflow: "auto", display: "flex", flexDirection: "column",
                    gap: 14, padding: "14px 16px",
                }}>{children}</div>
                <div style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "10px 16px", borderTop: "1px solid var(--gline)",
                }}>
                    <span style={{ flex: 1, fontSize: 11, color: "var(--txt4)" }}>{note}</span>
                    <button onClick={onClose} style={{
                        height: 28, padding: "0 12px", border: "1px solid var(--gline2)",
                        background: "transparent", color: "var(--txt2)", font: "inherit",
                        cursor: "pointer", borderRadius: 0,
                    }}>Cancel</button>
                    <button onClick={onPrimary} style={{
                        height: 28, padding: "0 12px", border: 0, background: "var(--acc)",
                        color: "var(--mz-cream)", font: "inherit", fontWeight: 600,
                        cursor: "pointer", borderRadius: 0,
                    }}>{primary}</button>
                </div>
            </div>
        </div>
    )
}
