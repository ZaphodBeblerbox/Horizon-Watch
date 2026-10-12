/**
 * WarningTakeover.jsx — a WARNING takes the whole screen, in red, with its
 * own alarm, until "Acknowledge" (owner, 2026-10-12: "that warning must go
 * above everything else").
 *
 * HOW IT ARRIVES, fastest first: the live stream (positionStream, when it
 * is open), the service worker handing over the push (public/sw-push.js,
 * "WARNING"), and its own poll of GET /api/warnings/inbox — every 8 s on
 * screen, 20 s in the background — which also catches anything missed.
 *
 * WHAT IT IGNORES: Do Not Disturb and muted sounds (takeover.js alarming()).
 * WHAT IT CANNOT DO, and says: an iPhone's silent switch and Focus, and
 * vibration on iOS (takeover.js deviceNote()).
 *
 * THE DESKTOP APP: with its window away, each new warning is also a macOS
 * notification (desktop/nativeNotify.js) — the alarm sounds either way.
 */
import { useEffect, useReducer, useRef, useState } from "react"
import { isDesktop } from "../apiBase.js"
import { getCurrentUser, subscribeAuth } from "../state/authStore.js"
import { getSettings } from "../state/settingsStore.js"
import { positionStream } from "../location/positionStream.js"
import { ackWarning, warningInbox } from "./api.js"
import { createAlarm } from "./alarm.js"
import { alarming, deviceNote, initialTakeover, reduceTakeover, takeoverEffects } from "./takeover.js"

export const POLL_ON_SCREEN_MS = 8_000
export const POLL_AWAY_MS = 20_000

const onScreen = () => typeof document === "undefined" || (document.visibilityState !== "hidden" && (typeof document.hasFocus !== "function" || document.hasFocus()))
const hhmm = (iso) => { try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) } catch { return "" } }

function useSignedIn() {
    const [u, setU] = useState(() => getCurrentUser())
    useEffect(() => subscribeAuth((x) => setU(x || null)), [])
    return !!u?.id
}

/** The state machine, with its effects run outside React's render. */
function useTakeover(alarm) {
    const ref = useRef(initialTakeover())
    const [state, force] = useReducer((n) => n + 1, 0)
    const dispatch = (ev) => {
        const prev = ref.current
        const next = reduceTakeover(prev, ev)
        if (next === prev) return
        ref.current = next
        const fx = takeoverEffects(prev, next, getSettings())       // settings ignored by design: DND does not apply
        if (fx.start) alarm.start()
        if (fx.stop) alarm.stop()
        for (const w of fx.fresh) announce(w)
        force()
    }
    void state
    return [ref.current, dispatch]
}

function announce(w) {
    const title = w.kind === "evacuate" ? "EVACUATE" : "WARNING"
    const body = `${w.from_name || "Your team"}: ${w.message}${w.asset_name ? ` — ${w.asset_name}` : ""}`
    // the tray keeps the record; the takeover is the card, so it is silent there
    import("../state/notificationStore.js").then((m) => m.pushNotification({
        id: `warn:${w.id}`, kind: "warning", sev: "critical", title: `${title} — ${w.message}`, sub: `from ${w.from_name || "your team"}`,
        ts: Date.parse(w.created_at) || Date.now(), assetId: w.asset_id || null, silent: true,
    })).catch(() => {})
    if (isDesktop() && !onScreen()) {
        import("../desktop/nativeNotify.js").then((m) => m.nativeSend({ title, body })).catch(() => {})
    }
}

export default function WarningTakeover() {
    const signedIn = useSignedIn()
    const [snd, setSnd] = useState({ running: false, audible: false, blocked: false, canVibrate: false })
    const alarmRef = useRef(null)
    if (!alarmRef.current) alarmRef.current = createAlarm({ onChange: setSnd })
    const alarm = alarmRef.current
    const [state, dispatch] = useTakeover(alarm)
    const [busy, setBusy] = useState(null)
    const [err, setErr] = useState(null)

    // the poll, the push handed over by the service worker, the live stream
    useEffect(() => {
        if (!signedIn) return undefined
        let live = true, t = null
        const poll = async () => {
            if (t) { clearTimeout(t); t = null }
            try {
                const d = await warningInbox(onScreen())
                if (live) dispatch({ type: "inbox", warnings: d.warnings || [] })
            } catch { /* offline: the next poll */ }
            if (live) t = setTimeout(poll, onScreen() ? POLL_ON_SCREEN_MS : POLL_AWAY_MS)
        }
        poll()
        const onMsg = (e) => { if (e.data?.type === "WARNING") poll() }
        const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : null
        sw?.addEventListener?.("message", onMsg)
        const onVis = () => { if (document.visibilityState === "visible") poll() }
        document.addEventListener("visibilitychange", onVis)
        window.addEventListener("focus", onVis)
        const off = positionStream().listen((ev) => {
            if (ev.type === "warning" || ev.type === "warning_update") dispatch({ type: "arrive", warning: ev.warning })
        })
        return () => {
            live = false
            if (t) clearTimeout(t)
            sw?.removeEventListener?.("message", onMsg)
            document.removeEventListener("visibilitychange", onVis)
            window.removeEventListener("focus", onVis)
            off()
        }
    }, [signedIn])   // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => () => alarm.stop(), [alarm])

    if (!signedIn || !alarming(state, getSettings())) return null
    const w = state.active[0]
    const evac = w.kind === "evacuate"
    const note = deviceNote({ ua: typeof navigator !== "undefined" ? navigator.userAgent : "", canVibrate: snd.canVibrate, desktop: isDesktop() })
    const ack = async () => {
        setBusy(w.id); setErr(null)
        dispatch({ type: "ack", id: w.id })
        try { await ackWarning(w.id) }
        catch (e) { dispatch({ type: "ack_failed", id: w.id }); setErr(`Not sent — ${e.message || "no connection"}. It will show again; acknowledge once more.`) }
        finally { setBusy(null) }
    }
    const openRoute = () => {
        const r = w.route || {}
        window.dispatchEvent(new CustomEvent("plx:open-notification", { detail: {
            id: `warn:${w.id}`, lat: w.lat ?? null, lon: w.lon ?? null, assetId: w.asset_id || null, title: w.message,
            routePlanId: r.route_plan_id || null, alertType: evac ? "Leave now" : null,
        } }))
    }
    return (
        <div role="alertdialog" aria-modal="true" aria-labelledby="plx-warning-title" data-testid="warning-takeover"
             onPointerDown={() => alarm.unlock()}
             style={{ position: "fixed", inset: 0, zIndex: 2147483000, display: "flex", flexDirection: "column", justifyContent: "center",
                      padding: "max(24px, env(safe-area-inset-top)) 20px max(24px, env(safe-area-inset-bottom))", color: "#fff",
                      background: "#b3121b", animation: "plxWarnPulse 1s ease-in-out infinite alternate",
                      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif", overflowY: "auto" }}>
            <style>{"@keyframes plxWarnPulse{from{background:#b3121b}to{background:#e5141f}}"}</style>
            <div style={{ maxWidth: 560, width: "100%", margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <svg width="44" height="44" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 1 21h22L12 2Zm0 6 .01 0M12 9v5m0 3v.01" stroke="#fff" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    <div>
                        <div id="plx-warning-title" style={{ fontSize: 34, fontWeight: 800, letterSpacing: ".06em", lineHeight: 1 }}>{evac ? "EVACUATE" : "WARNING"}</div>
                        <div style={{ fontSize: 14, opacity: 0.9, marginTop: 4 }}>
                            from {w.from_name || "your team"} · {hhmm(w.created_at)}{w.severity === "critical" ? " · critical" : ""}
                            {state.active.length > 1 ? ` · 1 of ${state.active.length}` : ""}
                        </div>
                    </div>
                </div>
                <div data-testid="warning-message" style={{ fontSize: 24, fontWeight: 650, lineHeight: 1.3, background: "rgba(0,0,0,.18)", borderRadius: 12, padding: "16px 18px" }}>
                    {w.message}
                </div>
                {w.asset_name && <div style={{ fontSize: 15, opacity: 0.95 }}>About: {w.asset_name}</div>}
                {w.route?.route_plan_id && (
                    <button onClick={openRoute} style={{ height: 52, borderRadius: 12, border: "2px solid #fff", background: "transparent", color: "#fff", font: "inherit", fontSize: 17, fontWeight: 700, cursor: "pointer" }}>
                        Open the route{w.route.safe_house ? ` to ${w.route.safe_house}` : ""}
                    </button>
                )}
                <button onClick={ack} disabled={busy === w.id} data-testid="warning-ack" autoFocus
                        style={{ height: 64, borderRadius: 14, border: 0, background: "#fff", color: "#b3121b", font: "inherit", fontSize: 21, fontWeight: 800, cursor: "pointer", letterSpacing: ".02em" }}>
                    {busy === w.id ? "Sending…" : "Acknowledge"}
                </button>
                {snd.blocked && <div style={{ fontSize: 15, fontWeight: 650 }} data-testid="warning-tap">Tap anywhere to sound the alarm.</div>}
                {err && <div style={{ fontSize: 14, fontWeight: 600 }}>{err}</div>}
                <div style={{ fontSize: 12.5, opacity: 0.85, lineHeight: 1.45 }}>
                    {`${w.from_name || "Your team"} will see when you acknowledge.`}{note ? ` ${note}` : ""}
                </div>
            </div>
        </div>
    )
}
