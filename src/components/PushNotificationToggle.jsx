import { useState, useEffect } from "react"
import { initPushNotifications, getPushSubscription, requestPushPermission, unsubscribePush } from "../utils/pushNotifications.js"

// Extracted from the old, never-mounted PreferencesPanel.jsx (real Settings
// round) — self-contained real push-subscription control (browser Push API
// state, not a per-user settings-blob field), reused as-is in Settings'
// Alerts section.
export default function PushNotificationToggle() {
    const [supported, setSupported] = useState(false)
    const [enabled,   setEnabled]   = useState(false)
    const [loading,   setLoading]   = useState(true)

    useEffect(() => {
        initPushNotifications().then(({ supported: s }) => {
            setSupported(s)
            if (s) {
                getPushSubscription().then(sub => {
                    setEnabled(!!sub)
                    setLoading(false)
                })
            } else {
                setLoading(false)
            }
        })
    }, [])

    const toggle = async () => {
        setLoading(true)
        if (enabled) {
            await unsubscribePush()
            setEnabled(false)
        } else {
            const { granted } = await requestPushPermission()
            setEnabled(granted)
        }
        setLoading(false)
    }

    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)

    return (
        <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", gap: 12 }}>
                <div>
                    <div style={{ fontSize: "var(--text-sm)", color: "var(--txt)", marginBottom: 2 }}>Push notifications</div>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--txt-4)" }}>
                        {supported ? "Receive alerts when app is closed" : isIOS ? "Add to Home Screen to enable" : "Not supported on this browser"}
                    </div>
                </div>
                <button
                    onClick={toggle}
                    disabled={!supported || loading}
                    style={{
                        width: 40, height: 22, borderRadius: "var(--r)", border: "none", flexShrink: 0,
                        background: (supported && enabled) ? "var(--acc)" : "var(--bg-4)",
                        cursor: (supported && !loading) ? "pointer" : "not-allowed",
                        position: "relative",
                        opacity: loading ? 0.5 : 1,
                        transition: "background 0.2s",
                    }}
                >
                    <div style={{
                        position: "absolute", top: 2, borderRadius: "50%",
                        width: 18, height: 18, background: "#fff",
                        left: (supported && enabled) ? 20 : 2,
                        transition: "left 0.2s",
                    }} />
                </button>
            </div>
            {isIOS && !supported && (
                <div style={{ fontSize: "var(--text-xs)", color: "var(--txt-3)", padding: "6px 10px", background: "var(--bg-2)", borderRadius: "var(--r)", borderLeft: "2px solid var(--amber)", marginBottom: 4 }}>
                    iOS: tap Share → "Add to Home Screen", then open from home screen.
                </div>
            )}
        </>
    )
}
