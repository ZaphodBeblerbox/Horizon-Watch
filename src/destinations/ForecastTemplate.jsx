/**
 * ForecastTemplate.jsx — the doctrinal template, drawn and played.
 *
 * READ THIS BEFORE CHANGING ANYTHING HERE (spec F8). This component
 * draws an animation of military units moving. It is the one object in
 * the console most likely to be mistaken for intelligence, because it
 * looks exactly like the product an intelligence system would emit. It
 * is not. It is a doctrine, drawn.
 *
 * Four things are therefore not negotiable, and each has a test:
 *
 *   1. The stamp is on EVERY frame of BOTH faces, and cannot be
 *      dismissed. Not a tooltip, not a first-run notice.
 *   2. The doctrine is NAMED, so the reader can disagree with the
 *      doctrine rather than with the picture.
 *   3. t = 0 draws on SELECTION, not on play. A bordered box containing
 *      only a warning label is a quarter-pane of dead space, and dead
 *      space is where a reader stops reading warnings.
 *   4. Playback runs on requestAnimationFrame against a WALL CLOCK.
 *      setInterval drifts under load and, worse, keeps firing in a
 *      backgrounded tab, so the "6 second" run silently becomes
 *      something else and two readers see different speeds.
 *
 * And one prohibition: templated units are never rendered as Cesium
 * entities on the live globe. That is the single place they would be
 * indistinguishable from tracks.
 */
import { useEffect, useRef, useState } from "react"
import {
    FRAME, SIZE, TPL, RUN_MS, isMoving, positionAt, chevron, elapsedLabel,
} from "./forecastTemplate.js"

const W = 560, H = 240

/** Affiliation colours. Deliberately not the globe's track colours. */
const TINT = {
    friendly: "#5AC8FA", hostile: "#FF6B6B",
    neutral:  "#8E8E93", unknown: "#FFD166",
}

/**
 * The stamp. Rendered inside the SVG rather than over it, so it cannot
 * be separated from the picture by a screenshot, a print stylesheet or
 * a stacking-context bug.
 */
function Stamp() {
    return (
        <g aria-hidden="false">
            <rect x={W - 300} y={8} width={292} height={22} rx={3}
                  fill="rgba(255,159,10,0.12)" stroke="#FF9F0A" strokeWidth="1" />
            {/* textLength PINS the width instead of trusting font
                metrics. Hand-tuned sizing clipped this to "...NOT AN
                OBSERVED MOVEM" on the first machine it was drawn on, and
                a truncated warning is the exact failure this component
                exists to prevent. The glyphs compress; the sentence
                always arrives whole, on any font stack. */}
            <text x={W - 294} y={23} fill="#FF9F0A" fontSize="10"
                  fontWeight="700" textLength={280}
                  lengthAdjust="spacingAndGlyphs">
                DOCTRINAL TEMPLATE · NOT AN OBSERVED MOVEMENT
            </text>
        </g>
    )
}

/** One APP-6 symbol: frame, echelon tick, designator. */
function Unit({ u, t }) {
    const { x, y } = positionAt(u, t)
    const tint = TINT[u.aff] || TINT.unknown
    return (
        <g transform={`translate(${x},${y})`}>
            <path d={FRAME[u.aff]} fill="rgba(10,12,16,0.85)"
                  stroke={tint} strokeWidth="1.6" />
            <text x={0} y={-16} textAnchor="middle" fill={tint}
                  fontSize="9" fontWeight="700">{SIZE[u.size]}</text>
            <text x={0} y={4} textAnchor="middle" fill={tint}
                  fontSize="9" fontWeight="600">{u.id}</text>
        </g>
    )
}

/** The schematic face: relationships, without the terrain arguing. */
export function Schematic({ tpl, t }) {
    return (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%"
             style={{ display: "block", background: "#0A0C10", borderRadius: 4 }}
             role="img"
             aria-label="Doctrinal template, schematic. Not an observed movement.">
            {/* The line the template is about — a border, a chokepoint,
                a terminal. Dashed, because it is a concept here and not
                a surveyed boundary. */}
            <path d={tpl.line} stroke="#3A3F4B" strokeWidth="1.4"
                  strokeDasharray="5 4" fill="none" />
            <text x={4} y={H - 8} fill="#6B7280" fontSize="9">{tpl.lineLabel}</text>

            {/* Axes first, so symbols sit on top of their own tracks. */}
            {tpl.units.filter(isMoving).map((u, i) => (
                <g key={`ax${i}`}>
                    <line x1={u.x} y1={u.y} x2={u.to[0]} y2={u.to[1]}
                          stroke={TINT[u.aff] || TINT.unknown} strokeWidth="1"
                          strokeDasharray="3 5" opacity="0.35" />
                    {chevron(u, t) ? (
                        <path d={chevron(u, t)} stroke={TINT[u.aff] || TINT.unknown}
                              strokeWidth="1.6" fill="none" opacity="0.9" />
                    ) : null}
                </g>
            ))}
            {tpl.units.map((u, i) => <Unit key={i} u={u} t={t} />)}
            <Stamp />
        </svg>
    )
}

/**
 * The geographic face. The spec asks for coastlines under the symbols,
 * because a schematic can be elegant and geographically impossible.
 *
 * WHY THIS SAYS SO INSTEAD OF DRAWING IT. Real coastlines need a
 * projection library and a world topology file, neither of which this
 * bundle carries. Drawing an INVENTED coastline would be strictly worse
 * than drawing none: the whole purpose of this face is to let the
 * reader check the schematic against real ground, and a decorative
 * outline would answer that check with a lie. So the face states its
 * own absence, and shows the coordinates the template does have.
 */
export function Geographic() {
    return (
        <div style={{ padding: "14px 14px 16px", background: "#0A0C10",
                      borderRadius: 4, border: "1px solid #1C1F26" }}>
            <svg viewBox={`0 0 ${W} 34`} width="100%" style={{ display: "block" }}>
                <Stamp />
            </svg>
            <p style={{ color: "#9AA0AA", fontSize: 12, lineHeight: 1.55,
                        margin: "10px 0 0" }}>
                This template has no geographic face yet. It is drawn
                schematically only, which means you cannot check it
                against the ground — the axes above are relationships,
                not routes, and nothing here asserts that the terrain
                permits them.
            </p>
            <p style={{ color: "#6B7280", fontSize: 11, lineHeight: 1.5,
                        margin: "8px 0 0" }}>
                Terrain requires a projection and a coastline dataset the
                console does not carry. An invented outline would defeat
                the purpose of the check, so none is drawn.
            </p>
        </div>
    )
}

export default function ForecastTemplate({ templateKey, window: window_ = "" }) {
    const tpl = TPL[templateKey]
    const [face, setFace] = useState("schematic")
    const [t, setT] = useState(0)
    const [playing, setPlaying] = useState(false)
    const raf = useRef(0)

    // Rule 3: t = 0 the moment a template is selected. The picture is
    // there to be read before it is played.
    useEffect(() => { setT(0); setPlaying(false) }, [templateKey])

    useEffect(() => {
        if (!playing) return
        // Rule 4: against a wall clock. performance.now() is monotonic,
        // so a stalled frame catches up rather than stretching the run,
        // and two readers see the same six seconds.
        const t0 = performance.now()
        const step = () => {
            const k = Math.min(1, (performance.now() - t0) / RUN_MS)
            setT(k)
            if (k < 1) raf.current = requestAnimationFrame(step)
            else setPlaying(false)
        }
        raf.current = requestAnimationFrame(step)
        return () => cancelAnimationFrame(raf.current)
    }, [playing])

    if (!tpl) return null

    const btn = {
        background: "transparent", border: "1px solid #2A2F3A", color: "#C8CDD6",
        borderRadius: 3, padding: "4px 10px", fontSize: 11, cursor: "pointer",
    }
    const tab = (k) => ({
        ...btn,
        borderColor: face === k ? "#4A5160" : "#2A2F3A",
        color: face === k ? "#E6E9EF" : "#8A909B",
        background: face === k ? "#161A21" : "transparent",
    })

    return (
        <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center",
                          marginBottom: 8 }}>
                <button style={tab("schematic")}
                        onClick={() => setFace("schematic")}>schematic</button>
                <button style={tab("terrain")}
                        onClick={() => setFace("terrain")}>on the terrain</button>
                <span style={{ flex: 1 }} />
                <span style={{ color: "#6B7280", fontSize: 11,
                               fontVariantNumeric: "tabular-nums" }}>
                    {elapsedLabel(t, window_)}
                </span>
                <button style={btn} onClick={() => { setT(0); setPlaying(true) }}>
                    {playing ? "playing…" : "play"}
                </button>
            </div>

            {face === "schematic"
                ? <Schematic tpl={tpl} t={t} />
                : <Geographic />}

            {/* Rule 2: the doctrine, named, under the frame. */}
            <p style={{ color: "#8A909B", fontSize: 11, lineHeight: 1.55,
                        margin: "8px 0 0" }}>
                <strong style={{ color: "#C8CDD6" }}>Doctrine.</strong>{" "}
                {tpl.doctrine}
            </p>
            {/* The caveat, in words rather than in a badge, because a
                badge is skimmed and a sentence is read. */}
            <p style={{ color: "#FF9F0A", fontSize: 11, lineHeight: 1.55,
                        margin: "6px 0 0", opacity: 0.85 }}>
                Nothing above has been observed. These are the positions
                the doctrine would produce if this scenario happened, drawn
                so you can compare them against what you actually see. If
                the real movement does not look like this, the scenario is
                not confirmed — the template is wrong, or the scenario is.
            </p>
        </div>
    )
}
