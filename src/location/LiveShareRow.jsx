/**
 * LiveShareRow.jsx — "Share my live location": the user's own switch, on
 * this device (location/liveShare.js). Settings › General › Time and place,
 * and the phone's Profile. What it does is written beside it, because it
 * sends where this person is to their team for as long as it is on.
 */
import { useEffect, useState } from "react"
import { shareStatus, startSharing, stopSharing, subscribeMyPosition } from "./liveShare.js"
import { hm } from "../utils/clock.js"

export default function LiveShareRow({ Row, Toggle }) {
    const [st, setSt] = useState(() => shareStatus())
    useEffect(() => subscribeMyPosition(() => setSt(shareStatus())), [])
    const hint = (
        <>
            While Parallax is open on this device, its position goes to your team: you appear on the map, any person asset
            linked to you moves with you, and what happens near you is assessed as you go. Off by default; turning it off
            stops it at once. Browsers stop location when the app is in the background or the phone is locked.
            {st.on && <span style={{ display: "block", color: "var(--txt2)", marginTop: 4 }}>
                {st.error ? `Not sharing: ${st.error}.` : st.lastSentAt ? `Sharing — last sent ${hm(st.lastSentAt)}.` : "Sharing — waiting for this device's position…"}
            </span>}
        </>
    )
    return (
        <Row label="Share my live location" hint={hint}>
            <Toggle value={st.on} onChange={(v) => { v ? startSharing() : stopSharing(); setSt(shareStatus()) }} />
        </Row>
    )
}
