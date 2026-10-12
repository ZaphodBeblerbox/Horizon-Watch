/**
 * mount.jsx — the WARNING takeover, in its own root above the whole app
 * (desktop, phone and the desktop app alike), so no screen, router or
 * overlay of the app can hide it or unmount it. Called once from main.jsx.
 */
import { createRoot } from "react-dom/client"
import WarningTakeover from "./WarningTakeover.jsx"
import { installAlarmPrime } from "./alarm.js"

export function mountWarnings(doc = typeof document !== "undefined" ? document : undefined) {
    if (!doc || doc.getElementById("plx-warnings")) return
    installAlarmPrime()
    const el = doc.createElement("div")
    el.id = "plx-warnings"
    doc.body.appendChild(el)
    createRoot(el).render(<WarningTakeover />)
}
