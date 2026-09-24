/**
 * WhatChanged.jsx — the card on the map, top-left (v4.3 §2).
 *
 * The first question a reader has on opening a watch console is not
 * "what is happening" but "what happened while I was away", and nothing
 * on the map answered it. This does, in three lines: how long you were
 * gone, how much arrived, and the three that matter most.
 *
 * It minimises to a pill rather than closing, because a card the reader
 * dismissed is a card they cannot get back without hunting, and this one
 * is worth getting back.
 */
import { useEffect, useMemo, useState } from "react"
import {
    windowFor, changedItems, summarise, readLastSeen, writeLastSeen,
    groupByKind, quietReason,
} from "./whatChanged.js"

const SEV_TINT = {
    critical: "var(--red)", high: "var(--amber)", elevated: "var(--amber)",
}

export default function WhatChanged({ items = [], onSelect, onOpenInbox }) {
    const [min, setMin] = useState(false)
    const [lastSeen] = useState(() => readLastSeen(
        typeof localStorage === "undefined" ? null : localStorage))

    // Written on the way out, so the NEXT visit has a mark. Writing it on
    // mount would make the window always empty.
    useEffect(() => {
        const store = typeof localStorage === "undefined" ? null : localStorage
        const write = () => writeLastSeen(store)
        window.addEventListener("beforeunload", write)
        return () => { window.removeEventListener("beforeunload", write); write() }
    }, [])

    const win = useMemo(() => windowFor(lastSeen), [lastSeen])
    const changed = useMemo(() => changedItems(items, win.since), [items, win.since])
    const top = changed.slice(0, 3)

    if (min) {
        return (
            <button className="wc-pill"
                    onClick={() => setMin(false)}
                    title="What changed since you last looked">
                ◆ {changed.length} new
            </button>
        )
    }

    return (
        <div className="wc">
            <div className="wc-head">
                <span>{win.label}</span>
                <button onClick={() => setMin(true)} title="Minimise">–</button>
            </div>
            <div className="wc-sum">{summarise(changed)}</div>

            {/* WHAT HAPPENED, not a tour of the furniture. A first-run
                guide teaches a reader where the buttons are; this tells
                them what they missed, which is the only thing they came
                back for. It is a sentence, not a walkthrough, and it goes
                away on its own once there is nothing to say. */}
            {changed.length ? (
                <div className="wc-brief">{groupByKind(changed)}</div>
            ) : (
                <div className="wc-brief quiet">{quietReason(win)}</div>
            )}
            {top.map((i) => (
                <button key={i.id} className="wc-row"
                        onClick={() => onSelect && onSelect(i)}>
                    <span className="dot" style={{
                        background: SEV_TINT[String(i.severity).toLowerCase()]
                            || "var(--txt-4)" }} />
                    <span className="t">{i.title || i.headline || "Signal"}</span>
                </button>
            ))}
            {changed.length ? (
                <div className="wc-foot">
                    {changed.length > 3 ? <span>+{changed.length - 3} more</span> : <span />}
                    <button onClick={() => onOpenInbox && onOpenInbox()}>open inbox →</button>
                </div>
            ) : null}
        </div>
    )
}
