/**
 * VoiceBar.jsx — hold fn, speak, and the map does it.
 *
 * HOW THIS WORKS AT ALL. Parallax never sees the fn key: macOS hands it to
 * Wispr Flow before the browser gets a keydown. Wispr dictates into
 * whatever field has focus. So the entire mechanism on our side is "keep a
 * text field focused and watch for a sentence appearing in it".
 *
 * WHICH IS WHY IT IS VISIBLE. The obvious implementation is a hidden
 * input, and it is the one that fails: dictation tools skip fields they
 * cannot see. It is a slim bar with the cheat sheet in it, which also
 * happens to be the only way anyone learns what they can say.
 *
 * IT NEVER STEALS FOCUS. Refocusing is only ever done when the active
 * element is <body>, the map canvas, or this field. If you are typing in a
 * note, a search box or a dialog, it leaves you alone — a command bar that
 * grabs the caret mid-sentence is worse than no command bar.
 *
 * DETECTING A DICTATION. Wispr inserts a whole sentence at once. More than
 * three characters in one input event is a dictation; a single character
 * is someone typing. After a multi-character insert we wait 400ms for the
 * value to settle, because some inserts arrive in two events.
 *
 * SINGLE KEYSTROKES PASS THROUGH. The map has one-key shortcuts, and a
 * field that swallows them would break them the moment it is focused. A
 * lone printable keystroke is removed from the field and re-dispatched at
 * the window, so pressing T still toggles the timeline.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import { parseCommand } from "./voiceCommands.js"
import { buildVoiceContext, primeUsers, primeGroups } from "./voiceContext.js"
import { interpretWithModel } from "./voiceFallback.js"
import { places, a2ToA3 } from "./gazetteer.js"
import { runVoiceActions } from "./runVoiceActions.js"
import { logParse, markUndone } from "./voiceLog.js"
import { isDictation, mayTakeFocus, isShortcutPassthrough } from "./voiceField.js"

const SETTLE_MS = 400
// The last thing done, kept outside the component: a command that changes
// page unmounts the bar that ran it ("open Imagery" from the map), and the
// bar on the new page shows what happened instead of nothing.
let _lastDone = null
const UNDO_MS = 6000

const CHEAT = "say it plainly — search for Dubai · show me fires in Yemen · open Imagery · hide GDELT · what's going on in Sudan · zoom in"

export default function VoiceBar({ active = true, floating = false }) {
    const input = useRef(null)
    const settle = useRef(null)
    const lastLen = useRef(0)
    const [state, setState] = useState("idle")      // idle | heard | working
    const [chip, setChip] = useState(null)          // { result, ctx } awaiting confirm
    const [undo, setUndo] = useState(() =>
        (_lastDone && Date.now() - _lastDone.at < UNDO_MS ? _lastDone.undo : null))   // { label, fn, logIndex }
    // Set before the page can change under us, so the next bar has it.
    const remember = (u) => { _lastDone = { undo: u, at: Date.now() }; setUndo(u) }
    useEffect(() => {
        if (!undo) return undefined
        const t = setTimeout(() => setUndo((u) => (u === undo ? null : u)), UNDO_MS)
        return () => clearTimeout(t)
    }, [undo])

    /* Warm the lookups the moment the bar exists.
       The gazetteer is a 691KB asset and the ISO table is a round trip;
       leaving them until the first command meant "go to Yemen" raced the
       fetch and silently did nothing, while the same phrase a few seconds
       later worked. A command that only works on the second try is a bug,
       not a slow first load. */
    useEffect(() => { primeUsers(); primeGroups(); places(); a2ToA3() }, [])

    /* ── focus discipline ───────────────────────────────────────── */
    const mayFocus = useCallback(
        () => mayTakeFocus(document.activeElement, input.current), [])

    const refocus = useCallback(() => {
        if (!active) return
        if (!mayFocus()) return
        try { input.current?.focus({ preventScroll: true }) } catch { /* detached */ }
    }, [active, mayFocus])

    useEffect(() => {
        if (!active) return undefined
        refocus()
        const onWin = () => refocus()
        // Map interactions blur the field; take it back after them, but only
        // when the rules above allow it.
        const onUp = () => setTimeout(refocus, 0)
        window.addEventListener("focus", onWin)
        document.addEventListener("mouseup", onUp)
        document.addEventListener("keyup", onUp)
        const iv = setInterval(refocus, 1500)
        return () => {
            window.removeEventListener("focus", onWin)
            document.removeEventListener("mouseup", onUp)
            document.removeEventListener("keyup", onUp)
            clearInterval(iv)
        }
    }, [active, refocus])

    /* ── running ────────────────────────────────────────────────── */
    const submit = useCallback(async (raw) => {
        const text = String(raw || "").trim()
        if (!text) return
        setState("working")
        const ctx = buildVoiceContext()
        const result = parseCommand(text, ctx)
        const logIndex = logParse(result)

        /* THE MODEL FIRST, THE RULES WHEN IT CANNOT ANSWER. Spoken
           sentences are free-form ("uh, can you search for Dubai"), and the
           regex rules read most of them as notes. The model (gpt-4o-mini,
           about a hundredth of a cent a sentence) reads every sentence into
           one to three steps the server has already checked against what
           the console can do. If it is unavailable, over budget, or finds
           nothing to do, the rules decide as before — offline still works. */
        const guess = await interpretWithModel(text, ctx)
        if (guess) {
            const out = await runVoiceActions({ ...result, actions: guess.actions, label: guess.label }, ctx)
            setState("idle")
            if (out.ran) {
                remember({ label: out.label || guess.label, fn: out.undo || null, logIndex })
                setTimeout(() => setUndo((u) => (u && u.logIndex === logIndex ? null : u)), UNDO_MS)
                return
            }
            setChip({ result, ctx, logIndex, problem: out.problem })
            return
        }
        if (!result.confident) {
            setChip({ result, ctx, logIndex })
            setState("idle")
            return
        }
        if (result.needsConfirm) {
            setChip({ result, ctx, logIndex })
            setState("idle")
            return
        }
        const out = await runVoiceActions(result, ctx)
        setState("idle")
        if (!out.ran) { setChip({ result, ctx, logIndex, problem: out.problem }); return }
        if (out.undo) {
            remember({ label: out.label, fn: out.undo, logIndex })
            setTimeout(() => setUndo((u) => (u && u.logIndex === logIndex ? null : u)), UNDO_MS)
        }
    }, [])

    const confirmChip = useCallback(async () => {
        if (!chip) return
        setState("working")
        const out = await runVoiceActions(chip.result, chip.ctx)
        setState("idle")
        setChip(out.ran ? null : { ...chip, problem: out.problem })
        if (out.ran && out.undo) {
            const { logIndex } = chip
            remember({ label: out.label, fn: out.undo, logIndex })
            setTimeout(() => setUndo((u) => (u && u.logIndex === logIndex ? null : u)), UNDO_MS)
        }
    }, [chip])

    /* ── dictation detection ────────────────────────────────────── */
    const [heard, setHeard] = useState("")
    const onInput = (e) => {
        const v = e.target.value
        const grew = v.length - lastLen.current
        lastLen.current = v.length
        if (settle.current) clearTimeout(settle.current)
        if (isDictation(v.length - grew, v.length)) {
            setState("heard")
            // What it is hearing, shown under the mark. The field itself is
            // invisible now, so without this there is no way to tell a
            // misheard sentence from a mis-executed one.
            setHeard(v.slice(-90))
            settle.current = setTimeout(() => {
                const text = input.current?.value || ""
                if (input.current) { input.current.value = ""; lastLen.current = 0 }
                setHeard("")
                submit(text)
            }, SETTLE_MS)
        }
    }

    const onKeyDown = (e) => {
        if (e.key === "Enter") {
            e.preventDefault()
            const text = e.target.value
            e.target.value = ""; lastLen.current = 0
            submit(text)
            return
        }
        if (e.key === "Escape") {
            e.preventDefault()
            e.target.value = ""; lastLen.current = 0
            setChip(null)
            return
        }
        /* A LONE KEYSTROKE IS A SHORTCUT, NOT A COMMAND. Only when the
           field is empty and no modifier is held — otherwise typing a
           sentence would fire a shortcut on every letter. */
        if (isShortcutPassthrough(e, e.target.value)) {
            e.preventDefault()
            window.dispatchEvent(new KeyboardEvent("keydown", {
                key: e.key, code: e.code, bubbles: true,
            }))
        }
    }

    if (!active) return null

    const SURFACE = {
        display: "flex", alignItems: "center", gap: 10,
        padding: "0 12px", height: 34,
        background: "var(--glass)", backdropFilter: "blur(22px) saturate(1.15)",
        WebkitBackdropFilter: "blur(22px) saturate(1.15)",
        border: "1px solid var(--gline)", boxShadow: "var(--gshadow)",
        borderRadius: 17,
    }

    return (
        <div data-screen-label="Voice bar" style={{
            // On the map it sits over the globe; on every other page it
            // floats at the bottom of the window, so a sentence works anywhere.
            position: floating ? "fixed" : "absolute", left: "50%", transform: "translateX(-50%)",
            bottom: floating ? 18 : "calc(var(--pane-bottom) + 8px)", zIndex: floating ? 55 : 26,
            display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
            // Only as wide as what is in it now that the bar is a mark.
            width: "auto", maxWidth: "min(680px, calc(100% - 120px))", pointerEvents: "none",
        }}>
            {chip && (
                <div style={{ ...SURFACE, height: "auto", padding: "10px 14px", borderRadius: 14, pointerEvents: "auto", width: "100%" }}>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 12.5, color: "var(--txt)", textWrap: "pretty" }}>
                            {chip.problem || chip.result.problem || describe(chip.result, chip.ctx)}
                        </span>
                        <span style={{
                            fontFamily: "var(--mz-font-mono)", fontSize: 10, color: "var(--txt4)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                        }}>heard: “{chip.result.raw}”</span>
                    </div>
                    {!chip.problem && chip.result.actions.length > 0 && (
                        <button onClick={confirmChip} style={BTN_PRIMARY}>
                            {chip.result.actions[0].type === "send" ? "Send"
                                : chip.result.actions[0].type === "generate_briefing" ? "Generate" : "Do it"}
                        </button>
                    )}
                    <button onClick={() => setChip(null)} style={BTN}>Cancel</button>
                </div>
            )}

            {undo && (
                <div style={{ ...SURFACE, pointerEvents: "auto" }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {undo.label}
                    </span>
                    {undo.fn && <button onClick={async () => { await undo.fn(); markUndone(undo.logIndex); setUndo(null) }}
                        style={BTN}>Undo</button>}
                </div>
            )}

            {/* ── THE MARK, NOT A BAR ──────────────────────────────────
                A 680px input sitting over the map said "type here" when
                the thing to do is speak, and it covered the one part of
                the screen a map puts its subject in. What is left is the
                Parallax X: quiet when idle, beating while you talk.

                The field is STILL THERE and still focused — Wispr types
                into whatever has focus, so removing it would remove the
                dictation. It is one transparent pixel-high line under the
                mark rather than a panel, and it shows what it heard only
                while there is something to show. */}
            <div style={{
                display: "flex", flexDirection: "column", alignItems: "center",
                gap: 6, pointerEvents: "auto",
            }}>
                <button
                    type="button"
                    onClick={() => input.current?.focus()}
                    aria-label="Hold fn and speak a command"
                    title={`Hold fn and speak — ${CHEAT}`}
                    style={{
                        position: "relative",
                        width: 46, height: 46, display: "grid", placeItems: "center",
                        border: 0, background: "transparent", cursor: "pointer", padding: 0,
                        borderRadius: "50%",
                    }}
                >
                    <VoiceMark state={state} />
                </button>

                {(state !== "idle" || heard) && (
                    <span style={{
                        maxWidth: 420, padding: "3px 10px", borderRadius: 11,
                        background: "var(--glass)", border: "1px solid var(--gline)",
                        backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)",
                        font: "400 11.5px var(--font)", color: "var(--txt2)",
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                        {state === "working" ? "working…" : (heard || "listening…")}
                    </span>
                )}

                <input
                    ref={input}
                    onInput={onInput}
                    onKeyDown={onKeyDown}
                    aria-label="Spoken command"
                    style={{
                        /* Focusable and typed into, and not seen. Hiding it
                           with display:none or visibility:hidden would make
                           it unfocusable, and an unfocusable field is one
                           Wispr cannot dictate into. */
                        position: "absolute", bottom: 0, width: 1, height: 1,
                        opacity: 0, border: 0, padding: 0, background: "transparent",
                        color: "transparent", outline: "none",
                    }}
                />
            </div>
        </div>
    )
}

/**
 * The Parallax X, as the voice indicator.
 *
 * Idle it is a quiet mark. While you speak it beats — the scale animation
 * rather than an opacity flicker, because at 28px a fade reads as a
 * rendering fault and a pulse reads as alive.
 *
 * Reduced motion gets a steady brightened mark instead: the state still
 * has to be legible to somebody who has asked the machine to stop moving.
 */
function VoiceMark({ state }) {
    const lit = state === "heard"      // words are arriving
    const busy = state === "working"   // the sentence is being carried out
    const awake = lit || busy

    /* ITS OWN COLOURS, NEVER A WARNING COLOUR. This went amber while
       working, which in a console where amber means "elevated" reads as
       something being wrong. The mark is the Parallax mark: white strokes,
       blue accent, brighter when it is doing something.

       LIT the moment words arrive; PULSING while the command runs. Two
       states, two behaviours — a steady glow says "I am hearing you" and a
       beat says "I am doing it", and using one animation for both would
       say the same thing about each. */
    const white = awake ? "var(--txt)" : "var(--txt3)"
    const blue = awake ? "var(--acchi)" : "var(--acc-hi)"

    return (
        <>
            <style>{`
                @keyframes plx-voice-beat {
                    0%, 100% { transform: scale(1)    }
                    50%      { transform: scale(1.16) }
                }
                @keyframes plx-voice-ring {
                    0%   { transform: scale(.82); opacity: .5 }
                    100% { transform: scale(1.7);  opacity: 0 }
                }
                @keyframes plx-voice-halo {
                    0%, 100% { opacity: .30 }
                    50%      { opacity: .62 }
                }
                @media (prefers-reduced-motion: reduce) {
                    .plx-voice-mark, .plx-voice-ring, .plx-voice-halo {
                        animation: none !important
                    }
                    .plx-voice-ring { opacity: 0 !important }
                }
            `}</style>

            {/* The glow, behind the mark. A blurred blue disc rather than a
                filter on the strokes: a filtered 2px stroke smears into
                mud, a disc behind it reads as light coming through. */}
            {awake && (
                <span className="plx-voice-halo" aria-hidden="true" style={{
                    position: "absolute", width: 32, height: 32, borderRadius: "50%",
                    background: "var(--acchi)", filter: "blur(10px)",
                    opacity: busy ? 0.3 : 0.5,
                    animation: busy ? "plx-voice-halo 1s ease-in-out infinite" : "none",
                    pointerEvents: "none",
                }} />
            )}

            {/* One expanding ring per beat, only while it is executing. */}
            {busy && (
                <span className="plx-voice-ring" aria-hidden="true" style={{
                    position: "absolute", width: 36, height: 36, borderRadius: "50%",
                    border: "1px solid var(--acchi)",
                    animation: "plx-voice-ring 1s ease-out infinite",
                }} />
            )}

            <svg
                className="plx-voice-mark"
                width="28" height="28" viewBox="0 0 24 24" fill="none"
                strokeWidth="2.2" strokeLinecap="butt" aria-hidden="true"
                style={{
                    position: "relative",
                    animation: busy ? "plx-voice-beat 1s ease-in-out infinite" : "none",
                    opacity: awake ? 1 : 0.6,
                    transition: "opacity 140ms ease",
                }}
            >
                <path stroke={white} d="M3 4L14 20M14 4L3 20" />
                <path stroke={blue} d="M18 4L12.5 12M22 4L19.25 8" />
            </svg>
        </>
    )
}

const BTN = {
    height: 26, padding: "0 10px", border: "1px solid var(--gline2)",
    background: "transparent", color: "var(--txt2)", font: "inherit",
    fontSize: 12, cursor: "pointer", borderRadius: 0, whiteSpace: "nowrap",
}
const BTN_PRIMARY = {
    ...BTN, border: 0, background: "var(--acc)", color: "var(--mz-cream)", fontWeight: 600,
}

/** A sentence for the confirm chip, so you see what it understood. */
function describe(result, ctx) {
    const a = result.actions[0]
    if (!a) return result.problem || "Nothing to do."
    const who = (id) => (ctx.users.find((u) => u.id === id) || {}).name || "them"
    switch (a.type) {
        case "send": return `Send the ${a.what} to ${who(a.userId)}?`
        case "generate_briefing": return "Generate a briefing from the basket?"
        case "add_note": return `Save as note: “${a.text.slice(0, 70)}”?`
        case "create_folder": return `Create the folder \u201c${a.name}\u201d?`
        case "file_to": return `File this under ${a.folder}?`
        case "navigate": return `Fly to ${a.place}?`
        case "risk": return `Risk index for ${a.place}?`
        default: return `Run ${a.type.replace(/_/g, " ")}?`
    }
}
