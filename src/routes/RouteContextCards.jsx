/**
 * RouteContextCards.jsx — "Exit route" / "Deliveries / access route" cards
 * for an asset (or a point) when a route plan is relevant there
 * (contexts.js, GET /api/routes/context). A click opens the route panel.
 * Shown in the desktop inspector and on the phone's asset sheet.
 */
import { useEffect, useState } from "react"
import { routeContext } from "./api.js"
import { openContext } from "./contexts.js"

export function useRouteContexts({ assetId, lat, lon }) {
    const [ctx, setCtx] = useState([])
    useEffect(() => {
        if (!assetId && !Number.isFinite(+lat)) return undefined
        let live = true
        routeContext({ assetId, lat, lon }).then((d) => { if (live) setCtx(d.contexts || []) }).catch(() => { if (live) setCtx([]) })
        return () => { live = false }
    }, [assetId, lat, lon])
    return ctx
}

export default function RouteContextCards({ assetId, lat, lon, onOpen }) {
    const ctx = useRouteContexts({ assetId, lat, lon })
    if (!ctx.length) return null
    return (
        <div data-testid="route-context-cards" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {ctx.map((c, i) => (
                <button key={`${c.kind}-${i}`} data-context={c.kind} onClick={() => { if (openContext(c, { assetId, lat, lon })) onOpen?.(c) }}
                        style={{ textAlign: "left", border: `1px solid ${c.kind === "exit" ? "#E5484D" : "#F5A524"}`, borderRadius: 8, padding: "9px 11px",
                                 background: c.kind === "exit" ? "rgba(229,72,77,.12)" : "rgba(245,165,36,.12)", color: "inherit", font: "inherit", cursor: "pointer" }}>
                    <b style={{ display: "block", fontSize: 13.5 }}>{c.title} →</b>
                    <span style={{ fontSize: 12.5, opacity: 0.85 }}>{c.reason}</span>
                </button>
            ))}
        </div>
    )
}
