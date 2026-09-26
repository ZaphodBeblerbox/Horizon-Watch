/**
 * SavedSidebar.jsx — the writer's reference pane: a minimap at the top, and
 * below it everything saved off the map to write about.
 *
 * Clicking an item puts it in the document. That is the whole point of
 * saving it — a list you can only look at makes you go and find the thing
 * again somewhere else.
 *
 * The minimap shows where the saved items are, with the hovered one
 * highlighted, so the list has a geography rather than being names in an
 * arbitrary order.
 */

import { useState } from "react"
import MiniMap from "../reports/MiniMap.jsx"
import { useSaved, removeSaved, savedLabel } from "../state/savedForBriefing.js"

export default function SavedSidebar({ onInsert }) {
    const items = useSaved()
    const [hover, setHover] = useState(null)

    const located = items.filter((i) => i.lat != null && i.lon != null)
    const focus = hover && hover.lat != null
        ? { lat: hover.lat, lon: hover.lon }
        : located[0] ? { lat: located[0].lat, lon: located[0].lon } : null

    return (
        <div style={{ display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
            <div style={{ borderBottom: "1px solid var(--line)", flexShrink: 0 }}>
                <MiniMap
                    focus={focus}
                    context={located.map((i) => ({ lat: i.lat, lon: i.lon }))}
                    height={150}
                />
            </div>

            <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
                {items.length === 0 ? (
                    <p style={{ font: "400 11px var(--font)", color: "var(--txt-4)", padding: "4px 12px", lineHeight: 1.6 }}>
                        Nothing saved yet. Save a detection or a signal from the map and it
                        appears here, ready to drop into the page.
                    </p>
                ) : items.map((i) => (
                    <div
                        key={i.id}
                        onMouseEnter={() => setHover(i)}
                        onMouseLeave={() => setHover(null)}
                        style={{
                            display: "flex", alignItems: "flex-start", gap: 7, padding: "6px 10px",
                            borderBottom: "1px solid var(--line)",
                            background: hover?.id === i.id ? "var(--bg-3, #2a2e34)" : "transparent",
                        }}
                    >
                        {i.imageUrl && (
                            <img src={i.imageUrl} alt="" style={{
                                width: 34, height: 34, objectFit: "cover", flexShrink: 0,
                                border: "1px solid var(--line)",
                            }} />
                        )}
                        <div role="button" onClick={() => onInsert?.(i)} title="Insert into the document"
                             style={{ flex: 1, minWidth: 0, cursor: "pointer" }}>
                            <div style={{ font: "400 12px var(--font)", color: "var(--txt-2)", lineHeight: 1.35 }}>
                                {savedLabel(i)}
                            </div>
                            {i.detail && (
                                <div style={{ font: "400 10px var(--font)", color: "var(--txt-4)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                    {i.detail}
                                </div>
                            )}
                        </div>
                        <span role="button" title="Remove" onClick={() => removeSaved(i.id)}
                              style={{ color: "var(--txt-4)", flexShrink: 0, cursor: "pointer", font: "400 11px var(--font)" }}>
                            &#10005;
                        </span>
                    </div>
                ))}
            </div>
        </div>
    )
}
