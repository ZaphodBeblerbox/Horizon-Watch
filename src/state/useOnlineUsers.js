/**
 * useOnlineUsers.js — who else has the console open right now.
 *
 * The menu bar showed three avatars — "L. Moreau · editing", "K. Adeyemi",
 * "R. Takahashi" — as a default prop. Nobody by those names exists here.
 *
 * This reuses the presence heartbeat already built for records (main.py,
 * /api/presence: a POST every ~15s, read back with a 45s TTL) under one
 * app-wide key. It is polling, not push, so "online" means "checked in
 * within the last 45 seconds", and the title says so. A hidden tab stops
 * checking in, so someone who walked away drops off instead of lingering.
 */
import { useEffect, useState } from "react"
import { getPresence, presenceHeartbeat } from "../lib/collabApi.js"

export const ONLINE_KEY = "app:online"
const EVERY_MS = 15_000

/** Everyone present except me, in a stable order. Pure, for testing. */
export function othersOnline(users, meId) {
    return (Array.isArray(users) ? users : [])
        .filter((u) => u && u.id && u.id !== meId)
        .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)))
}

export default function useOnlineUsers(meId) {
    const [users, setUsers] = useState([])
    useEffect(() => {
        if (!meId) return undefined
        let live = true
        const tick = async () => {
            if (typeof document !== "undefined" && document.visibilityState === "hidden") return
            try {
                await presenceHeartbeat(ONLINE_KEY)
                const d = await getPresence(ONLINE_KEY)
                if (live) setUsers(othersOnline(d?.users, meId))
            } catch { /* offline or signed out: show nobody rather than stale faces */
                if (live) setUsers([])
            }
        }
        tick()
        const t = setInterval(tick, EVERY_MS)
        const onVis = () => { if (document.visibilityState === "visible") tick() }
        document.addEventListener("visibilitychange", onVis)
        return () => { live = false; clearInterval(t); document.removeEventListener("visibilitychange", onVis) }
    }, [meId])
    return users
}
