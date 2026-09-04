/**
 * PlaceholderModule.jsx — an honest "not built yet" screen for a module
 * whose real rebuild is explicitly a later redesign round's job (Round 2's
 * own ground rule: "placeholder tabs/routes are fine for now"). Never a
 * fake preview of content that doesn't exist — just a real, specific
 * sentence naming which round owns it, per Round 1's `.empty` convention.
 */
export default function PlaceholderModule({ label, roundNote }) {
    return (
        <div style={{
            height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--bg-0)",
        }}>
            <div className="empty">
                <svg className="icon lg" style={{ opacity: 0.45 }}><use href="#i-layers" /></svg>
                <p>{label} hasn't been rebuilt for the new design system yet — {roundNote}.</p>
            </div>
        </div>
    )
}
