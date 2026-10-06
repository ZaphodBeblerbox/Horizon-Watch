/**
 * Tutorial.jsx — the guided walkthrough: it takes you there and shows you.
 *
 * Each step opens what it is about (a screen, a pane, the notification
 * tray), waits for it to appear, darkens everything else and rings the
 * control in question, with the explanation beside it. Back and Next move
 * through it; Escape leaves it.
 *
 * WHY THIS DOES NOT BREAK SILENTLY. The old walkthrough was text-only
 * because a tour anchored to buttons breaks when the layout moves: the ring
 * lands on nothing. Here every target is a stable hook (data-tour, a
 * data-testid, a rail button's title), the step waits up to two seconds for
 * it, and if it is not there the step is shown as a centred card instead of
 * pointing at the wrong thing. tutorialSteps.test.js checks that every hook
 * the steps name still exists in the source.
 *
 * Shown on first launch, and again from Settings → General → "Guided
 * walkthrough" (or the akili:start-tour event) — at once, not next launch.
 * The setting is tri-state: null = not seen, "done" = finished or skipped.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"
import { STEPS } from "./tutorialSteps.js"

const PAD = 8
const GAP = 14
const CARD_W = 360

function rectOf(sel) {
    if (!sel) return null
    for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        const cs = getComputedStyle(el)
        if (r.width > 4 && r.height > 4 && cs.visibility !== "hidden" && cs.display !== "none" && +cs.opacity > 0.2
            && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) {
            return { x: r.left, y: r.top, w: r.width, h: r.height }
        }
    }
    return null
}

/** Where the card goes: beside the ring on the side with the most room, kept on screen. */
export function placeCard(ring, vw, vh, cardW = CARD_W, cardH = 220) {
    if (!ring) return { left: (vw - cardW) / 2, top: Math.max(16, (vh - cardH) / 2) }
    const room = {
        right: vw - (ring.x + ring.w), left: ring.x, below: vh - (ring.y + ring.h), above: ring.y,
    }
    let left, top
    if (room.right >= cardW + GAP + 16) { left = ring.x + ring.w + GAP; top = ring.y }
    else if (room.left >= cardW + GAP + 16) { left = ring.x - cardW - GAP; top = ring.y }
    else if (room.below >= cardH + GAP + 16) { left = ring.x; top = ring.y + ring.h + GAP }
    else if (room.above >= cardH + GAP + 16) { left = ring.x; top = ring.y - cardH - GAP }
    else { left = vw - cardW - 24; top = vh - cardH - 24 }          // a big target: the corner
    return { left: Math.max(16, Math.min(vw - cardW - 16, left)), top: Math.max(16, Math.min(vh - cardH - 16, top)) }
}

export default function Tutorial() {
    const [open, setOpen] = useState(() => getSettings()?.tutorial == null)
    const [i, setI] = useState(0)
    const [ring, setRing] = useState(null)
    const [found, setFound] = useState(true)
    const [vp, setVp] = useState({ w: innerWidth, h: innerHeight })
    const cardRef = useRef(null)
    const [cardH, setCardH] = useState(220)

    // Settings arrive after first paint; "show again" in Settings sets it
    // back to null, which starts the walkthrough there and then.
    // Only a CHANGE to null restarts it: the store re-broadcasts the same
    // settings now and then, and "still not seen" must not jump back to step 1.
    const lastSeen = useRef(getSettings()?.tutorial ?? null)
    useEffect(() => subscribeSettings((s) => {
        const v = s?.tutorial ?? null
        if (v === lastSeen.current) return
        lastSeen.current = v
        if (v === "done") setOpen(false)
        else if (v == null) { setI(0); setOpen(true) }
    }), [])
    useEffect(() => {
        const h = () => { setI(0); setOpen(true) }
        window.addEventListener("akili:start-tour", h)
        return () => window.removeEventListener("akili:start-tour", h)
    }, [])

    const finish = useCallback(() => {
        setOpen(false)
        updateSetting("tutorial", "done")
        STEPS[i]?.leave?.()
    }, [i])

    // Open what the step is about, then find its target (it may take a
    // moment to mount or slide in) and keep the ring on it while it moves.
    useEffect(() => {
        if (!open) return undefined
        const step = STEPS[i]
        try { step.go?.() } catch { /* a step that cannot open still explains */ }
        let alive = true
        const t0 = Date.now()
        setRing(null); setFound(true)
        const tick = () => {
            if (!alive) return
            const r = rectOf(step.target)
            if (r) { setRing(r); setFound(true) }
            else if (Date.now() - t0 > 2000) setFound(false)
        }
        tick()
        const iv = setInterval(tick, 200)
        return () => { alive = false; clearInterval(iv); try { step.leave?.() } catch { /* nothing to undo */ } }
    }, [open, i])

    useEffect(() => {
        const h = () => setVp({ w: innerWidth, h: innerHeight })
        window.addEventListener("resize", h)
        return () => window.removeEventListener("resize", h)
    }, [])
    useLayoutEffect(() => { if (cardRef.current) setCardH(cardRef.current.offsetHeight) })

    useEffect(() => {
        if (!open) return undefined
        const onKey = (e) => {
            if (e.key === "Escape") { e.stopPropagation(); finish() }
            else if (e.key === "ArrowRight" || e.key === "Enter") setI((n) => Math.min(n + 1, STEPS.length - 1))
            else if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0))
        }
        window.addEventListener("keydown", onKey, true)
        return () => window.removeEventListener("keydown", onKey, true)
    }, [open, finish])

    if (!open) return null
    const step = STEPS[i]
    const last = i === STEPS.length - 1
    const r = step.target && found && ring
        ? { x: ring.x - PAD, y: ring.y - PAD, w: ring.w + PAD * 2, h: ring.h + PAD * 2 } : null
    const pos = placeCard(r, vp.w, vp.h, CARD_W, cardH)
    const waiting = step.target && found && !ring

    return (
        <div role="dialog" aria-label="Guided walkthrough" style={{ position: "fixed", inset: 0, zIndex: 6000, pointerEvents: "auto" }}>
            {/* The dimming, with a hole where the target is. */}
            <svg width={vp.w} height={vp.h} style={{ position: "absolute", inset: 0 }}>
                <defs>
                    <mask id="tour-hole">
                        <rect width={vp.w} height={vp.h} fill="white" />
                        {r && <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill="black" style={{ transition: "all 260ms ease" }} />}
                    </mask>
                </defs>
                <rect width={vp.w} height={vp.h} fill="rgba(6,8,12,.66)" mask="url(#tour-hole)" />
                {r && <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} fill="none" stroke="var(--acchi, #7aa7ff)" strokeWidth={2}
                    style={{ transition: "all 260ms ease", filter: "drop-shadow(0 0 10px rgba(122,167,255,.55))" }} />}
            </svg>

            <div ref={cardRef} style={{
                position: "absolute", left: pos.left, top: pos.top, width: CARD_W, maxWidth: "calc(100vw - 32px)",
                background: "var(--bar, #161a22)", border: "1px solid var(--gline2, #333)", boxShadow: "var(--gshadow)",
                padding: "16px 18px 14px", color: "var(--txt)", transition: "left 260ms ease, top 260ms ease",
                backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)",
            }}>
                <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)", marginBottom: 8 }}>
                    Walkthrough · {i + 1} of {STEPS.length}{step.where ? ` · ${step.where}` : ""}
                </div>
                <h2 style={{ margin: "0 0 8px", fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 17 }}>{step.title}</h2>
                <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: "var(--txt2)" }}>{step.body}</p>
                {step.try && <p style={{ margin: "8px 0 0", fontSize: 12.5, lineHeight: 1.5, color: "var(--txt)" }}><span style={{ color: "var(--acchi)" }}>Try it: </span>{step.try}</p>}
                {waiting && <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--txt4)" }}>Opening…</p>}
                <div style={{ display: "flex", gap: 3, margin: "14px 0 12px" }}>
                    {STEPS.map((_, n) => (
                        <button key={n} onClick={() => setI(n)} aria-label={`Step ${n + 1}`} style={{
                            flex: 1, height: 3, padding: 0, border: 0, cursor: "pointer",
                            background: n <= i ? "var(--acchi)" : "var(--gline2)",
                        }} />
                    ))}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <button onClick={finish} style={BTN}>{last ? "Close" : "Skip"}</button>
                    <span style={{ flex: 1 }} />
                    {i > 0 && <button onClick={() => setI(i - 1)} style={BTN}>Back</button>}
                    {last
                        ? <button onClick={finish} style={{ ...BTN, ...PRIMARY }}>Done</button>
                        : <button onClick={() => setI(i + 1)} style={{ ...BTN, ...PRIMARY }}>Next</button>}
                </div>
            </div>
        </div>
    )
}

const BTN = {
    height: 28, padding: "0 12px", border: "1px solid var(--gline2)", background: "transparent",
    color: "var(--txt2)", font: "inherit", fontSize: 12, cursor: "pointer", borderRadius: 0,
}
const PRIMARY = { background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" }
