/**
 * ConfirmCard.jsx — what the assistant proposes to create, and the user's
 * Confirm / Edit / Skip. Shared by the desktop panel and the phone screen.
 * Nothing is written until Confirm (then the existing endpoint, with the
 * user's own session: assistantApi.confirmProposal).
 */
import { runAssistantActions } from "./assistantActions.js"
import { proposalState } from "./assistantStore.js"

const KIND = { theater: "New theater", asset: "New asset", interests: "Follow", alerts: "Interruptions" }

/** A small drawing of the area: a ring for the radius, a dot for the centre. */
export function MiniArea({ place }) {
    if (!place) return null
    const r = Math.max(6, Math.min(26, 6 + Math.log10(Math.max(1, place.radius_km || 10)) * 8))
    return (
        <svg className="plx-as-mini" viewBox="0 0 64 64" aria-label={`${place.label || ""}, ${Math.round(place.radius_km || 0)} km`}>
            <path d="M0 32h64M32 0v64" stroke="rgba(255,255,255,.08)" />
            <circle cx="32" cy="32" r={r} fill="rgba(122,167,255,.12)" stroke="#7aa7ff" strokeWidth="1.2" />
            <circle cx="32" cy="32" r="2.5" fill="#7aa7ff" />
        </svg>
    )
}

export default function ConfirmCard({ proposal, onConfirm, onEdit, onSkip, platform = "desktop" }) {
    const p = proposal
    const st = proposalState(p)          // a pending token past its 10 minutes reads expired
    const show = () => p.place && runAssistantActions([{ intent: "navigate", slots: {
        lat: p.place.lat, lon: p.place.lon, place: p.place.label,
        zoom: p.place.zoom ?? (p.place.radius_km > 200 ? 6 : p.place.radius_km > 40 ? 8 : 11),
        altitude: Math.max(15000, (p.place.radius_km || 30) * 2600) } }], platform)
    return (
        <div className="plx-as-card" data-testid="assistant-confirm" data-kind={p.kind} data-state={st}>
            <div className="plx-as-card-body">
                <MiniArea place={p.place} />
                <p><span style={{ display: "block", fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase",
                                  color: "var(--txt3, rgba(233,237,243,.55))", marginBottom: 2 }}>{KIND[p.kind] || "Proposal"}</span>
                    {p.summary}</p>
            </div>
            {st === "pending" || st === "saving" || st === "failed" ? (
                <>
                    {st === "failed" && <div className="plx-as-card-state">{p.why || "That was not saved."}</div>}
                    <div className="plx-as-card-actions">
                        <button data-primary="true" disabled={st === "saving"} onClick={() => onConfirm?.(p)}>
                            {st === "saving" ? "Saving…" : "Confirm"}</button>
                        {p.place && <button onClick={show}>Show on map</button>}
                        {onEdit && (p.kind === "theater" || p.kind === "asset") && <button onClick={() => onEdit(p)}>Edit</button>}
                        <button onClick={() => onSkip?.(p)}>Skip</button>
                    </div>
                </>
            ) : (
                <div className="plx-as-card-state">
                    {st === "done" && <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 8.5l3.2 3L13 4.5" /></svg>}
                    {st === "done" ? "Created." : st === "expired" ? "Expired. Ask again to make a new proposal." : "Skipped."}
                </div>
            )}
        </div>
    )
}
