/**
 * GroundReel.jsx — Home's "From the ground": one video at a time.
 *
 * The most breaking story plays; when it ends the next slides in, and after
 * the last the first comes round again. Three by default, more when there
 * is more urgent footage (Home's groundPick). Segments along the top show
 * where the reel is and how far the current video has played; a segment or
 * the arrows jump. Sound, once turned on, stays on from one video to the
 * next. A video that cannot play is skipped after a moment; one behind the
 * graphic-content warning waits for the reader.
 */
import { useEffect, useRef, useState } from "react"
import TelegramMedia from "../components/TelegramMedia.jsx"

const SKIP_MS = 2000

export default function GroundReel({ videos, renderInfo }) {
    const [i, setI] = useState(0)
    const [dir, setDir] = useState(1)
    const [progress, setProgress] = useState(0)
    const [muted, setMuted] = useState(true)
    const skipRef = useRef(null)
    const n = videos.length
    const at = Math.min(i, n - 1)
    const v = videos[at]
    const go = (to, d = 1) => { clearTimeout(skipRef.current); setDir(d); setProgress(0); setI(((to % n) + n) % n) }
    useEffect(() => () => clearTimeout(skipRef.current), [])
    useEffect(() => { if (i >= n) setI(0) }, [n, i])
    if (!v) return null
    return (
        <div data-testid="ground-reel" style={{ display: "flex", flexDirection: "column", gap: 0, border: "1px solid var(--gline)", background: "var(--glass2)", minWidth: 0, overflow: "hidden" }}>
            {n > 1 && (
                <div style={{ display: "flex", gap: 4, padding: "8px 10px 0" }}>
                    {videos.map((x, k) => (
                        <button key={x.id} onClick={() => go(k, k >= at ? 1 : -1)} aria-label={`Story ${k + 1} of ${n}`} aria-current={k === at}
                                style={{ flex: 1, height: 3, padding: 0, border: 0, cursor: "pointer", background: "var(--gline2)", position: "relative", overflow: "hidden" }}>
                            <span style={{ position: "absolute", inset: 0, transformOrigin: "left", background: "var(--acc-hi, var(--acchi))",
                                           transform: `scaleX(${k < at ? 1 : k === at ? progress : 0})`, transition: k === at ? "transform .25s linear" : "none" }} />
                        </button>
                    ))}
                </div>
            )}
            <div key={v.id} className="plx-reel-slide" style={{ animation: `${dir > 0 ? "plx-reel-in" : "plx-reel-back"} .42s cubic-bezier(.22,.61,.36,1)`,
                                                               display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,320px),1fr))", gap: 0 }}>
                <div style={{ position: "relative", minWidth: 0 }}>
                    <TelegramMedia post={v} maxHeight="380px" radius="0"
                                   muted={muted} onMutedChange={setMuted}
                                   onProgress={setProgress}
                                   onEnded={n > 1 ? () => go(at + 1) : undefined}
                                   onUnplayable={n > 1 ? () => { skipRef.current = setTimeout(() => go(at + 1), SKIP_MS) } : undefined} />
                    {n > 1 && (<>
                        <button onClick={() => go(at - 1, -1)} aria-label="Previous story" style={ARROW("left")}>‹</button>
                        <button onClick={() => go(at + 1)} aria-label="Next story" style={ARROW("right")}>›</button>
                    </>)}
                </div>
                <div style={{ minWidth: 0 }}>{renderInfo(v, at, n)}</div>
            </div>
        </div>
    )
}

const ARROW = (side) => ({
    position: "absolute", top: "50%", [side]: 6, transform: "translateY(-50%)", width: 30, height: 30, borderRadius: 15,
    border: 0, background: "rgba(0,0,0,.45)", color: "#fff", fontSize: 20, lineHeight: "28px", cursor: "pointer", zIndex: 2,
})
