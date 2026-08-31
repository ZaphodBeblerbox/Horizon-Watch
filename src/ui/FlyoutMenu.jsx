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
 * Translucent per the correction pass's own narrow exception to "no
 * glassmorphism": alpha transparency only (--bg-panel-translucent), no blur
 * filter, crisp hard 1px border regardless.
 *
 * Self-contained: owns its own open/closed state, closes on outside click
 * and on Escape. `align="right"` (default) anchors the panel's right edge to
 * the trigger button's right edge (for header icons); `align="left"` anchors
 * the left edges (for a map-control-stack button whose panel should open
 * toward the map, not off-screen).
 */
export default function FlyoutMenu({ icon, label, title, align = "right", direction = "down", panelWidth = 260, buttonSize = 32, buttonStyle, hotkey = null, children }) {
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
                style={{
                    width: buttonSize, height: buttonSize, borderRadius: "var(--radius-md)",
                    background: "var(--bg-card)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", color: open ? "var(--accent-blue)" : "var(--text-secondary)",
                    ...buttonStyle,
                }}
            >
                <Icon name={icon} size={16} />
            </button>

            {open && (
                <div style={{
                    position: "absolute",
                    [direction === "up" ? "bottom" : "top"]: "calc(100% + 6px)",
                    [align === "right" ? "right" : "left"]: 0,
                    width: panelWidth, zIndex: 2000,
                    background: "var(--bg-panel-translucent)", border: "1px solid var(--border-strong)",
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
