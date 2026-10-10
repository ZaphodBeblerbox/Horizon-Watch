/**
 * ClosedNotificationsRow.jsx — the switch for notifications with Parallax
 * closed, on this device. Settings › Alerts and notifications, and the
 * phone's Profile. A permission prompt only appears from a click, so this
 * is the place it is asked.
 */
import { useEffect, useState } from "react"
import { closedNotifyStatus, enableClosedNotify, disableClosedNotify } from "./closedNotifications.js"

const HINT = {
    web: "What would pop up on screen — announced events before they start, live developments near what you watch, critical alerts — reaches this device even with the tab closed. Once per alert.",
    desktop: "Closing the window keeps Parallax running in the dock, and what would pop up on screen arrives as a macOS notification. Quit with ⌘Q to stop it.",
    "ios-browser": "On iPhone and iPad, Apple allows this only for the app on your Home Screen: tap Share › Add to Home Screen, open Parallax from there, and turn this on.",
    unsupported: "This browser cannot receive notifications while Parallax is closed.",
}

export default function ClosedNotificationsRow({ Row, Toggle }) {
    const [st, setSt] = useState(null)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)
    useEffect(() => { closedNotifyStatus().then(setSt).catch(() => setSt({ platform: "unsupported", on: false })) }, [])
    if (!st) return null
    const usable = st.platform === "web" || st.platform === "desktop"
    const flip = async (v) => {
        setBusy(true); setErr(null)
        const r = v ? await enableClosedNotify() : await disableClosedNotify()
        if (!r.ok) setErr(r.error === "blocked"
            ? "Notifications are blocked for this site — allow them in the browser's site settings, then turn this on."
            : r.error)
        setSt(await closedNotifyStatus())
        setBusy(false)
    }
    return (
        <Row label="Notify me when Parallax is closed"
             hint={<>{HINT[st.platform]}{st.blocked && <><br />Blocked for this site in the browser's settings.</>}
                   {busy && <span style={{ display: "block", color: "var(--txt2)", marginTop: 4 }}>{st.on ? "Turning off…" : "Turning on — registering this device…"}</span>}
                   {err && <span style={{ display: "block", color: "var(--red)", marginTop: 4 }}>{err}</span>}</>}>
            {usable ? <Toggle value={st.on} onChange={(v) => { if (!busy) flip(v) }} /> : null}
        </Row>
    )
}
