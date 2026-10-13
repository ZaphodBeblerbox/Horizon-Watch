/**
 * StrikeEventDetail.jsx — the top of a strike/control event's inspector
 * card: the act's marker, one plain sentence (strikes.strikeSummary) and,
 * when the event belongs to a campaign, the campaign with a "Replay
 * campaign" button (GlobeStrikesLayer runs the replay). The rows below are
 * the adapter's (adapters.js adaptStrikeEvent), sources as links.
 */
import { actorColor, isHollow, strikeIconUri, strikeSummary, actLabel, dayLabel } from "../globe/strikes.js"
import StrikeSourceMedia from "./StrikeSourceMedia.jsx"

export default function StrikeEventDetail({ event }) {
    const e = event || {}
    const c = e.campaign
    const color = actorColor(e.actor)
    return (
        <div data-testid="strike-detail" style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: "var(--space-4, 16px)" }}>
            <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <img src={strikeIconUri({ act: e.act, color, size: 34, hollow: isHollow(e) })} width={34} height={40} alt={actLabel(e.act)} />
                <div style={{ fontSize: "var(--text-sm, 13px)", lineHeight: 1.45, color: "var(--txt)" }}>{strikeSummary(e)}</div>
            </div>
            <StrikeSourceMedia event={e} maxHeight="60vh" />
            {c && (
                <div style={{ border: `1px solid ${color}55`, background: `${color}12`, borderRadius: 8, padding: "9px 11px",
                              fontSize: "var(--text-sm, 13px)", lineHeight: 1.45 }}>
                    <div style={{ fontWeight: 600, color }}>Campaign · {c.title}</div>
                    <div style={{ color: "var(--txt2, var(--txt))" }}>
                        {c.count} events from {dayLabel(c.first)} to {dayLabel(c.last)}
                        {c.acts ? ` — ${Object.entries(c.acts).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${actLabel(k).toLowerCase()}`).join(", ")}` : ""}
                        {c.killed ? `; ${c.killed} killed reported` : ""}.
                    </div>
                    <button type="button" className="chip" data-testid="strike-campaign-replay"
                        onClick={() => window.dispatchEvent(new CustomEvent("akili:strike-campaign-replay", { detail: { id: c.id, campaign: c } }))}
                        style={{ marginTop: 6, font: "500 12px var(--font)", padding: "3px 9px", cursor: "pointer" }}>
                        Replay campaign
                    </button>
                </div>
            )}
        </div>
    )
}
