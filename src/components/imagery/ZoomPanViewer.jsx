import { isTextEntry } from "../../utils/isTextEntry.js"
import { useRef, useState, useEffect, useCallback, useImperativeHandle, forwardRef, createContext, useContext } from "react"
import {
    zoomAbout, clampPan, focusOnBox, scaleToFit, arrowFor, IDENTITY, MIN_SCALE,
    containRect, boxToFrame,
} from "./viewportMath.js"

/**
 * ZoomPanViewer — inspect a scene at full resolution.
 *
 * WHY. A tiled scan now arrives at 10 m/px, so a zone scene can be tens of
 * megapixels. Rendering that into a 420px pane and calling it "the image"
 * throws away the resolution the whole tiling effort exists to produce: a
 * 100m vessel is 10 real pixels and roughly one screen pixel. Zoom is not a
 * convenience here, it is the only way to see what was detected.
 *
 * The children are laid out in a normalised box, so existing percentage-
 * positioned detection overlays scale with the image for free — the
 * transform applies to the whole stack, image and boxes together, which is
 * what keeps a box welded to its object at every zoom level.
 *
 * Interaction deliberately matches what people already expect from a map:
 * wheel to zoom at the cursor, drag to pan, double-click to reset.
 */
/**
 * The current zoom, for overlays that must NOT grow with the image.
 *
 * Everything inside the viewer is scaled by one CSS transform, which is what
 * keeps a detection box welded to its object. It also multiplies strokes and
 * text: at 8.7x a 9px label renders at 78px and a scan disappears behind its
 * own annotations — observed in the browser, not in theory. Overlays divide
 * their pixel sizes by this to hold a constant on-screen size.
 */
export const ViewerScaleContext = createContext(1)
export const useViewerScale = () => useContext(ViewerScaleContext)

/**
 * The full view, for overlays drawn OUTSIDE the transform.
 *
 * Counter-scaling inside the transformed container does not work, and the
 * reason is worth recording: a CSS outline-width below 1px is rounded up to
 * 1px by the browser BEFORE the transform magnifies it, so at 15x a
 * correctly counter-scaled 0.08px border rendered as a 15px slab.
 * `vector-effect="non-scaling-stroke"` does not rescue it either — that
 * cancels an SVG's own viewBox scaling, not an ancestor CSS transform.
 *
 * So annotations that must keep a constant on-screen weight are rendered in
 * an untransformed layer and positioned from this view instead: a point at
 * image fraction `x` sits at `tx + scale * x * frameW`.
 */
export const ViewerViewContext = createContext({
    scale: 1, tx: 0, ty: 0, frameW: 0, frameH: 0,
    imgX: 0, imgY: 0, imgW: 0, imgH: 0,
})
export const useViewerView = () => useContext(ViewerViewContext)


const ZoomPanViewer = forwardRef(function ZoomPanViewer(
    { src, alt = "scene", children, overlay = null, onBackgroundClick,
      minHeight = 320, fill = false, footer = null, stretch = false,
      // CONTROLLED MODE. When `view`/`onViewChange` are supplied the viewer
      // stops owning its own zoom and defers to the caller. That is what
      // makes a comparison honest: two panes driven by ONE view are always
      // showing the same ground, so a difference on screen is a difference
      // on the ground rather than an artefact of two independent zooms.
      view: controlledView = null, onViewChange = null,
      label = null }, ref,
) {
    const frameRef = useRef(null)
    const [ownView, setOwnView] = useState(IDENTITY)
    const [frame, setFrame] = useState({ w: 0, h: 0 })
    // The image's own pixel dimensions. Needed because objectFit:contain
    // LETTERBOXES a scene whose aspect ratio differs from the pane, and an
    // overlay mapped to the pane instead of to the image sits off its
    // objects by the width of the bars.
    const [loadedSize, setNatural] = useState({ w: 0, h: 0 })
    // `stretch`: the image is a georeferenced scene whose frame already has
    // the area's shape — it fills the frame exactly, so every image of the
    // area (optical, radar, the sharp reference, an old square fetch) lines
    // up with every other and with the outlines.
    const natural = stretch ? frame : loadedSize

    const isControlled = controlledView != null && typeof onViewChange === "function"
    const view = isControlled ? controlledView : ownView
    // Accepts the same updater shape as a setState so every call site below
    // is unchanged whether the viewer owns its view or not.
    const setView = useCallback((next) => {
        const resolve = (prev) => (typeof next === "function" ? next(prev) : next)
        if (isControlled) onViewChange(resolve(controlledView))
        else setOwnView(resolve)
    }, [isControlled, onViewChange, controlledView])
    const [dragging, setDragging] = useState(false)
    const dragFrom = useRef(null)

    const frameSize = () => {
        const el = frameRef.current
        return el ? { w: el.clientWidth, h: el.clientHeight } : { w: 1, h: 1 }
    }

    const reset = useCallback(() => setView(IDENTITY), [])

    // Overlays are positioned in frame pixels, so they need the frame's real
    // size — and need it to follow a resize, or every annotation drifts off
    // its object the moment the pane changes width.
    useEffect(() => {
        const el = frameRef.current
        if (!el) return
        const measure = () => setFrame({ w: el.clientWidth, h: el.clientHeight })
        measure()
        const ro = new ResizeObserver(measure)
        ro.observe(el)
        return () => ro.disconnect()
    }, [])

    useImperativeHandle(ref, () => ({
        reset,
        /** Centre and zoom on a normalised box — "show me this detection". */
        focus(box, { fraction = 0.3 } = {}) {
            if (!box) return
            const { w, h } = frameSize()
            // In FRAME fractions. The box arrives as a fraction of the
            // image, and objectFit:contain letterboxes the image inside
            // the frame — centring on the raw fraction lands beside the
            // object and zooms by the wrong factor.
            const b = boxToFrame(box, containRect(natural, { w, h }), w, h)
            setView(focusOnBox(b, w, h, scaleToFit(b, fraction)))
        },
        get scale() { return view.scale },
    }), [reset, view.scale, natural])

    // Wheel zoom. Registered non-passively because preventDefault on a
    // passive listener is ignored, and without it the page scrolls behind
    // the viewer while the person is trying to zoom into it.
    useEffect(() => {
        const el = frameRef.current
        if (!el) return
        const onWheel = (e) => {
            e.preventDefault()
            const r = el.getBoundingClientRect()
            const factor = Math.exp(-e.deltaY * 0.0015)
            setView((v) => clampPan(
                zoomAbout(v, factor, e.clientX - r.left, e.clientY - r.top),
                r.width, r.height,
            ))
        }
        el.addEventListener("wheel", onWheel, { passive: false })
        return () => el.removeEventListener("wheel", onWheel)
    }, [])

    useEffect(() => {
        const onKey = (e) => {
            // The old tagName test knew nothing about contenteditable, so
            // typing "0" or "-" while writing a document zoomed this
            // viewer underneath the writer.
            if (isTextEntry(e.target)) return
            const { w, h } = frameSize()
            if (e.key === "+" || e.key === "=") setView((v) => clampPan(zoomAbout(v, 1.3, w / 2, h / 2), w, h))
            else if (e.key === "-" || e.key === "_") setView((v) => clampPan(zoomAbout(v, 1 / 1.3, w / 2, h / 2), w, h))
            else if (e.key === "0") reset()
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [reset])

    function onPointerDown(e) {
        if (view.scale <= MIN_SCALE) return          // nothing to pan
        dragFrom.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }
        setDragging(true)
        e.currentTarget.setPointerCapture?.(e.pointerId)
    }
    function onPointerMove(e) {
        const from = dragFrom.current
        if (!from) return
        const dx = e.clientX - from.x
        const dy = e.clientY - from.y
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) from.moved = true
        const { w, h } = frameSize()
        setView((v) => clampPan({ ...v, tx: from.tx + dx, ty: from.ty + dy }, w, h))
    }
    function onPointerUp(e) {
        const from = dragFrom.current
        dragFrom.current = null
        setDragging(false)
        e.currentTarget.releasePointerCapture?.(e.pointerId)
        // A drag must not read as a click, or panning across a scene
        // deselects whatever the person had chosen.
        if (from && !from.moved && onBackgroundClick) onBackgroundClick(e)
    }

    const zoomed = view.scale > MIN_SCALE

    return (
        <div style={fill
            // `fill` makes the viewer take its parent's box instead of a
            // fixed height. With a fixed minHeight a large scene rendered
            // small inside a much larger pane, which is the opposite of
            // what a 10 m/px fetch is for.
            ? { position: "relative", width: "100%", height: "100%",
                minHeight: 0, overflow: "hidden", background: "transparent" }
            : { position: "relative", width: "100%", minHeight,
                overflow: "hidden", background: "transparent" }}>
            <div
                ref={frameRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onDoubleClick={reset}
                style={{
                    position: "relative", width: "100%", height: "100%",
                    minHeight: fill ? 0 : minHeight,
                    overflow: "hidden", touchAction: "none",
                    cursor: dragging ? "grabbing" : zoomed ? "grab" : "default",
                }}
            >
                <div style={{
                    position: "absolute", inset: 0,
                    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
                    transformOrigin: "0 0",
                    transition: dragging ? "none" : "transform 120ms ease-out",
                }}>
                    {src
                        ? <img src={src} alt={alt} draggable={false}
                               onLoad={(e) => setNatural({
                                   w: e.currentTarget.naturalWidth,
                                   h: e.currentTarget.naturalHeight,
                               })}
                               style={{ display: "block", width: "100%", height: "100%", objectFit: stretch ? "fill" : "contain" }} />
                        : null}
                    <ViewerScaleContext.Provider value={view.scale}>
                        {children}
                    </ViewerScaleContext.Provider>
                </div>

                {/* Annotations that must keep a constant on-screen weight.
                    Outside the transform, positioned from the view. */}
                {overlay ? (
                    <ViewerViewContext.Provider
                        value={{ scale: view.scale, tx: view.tx, ty: view.ty,
                                 frameW: frame.w, frameH: frame.h,
                                 ...containRect(natural, frame) }}>
                        <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                            {overlay}
                        </div>
                    </ViewerViewContext.Provider>
                ) : null}
            </div>

            {/* Zoom readout and reset. Without a visible level, a person who
                has zoomed a long way in has no idea how far out they are
                from the whole scene. */}
            <div style={{
                position: "absolute", right: 8, bottom: 8, display: "flex", gap: 6, alignItems: "center",
                font: "400 10px var(--mono)", color: "var(--txt-dim)",
                background: "var(--bg-0)", padding: "2px 6px", borderRadius: 2, opacity: 0.92,
            }}>
                <span>{view.scale.toFixed(1)}×</span>
                {zoomed && (
                    <button onClick={reset} style={{
                        font: "400 10px var(--mono)", color: "var(--acc-hi)",
                        background: "none", border: "none", cursor: "pointer", padding: 0,
                    }}>reset</button>
                )}
            </div>
            {footer}
        </div>
    )
})

export default ZoomPanViewer

/**
 * DetectionArrow — point at one detection.
 *
 * A thin outline around a 4-pixel object in a busy port is genuinely hard to
 * find, and "the ship we mean is this one" is the entire job of a detection
 * notification. The arrow approaches from whichever side has room, so it
 * never points in from outside the frame.
 *
 * Stroke widths are divided by `scale` so the arrow keeps a constant
 * on-screen thickness however far the image is zoomed — otherwise it grows
 * into a slab that hides the object it is indicating.
 */
export function DetectionArrow({ box, scale, colour = "var(--acc-hi)", label }) {
    const ctxScale = useViewerScale()
    scale = scale || ctxScale || 1
    if (!box) return null
    const { tail, head, side } = arrowFor(box)
    const k = Math.max(0.15, 1 / scale)
    return (
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true"
             style={{ position: "absolute", inset: 0, width: "100%", height: "100%",
                      pointerEvents: "none", overflow: "visible" }}>
            <defs>
                <marker id="det-arrow-head" markerWidth="6" markerHeight="6"
                        refX="5" refY="3" orient="auto">
                    <path d="M0,0 L6,3 L0,6 z" fill={colour} />
                </marker>
            </defs>
            <line x1={tail.x} y1={tail.y} x2={head.x} y2={head.y}
                  stroke={colour} strokeWidth={0.004 * k}
                  markerEnd="url(#det-arrow-head)" vectorEffect="non-scaling-stroke" />
            {label ? (
                <text
                    x={tail.x} y={tail.y - 0.012 * k}
                    textAnchor={side === "right" ? "start" : side === "left" ? "end" : "middle"}
                    style={{ font: `400 ${0.022 * k}px var(--mono)`, fill: colour }}
                >{label}</text>
            ) : null}
        </svg>
    )
}
