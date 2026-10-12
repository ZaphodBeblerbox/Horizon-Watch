/**
 * usePlan.js — the plan for the open panel, kept current: planned (POST
 * /api/routes/plan) or opened by id (GET /api/routes/{id}); then RE-CHECKED
 * every minute (GET /api/routes/{id} — the server re-plans when a new danger
 * is on the way, and says why: "New danger: kettle at … — the route was changed").
 */
import { useEffect, useRef, useState } from "react"
import { planRoute, getPlan } from "./api.js"
import { getRoutePanel, subscribeRoutePanel } from "./store.js"
import { RECHECK_MS } from "./view.js"
import { myPosition } from "../location/liveShare.js"
import { getFix } from "../location/geo.js"

export function useRoutePanel() {
    const [s, setS] = useState(getRoutePanel())
    useEffect(() => subscribeRoutePanel(setS), [])
    return s
}

async function deviceFix() {
    const mine = myPosition()
    if (mine && Date.now() - (mine.at || 0) < 120_000 && !(mine.accuracy >= 1000)) return mine
    try { return await getFix() } catch { return mine || null }
}

export function usePlan(panel) {
    const { open, request, planId, seq } = panel
    const [plan, setPlan] = useState(null)
    const [error, setError] = useState(null)
    const [loading, setLoading] = useState(false)
    const [changed, setChanged] = useState(null)
    const idRef = useRef(null)
    const live = useRef(0)

    const run = async () => {
        const my = ++live.current
        setLoading(true); setError(null)
        try {
            let p
            if (planId) p = await getPlan(planId, request?.from?.me ? await deviceFix() : null)
            else {
                let req = request
                if (req?.from?.me && !Number.isFinite(+req.from.lat)) {
                    const f = await deviceFix()
                    if (f) req = { ...req, from: { me: true, lat: f.lat, lon: f.lon } }
                }
                // a slow server answers after the app's 30 s fetch limit; it caches the plan
                // for a minute, so asking once more returns it at once
                p = await planRoute(req).catch((e) => (e?.status ? Promise.reject(e) : planRoute(req)))
            }
            if (my !== live.current) return
            idRef.current = p.id || planId
            setPlan(p)
        } catch (e) {
            if (my === live.current) setError(e.message || "Could not get a route")
        } finally {
            if (my === live.current) setLoading(false)
        }
    }

    const recheck = async (force = false) => {
        const id = idRef.current
        if (!id) return run()
        setLoading(true)
        try {
            const f = request?.from?.me ? await deviceFix() : null
            const p = await getPlan(force ? `${id}` : id, f)
            if (p.rerouted) {
                setChanged(p.changed_because || "The route was changed.")
                try { navigator.vibrate?.([200, 100, 200]) } catch { /* not a phone */ }
            }
            setPlan(p)
        } catch (e) { setError(e.message || "Could not re-check") }
        finally { setLoading(false) }
    }

    useEffect(() => {
        if (!open) return undefined
        setPlan(null); setChanged(null); idRef.current = planId || null
        run()
        return undefined
    }, [open, seq]) // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!open) return undefined
        const t = setInterval(() => { if (idRef.current) recheck() }, RECHECK_MS)
        return () => clearInterval(t)
    }, [open, seq]) // eslint-disable-line react-hooks/exhaustive-deps

    return { plan, error, loading, changed, dismissChanged: () => setChanged(null), recheck, planId: idRef.current }
}
