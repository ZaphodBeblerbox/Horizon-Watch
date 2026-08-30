import { useEffect, useRef } from "react"
import { panelStyle, buttonStyle } from "../ui/styleHelpers.js"

/**
 * Compact overflow menu for real features that aren't one of the 4 fixed
 * top-level modes (Globe/News/Reports/Forge) but are still real, reachable
 * functionality: Overwatch, Director Mode, Analytics, Threats, Health,
 * Live TV, Sound mute, Settings, Profile. Nothing here is deleted — it's
 * moved out of the primary nav so the primary nav stays a small fixed set,
 * per this round's own decision on the extra Sidebar items that didn't fit
 * the prompt's 4-mode spec.
 */
function Row({ label, active, badge, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                ...buttonStyle({ variant: "ghost", size: "md", active }),
                width: "100%",
                justifyContent: "space-between",
                marginBottom: 2,
            }}
        >
            <span>{label}</span>
            {badge ? (
                <span style={{
                    fontSize: "var(--text-xs)", fontWeight: "var(--weight-bold)",
                    color: "var(--sev-critical)",
                }}>
                    {badge}
                </span>
            ) : null}
        </button>
    )
}

export default function SecondaryMenu({
    open,
    onClose,
    style = {},
    overwatchActive = false,
    onToggleOverwatch = null,
    directorActive = false,
    onDirectorClick = null,
    onOpenAnalytics = null,
    analyticsActive = false,
    onOpenThreats = null,
    threatsActive = false,
    onOpenHealth = null,
    healthActive = false,
    tvOpen = false,
    onToggleTV = null,
    soundMuted = false,
    onToggleSound = null,
    onOpenSettings = null,
    settingsActive = false,
    profile = null,
    profileActive = false,
    onOpenProfile = null,
}) {
    const ref = useRef(null)

    useEffect(() => {
        if (!open) return
        const onOutside = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose?.() }
        document.addEventListener("mousedown", onOutside)
        return () => document.removeEventListener("mousedown", onOutside)
    }, [open, onClose])

    if (!open) return null

    const click = (fn) => () => { fn?.(); onClose?.() }

    return (
        <div
            ref={ref}
            style={{
                position: "fixed",
                width: 220,
                zIndex: 1000,
                ...panelStyle({ elevated: true, elevation: 2 }),
                ...style,
            }}
        >
            {onToggleOverwatch && (
                <Row label="Overwatch" active={overwatchActive} onClick={click(onToggleOverwatch)} />
            )}
            {onDirectorClick && (
                <Row label="Director Mode" active={directorActive} onClick={click(onDirectorClick)} />
            )}
            {onOpenAnalytics && (
                <Row label="Analytics" active={analyticsActive} onClick={click(onOpenAnalytics)} />
            )}
            {onOpenThreats && (
                <Row label="Threats" active={threatsActive} onClick={click(onOpenThreats)} />
            )}
            {onOpenHealth && (
                <Row label="Health" active={healthActive} onClick={click(onOpenHealth)} />
            )}
            {onToggleTV && (
                <Row label={tvOpen ? "Live TV (on)" : "Live TV"} active={tvOpen} onClick={click(onToggleTV)} />
            )}
            {onToggleSound && (
                <Row label={soundMuted ? "Sound: Muted" : "Sound: On"} active={false} onClick={click(onToggleSound)} />
            )}
            {onOpenSettings && (
                <Row label="Settings" active={settingsActive} onClick={click(onOpenSettings)} />
            )}
            {profile && onOpenProfile && (
                <Row label={profile.displayName || "Profile"} active={profileActive} onClick={click(onOpenProfile)} />
            )}
        </div>
    )
}
