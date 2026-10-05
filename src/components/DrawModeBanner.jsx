/**
 * DrawModeBanner.jsx — "the map is listening, and here is how to stop".
 *
 * Arming area selection changed nothing a reader could see except the
 * pointer, and even that only after the first click. So the state was
 * invisible: a click that was about to define a corner looked identical to
 * a click that pans the globe, and there was no way to tell the mode was
 * on, what it would do, or how to get out of it.
 *
 * Deliberately over the map and not in a panel. The thing that changed
 * behaviour is the map, so that is where it has to be said.
 */

export default function DrawModeBanner({ active, drawMode = "rectangle", stage = "idle", onCancel }) {
    if (!active) return null

    const how = drawMode === "polygon"
        ? (stage === "drawing"
            ? "Click to add each corner · double-click to close the shape"
            : "Click on the map to start the outline")
        : (stage === "drawing"
            ? "Click the opposite corner to finish"
            : "Click one corner of the area to scan")

    return (
        <div
            role="status"
            aria-live="polite"
            style={{
                position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)",
                zIndex: 60, display: "flex", alignItems: "center", gap: 12,
                padding: "7px 12px", borderRadius: 3,
                background: "var(--bg-2, #1e212c)", border: "1px solid var(--acc-hi, #a0b2d2)",
                boxShadow: "0 3px 14px rgba(0,0,0,.45)", pointerEvents: "auto",
                maxWidth: "min(560px, calc(100% - 24px))",
            }}
        >
            <span aria-hidden="true" style={{
                width: 9, height: 9, flexShrink: 0, borderRadius: "50%",
                background: "var(--acc-hi, #a0b2d2)",
            }} />
            <span style={{ font: "600 11px var(--font)", color: "var(--txt, #f2f3f6)", whiteSpace: "nowrap" }}>
                Drawing {drawMode === "polygon" ? "an outline" : "an area"}
            </span>
            <span style={{ font: "400 11px var(--font)", color: "var(--txt-3, #b5b9c3)" }}>{how}</span>
            <span style={{ flex: 1 }} />
            {onCancel && (
                <button
                    onClick={onCancel}
                    title="Cancel (Esc)"
                    style={{
                        font: "400 11px var(--font)", color: "var(--txt-2)", cursor: "pointer",
                        background: "transparent", border: "1px solid var(--line)",
                        borderRadius: 3, padding: "2px 8px", flexShrink: 0,
                    }}
                >cancel</button>
            )}
        </div>
    )
}
