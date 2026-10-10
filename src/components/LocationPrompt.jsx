/**
 * LocationPrompt.jsx — asked once: where are you?
 *
 * On the desktop app, the phone and the web alike (owner, 2026-10-10): with
 * the user's location, what happens around them is theirs like an asset's
 * surroundings — first on Home, a card when it is near — and their clock
 * is synced: the profile's time zone follows this device's, so colleagues
 * see their local time right. The device's location where it can give one;
 * where it cannot (or the user prefers), a city typed in. Stored in
 * settings.interests.here; "Not now" is remembered (settings.locationAsked)
 * and Settings › General changes or forgets it. Never shown over another
 * dialog (the welcome, a walkthrough).
 */
import { useEffect, useState } from "react"
import API_BASE from "../apiBase.js"
import { getSettings, subscribeSettings, updateSetting, settingsFromServer } from "../state/settingsStore.js"
import { getCurrentUser } from "../state/authStore.js"
import PlacePicker from "../search/PlacePicker.jsx"
import { getManualLocation, setManualLocation } from "../state/themeStore.js"
import { resumeSharing, startSharing } from "../location/liveShare.js"

/** The device's position, or an error saying why not. */
export function devicePosition(timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
        if (typeof navigator === "undefined" || !navigator.geolocation) { reject(new Error("This device cannot give its location.")); return }
        navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
            (e) => reject(new Error(e.code === 1 ? "Location was not allowed." : "The location could not be found.")),
            { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 30 * 60_000 })
    })
}

async function placeName(lat, lon) {
    try {
        const r = await fetch(`${API_BASE}/api/my-assets/reverse?lat=${lat}&lon=${lon}`, { credentials: "include" })
        const d = r.ok ? await r.json() : null
        return d?.place?.label || null
    } catch { return null }
}

/** Keep the profile's time zone in step with this device's. */
export function syncClock() {
    const u = getCurrentUser()
    let tz = null
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone } catch { /* none */ }
    if (!u || !tz || u.timezone === tz) return
    fetch(`${API_BASE}/api/users/${encodeURIComponent(u.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ timezone: tz }),
    }).then((r) => { if (r.ok) u.timezone = tz }).catch(() => {})
}

/** Save where the user is (and sync the clock). */
export async function saveHere(lat, lon, label = null) {
    const here = { lat: +(+lat).toFixed(4), lon: +(+lon).toFixed(4), label: label || (await placeName(lat, lon)), radius_km: 30, at: new Date().toISOString() }
    const interests = { ...(getSettings()?.interests || {}), here }
    await updateSetting("interests", interests)
    await updateSetting("locationAsked", true)
    // the day-and-night theme follows the same place, unless one was set for it
    if (!getManualLocation()) setManualLocation({ lat: here.lat, lon: here.lon, label: here.label })
    syncClock()
    return here
}

export async function forgetHere() {
    const { here, ...rest } = getSettings()?.interests || {}
    void here
    await updateSetting("interests", rest)
}

const BTN = { height: 30, padding: "0 14px", border: "1px solid var(--gline2)", background: "transparent", color: "var(--txt2)", font: "inherit", fontSize: 12.5, cursor: "pointer", borderRadius: 0 }
const PRIMARY = { ...BTN, background: "var(--accdim)", color: "var(--txt)", border: "1px solid var(--acchi)" }

export default function LocationPrompt({ afterTour = true, live = false }) {
    const [due, setDue] = useState(false)
    const [busy, setBusy] = useState(false)
    const [err, setErr] = useState(null)
    const [typing, setTyping] = useState(false)

    useEffect(() => {
        let t = null
        const check = (s) => {
            if (!settingsFromServer() || s?.locationAsked || s?.interests?.here) { setDue(false); return }
            // only when the welcome and walkthroughs are out of the way
            if (afterTour && s?.tutorial !== "done") return
            clearTimeout(t)
            t = setTimeout(function wait() {
                if (document.querySelector('[role="dialog"]')) { t = setTimeout(wait, 4000); return }
                setDue(true)
            }, 5000)
        }
        check(getSettings())
        const off = subscribeSettings(check)
        return () => { off?.(); clearTimeout(t) }
    }, [])
    // Already shared: refresh it quietly once per launch where the device
    // allows it without asking, and keep the clock in step.
    useEffect(() => {
        resumeSharing()                     // this device was sharing live: carry on
        const s = getSettings()
        if (!s?.interests?.here) return
        syncClock()
        navigator.permissions?.query?.({ name: "geolocation" }).then((p) => {
            if (p.state !== "granted") return
            devicePosition(8000).then(({ lat, lon }) => {
                const h = getSettings()?.interests?.here
                if (h && (Math.abs(h.lat - lat) > 0.05 || Math.abs(h.lon - lon) > 0.05)) saveHere(lat, lon)
            }).catch(() => {})
        }).catch(() => {})
    }, [])

    if (!due) return null
    // THE PHONE ASKS FOR LIVE LOCATION (owner, 2026-10-10): shared with the
    // team while Parallax is open, and kept on an asset linked to this person.
    const goLive = async () => {
        setBusy(true); setErr(null)
        try { const p = await devicePosition(); setDue(false); startSharing(); await saveHere(p.lat, p.lon) }
        catch (e) { setErr(`${e.message} You can type your city instead.`); setTyping(true) }
        finally { setBusy(false) }
    }
    const useDevice = async () => {
        setBusy(true); setErr(null)
        try { const p = await devicePosition(); setDue(false); await saveHere(p.lat, p.lon) }
        catch (e) { setErr(`${e.message} You can type your city instead.`); setTyping(true) }
        finally { setBusy(false) }
    }
    return (
        <div role="dialog" aria-label="Your location" data-testid="location-prompt"
             style={{ position: "fixed", right: 16, bottom: typeof window !== "undefined" && window.innerWidth < 640 ? "calc(env(safe-area-inset-bottom, 0px) + 84px)" : 16,
                      zIndex: 5800, width: 380, maxWidth: "calc(100vw - 32px)", borderRadius: typeof window !== "undefined" && window.innerWidth < 640 ? 20 : 0,
                      animation: "plx-fade-in .3s ease",
                      background: "var(--bar, #161a22)", border: "1px solid var(--gline2, #333)", boxShadow: "var(--gshadow)",
                      padding: "16px 18px 14px", color: "var(--txt)", backdropFilter: "blur(18px)", WebkitBackdropFilter: "blur(18px)" }}>
            <div style={{ fontFamily: "var(--mz-font-mono)", fontSize: 10, letterSpacing: ".14em", textTransform: "uppercase", color: "var(--txt4)", marginBottom: 8 }}>Where you are</div>
            <h2 style={{ margin: "0 0 8px", fontFamily: "var(--mz-font-body)", fontWeight: 600, fontSize: 16 }}>{live ? "Share where you are?" : "Show what matters near you?"}</h2>
            <p style={{ margin: "0 0 12px", fontSize: 13, lineHeight: 1.55, color: "var(--txt2)" }}>
                {live
                    ? "Sharing your live location puts what happens around you first, and lets your team follow you as an asset — threats near you are assessed as you move. It is shared while Parallax is open; turn it off any time in Profile."
                    : "With your location, what happens around you comes first on Home and in your notifications, and times are shown on your clock. It is kept with your account, used for nothing else, and you can change or remove it in Settings."}
            </p>
            {typing && (
                <div style={{ marginBottom: 10 }}>
                    <PlacePicker label="Your city" placeholder="Type your city — Paris, Dubai, Kyiv…"
                                 onPick={async (p) => { setBusy(true); await saveHere(p.lat, p.lon, p.label || p.name); setBusy(false); setDue(false) }} />
                </div>
            )}
            {err && <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--txt3)" }}>{err}</p>}
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button style={BTN} onClick={() => { updateSetting("locationAsked", true); syncClock(); setDue(false) }}>Not now</button>
                <span style={{ flex: 1 }} />
                {!typing && <button style={BTN} onClick={() => setTyping(true)}>Type my city</button>}
                {live && <button style={BTN} disabled={busy} onClick={useDevice}>Just once</button>}
                <button style={PRIMARY} disabled={busy} onClick={live ? goLive : useDevice} data-testid="location-use">{busy ? "Finding you…" : live ? "Share live location" : "Use my location"}</button>
            </div>
        </div>
    )
}
