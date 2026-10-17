import { useEffect, useState } from "react"

/**
 * usePresence — keep a closing surface on screen for its exit motion
 * (2026-10-17, the desktop's share of the phone's v4 motion).
 *
 * A menu, dialog or toast that returns null the instant it closes can only
 * ever cut away; the owner asked for the desktop to move like the phone, and
 * on the phone things leave the way they came. This holds the surface for
 * `ms` after it closes while the caller renders it with a `leaving` class,
 * then lets it unmount.
 *
 *   const { mounted, leaving } = usePresence(open, 160)
 *   if (!mounted) return null
 *
 * The hold is decided during render, not in an effect: an effect runs after
 * the closing render has already unmounted the surface, which would flash it
 * off and back on. With reduced motion asked for there is nothing to wait
 * for, so it unmounts at once.
 */
const reduced = () => typeof window !== "undefined"
    && !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches

export default function usePresence(open, ms = 160) {
    const [prev, setPrev] = useState(open)
    const [held, setHeld] = useState(false)
    if (prev !== open) {
        setPrev(open)
        setHeld(!open && ms > 0 && !reduced())
    }
    useEffect(() => {
        if (!held) return undefined
        const t = setTimeout(() => setHeld(false), ms)
        return () => clearTimeout(t)
    }, [held, ms])
    return { mounted: open || held, leaving: !open && held }
}
