/**
 * AssetFigure.jsx — the picture of an asset kind.
 *
 * Today a drawn silhouette per group; the slowly turning 3D models (owner,
 * 2026-10-06: drawn in code, as detailed as possible) replace the body of
 * this component, so every place that shows an asset gets them at once.
 */
const GLYPH = {
    Vessels: "M3 15h18l-2.5 4.5H5.5zM6 15V9h7l3 6M9 9V5.5h2.5V9",
    Aircraft: "M12 3v18M12 9l9 4v2l-9-2.5M12 9l-9 4v2l9-2.5M9.5 20l2.5-1.5 2.5 1.5",
    Vehicles: "M3 16V9.5l2.5-3h9l3 4H21V16zM6.5 18.5a1.8 1.8 0 100-.01M16.5 18.5a1.8 1.8 0 100-.01",
    Sites: "M3 20V10l5 3V10l5 3V7h3v13zM18 20V4h3v16",
    Energy: "M13 2L5 13h6l-1 9 8-11h-6z",
    Transport: "M4 20h16M6 20V12h12v8M9 12V7h6v5M12 7V3",
    People: "M12 4a3.2 3.2 0 100 6.4A3.2 3.2 0 0012 4zM5 20c.8-4 3.6-6 7-6s6.2 2 7 6",
}

export default function AssetFigure({ group, size = 40, color = "var(--acchi)" }) {
    const d = GLYPH[group] || GLYPH.Sites
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5"
             strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flex: "none" }}>
            <path d={d} />
        </svg>
    )
}
