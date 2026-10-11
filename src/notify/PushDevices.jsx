/**
 * PushDevices.jsx — every device that gets your notifications, each with
 * its own switch (owner, 2026-10-11: "turn off web notifications without
 * turning off the mobile and DMG notifications"). Removing one stops only
 * that device; from the device itself it also forgets the subscription
 * there. The desktop app notifies through macOS and is switched in its own
 * Settings, so it is named here but not listed.
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { getPushSubscription, unsubscribePush } from "../utils/pushNotifications.js"

export default function PushDevices({ Row }) {
    const [list, setList] = useState(null)
    const [mine, setMine] = useState("")
    const [err, setErr] = useState(null)
    const load = async () => {
        const sub = await getPushSubscription().catch(() => null)
        const ep = sub?.endpoint || ""
        setMine(ep)
        const r = await fetch(`${API_BASE}/api/push/devices${ep ? `?endpoint=${encodeURIComponent(ep)}` : ""}`, { credentials: "include" }).catch(() => null)
        setList(r?.ok ? await r.json() : [])
    }
    useEffect(() => { load() }, [])
    const remove = async (d) => {
        setErr(null)
        if (d.this_device && mine) await unsubscribePush().catch(() => {})
        const r = await fetch(`${API_BASE}/api/push/devices/${d.id}`, { method: "DELETE", credentials: "include" }).catch(() => null)
        if (!r?.ok && r?.status !== 404) setErr("Could not switch it off — try again.")
        load()
    }
    if (list === null) return null
    return (
        <Row label="Devices that get your notifications"
             hint={<>
                 {list.length === 0 ? "No phone or browser is set up for notifications."
                     : list.map((d) => (
                         <span key={d.id} data-testid="push-device" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                             <span style={{ flex: 1, minWidth: 0, color: "var(--txt2)" }}>{d.label}{d.this_device ? " · this device" : ""}</span>
                             <button onClick={() => remove(d)} style={{ height: 28, padding: "0 12px", border: "1px solid var(--gline2)", borderRadius: 14,
                                     background: "transparent", color: "var(--txt2)", font: "inherit", fontSize: 12.5, cursor: "pointer" }}>Turn off</button>
                         </span>
                     ))}
                 <span style={{ display: "block", marginTop: 8 }}>The desktop app notifies through macOS; switch it in the app's own Settings.</span>
                 {err && <span style={{ display: "block", color: "var(--red)", marginTop: 4 }}>{err}</span>}
             </>} />
    )
}
