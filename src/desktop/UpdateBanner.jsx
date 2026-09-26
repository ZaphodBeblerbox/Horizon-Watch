/**
 * UpdateBanner.jsx — "there is a new version", and the button that takes it.
 *
 * A bar rather than a modal: an update is not urgent enough to interrupt
 * what someone is doing, and a modal over a half-written briefing is worse
 * than the old version they are running.
 */

import { useEffect, useState } from "react"
import { checkOnceOnLaunch, installUpdate } from "./autoUpdate.js"

export default function UpdateBanner() {
    const [update, setUpdate] = useState(null)
    const [busy, setBusy] = useState(false)
    const [pct, setPct] = useState(0)
    const [error, setError] = useState(null)
    const [dismissed, setDismissed] = useState(false)

    useEffect(() => { checkOnceOnLaunch().then(setUpdate).catch(() => {}) }, [])

    if (!update || dismissed) return null

    return (
        <div role="status" style={{
            position: "fixed", bottom: 14, left: "50%", transform: "translateX(-50%)",
            zIndex: 120, display: "flex", alignItems: "center", gap: 12,
            padding: "9px 14px", background: "var(--bg-2, #22282f)",
            border: "1px solid var(--line)", borderRadius: 4,
            boxShadow: "0 6px 22px rgba(0,0,0,.45)", maxWidth: "calc(100vw - 32px)",
        }}>
            <span style={{ font: "400 12px var(--font)", color: "var(--txt-2)" }}>
                {error
                    ? `Update failed: ${error}`
                    : busy
                        ? `Downloading ${update.version}… ${pct ? `${pct}%` : ""}`
                        : <>Version <b style={{ color: "var(--txt)" }}>{update.version}</b> is available.</>}
            </span>
            {!busy && !error && (
                <>
                    <button className="btn sm primary" onClick={async () => {
                        setBusy(true); setError(null)
                        try {
                            await installUpdate(update, (done, total) => {
                                if (total) setPct(Math.round((done / total) * 100))
                            })
                        } catch (e) {
                            // The app is still running the old version and
                            // is perfectly usable — say so rather than
                            // leaving a stuck progress bar.
                            setError(e?.message || "could not install")
                            setBusy(false)
                        }
                    }}>
                        install &amp; restart
                    </button>
                    <button className="btn sm" onClick={() => setDismissed(true)}>later</button>
                </>
            )}
            {error && <button className="btn sm" onClick={() => setDismissed(true)}>dismiss</button>}
        </div>
    )
}
