/**
 * LiveShareRow.jsx — "Share my live location": the user's own switch, on
 * this device (location/liveShare.js). Settings › General › Time and place,
 * and the phone's Settings › Location. What it does is written beside it,
 * because it sends where this person is to their team for as long as it is
 * on — and so is what it is doing right now: sharing, paused in the
 * background, refused (with how to allow it) or finding no position, with
 * Try again.
 */
import { useEffect, useState } from "react"
import { isDesktop } from "../apiBase.js"
import { retrySharing, shareStatus, startSharing, stopSharing, subscribeMyPosition } from "./liveShare.js"
import { platformOf } from "./geo.js"
import { hm } from "../utils/clock.js"

function line(st) {
    switch (st.state) {
        case "sharing": return `Sharing — last sent ${st.lastSentAt ? hm(st.lastSentAt) : "just now"}${st.accuracy != null && st.accuracy < 1000 ? `, to within ${Math.round(st.accuracy)} m` : ""}.`
        case "starting": return st.message || "Finding this device's position…"
        case "paused": return st.message
        default: return st.message
    }
}

export default function LiveShareRow({ Row, Toggle }) {
    const [st, setSt] = useState(() => shareStatus())
    useEffect(() => subscribeMyPosition(() => setSt(shareStatus())), [])
    const plat = platformOf()
    const trouble = ["denied", "unavailable", "error"].includes(st.state)
    const hint = (
        <>
            While Parallax is open on this device, its position goes to your team: you appear on the map, any asset
            linked to you moves with you, and what happens near you is assessed as you go — sent when you have moved
            50 m, and every two minutes standing still. Off by default; turning it off stops it at once.
            {isDesktop() ? " This app cannot read a device position: it shares where your connection is, city level."
                : plat.ios ? " An iPhone web app cannot share location in the background or with the phone locked: it pauses, and resumes when you open Parallax."
                : " Browsers stop location when the page is in the background."}
            {st.on && <span data-testid="live-share-state" data-state={st.state} role={trouble ? "alert" : undefined}
                            style={{ display: "block", color: trouble ? "var(--red, #e5484d)" : "var(--txt2)", marginTop: 4, lineHeight: 1.5 }}>
                {line(st)}
                {trouble && <button className="m2-chip" style={{ display: "inline-block", marginLeft: 8, marginTop: 4 }}
                                    onClick={() => { retrySharing(); setSt(shareStatus()) }} data-testid="live-share-retry">Try again</button>}
            </span>}
        </>
    )
    return (
        <Row label="Share my live location" hint={hint}>
            <Toggle value={st.on} onChange={(v) => { v ? startSharing() : stopSharing(); setSt(shareStatus()) }} />
        </Row>
    )
}
