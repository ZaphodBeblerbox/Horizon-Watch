/**
 * UpdateBanner.jsx — says an update happened. Does not ask permission.
 *
 * The install runs by itself and applies at the next launch, so there is
 * nothing here to accept. What is left is telling the truth about state:
 * that something is downloading, that a new version is waiting, or that it
 * failed and the current one is still fine.
 *
 * A quiet line at the bottom, not a modal. Nothing here is urgent enough
 * to take the screen from someone who is working.
 */

import { useEffect, useState } from "react"
import { autoUpdateOnLaunch } from "./autoUpdate.js"

export default function UpdateBanner() {
    const [state, setState] = useState(null)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => { autoUpdateOnLaunch({ onState: setState }).catch(() => {}) }, [])

    if (!state || dismissed) return null
    // Downloading is progress, not news: it shows, but quietly.
    if (state.phase === "failed" && !state.error) return null

    const text =
        state.phase === "downloading" ? `Downloading ${state.version}… ${state.pct || 0}%`
        : state.phase === "ready"     ? `Version ${state.version} installed — it starts next time you open Parallax.`
        : state.phase === "failed"    ? `Update to ${state.version} didn't install. You're still on the working version.`
        : null
    if (!text) return null

    return (
        <div role="status" style={{
            position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)",
            zIndex: 120, display: "flex", alignItems: "center", gap: 10,
            padding: "7px 13px", background: "var(--bg-2, #1e212c)",
            border: "1px solid var(--line)", borderRadius: 4,
            boxShadow: "0 4px 18px rgba(0,0,0,.4)", maxWidth: "calc(100vw - 32px)",
            font: "400 12px var(--font)", color: "var(--txt-2)",
        }}>
            <span>{text}</span>
            {state.phase !== "downloading" && (
                <button onClick={() => setDismissed(true)}
                        style={{
                            background: "transparent", border: "1px solid var(--line)",
                            borderRadius: 3, color: "var(--txt-3)", cursor: "pointer",
                            font: "400 11px var(--font)", padding: "1px 7px",
                        }}>dismiss</button>
            )}
        </div>
    )
}
