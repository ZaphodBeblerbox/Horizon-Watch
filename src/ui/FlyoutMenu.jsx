import { useState, useRef, useEffect } from "react"
import Icon from "./Icon.jsx"

/**
 * FlyoutMenu — the one shared "small menu that opens from a header/control
 * icon" pattern in the app (UI correction pass, Part 2/9): a button in the
 * same visual family as the map control stack (--bg-card fill, 1px --border,
 * 8px radius), opening a small TRANSLUCENT panel on click. Used for the
 * layers control (replacing the old always-docked 240px rail), the header's
 * "Tools" utility-toggle flyout, and the header's Settings "coming soon"
 * state — one consistent pattern, not three bespoke ones.
 *
 * Real glass, matched to --map-tooltip-bg + the exact real blur/saturate
 * recipe .vessel-popup's own floating card uses (src/index.css) — the SAME
 * real translucent treatment every map hover bar/popup already uses, per
 * direct user correction (theming regression fix — this used to point at
 * --bg-panel-translucent, a legacy name a LATER, unrelated round repointed
 * at a fully opaque --bg-1 ["Translucency is gone this round" —
 * index.html], so this panel was never actually translucent despite its
 * own name/comment claiming otherwise, then briefly matched to
 * --pane-glass-bg — a real but more see-through tint reserved for
 * Situation/Dossiers' large side panes, not this map-control flyout;
 * --bg-panel-translucent itself is left alone since Sources.jsx and others
 * still rely on it being opaque for their own, non-floating card surfaces).
 *
 * Self-contained: owns its own open/closed state, closes on outside click
 * and on Escape. `align="right"` (default) anchors the panel's right edge to
 * the trigger button's right edge (for header icons); `align="left"` anchors
 * the left edges (for a map-control-stack button whose panel should open
 * toward the map, not off-screen).
 */
export default function FlyoutMenu({ icon, buttonText, label, title, align = "right", direction = "down", panelWidth = 260, buttonSize = 32, buttonStyle, hotkey = null, children }) {
    const [open, setOpen] = useState(false)
    const containerRef = useRef(null)

    useEffect(() => {
        if (!open) return
        const onOutside = (e) => {
            if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
        }
        const onKey = (e) => { if (e.key === "Escape") setOpen(false) }
        document.addEventListener("mousedown", onOutside)
        window.addEventListener("keydown", onKey)
        return () => {
            document.removeEventListener("mousedown", onOutside)
            window.removeEventListener("keydown", onKey)
        }
    }, [open])

    // Optional single-key shortcut (e.g. "l" for the layers control) — same
    // "ignore it while a real text input is focused" guard HeaderSearch.jsx's
    // own "/" shortcut already uses.
    useEffect(() => {
        if (!hotkey) return
        const onHotkey = (e) => {
            if (e.metaKey || e.ctrlKey || e.altKey) return
            const tag = document.activeElement?.tagName
            if (tag === "INPUT" || tag === "TEXTAREA") return
            if (e.key.toLowerCase() === hotkey.toLowerCase()) {
                e.preventDefault()
                setOpen((v) => !v)
            }
        }
        window.addEventListener("keydown", onHotkey)
        return () => window.removeEventListener("keydown", onHotkey)
    }, [hotkey])

    return (
        <div ref={containerRef} style={{ position: "relative" }}>
            <button
                onClick={() => setOpen((v) => !v)}
                title={title || label}
                aria-label={title || label}
                aria-expanded={open}
                style={buttonText ? {
                    height: buttonSize, borderRadius: "var(--radius-md)",
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", gap: 6, padding: "0 10px",
                    cursor: "pointer", color: open ? "var(--accent-blue)" : "var(--text-secondary)",
                    fontFamily: "var(--font-sans)", fontSize: "var(--text-chip)", fontWeight: "var(--weight-medium)",
                    whiteSpace: "nowrap",
                    ...buttonStyle,
                } : {
                    width: buttonSize, height: buttonSize, borderRadius: "var(--radius-md)",
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: open ? "var(--accent-blue)" : "var(--text-secondary)",
                    ...buttonStyle,
                }}
            >
                {buttonText ? (
                    <>
                        <span>{buttonText}</span>
                        <Icon name="chevronRight" size={12} style={{ transform: open ? "rotate(-90deg)" : "rotate(90deg)", transition: "transform 0.15s ease" }} />
                    </>
                ) : (
                    <Icon name={icon} size={16} />
                )}
            </button>

            {open && (
                <div style={{
                    position: "absolute",
                    [direction === "up" ? "bottom" : "top"]: "calc(100% + 6px)",
                    [align === "right" ? "right" : "left"]: 0,
                    width: panelWidth, zIndex: 2000,
                    background: "var(--map-tooltip-bg)",
                    backdropFilter: "blur(20px) saturate(1.4)",
                    WebkitBackdropFilter: "blur(20px) saturate(1.4)",
                    border: "1px solid var(--border-strong)",
                    borderRadius: "var(--radius-md)", overflow: "hidden",
                    maxHeight: "70vh", overflowY: "auto",
                }}>
                    {label && (
                        <div style={{
                            padding: "var(--space-3) var(--space-3) var(--space-2)",
                            fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)",
                            letterSpacing: "0.08em", borderBottom: "1px solid var(--border)",
                        }}>
                            {label}
                        </div>
                    )}
                    {children}
                </div>
            )}
        </div>
    )
}
