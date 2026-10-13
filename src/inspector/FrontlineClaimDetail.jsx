/**
 * FrontlineClaimDetail.jsx — the top of a frontline claim's, a movement's
 * or a trajectory's inspector card (GlobeFrontlineClaimsLayer): one plain
 * paragraph (frontlineClaims.js), the claim's status as a chip, the unit's
 * APP-6 symbol, and for a trajectory the replay — started when the card
 * opens, again on "Replay flight". The rows below are the adapter's
 * (adapters.js adaptFrontlineClaim / adaptTroopMovement / adaptTrajectory).
 */
import { useEffect } from "react"
import {
    claimStyle, claimSummary, milSymbol, movementSummary, sideColour, trajectorySummary,
} from "../globe/frontlineClaims.js"
import { actorColor, strikeIconUri } from "../globe/strikes.js"

const replay = (t) => window.dispatchEvent(new CustomEvent("akili:trajectory-replay", { detail: { id: t.id, trajectory: t } }))

export default function FrontlineClaimDetail({ type, data }) {
    const d = data || {}
    useEffect(() => {
        if (type === "trajectory" && d.id) replay(d)
    }, [type, d.id]) // eslint-disable-line react-hooks/exhaustive-deps
    const text = type === "frontline_claim" ? claimSummary(d) : type === "troop_movement" ? movementSummary(d) : trajectorySummary(d)
    const colour = type === "frontline_claim" ? claimStyle(d).color : sideColour(d.side, d.colour)
    const sym = type === "troop_movement" && d.sidc ? milSymbol(d.sidc, { colour, size: 26 }) : null
    const glyph = type === "trajectory" ? strikeIconUri({ act: d.kind === "drone" ? "drone" : "missile", color: actorColor(d.actor), size: 34 }) : null
    return (
        <div data-testid="frontline-detail" data-type={type}
             style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "var(--space-4, 16px)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {sym?.uri && <img src={sym.uri} width={sym.width} height={sym.height} alt={d.unit_label || "unit symbol"} />}
                {glyph && <img src={glyph} width={34} height={40} alt={d.kind_label || "flight"} />}
                {type === "frontline_claim" && (
                    <span style={{ border: `1px ${claimStyle(d).dash ? "dashed" : "solid"} ${colour}`, background: `${colour}22`, color: colour,
                                   borderRadius: 6, padding: "2px 8px", font: "600 11px var(--font)", whiteSpace: "nowrap" }}>
                        {claimStyle(d).label}
                    </span>
                )}
                <div style={{ fontSize: "var(--text-sm, 13px)", lineHeight: 1.45, color: "var(--txt)" }}>{text}</div>
            </div>
            {type === "trajectory" && (
                <div>
                    <button type="button" className="chip" data-testid="trajectory-replay" onClick={() => replay(d)}
                            style={{ font: "500 12px var(--font)", padding: "3px 9px", cursor: "pointer" }}>
                        Replay flight
                    </button>
                    {d.from?.assumed && (
                        <span style={{ marginLeft: 8, font: "400 11px var(--font)", color: "var(--txt-3, var(--txt))" }}>
                            The origin is assumed, not reported.
                        </span>
                    )}
                </div>
            )}
        </div>
    )
}
