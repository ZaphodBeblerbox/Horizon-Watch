/**
 * SourceViewer.jsx — read a cited post without leaving the console.
 *
 * Opened by openSource(url) (src/inspector/sourceEmbed.js) from any "Open
 * here" control. Docks beside the inspector so the record and its source
 * can be read together, which is the point: checking a claim against what
 * it cites should not mean switching windows and losing the map.
 *
 * Only X and Telegram posts are shown in-frame, through their official
 * embed endpoints; anything else never reaches this panel (the caller
 * opens a tab). Nothing here leads out of Parallax (owner, 2026-10-10): the
 * post's link can be copied. On a phone it is a full-screen sheet; next to
 * a spoken answer it takes the side (ui/sideWindows.js).
 */
import { useEffect, useRef, useState } from "react"
import { embedFor } from "../inspector/sourceEmbed.js"
import { getRenderedTheme, subscribeRenderedTheme } from "../state/themeStore.js"
import { claimSide, onSideClaim } from "../ui/sideWindows.js"

export default function SourceViewer() {
    const [url, setUrl] = useState(null)
    const urlRef = useRef(null)
    urlRef.current = url
    const [theme, setTheme] = useState(getRenderedTheme)
    useEffect(() => subscribeRenderedTheme(setTheme), [])
    useEffect(() => {
        const open = (e) => setUrl(e.detail?.url || null)
        // ESCAPE CLOSES THE TOP THING ONLY. The inspector also closes on
        // Escape, and the shell then leaves the map, so one key press
        // dropped the source, the record and the screen at once. Caught in
        // the capture phase and stopped here while the viewer is open.
        const esc = (e) => {
            if (e.key !== "Escape" || !urlRef.current) return
            e.stopImmediatePropagation()
            e.preventDefault()
            setUrl(null)
        }
        window.addEventListener("akili:open-source", open)
        window.addEventListener("keydown", esc, true)
        return () => {
            window.removeEventListener("akili:open-source", open)
            window.removeEventListener("keydown", esc, true)
        }
    }, [])

    useEffect(() => onSideClaim("source", (by) => { if (by === "answer") setUrl(null) }), [])
    useEffect(() => { if (url) claimSide("source") }, [url])
    const embed = url ? embedFor(url, { dark: theme === "dark" }) : null

    /* WHERE IT GOES. Beside the inspector when the window has room for the
       map, the inspector and the source; on a narrow window it takes the
       inspector's own column instead, so the map is never covered. The
       choice is announced so the map chrome and the Layers pane can make
       way (Situation.jsx). */
    const [vw, setVw] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1600))
    useEffect(() => {
        const r = () => setVw(window.innerWidth)
        window.addEventListener("resize", r)
        return () => window.removeEventListener("resize", r)
    }, [])
    const phone = vw < 640
    const docked = vw >= 1150
    const width = docked ? Math.min(460, vw - 48 - 334 - 480) : 312
    useEffect(() => {
        window.dispatchEvent(new CustomEvent("akili:source-viewer", { detail: { open: !!embed, docked, width: Math.max(320, width) } }))
    }, [!!embed, docked, width]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!embed) return null

    return (
        <aside role="dialog" aria-label={`Source: ${embed.label}`} style={{
            position: "fixed", top: phone ? 0 : 94, bottom: phone ? 0 : 22, zIndex: phone ? 3000 : 70,
            right: phone ? 0 : docked ? 12 + 312 + 10 : 12, width: phone ? "100vw" : docked ? Math.max(320, width) : 312,
            display: "flex", flexDirection: "column",
            background: "var(--bg-1, var(--canvas))", border: "1px solid var(--gline2, var(--line))",
            boxShadow: "var(--gshadow)",
        }}>
            <header style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
                borderBottom: "1px solid var(--gline, var(--line))", flexShrink: 0,
            }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ font: "600 10.5px var(--font)", letterSpacing: ".08em", textTransform: "uppercase", color: "var(--txt-3, var(--txt3))" }}>
                        Source
                    </div>
                    <div style={{ font: "600 13px var(--font)", color: "var(--txt)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {embed.label}
                    </div>
                </div>
                {/* NOT A WAY OUT (owner, 2026-10-10): the post stays in Parallax; its link can be copied */}
                <button onClick={() => { navigator.clipboard?.writeText(url).catch(() => {}) }} title={url} style={{
                    font: "500 12px var(--font)", color: "var(--acc-hi, var(--acchi))", whiteSpace: "nowrap", border: 0, background: "none", cursor: "pointer", padding: 0,
                }}>Copy link</button>
                <button onClick={() => setUrl(null)} aria-label="Close source" title="Close (Esc)" style={{
                    width: 26, height: 26, border: "1px solid var(--gline2, var(--line))", background: "transparent",
                    color: "var(--txt-3, var(--txt3))", cursor: "pointer", font: "inherit",
                }}>✕</button>
            </header>
            <iframe
                key={embed.src}
                title={embed.label}
                src={embed.src}
                // The embed needs scripts and its own origin to render; it
                // gets nothing else — no top navigation, no forms, no popups
                // except a link the reader clicks.
                sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
                referrerPolicy="no-referrer"
                loading="lazy"
                style={{ flex: 1, width: "100%", border: 0, background: "#fff" }}
            />
        </aside>
    )
}
