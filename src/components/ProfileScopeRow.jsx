/**
 * ProfileScopeRow.jsx — "Only show what matches my profile".
 *
 * The server holds every list, map layer and notification to what concerns
 * the asking user: their theaters, assets, countries, regions and the topics
 * they follow (backend/user_concern.py). This is the switch, stored as
 * settings.interests.onlyMine: on (or never touched) filters once there is
 * something to filter by; off shows everything, as before. A new account has
 * no profile yet, so it sees everything and is told how to set one.
 *
 * The line under it says what the filter holds back right now, derived on
 * read by /api/profile/scope — never stored. Row and Toggle come from the
 * caller (desktop Settings and the phone's Settings use their own).
 */
import { useEffect, useState } from "react"
import { apiFetch } from "../auth.js"
import { getSettings, subscribeSettings, updateSetting } from "../state/settingsStore.js"

export function scopeLine(scope, on) {
    if (!scope) return null
    if (!scope.has_profile) return scope.hint || "Add a theater, a country or an asset and only what concerns you is shown."
    if (!on) return "Showing everything, wherever it happens."
    const n = scope.hidden || 0
    const c = scope.counts || {}
    const parts = [c.signals ? `${c.signals} signal${c.signals === 1 ? "" : "s"}` : null,
                   c.telegram ? `${c.telegram} Telegram report${c.telegram === 1 ? "" : "s"}` : null].filter(Boolean)
    if (!n) return "Nothing is held back right now."
    return `${n} item${n === 1 ? "" : "s"} outside your profile hidden${parts.length ? ` (${parts.join(", ")})` : ""}.`
}

export const withSwitch = (interests, v) => ({ ...(interests || {}), onlyMine: !!v })

export default function ProfileScopeRow({ Row, Toggle }) {
    const [it, setIt] = useState(() => getSettings()?.interests || {})
    const [scope, setScope] = useState(null)
    useEffect(() => subscribeSettings((s) => setIt(s?.interests || {})), [])
    const on = it.onlyMine !== false
    // counts follow the profile and the switch (the server sees a change within a moment)
    const key = JSON.stringify([it.countries, it.regions, it.topics, it.here, it.onlyMine])
    useEffect(() => {
        let live = true
        const t = setTimeout(() => {
            apiFetch("/api/profile/scope").then((r) => (r.ok ? r.json() : null)).then((d) => { if (live && d) setScope(d) }).catch(() => {})
        }, 400)
        return () => { live = false; clearTimeout(t) }
    }, [key])
    const flip = (v) => { const next = withSwitch(it, v);setIt(next); updateSetting("interests", next) }
    return (
        <Row label="Only show what matches my profile"
             hint={<span data-testid="profile-scope-line">{scopeLine(scope, on) || "Your theaters, assets and interests decide what the maps, Home, the Desk and Alerts show."}</span>}>
            <Toggle value={on} onChange={flip} />
        </Row>
    )
}
