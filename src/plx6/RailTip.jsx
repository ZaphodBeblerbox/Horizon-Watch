import { createPortal } from "react-dom"

/* THE NAME, AT ONCE. The browser's own tooltip waits about a second, which
   on a column of bare icons means guessing. This one shows on hover with no
   delay, beside the icon. Portalled to the body: the rail's backdrop-filter
   makes it the containing block for anything fixed inside it. */
export default function RailTip({ at, children }) {
    if (!at || typeof document === "undefined") return null
    return createPortal(
        <span role="tooltip" style={{
            position: "fixed", left: at.right + 8, top: at.top + at.height / 2,
            transform: "translateY(-50%)", zIndex: 10000, pointerEvents: "none",
            padding: "4px 8px", whiteSpace: "nowrap",
            background: "var(--glass, rgba(14,18,32,.94))", border: "1px solid var(--gline2)",
            backdropFilter: "blur(22px) saturate(1.15)", WebkitBackdropFilter: "blur(22px) saturate(1.15)",
            boxShadow: "var(--gshadow)", color: "var(--txt)",
            font: "500 12px var(--mz-font-body, var(--font))",
        }}>{children}</span>,
        document.body,
    )
}
