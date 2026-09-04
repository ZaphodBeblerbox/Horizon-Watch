import { useEffect, useState, useRef, useCallback } from "react"
import { subscribeToasts } from "./toast.js"

/**
 * ToastHost.jsx — mount once at the app root. Renders the real `.toast-stack`
 * (designSystem.css, Round 1) driven by toast.js's plain pub/sub queue.
 * Auto-dismiss per-toast durationMs, with a real 300ms fade-out (matching
 * the Round 1 floating-layer motion budget) before removal, not an
 * instant unmount.
 */
export default function ToastHost() {
    const [toasts, setToasts] = useState([])
    const timers = useRef(new Map())

    const remove = useCallback((id) => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)))
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 300)
    }, [])

    useEffect(() => {
        const unsub = subscribeToasts((entry) => {
            setToasts((prev) => [...prev, { ...entry, leaving: false }])
            const t = setTimeout(() => remove(entry.id), entry.durationMs)
            timers.current.set(entry.id, t)
        })
        return () => {
            unsub()
            timers.current.forEach(clearTimeout)
            timers.current.clear()
        }
    }, [remove])

    if (toasts.length === 0) return null
    return (
        <div className="toast-stack">
            {toasts.map((t) => (
                <div key={t.id} className={`toast${t.leaving ? " leaving" : ""}`}>
                    <svg className="icon"><use href={`#${t.icon}`} /></svg>
                    <span>{t.message}</span>
                </div>
            ))}
        </div>
    )
}
